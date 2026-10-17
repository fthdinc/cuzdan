import { describe, expect, it } from 'vitest'
import {
  billHistory, billInfo, billKeywords, billThisMonth, changeRatio, debtSummary, detectBill, estimatedBillAmount,
  matchesKeywords, monthSummary, occurrencesForPlan, upcoming, billDefaultName,
  type RecurringPlan, type Snapshot, type Transaction,
} from './index'

const TODAY = '2026-10-17'
const bill = (p: Partial<RecurringPlan>): RecurringPlan => ({
  id: 'e', name: 'Elektrik', accountId: 'b', active: true, createdAt: 0,
  kind: 'recurring_expense', amount: 50000, variable: true, frequency: 'monthly', startDate: '2026-01-10',
  ...p,
})
const paidTx = (planId: string, i: number, amount: number, date = '2026-01-10'): Transaction =>
  ({ id: `${planId}-${i}`, date, kind: 'expense', amount, accountId: 'b', occurrenceKey: `${planId}:${i}`, createdAt: 0 })
const snapOf = (plans: RecurringPlan[], transactions: Transaction[] = []): Snapshot =>
  ({ accounts: [], categories: [], plans, transactions })

describe('estimatedBillAmount', () => {
  it('averages the last 3 paid occurrences, falls back to plan.amount', () => {
    const p = bill({})
    expect(estimatedBillAmount(p, snapOf([p]))).toBe(50000)
    const s = snapOf([p], [paidTx('e', 0, 10000), paidTx('e', 5, 30000), paidTx('e', 3, 20000), paidTx('e', 4, 40001)])
    expect(estimatedBillAmount(p, s)).toBe(30000) // indexes 5, 4, 3
  })
  it('fixed plans keep their amount', () => {
    const p = bill({ variable: false })
    expect(estimatedBillAmount(p, snapOf([p], [paidTx('e', 0, 10000)]))).toBe(50000)
  })
  it('is the expected amount of unpaid occurrences; overrides still win; paid ones keep plan.amount', () => {
    const p = bill({ overrides: { 10: { amount: 99900 } } })
    const s = snapOf([p], [paidTx('e', 7, 60000), paidTx('e', 8, 66000)])
    const occ = occurrencesForPlan(p, s, TODAY, '2026-12-31')
    expect(occ[7].expected).toBe(50000)
    expect(occ[9].expected).toBe(63000) // 2026-10-10, overdue
    expect(occ[10].expected).toBe(99900)
    expect(occ[11].expected).toBe(63000)
  })
  it('summaries use the estimate consistently', () => {
    const p = bill({ startDate: '2026-10-20', settledBefore: undefined })
    const s = snapOf([p], [])
    const p2 = { ...p, startDate: '2026-08-20' }
    const s2 = snapOf([p2], [paidTx('e', 0, 70000), paidTx('e', 1, 80000)])
    expect(monthSummary(s, '2026-10', TODAY).projectedExpense).toBe(50000)
    expect(monthSummary(s2, '2026-10', TODAY).projectedExpense).toBe(75000)
    const up = upcoming(s2, TODAY, '2026-11-30')
    expect(up.map((u) => u.amount)).toEqual([75000, 75000])
  })
})

describe('autopay', () => {
  const p = bill({ startDate: '2026-09-05', bill: { type: 'electricity', autopay: true, matchKeywords: ['enerjisa'] } })
  it('past-due unpaid occurrences are autopay_pending, not overdue', () => {
    const occ = occurrencesForPlan(p, snapOf([p]), TODAY, '2026-11-30')
    expect(occ.map((o) => o.status)).toEqual(['autopay_pending', 'autopay_pending', 'pending'])
    const paid = occurrencesForPlan(p, snapOf([p], [paidTx('e', 0, 1)]), TODAY, '2026-11-30')
    expect(paid[0].status).toBe('paid')
  })
  it('included in upcoming and projected expense, not in loans debt', () => {
    const s = snapOf([p])
    const up = upcoming(s, TODAY, '2026-10-31')
    expect(up.map((u) => u.type === 'occurrence' && u.occurrence.status)).toEqual(['autopay_pending', 'autopay_pending'])
    expect(monthSummary(s, '2026-10', TODAY).projectedExpense).toBe(50000)
    expect(debtSummary(s, TODAY).total).toBe(0)
  })
  it('plans without bill info default to other / no autopay', () => {
    const legacy = bill({ startDate: '2026-09-05' })
    expect(billInfo(legacy)).toEqual({ type: 'other', autopay: false, matchKeywords: [] })
    expect(occurrencesForPlan(legacy, snapOf([legacy]), TODAY, '2026-10-31').map((o) => o.status)).toEqual(['overdue', 'overdue'])
  })
})

describe('billHistory / billThisMonth', () => {
  const p = bill({ startDate: '2025-09-10' })
  const s = snapOf([p], [
    paidTx('e', 0, 40000), // 2025-09
    paidTx('e', 1, 45000), // 2025-10
    paidTx('e', 11, 50000), // 2026-08
    paidTx('e', 12, 60000), // 2026-09
  ])
  it('monthly paid amounts with previous month and same month last year', () => {
    const h = billHistory(p, s, TODAY, 3)
    expect(h).toEqual([
      { month: '2026-08', amount: 50000, prev: null, lastYear: null },
      { month: '2026-09', amount: 60000, prev: 50000, lastYear: 40000 },
      { month: '2026-10', amount: null, prev: 60000, lastYear: 45000 },
    ])
    expect(billHistory(p, s, TODAY, 12)).toHaveLength(12)
    expect(changeRatio(60000, 50000)).toBeCloseTo(0.2)
    expect(changeRatio(null, 50000)).toBeNull()
    expect(changeRatio(1, 0)).toBeNull()
  })
  it("this month's state: estimate for unpaid, actual when paid", () => {
    const m = billThisMonth(p, s, TODAY) // last 3 paid: 60000, 50000, 45000
    expect(m).toMatchObject({ amount: 51667, estimated: true, status: 'overdue' })
    const paid = billThisMonth(p, { ...s, transactions: [...s.transactions, paidTx('e', 13, 51234)] }, TODAY)
    expect(paid).toMatchObject({ amount: 51234, estimated: false, status: 'paid' })
  })
})

describe('provider catalog', () => {
  it('detects providers diacritic-insensitively as whole words', () => {
    expect(detectBill('ENERJİSA İSTANBUL ANADOLU YAKASI')).toMatchObject({ type: 'electricity', provider: 'Enerjisa', autopay: false })
    expect(detectBill('IGDAS FATURA OTOMATIK ODEME TALIMATI')).toMatchObject({ type: 'gas', provider: 'İGDAŞ', autopay: true })
    expect(detectBill('İSKİ SU FATURASI')).toMatchObject({ type: 'water', provider: 'İSKİ' })
    expect(detectBill('TURKCELL-FATURA 5321234567')).toMatchObject({ type: 'phone', provider: 'Turkcell' })
    expect(detectBill('TÜRK TELEKOM ANKARA')).toMatchObject({ type: 'internet', provider: 'Türk Telekom' })
    expect(detectBill('NETFLIX.COM AMSTERDAM')).toMatchObject({ type: 'tv', provider: 'Netflix' })
    expect(detectBill('GOOGLE *YouTubePremium')).toMatchObject({ type: 'subscription', provider: 'YouTube Premium' })
    expect(detectBill('D-SMART ODEME')).toMatchObject({ type: 'tv', provider: 'D-Smart' })
    expect(detectBill('MIGROS ATASEHIR')).toBeNull()
    expect(detectBill('KASKI MARKET')).toBeNull() // "aski" only as a whole word
  })
  it('generic fatura patterns without a known provider', () => {
    expect(detectBill('XYZ ENERJI FATURA OTOMATIK ODEME TALIMATI 123456')).toEqual({ type: 'other', keywords: ['xyz enerji'], autopay: true })
    expect(detectBill('ABC ELEKTRIK FATURASI')).toMatchObject({ type: 'electricity', keywords: ['abc elektrik'], autopay: false })
    expect(detectBill('KREDI KARTI OTOMATIK ODEME')).toBeNull()
  })
  it('keyword matching and plan keywords', () => {
    expect(matchesKeywords('CK BOĞAZİÇİ ELEKTRİK', ['bogazici elektrik'])).toBe(true)
    expect(matchesKeywords('SPOTIFYAB', ['spotify'])).toBe(false)
    expect(billKeywords({ name: 'x', bill: { provider: 'Enerjisa', matchKeywords: [] } })).toContain('Enerjisa')
    expect(billKeywords({ name: 'x', bill: { matchKeywords: ['abc'] } })).toEqual(['abc'])
    expect(billKeywords({ name: 'Turkcell hattım' })).toContain('Turkcell')
    expect(billKeywords({ name: 'Kira' })).toEqual([])
  })
  it('default names', () => {
    expect(billDefaultName('electricity', 'Enerjisa')).toBe('Enerjisa elektrik')
    expect(billDefaultName('internet', 'Türknet')).toBe('Türknet internet')
    expect(billDefaultName('water', 'Su idaresi')).toBe('Su idaresi')
    expect(billDefaultName('tv', 'Netflix')).toBe('Netflix')
    expect(billDefaultName('gas', undefined)).toBe('Doğalgaz')
  })
})
