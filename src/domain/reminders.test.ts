import { describe, expect, it } from 'vitest'
import { DEFAULT_REMINDER_SETTINGS, nextCardDates, reminders } from './index'
import type { Account, LoanPlan, PersonalDebt, Plan, RecurringPlan, Snapshot, Transaction } from './index'

const bank: Account = { id: 'b', name: 'Banka', kind: 'bank', openingBalance: 1000000, openingDate: '2026-10-01' }
const card = (statementDay = 25, dueDays = 10): Account => ({
  id: 'c', name: 'Axess', kind: 'credit_card', openingBalance: 0, openingDate: '2026-10-01',
  card: { statementDay, dueDaysAfterStatement: dueDays },
})

let n = 0
function tx(p: Partial<Transaction>): Transaction {
  return { id: `t${++n}`, date: '2026-10-10', kind: 'expense', amount: 0, accountId: 'b', createdAt: 0, ...p }
}
const spend = (amount: number, date = '2026-10-10') => tx({ accountId: 'c', amount, date })
const pay = (amount: number, date: string) => tx({ kind: 'transfer', accountId: 'b', toAccountId: 'c', amount, date })

function snap(p: { accounts?: Account[]; transactions?: Transaction[]; plans?: Plan[]; debts?: PersonalDebt[] } = {}): Snapshot {
  return { accounts: p.accounts ?? [bank, card()], categories: [], transactions: p.transactions ?? [], plans: p.plans ?? [], debts: p.debts }
}
const S = DEFAULT_REMINDER_SETTINGS

describe('reminders: card kesim', () => {
  it('kesim_soon within N days, with the total so far', () => {
    const r = reminders(snap({ transactions: [spend(100000)] }), '2026-10-22', S)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'kesim_soon:c:2026-10-25', kind: 'kesim_soon', severity: 'info', amount: 100000, date: '2026-10-25' })
    expect(r[0].title).toBe('Axess kesimi 3 gün sonra (25 Ekim)')
    expect(r[0].detail).toBe('Şu ana kadarki dönem borcu: 1.000,00 ₺')
  })

  it('nothing before the window', () => {
    expect(reminders(snap({ transactions: [spend(100000)] }), '2026-10-21', S)).toEqual([])
  })

  it('today / tomorrow wording', () => {
    expect(reminders(snap(), '2026-10-25', S)[0].title).toBe('Axess kesimi bugün (25 Ekim)')
    expect(reminders(snap(), '2026-10-24', S)[0].title).toBe('Axess kesimi yarın (25 Ekim)')
  })

  it('month-end kesim: day 31 is clamped to Feb 28', () => {
    const s = snap({ accounts: [bank, { ...card(31), openingDate: '2027-01-01' }] })
    const r = reminders(s, '2027-02-26', S)
    expect(r.map((x) => [x.id, x.title])).toEqual([['kesim_soon:c:2027-02-28', 'Axess kesimi 2 gün sonra (28 Şubat)']])
  })

  it('kesim_passed in the 7 days after kesim (before due window)', () => {
    const r = reminders(snap({ transactions: [spend(100000)] }), '2026-10-28', S)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'kesim_passed:c:2026-10-25', kind: 'kesim_passed', severity: 'info', amount: 100000 })
    expect(r[0].title).toBe('Axess hesap kesildi')
    expect(r[0].detail).toBe('Dönem borcu 1.000,00 ₺, asgari 200,00 ₺, son ödeme 4 Kasım.')
  })

  it('no statement reminder when the statement total is 0', () => {
    expect(reminders(snap(), '2026-10-28', S)).toEqual([])
  })
})

describe('reminders: card due', () => {
  it('due date crossing months (25 Ekim + 10 = 4 Kasım)', () => {
    const r = reminders(snap({ transactions: [spend(100000)] }), '2026-11-02', S)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'due_soon:c:2026-10-25', kind: 'due_soon', severity: 'warning', date: '2026-11-04', amount: 100000 })
    expect(r[0].title).toBe('Axess son ödemeye 2 gün kaldı')
    expect(r[0].detail).toBe('Ödenecek 1.000,00 ₺, asgari 200,00 ₺. Son ödeme 4 Kasım.')
  })

  it('today / tomorrow wording', () => {
    const s = snap({ transactions: [spend(100000)] })
    expect(reminders(s, '2026-11-04', S)[0].title).toBe('Axess son ödeme günü bugün')
    expect(reminders(s, '2026-11-03', S)[0].title).toBe('Axess son ödeme günü yarın')
  })

  it('due_soon replaces kesim_passed when both apply', () => {
    const s = snap({ accounts: [bank, card(25, 5)], transactions: [spend(100000)] })
    expect(reminders(s, '2026-10-28', S).map((r) => r.kind)).toEqual(['due_soon'])
  })

  it('paid statements produce nothing', () => {
    const s = snap({ transactions: [spend(100000), pay(100000, '2026-10-30')] })
    for (const today of ['2026-10-28', '2026-11-02', '2026-11-10']) expect(reminders(s, today, S)).toEqual([])
  })

  it('past due, min not paid -> danger', () => {
    const r = reminders(snap({ transactions: [spend(100000), pay(10000, '2026-10-30')] }), '2026-11-06', S)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'due_overdue:c:2026-10-25', kind: 'due_overdue', severity: 'danger', amount: 90000 })
    expect(r[0].title).toBe('Axess son ödeme geçti, asgari ödenmedi')
  })

  it('past due, min paid -> amber with remaining, separate id', () => {
    const r = reminders(snap({ transactions: [spend(100000), pay(20000, '2026-10-30')] }), '2026-11-06', S)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'due_overdue:c:2026-10-25:min', kind: 'due_overdue', severity: 'warning', amount: 80000 })
    expect(r[0].title).toBe('Axess asgari ödendi, kalan 800,00 ₺ faiz işleyebilir')
  })

  it('min paid before due -> due_soon mentions remaining', () => {
    const r = reminders(snap({ transactions: [spend(100000), pay(20000, '2026-10-30')] }), '2026-11-03', S)
    expect(r[0].detail).toBe('Asgari ödendi; kalan 800,00 ₺. Son ödeme 4 Kasım.')
  })

  it('archived cards are ignored; settings change the windows', () => {
    const s = snap({ accounts: [bank, { ...card(), archived: true }] })
    expect(reminders(s, '2026-10-25', S)).toEqual([])
    expect(reminders(snap(), '2026-10-20', { kesimDaysBefore: 5, dueDaysBefore: 3 })).toHaveLength(1)
    expect(reminders(snap(), '2026-10-20', { kesimDaysBefore: 4, dueDaysBefore: 3 })).toEqual([])
  })
})

describe('reminders: plans and debts', () => {
  const loan: LoanPlan = {
    id: 'L', name: 'Konut kredisi', kind: 'loan', accountId: 'b', active: true, createdAt: 0,
    installmentAmount: 500000, totalInstallments: 12, firstDueDate: '2026-10-05', preSettledCount: 0,
  }
  const bill = (p: Partial<RecurringPlan>): RecurringPlan => ({
    id: 'E', name: 'Elektrik', kind: 'recurring_expense', accountId: 'b', active: true, createdAt: 0,
    amount: 40000, variable: true, frequency: 'monthly', startDate: '2026-10-20', ...p,
  })
  const salary: RecurringPlan = {
    id: 'M', name: 'Maaş', kind: 'recurring_income', accountId: 'b', active: true, createdAt: 0,
    amount: 4500000, variable: false, frequency: 'monthly', startDate: '2026-10-18',
  }
  const noCard = [bank]

  it('overdue, soon, autopay and income, sorted by urgency then date', () => {
    const s = snap({
      accounts: noCard,
      plans: [loan, bill({}), bill({ id: 'D', name: 'Doğalgaz', startDate: '2026-10-10', bill: { type: 'gas', autopay: true, matchKeywords: [] } }), salary],
      transactions: [tx({ kind: 'expense', amount: 500000, date: '2026-10-05', occurrenceKey: 'L:0' })],
    })
    const r = reminders(s, '2026-10-18', S)
    expect(r.map((x) => [x.id, x.severity, x.title])).toEqual([
      ['payment_soon:E:0', 'warning', 'Elektrik ödemesi 2 gün sonra'],
      ['amount_needed:D:0', 'info', 'Doğalgaz otomatik ödendi, tutarı gir'],
      ['income_expected:M:0', 'info', 'Maaş bugün bekleniyor'],
    ])
    expect(r[0].detail).toBe('20 Ekim · tahmini 400,00 ₺')
  })

  it('overdue loan installment is danger', () => {
    const r = reminders(snap({ accounts: noCard, plans: [loan] }), '2026-10-18', S)
    expect(r.map((x) => [x.id, x.severity, x.title])).toEqual([['payment_overdue:L:0', 'danger', 'Konut kredisi taksiti gecikti']])
  })

  it('personal debts: borrowed due tomorrow, lent overdue', () => {
    const d = (p: Partial<PersonalDebt>): PersonalDebt => ({
      id: 'd1', direction: 'borrowed', counterparty: 'Ali', amount: 100000, date: '2026-10-01', dueDate: '2026-10-19', createdAt: 0, ...p,
    })
    const s = snap({ accounts: noCard, debts: [d({}), d({ id: 'd2', direction: 'lent', counterparty: 'Ayşe', dueDate: '2026-10-15' }), d({ id: 'd3', dueDate: '2026-12-01' })] })
    const r = reminders(s, '2026-10-18', S)
    expect(r.map((x) => [x.id, x.title])).toEqual([
      ['payment_soon:debt:d1:2026-10-19', 'Borç ödemesi (Ali) yarın'],
      ['income_expected:debt:d2:2026-10-15', 'Alacak (Ayşe) vadesi geçti'],
    ])
  })
})

describe('nextCardDates', () => {
  it('open statement kesim; closed unpaid due when still ahead', () => {
    const s = snap({ transactions: [spend(100000)] })
    expect(nextCardDates(card(), s, '2026-10-20')).toEqual({ kesim: '2026-10-25', due: '2026-11-04' })
    expect(nextCardDates(card(), s, '2026-10-28')).toEqual({ kesim: '2026-11-25', due: '2026-11-04' })
    expect(nextCardDates(card(), s, '2026-11-06')).toEqual({ kesim: '2026-11-25', due: '2026-12-05' })
  })
})
