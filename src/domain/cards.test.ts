import { describe, expect, it } from 'vitest'
import {
  accountBalance, cardFutureInstallments, cardStatements, debtSummary, minPaymentRate, monthSummary, upcoming,
} from './index'
import type { Account, CardInstallmentPlan, Plan, Snapshot, Transaction } from './index'

const TODAY = '2026-10-17'

const bank: Account = { id: 'b', name: 'Banka', kind: 'bank', openingBalance: 1000000, openingDate: '2026-08-01' }
const card: Account = {
  id: 'c', name: 'Kart', kind: 'credit_card', openingBalance: -100000, openingDate: '2026-08-10',
  card: { limit: 3000000, statementDay: 5, dueDaysAfterStatement: 10 },
}

let n = 0
function tx(p: Partial<Transaction>): Transaction {
  return { id: `t${++n}`, date: '2026-01-01', kind: 'expense', amount: 0, accountId: 'b', createdAt: 0, ...p }
}
function inst(p: Partial<CardInstallmentPlan>): CardInstallmentPlan {
  return {
    id: 'i', name: 'TV', accountId: 'c', active: true, createdAt: 0, categoryId: 'elec',
    kind: 'card_installment', totalAmount: 100001, installmentCount: 3, purchaseDate: '2026-09-01', preSettledCount: 0,
    ...p,
  }
}

function fixture(extraPlans: Plan[] = [], extraTx: Transaction[] = []): Snapshot {
  return {
    accounts: [bank, card],
    categories: [],
    plans: [inst({}), ...extraPlans],
    transactions: [
      tx({ accountId: 'c', date: '2026-08-20', amount: 20000 }),
      tx({ kind: 'transfer', accountId: 'b', toAccountId: 'c', date: '2026-09-10', amount: 50000 }),
      tx({ accountId: 'c', date: '2026-09-20', amount: 30000 }),
      tx({ kind: 'transfer', accountId: 'b', toAccountId: 'c', date: '2026-10-12', amount: 10000 }),
      tx({ accountId: 'c', date: '2026-10-10', amount: 5000 }),
      ...extraTx,
    ],
  }
}

describe('cardStatements', () => {
  const st = cardStatements(card, fixture(), TODAY)

  it('periods from openingDate through open period', () => {
    expect(st.map((s) => [s.periodStart, s.periodEnd, s.dueDate])).toEqual([
      ['2026-08-10', '2026-09-05', '2026-09-15'],
      ['2026-09-06', '2026-10-05', '2026-10-15'],
      ['2026-10-06', '2026-11-05', '2026-11-15'],
    ])
  })
  it('first statement: opening debt + spending + part 0 (with remainder)', () => {
    expect(st[0]).toMatchObject({
      spending: 20000, total: 153335, minPayment: 30667, paid: 50000, status: 'min_paid',
      installmentParts: [{ planId: 'i', index: 0, amount: 33335 }],
    })
  })
  it('second statement carries over and is overdue', () => {
    expect(st[1]).toMatchObject({
      spending: 30000, total: 166668, minPayment: 33334, paid: 10000, status: 'overdue',
      installmentParts: [{ planId: 'i', index: 1, amount: 33333 }],
    })
  })
  it('current period is open', () => {
    expect(st[2]).toMatchObject({ spending: 5000, status: 'open', installmentParts: [{ index: 2, amount: 33333 }] })
  })
  it('status variants', () => {
    const paidFull = cardStatements(card, fixture([], [
      tx({ kind: 'transfer', accountId: 'b', toAccountId: 'c', date: '2026-10-14', amount: 156668 }),
    ]), TODAY)
    expect(paidFull[1].status).toBe('paid')
    const beforeDue = cardStatements(card, fixture(), '2026-10-08')
    expect(beforeDue[1].status).toBe('partial')
    expect(beforeDue).toHaveLength(3)
    const nothingPaid = cardStatements(card, { ...fixture(), transactions: [] }, '2026-10-08')
    expect(nothingPaid[1].status).toBe('unpaid')
    expect(nothingPaid[0].status).toBe('overdue')
  })
  it('statementDay clamps to month end', () => {
    const c31: Account = { ...card, openingDate: '2026-01-15', card: { limit: 1, statementDay: 31, dueDaysAfterStatement: 10 } }
    const s = cardStatements(c31, { ...fixture(), plans: [], transactions: [] }, '2026-03-01')
    expect(s.map((x) => x.periodEnd)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    expect(s[1].periodStart).toBe('2026-02-01')
    expect(s[1].dueDate).toBe('2026-03-10')
  })
  it('non-card account has no statements', () => {
    expect(cardStatements(bank, fixture(), TODAY)).toEqual([])
  })
})

describe('balances', () => {
  it('card balance includes billed parts only', () => {
    expect(accountBalance(card, fixture(), TODAY)).toBe(-161668)
    expect(cardFutureInstallments(card, fixture(), TODAY)).toBe(33333)
  })
  it('bank balance with transfers and adjustments', () => {
    const snap = fixture([], [
      tx({ kind: 'income', amount: 4500000, date: '2026-10-01' }),
      tx({ kind: 'expense', amount: 12000, date: '2026-10-03' }),
      tx({ kind: 'adjustment', amount: -500, date: '2026-10-04' }),
      tx({ kind: 'income', amount: 999, date: '2026-10-18' }), // after asOf
    ])
    expect(accountBalance(bank, snap, TODAY)).toBe(1000000 - 60000 + 4500000 - 12000 - 500)
  })
  it('presettled parts and parts before first statement are ignored', () => {
    const snap: Snapshot = {
      ...fixture(), transactions: [],
      plans: [
        // Jun..Nov kesims; parts 0-3 presettled -> Oct + Nov remain
        inst({ id: 'a', totalAmount: 60000, installmentCount: 6, purchaseDate: '2026-06-01', preSettledCount: 4 }),
        // Jul, Aug, Sep kesims; only Sep is inside the card's first statement
        inst({ id: 'b', totalAmount: 30000, installmentCount: 3, purchaseDate: '2026-07-01' }),
      ],
    }
    expect(accountBalance(card, snap, TODAY)).toBe(-100000 - 10000 - 10000)
    expect(cardFutureInstallments(card, snap, TODAY)).toBe(10000)
  })
  it('minPaymentRate', () => {
    expect(minPaymentRate(card)).toBe(0.2)
    expect(minPaymentRate({ ...card, card: { ...card.card!, limit: 5000000 } })).toBe(0.4)
    expect(minPaymentRate({ ...card, card: { ...card.card!, minPaymentRate: 0.3 } })).toBe(0.3)
  })
})

describe('summaries', () => {
  const salary: Plan = {
    id: 's', name: 'Maaş', accountId: 'b', active: true, createdAt: 0, kind: 'recurring_income',
    amount: 4500000, variable: false, frequency: 'monthly', startDate: '2026-09-25',
  }
  const bill: Plan = {
    id: 'e', name: 'Elektrik', accountId: 'b', active: true, createdAt: 0, kind: 'recurring_expense', categoryId: 'elec',
    amount: 50000, variable: true, frequency: 'monthly', startDate: '2026-09-01',
  }
  const snap = fixture([salary, bill], [
    tx({ kind: 'income', amount: 4500000, date: '2026-10-01', categoryId: 'sal' }),
    tx({ kind: 'expense', amount: 12000, date: '2026-10-03', categoryId: 'market', occurrenceKey: 'e:1' }),
    tx({ kind: 'adjustment', amount: -500, date: '2026-10-04' }),
    tx({ kind: 'expense', amount: 7000, date: '2026-09-30', categoryId: 'market' }),
  ])

  it('monthSummary', () => {
    const m = monthSummary(snap, '2026-10', TODAY)
    expect(m.income).toBe(4500000)
    // 120 market + 50 card spending + 333,33 installment part (Oct 5 kesim)
    expect(m.expense).toBe(12000 + 5000 + 33333)
    expect(m.net).toBe(4500000 - 50333)
    expect(m.projectedIncome).toBe(4500000) // Oct 25 salary pending
    // Oct 1 bill paid; statement due Oct 15 remainder 166668-10000
    expect(m.projectedExpense).toBe(156668)
    expect(m.byCategory).toEqual([
      { categoryId: 'elec', amount: 33333 },
      { categoryId: 'market', amount: 12000 },
      { categoryId: null, amount: 5000 },
    ])
  })

  it('upcoming: overdue + pending + latest closed statement, sorted', () => {
    const items = upcoming(snap, TODAY, '2026-11-16')
    expect(items.map((i) => [i.type, i.dueDate, i.amount])).toEqual([
      ['occurrence', '2026-09-01', 50000],
      ['occurrence', '2026-09-25', 4500000],
      ['statement', '2026-10-15', 156668],
      ['occurrence', '2026-10-25', 4500000],
      ['occurrence', '2026-11-01', 50000],
    ])
  })

  it('debtSummary', () => {
    const loan: Plan = {
      id: 'l', name: 'Kredi', accountId: 'b', active: true, createdAt: 0,
      kind: 'loan', installmentAmount: 100000, totalInstallments: 12, firstDueDate: '2026-06-10', preSettledCount: 3,
    }
    const s = fixture([loan], [tx({ amount: 100000, occurrenceKey: 'l:3', date: '2026-09-10' })])
    expect(debtSummary(s, TODAY)).toEqual({
      loansRemaining: 800000, cardsCurrent: 161668, cardsFutureInstallments: 33333,
      total: 800000 + 161668 + 33333,
    })
  })
})
