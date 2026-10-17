import { describe, expect, it } from 'vitest'
import { loanFromRemaining, loanProgress, occurrencesForPlan } from './index'
import type { LoanPlan, RecurringPlan, Snapshot, Transaction } from './index'

const empty: Snapshot = { accounts: [], transactions: [], plans: [], categories: [] }

function recurring(p: Partial<RecurringPlan>): RecurringPlan {
  return {
    id: 'r', name: 'Fatura', accountId: 'b', active: true, createdAt: 0,
    kind: 'recurring_expense', amount: 50000, variable: false, frequency: 'monthly', startDate: '2026-01-31',
    ...p,
  }
}

function tx(p: Partial<Transaction>): Transaction {
  return { id: 't', date: '2026-01-01', kind: 'expense', amount: 0, accountId: 'b', createdAt: 0, ...p }
}

const loan: LoanPlan = {
  id: 'l', name: 'Kredi', accountId: 'b', active: true, createdAt: 0,
  kind: 'loan', installmentAmount: 100000, totalInstallments: 12, firstDueDate: '2026-06-10', preSettledCount: 3,
}

describe('occurrencesForPlan dates', () => {
  it('monthly computed from startDate with clamping', () => {
    const occ = occurrencesForPlan(recurring({}), empty, '2026-01-01', '2026-04-30')
    expect(occ.map((o) => o.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(occ.map((o) => o.key)).toEqual(['r:0', 'r:1', 'r:2', 'r:3'])
  })
  it('weekly', () => {
    const occ = occurrencesForPlan(recurring({ frequency: 'weekly', startDate: '2026-10-01' }), empty, '2026-01-01', '2026-10-22')
    expect(occ.map((o) => o.dueDate)).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'])
  })
  it('yearly from leap day', () => {
    const occ = occurrencesForPlan(recurring({ frequency: 'yearly', startDate: '2024-02-29' }), empty, '2020-01-01', '2026-12-31')
    expect(occ.map((o) => o.dueDate)).toEqual(['2024-02-29', '2025-02-28', '2026-02-28'])
  })
  it('stops at endDate inclusive', () => {
    const occ = occurrencesForPlan(recurring({ startDate: '2026-01-10', endDate: '2026-03-10' }), empty, '2026-01-01', '2027-01-01')
    expect(occ.map((o) => o.dueDate)).toEqual(['2026-01-10', '2026-02-10', '2026-03-10'])
  })
  it('inactive and card_installment produce nothing', () => {
    expect(occurrencesForPlan(recurring({ active: false }), empty, '2026-01-01', '2027-01-01')).toEqual([])
    expect(occurrencesForPlan({
      id: 'c', name: 'TV', accountId: 'card', active: true, createdAt: 0,
      kind: 'card_installment', totalAmount: 1000, installmentCount: 2, purchaseDate: '2026-01-01', preSettledCount: 0,
    }, empty, '2026-01-01', '2027-01-01')).toEqual([])
  })
  it('loan stops at totalInstallments', () => {
    const occ = occurrencesForPlan(loan, empty, '2026-10-17', '2030-01-01')
    expect(occ).toHaveLength(12)
    expect(occ[11].dueDate).toBe('2027-05-10')
  })
})

describe('occurrence status', () => {
  it('paid / skipped / override / overdue / pending', () => {
    const plan = recurring({ startDate: '2026-08-01', overrides: { 1: { skipped: true }, 3: { amount: 70000 } } })
    const snap: Snapshot = { ...empty, transactions: [tx({ id: 'tx1', amount: 52000, occurrenceKey: 'r:0', date: '2026-08-02' })] }
    const occ = occurrencesForPlan(plan, snap, '2026-10-17', '2026-11-30')
    expect(occ.map((o) => o.status)).toEqual(['paid', 'skipped', 'overdue', 'pending'])
    expect(occ[0]).toMatchObject({ transactionId: 'tx1', actual: 52000, expected: 50000 })
    expect(occ[3].expected).toBe(70000)
    // due today is pending, not overdue
    const occ2 = occurrencesForPlan(recurring({ startDate: '2026-10-17' }), empty, '2026-10-17', '2026-10-17')
    expect(occ2[0].status).toBe('pending')
  })
  it('loan presettled wins', () => {
    const snap: Snapshot = { ...empty, transactions: [tx({ id: 'p', amount: 100000, occurrenceKey: 'l:3' })] }
    const occ = occurrencesForPlan(loan, snap, '2026-10-17', '2026-11-30')
    expect(occ.map((o) => o.status)).toEqual(['presettled', 'presettled', 'presettled', 'paid', 'overdue', 'pending'])
  })
})

describe('loanProgress', () => {
  it('counts presettled + paid', () => {
    const snap: Snapshot = { ...empty, transactions: [tx({ id: 'p', amount: 100000, occurrenceKey: 'l:3' })] }
    const pr = loanProgress(loan, snap, '2026-10-17')
    expect(pr.paidCount).toBe(4)
    expect(pr.remainingCount).toBe(8)
    expect(pr.remainingAmount).toBe(800000)
    expect(pr.nextDue).toMatchObject({ index: 4, dueDate: '2026-10-10', status: 'overdue' })
  })
  it('fully paid loan has no nextDue', () => {
    const pr = loanProgress({ ...loan, preSettledCount: 12 }, empty, '2026-10-17')
    expect(pr).toMatchObject({ paidCount: 12, remainingCount: 0, remainingAmount: 0 })
    expect(pr.nextDue).toBeUndefined()
  })
})

describe('bug fixes', () => {
  it('loan due dates keep dueDay after month-end clamping', () => {
    const p = loanFromRemaining({
      id: 'l', name: 'Kredi', accountId: 'b', createdAt: 1,
      installmentAmount: 100000, totalInstallments: 12, remainingInstallments: 11, nextDueDate: '2026-03-31',
    })
    expect(p.firstDueDate).toBe('2026-02-28')
    expect(p.dueDay).toBe(31)
    const occ = occurrencesForPlan(p, empty, '2026-03-01', '2027-12-31')
    expect(occ.map((o) => o.dueDate).slice(0, 5)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'])
    expect(occ).toHaveLength(12)
    expect(occ[11].dueDate).toBe('2027-01-31')
    expect(loanProgress(p, empty, '2026-03-01')).toMatchObject({ paidCount: 1, remainingCount: 11 })
  })
  it('loan without dueDay uses firstDueDate day', () => {
    const occ = occurrencesForPlan({ ...loan, firstDueDate: '2026-01-31', preSettledCount: 0 }, empty, '2026-01-01', '2026-03-31')
    expect(occ.map((o) => o.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })
  it('recurring settledBefore -> presettled unless paid by tx', () => {
    const plan = recurring({ startDate: '2026-07-01', settledBefore: '2026-09-01', overrides: { 0: { skipped: true } } })
    const snap: Snapshot = { ...empty, transactions: [tx({ id: 'x', amount: 50000, occurrenceKey: 'r:1' })] }
    const occ = occurrencesForPlan(plan, snap, '2026-10-17', '2026-10-31')
    expect(occ.map((o) => o.status)).toEqual(['presettled', 'paid', 'overdue', 'overdue'])
  })
})
