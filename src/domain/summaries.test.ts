import { describe, expect, it } from 'vitest'
import { monthSummary } from './index'
import type { Account, Snapshot, Transaction } from './index'

const bank: Account = { id: 'b', name: 'Ana hesap', kind: 'bank', openingBalance: 0, openingDate: '2000-01-01' }
const cash: Account = { id: 'c', name: 'Cüzdan', kind: 'cash', openingBalance: 0, openingDate: '2000-01-01' }
const axess: Account = {
  id: 'ax', name: 'Axess Kredi Kartı', kind: 'credit_card', openingBalance: 0, openingDate: '2026-10-01',
  card: { statementDay: 5, dueDaysAfterStatement: 10 },
}

let n = 0
const tx = (p: Partial<Transaction>): Transaction => ({ id: `t${++n}`, date: '2026-10-10', kind: 'expense', amount: 1000, accountId: 'b', createdAt: 0, ...p })
const snapOf = (transactions: Transaction[]): Snapshot => ({ accounts: [bank, cash, axess], categories: [], plans: [], transactions })
const income = tx({ kind: 'income', amount: 100000 })
const sum = (txs: Transaction[]) => monthSummary(snapOf([income, ...txs]), '2026-10', '2026-10-18')

describe('monthSummary cashOut (Hesaptan çıkan)', () => {
  it('card purchase only: spent, but nothing left bank/cash', () => {
    expect(sum([tx({ accountId: 'ax', amount: 5000 })])).toMatchObject({
      expense: 5000, cardExpense: 5000, cashOut: 0, cardPayments: 0, net: 95000, cashNet: 100000,
    })
  })

  it('card payment only: cashOut = payment, not an expense', () => {
    expect(sum([tx({ kind: 'transfer', toAccountId: 'ax', amount: 3000000 })])).toMatchObject({
      expense: 0, cashOut: 3000000, cardPayments: 3000000, cashNet: 100000 - 3000000,
    })
  })

  it('bank/cash expense + card payment', () => {
    expect(sum([
      tx({ amount: 2000 }),
      tx({ accountId: 'c', amount: 500 }),
      tx({ accountId: 'ax', amount: 7000 }),
      tx({ kind: 'transfer', accountId: 'c', toAccountId: 'ax', amount: 4000 }),
    ])).toMatchObject({ expense: 9500, cashOut: 6500, cardPayments: 4000, cashNet: 93500 })
  })

  it('transfers between bank/cash accounts and adjustments are excluded', () => {
    expect(sum([
      tx({ kind: 'transfer', accountId: 'b', toAccountId: 'c', amount: 8000 }),
      tx({ kind: 'adjustment', amount: -1500 }),
    ])).toMatchObject({ cashOut: 0, cardPayments: 0 })
  })

  it('debt-linked tx are excluded (like income/expense)', () => {
    expect(sum([tx({ amount: 2500, debtId: 'd1' })])).toMatchObject({ expense: 0, cashOut: 0 })
  })

  it('only tx dated in the month count', () => {
    expect(sum([
      tx({ date: '2026-09-30', amount: 1 }),
      tx({ date: '2026-10-01', amount: 10 }),
      tx({ date: '2026-10-31', kind: 'transfer', toAccountId: 'ax', amount: 100 }),
      tx({ date: '2026-11-01', kind: 'transfer', toAccountId: 'ax', amount: 1000 }),
    ])).toMatchObject({ cashOut: 110, cardPayments: 100 })
  })
})
