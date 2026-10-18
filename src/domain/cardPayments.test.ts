import { describe, expect, it } from 'vitest'
import { cardPaymentTransfer, looksLikeCardPayment, matchCard, minPaymentRate, monthSummary, suspectedCardPayments } from './index'
import type { Account, Category, Snapshot, Transaction } from './index'

const bank: Account = { id: 'b', name: 'Ana hesap', kind: 'bank', openingBalance: 0, openingDate: '2000-01-01' }
const axess: Account = {
  id: 'ax', name: 'Axess Kredi Kartı', kind: 'credit_card', openingBalance: 0, openingDate: '2026-10-01',
  card: { statementDay: 5, dueDaysAfterStatement: 10 },
}
const bonus: Account = { ...axess, id: 'bo', name: 'Bonus' }
const cats: Category[] = [
  { id: 'kk', name: 'Kredi kartı', kind: 'expense' },
  { id: 'm', name: 'Market', kind: 'expense' },
]

let n = 0
const tx = (p: Partial<Transaction>): Transaction => ({ id: `t${++n}`, date: '2026-10-10', kind: 'expense', amount: 1000, accountId: 'b', createdAt: 0, ...p })
const snapOf = (transactions: Transaction[], accounts = [bank, axess, bonus]): Snapshot => ({ accounts, categories: cats, plans: [], transactions })

describe('matchCard', () => {
  it('matches a distinctive word of the card name, tr-TR case-insensitive', () => {
    expect(matchCard('120 market AXESS', [axess, bonus])?.id).toBe('ax')
    expect(matchCard('bonus', [axess, bonus])?.id).toBe('bo')
  })
  it('ignores generic words like kredi / kartı', () => {
    expect(matchCard('kredi kartı aidatı', [axess, bonus])).toBeUndefined()
    expect(matchCard('market', [axess, bonus])).toBeUndefined()
  })
})

describe('looksLikeCardPayment', () => {
  const snap = snapOf([])
  it('Kredi kartı category', () => expect(looksLikeCardPayment('', 'kk', snap)).toBe(true))
  it('payment phrases', () => {
    expect(looksLikeCardPayment('Ekim kart ödemesi', undefined, snap)).toBe(true)
    expect(looksLikeCardPayment('ekstre ödemesi', undefined, snap)).toBe(true)
  })
  it('a card word needs a payment word (a card name alone is spending on that card)', () => {
    expect(looksLikeCardPayment('Axess Kredi Kartı', undefined, snap)).toBe(true)
    expect(looksLikeCardPayment('axess borcu', undefined, snap)).toBe(true)
    expect(looksLikeCardPayment('Bonus ödemesi', undefined, snap)).toBe(true)
    expect(looksLikeCardPayment('axess market', undefined, snap)).toBe(false)
    expect(looksLikeCardPayment('market bonus', undefined, snap)).toBe(false)
    expect(looksLikeCardPayment('Market', 'm', snap)).toBe(false)
  })
})

describe('suspectedCardPayments', () => {
  it('flags expenses that look like card payments, also when recorded on the card itself; skips plan and debt tx', () => {
    const hits = [
      tx({ categoryId: 'kk' }),
      tx({ note: 'Axess kredi kartı ödemesi', categoryId: 'm' }),
      tx({ note: 'kart ödemesi' }),
      // Paying the card entered as an expense with the card as payment method: raises its debt instead of lowering it.
      tx({ note: 'Axess Kredi Kartı', accountId: 'ax' }),
    ]
    const misses = [
      tx({ note: 'market' }),
      tx({ note: 'market axess', accountId: 'ax' }), // real spending on the card
      tx({ note: 'kart ödemesi', occurrenceKey: 'p:0' }),
      tx({ note: 'kart ödemesi', debtId: 'd' }),
      tx({ kind: 'transfer', toAccountId: 'ax', note: 'Axess ödemesi' }),
    ]
    expect(suspectedCardPayments(snapOf([...hits, ...misses])).map((t) => t.id).sort()).toEqual(hits.map((t) => t.id).sort())
  })
  it('works without any card account', () => {
    expect(suspectedCardPayments(snapOf([tx({ categoryId: 'kk' })], [bank]))).toHaveLength(1)
  })
})

describe('cardPaymentTransfer', () => {
  it('expense on bank/cash -> transfer from it to the named card (else first card)', () => {
    const snap = snapOf([])
    expect(cardPaymentTransfer(tx({ note: 'Bonus ödemesi' }), snap)).toEqual({ accountId: 'b', toAccountId: 'bo' })
    expect(cardPaymentTransfer(tx({ note: 'kart ödemesi' }), snap)).toEqual({ accountId: 'b', toAccountId: 'ax' })
  })
  it('expense recorded on the card -> transfer from the first bank/cash account to that card', () => {
    expect(cardPaymentTransfer(tx({ note: 'Axess Kredi Kartı', accountId: 'ax' }), snapOf([]))).toEqual({ accountId: 'b', toAccountId: 'ax' })
  })
  it('no possible source or target -> undefined', () => {
    expect(cardPaymentTransfer(tx({ note: 'kart ödemesi' }), snapOf([], [bank]))).toBeUndefined()
    expect(cardPaymentTransfer(tx({ note: 'kart ödemesi', accountId: 'ax' }), snapOf([], [axess]))).toBeUndefined()
  })
})

describe('card spending split and payments', () => {
  it('cardExpense = expense made on cards; a card payment transfer is not spending', () => {
    const snap = snapOf([
      tx({ accountId: 'ax', amount: 5000, note: 'Spotify' }),
      tx({ amount: 2000, note: 'market' }),
      tx({ kind: 'transfer', accountId: 'b', toAccountId: 'ax', amount: 5000 }),
    ])
    const m = monthSummary(snap, '2026-10', '2026-10-18')
    expect(m.expense).toBe(7000)
    expect(m.cardExpense).toBe(5000)
  })
})

describe('minPaymentRate without a limit', () => {
  it('defaults to 20% when limit is unknown (undefined or 0)', () => {
    expect(minPaymentRate(axess)).toBe(0.2)
    expect(minPaymentRate({ ...axess, card: { ...axess.card!, limit: 0 } })).toBe(0.2)
  })
})
