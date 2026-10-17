import { describe, expect, it } from 'vitest'
import { accountBalance, balanceForecast, debtStatus, debtSummary, monthSummary, overdraftUsage } from './index'
import type { Account, PersonalDebt, Plan, Snapshot, Transaction } from './index'

const TODAY = '2026-10-17'
const bank: Account = { id: 'b', name: 'Banka', kind: 'bank', openingBalance: 100000, openingDate: '2026-10-01', overdraftLimit: 300000 }
const cash: Account = { id: 'n', name: 'Nakit', kind: 'cash', openingBalance: 0, openingDate: '2026-10-01' }

let n = 0
function tx(p: Partial<Transaction>): Transaction {
  return { id: `t${++n}`, date: '2026-10-01', kind: 'expense', amount: 0, accountId: 'b', createdAt: n, ...p }
}
function debt(p: Partial<PersonalDebt>): PersonalDebt {
  return { id: 'd', direction: 'borrowed', counterparty: 'Ali', amount: 100000, date: '2026-10-02', createdAt: 0, ...p }
}
const snap = (p: Partial<Snapshot>): Snapshot => ({ accounts: [bank], transactions: [], plans: [], categories: [], ...p })

describe('debtStatus', () => {
  const d = debt({ accountId: 'b', dueDate: '2026-10-15' })
  const s = snap({
    debts: [d],
    transactions: [
      tx({ kind: 'income', amount: 100000, date: '2026-10-02', debtId: 'd' }), // principal
      tx({ kind: 'expense', amount: 30000, date: '2026-10-10', debtId: 'd' }), // payment
      tx({ kind: 'expense', amount: 10000, date: '2026-10-12', debtId: 'd' }),
    ],
  })
  it('borrowed: payments are expense tx, principal is not a payment', () => {
    const st = debtStatus(d, s, TODAY)
    expect(st).toMatchObject({ paid: 40000, remaining: 60000, overdue: true, done: false })
    expect(st.payments.map((t) => t.amount)).toEqual([30000, 10000])
    expect(st.principalTx?.amount).toBe(100000)
    expect(debtStatus(d, s, '2026-10-15').overdue).toBe(false)
  })
  it('lent: payments are income tx; paid in full is done', () => {
    const l = debt({ direction: 'lent', dueDate: '2026-10-01' })
    const s2 = snap({ debts: [l], transactions: [tx({ kind: 'income', amount: 100000, debtId: 'd' })] })
    expect(debtStatus(l, s2, TODAY)).toMatchObject({ paid: 100000, remaining: 0, overdue: false, done: true })
  })
  it('closed debt has nothing remaining', () => {
    expect(debtStatus({ ...d, closed: true }, s, TODAY)).toMatchObject({ remaining: 0, done: true, overdue: false })
  })
  it('debt tx move the balance but are not income/expense', () => {
    expect(accountBalance(bank, s, TODAY)).toBe(100000 + 100000 - 40000)
    expect(monthSummary(s, '2026-10', TODAY)).toMatchObject({ income: 0, expense: 0 })
  })
})

describe('overdraft', () => {
  it('overdraftUsage with and without limit', () => {
    const s = snap({ accounts: [bank, cash], transactions: [tx({ amount: 350000 }), tx({ accountId: 'n', amount: 5000 })] })
    expect(overdraftUsage(bank, s, TODAY)).toEqual({ used: 250000, limit: 300000, over: false })
    expect(overdraftUsage({ ...bank, overdraftLimit: 200000 }, s, TODAY)).toEqual({ used: 250000, limit: 200000, over: true })
    expect(overdraftUsage(cash, s, TODAY)).toEqual({ used: 5000, over: false })
    expect(overdraftUsage({ ...bank, openingBalance: 1000000 }, s, TODAY)).toEqual({ used: 0, limit: 300000, over: false })
  })
  it('debtSummary: overdraft and personal debts in total, receivables separate', () => {
    const s = snap({
      accounts: [bank, cash],
      transactions: [tx({ amount: 350000 }), tx({ kind: 'expense', amount: 20000, debtId: 'd' })],
      debts: [debt({}), debt({ id: 'l', direction: 'lent', amount: 70000 }), debt({ id: 'c', amount: 999, closed: true })],
    })
    expect(debtSummary(s, TODAY)).toEqual({
      loansRemaining: 0, cardsCurrent: 0, cardsFutureInstallments: 0,
      overdraft: 270000, personalDebts: 80000, total: 350000, receivables: 70000,
    })
  })
})

describe('balanceForecast', () => {
  const rent: Plan = {
    id: 'r', name: 'Kira', accountId: 'b', active: true, createdAt: 0, kind: 'recurring_expense',
    amount: 200000, variable: false, frequency: 'monthly', startDate: '2026-10-24',
  }
  const base = snap({
    plans: [rent],
    transactions: [tx({ kind: 'income', amount: 500000, date: '2026-10-05' }), tx({ amount: 450000, date: '2026-10-10' })],
  })

  it('actual past days, projected future, negative crossing', () => {
    const f = balanceForecast(base, TODAY, '2026-10')
    expect(f.days).toHaveLength(31)
    expect(f.days[0]).toEqual({ date: '2026-10-01', balance: 100000, projected: false })
    expect(f.days[4]).toEqual({ date: '2026-10-05', balance: 600000, projected: false })
    expect(f.days[16]).toEqual({ date: '2026-10-17', balance: 150000, projected: false })
    expect(f.days[17]).toEqual({ date: '2026-10-18', balance: 150000, projected: true })
    expect(f.days[23]).toEqual({ date: '2026-10-24', balance: -50000, projected: true })
    expect(f).toMatchObject({
      endBalance: -50000, minBalance: -50000, firstNegativeDate: '2026-10-24',
      incomeThisMonth: 500000, expenseThisMonth: 450000, spentRatio: 0.9, overdraftLimit: 300000,
    })
  })

  it('overdue occurrences are applied today; card-paid plans are skipped', () => {
    const loan: Plan = {
      id: 'l', name: 'Kredi', accountId: 'b', active: true, createdAt: 0,
      kind: 'loan', installmentAmount: 30000, totalInstallments: 2, firstDueDate: '2026-10-12', preSettledCount: 0,
    }
    const card: Account = { id: 'c', name: 'Kart', kind: 'credit_card', openingBalance: 0, openingDate: '2026-10-01', card: { limit: 1, statementDay: 28, dueDaysAfterStatement: 20 } }
    const onCard: Plan = { ...rent, id: 'x', accountId: 'c', startDate: '2026-10-20' }
    const f = balanceForecast({ ...base, accounts: [bank, card], plans: [rent, loan, onCard] }, TODAY, '2026-10')
    expect(f.days[16]).toEqual({ date: '2026-10-17', balance: 120000, projected: true })
    expect(f.days[23].balance).toBe(-80000)
    expect(f.endBalance).toBe(-80000) // loan installment 2 is due 2026-11-12
  })

  it('card statement due in the month is paid from liquid money', () => {
    const card: Account = {
      id: 'c', name: 'Kart', kind: 'credit_card', openingBalance: -80000, openingDate: '2026-09-25',
      card: { limit: 1000000, statementDay: 20, dueDaysAfterStatement: 10 },
    }
    const s = { ...base, accounts: [bank, card], plans: [], transactions: [...base.transactions, tx({ accountId: 'c', amount: 20000, date: '2026-10-01' })] }
    const f = balanceForecast(s, TODAY, '2026-10')
    expect(f.days[28].balance).toBe(150000) // 29th
    expect(f.days[29]).toEqual({ date: '2026-10-30', balance: 50000, projected: true })
    expect(f.expenseThisMonth).toBe(470000)
  })

  it('unpaid closed statement: only the remaining, applied today; open statement adds only new debt', () => {
    const card: Account = {
      id: 'c', name: 'Kart', kind: 'credit_card', openingBalance: -80000, openingDate: '2026-09-01',
      card: { limit: 1000000, statementDay: 5, dueDaysAfterStatement: 10 },
    }
    const s = {
      ...base, accounts: [bank, card], plans: [],
      transactions: [...base.transactions, tx({ kind: 'transfer', toAccountId: 'c', amount: 30000, date: '2026-10-07' }), tx({ accountId: 'c', amount: 5000, date: '2026-10-08' })],
    }
    // kesim 10-05: 80000, paid 30000 -> 50000 applied today. Open kesim 11-05 (total 55000) due 11-15.
    expect(balanceForecast(s, TODAY, '2026-10').days[16].balance).toBe(120000 - 50000)
    const nov = balanceForecast(s, TODAY, '2026-11')
    expect(nov.days[13].balance).toBe(70000)
    expect(nov.days[14].balance).toBe(70000 - 5000) // 11-15: 55000 - 50000 carried
  })

  it('month boundaries: past month all actual, future month all projected from today', () => {
    const sep = balanceForecast({ ...base, accounts: [{ ...bank, openingDate: '2026-09-01' }] }, TODAY, '2026-09')
    expect(sep.days).toHaveLength(30)
    expect(sep.days.every((d) => !d.projected)).toBe(true)
    expect(sep.days[29]).toEqual({ date: '2026-09-30', balance: 100000, projected: false })
    const nov = balanceForecast(base, TODAY, '2026-11')
    expect(nov.days).toHaveLength(30)
    expect(nov.days.every((d) => d.projected)).toBe(true)
    expect(nov.days[0].balance).toBe(-50000)
    expect(nov.days[23].balance).toBe(-250000)
    expect(nov).toMatchObject({ firstNegativeDate: '2026-11-01', incomeThisMonth: 0, spentRatio: null })
  })

  it('personal debts: borrowed repayment due, lent collection only if not overdue', () => {
    const s = {
      ...base, plans: [],
      debts: [
        debt({ dueDate: '2026-10-28' }),
        debt({ id: 'l1', direction: 'lent', amount: 25000, dueDate: '2026-10-26' }),
        debt({ id: 'l2', direction: 'lent', amount: 99999, dueDate: '2026-10-01' }),
        debt({ id: 'nodue', amount: 77777 }),
      ] as PersonalDebt[],
      transactions: [...base.transactions, tx({ amount: 40000, date: '2026-10-11', debtId: 'd' })],
    }
    const f = balanceForecast(s, TODAY, '2026-10')
    expect(f.days[16].balance).toBe(110000)
    expect(f.days[25].balance).toBe(135000)
    expect(f.days[27].balance).toBe(75000)
    expect(f.endBalance).toBe(75000)
  })
})
