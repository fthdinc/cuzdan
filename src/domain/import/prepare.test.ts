import { describe, expect, it } from 'vitest'
import { accountBalance, cardStatements, parseQuickEntry, type Account, type Category, type Snapshot } from '../index'
import { buildImport, prepareImport, reconcile, suggestCategory, withImport, type ParsedRow, type ParsedStatement } from './index'

const TODAY = '2026-10-17'
const card: Account = {
  id: 'card', name: 'Kart', kind: 'credit_card', openingBalance: -500000, openingDate: '2026-08-15',
  card: { limit: 4000000, statementDay: 10, dueDaysAfterStatement: 10 },
}
const bank: Account = { id: 'bank', name: 'Banka', kind: 'bank', openingBalance: 1000000, openingDate: '2026-09-01' }
const cats: Category[] = [
  { id: 'market', name: 'Market', kind: 'expense', keywords: ['migros', 'şok', 'market'] },
  { id: 'food', name: 'Yemek', kind: 'expense', keywords: ['kafe', 'trendyol yemek'] },
  { id: 'health', name: 'Sağlık', kind: 'expense', keywords: ['eczane'] },
  { id: 'salary', name: 'Maaş', kind: 'income', keywords: ['maaş', 'maas'] },
]
const snap: Snapshot = {
  accounts: [card, bank],
  categories: cats,
  transactions: [
    { id: 't1', date: '2026-09-14', kind: 'expense', amount: 25040, accountId: 'card', createdAt: 1 },
    { id: 't2', date: '2026-09-12', kind: 'transfer', amount: 300000, accountId: 'bank', toAccountId: 'card', createdAt: 1 },
  ],
  plans: [{
    id: 'p1', kind: 'card_installment', name: 'Telefon', accountId: 'card', active: true, createdAt: 1,
    totalAmount: 600000, installmentCount: 6, purchaseDate: '2026-09-05', preSettledCount: 0,
  }],
}
const row = (date: string, description: string, amount: number, direction: 'debit' | 'credit', extra: Partial<ParsedRow> = {}): ParsedRow =>
  ({ date, description, amount, direction, source: 0, ...extra })

const parsed: ParsedStatement = {
  meta: { statementDate: '2026-10-10', totalDebt: 500000 },
  rows: [
    row('2026-09-12', 'ÖDEMENİZ İÇİN TEŞEKKÜRLER', 300000, 'credit'),
    row('2026-09-14', 'MIGROS ATASEHIR', 25040, 'debit'),
    row('2026-09-15', 'MIGROS ATASEHIR', 25040, 'debit'),
    row('2026-10-01', 'TELEFONCU 2/6', 100000, 'debit', { installment: { current: 2, total: 6 } }),
    row('2026-09-20', 'BEYAZ ESYA 1/3', 50000, 'debit', { installment: { current: 1, total: 3 }, installmentTotal: 150000 }),
    row('2026-07-15', 'ONLINE MAGAZA 3/6', 50000, 'debit', { installment: { current: 3, total: 6 } }),
    row('2026-08-01', 'KAFE', 4500, 'debit'),
    row('2026-09-22', 'GIYIM IADE', 35000, 'credit'),
    row('2026-09-25', 'KAFE', 4500, 'debit'),
    row('2026-09-25', 'KAFE', 4500, 'debit'),
  ],
}

describe('prepareImport (card)', () => {
  const { rows, reconciliation } = prepareImport(parsed, card, snap, TODAY)
  it('kinds, categories, duplicates and defaults', () => {
    expect(rows.map((r) => [r.kind, r.categoryId, r.duplicate, r.beforeOpening, r.include, r.mode])).toEqual([
      ['income', undefined, 'existing', false, false, 'tx'], // payment already recorded as a transfer
      ['expense', 'market', 'existing', false, false, 'tx'],
      ['expense', 'market', undefined, false, true, 'tx'], // t1 is consumed by the previous row
      ['expense', undefined, undefined, false, false, 'tx'], // covered by plan p1
      ['expense', undefined, undefined, false, true, 'plan'],
      ['expense', undefined, undefined, true, true, 'plan'],
      ['expense', 'food', undefined, true, false, 'tx'],
      ['income', undefined, undefined, false, true, 'tx'],
      ['expense', 'food', undefined, false, true, 'tx'],
      ['expense', 'food', 'file', false, true, 'tx'],
    ])
    expect(rows[0].looksLikePayment).toBe(true)
    expect(rows[7].looksLikePayment).toBe(false)
  })
  it('installment coverage and plan proposals', () => {
    expect(rows[3].installment).toEqual({ current: 2, total: 6, coveredBy: 'p1' })
    expect(rows[4].installment?.plan).toMatchObject({ totalAmount: 150000, installmentCount: 3, purchaseDate: '2026-09-20', preSettledCount: 0 })
    // 3/6 billed at the 2026-10-10 kesim -> part 0 at 2026-08-10, before the card's first statement (2026-09-10).
    expect(rows[5].installment?.plan).toMatchObject({ totalAmount: 300000, installmentCount: 6, purchaseDate: '2026-07-15', preSettledCount: 1 })
  })
  it('reconciliation against the engine statement', () => {
    // -500000 opening - 25040 expense + 300000 payment - 2 plan parts of 100000
    expect(reconciliation).toEqual({ bankKesim: '2026-10-10', bankTotal: 500000, kesim: '2026-10-10', engineTotal: 425040, diff: -74960 })
  })
  it('built records reproduce the plan part in this statement and the adjustment closes the gap', () => {
    let n = 0
    const opts = { importId: 'imp1', makeId: () => `id${++n}`, now: 5 }
    const built = buildImport(rows, card, opts)
    expect(built.transactions.every((t) => t.importId === 'imp1')).toBe(true)
    expect(built.plans.map((p) => [p.name, p.importId])).toEqual([['BEYAZ ESYA 1/3', 'imp1'], ['ONLINE MAGAZA 3/6', 'imp1']])
    const after = withImport(snap, built)
    const st = cardStatements(card, after, TODAY).find((s) => s.periodEnd === '2026-10-10')!
    expect(st.installmentParts.map((p) => p.amount).sort()).toEqual([100000, 50000, 50000].sort())
    const rec = reconcile(parsed.meta, card, after, TODAY)!
    const fixed = withImport(snap, buildImport(rows, card, { ...opts, adjustment: { amount: rec.diff!, date: rec.kesim! } }))
    expect(reconcile(parsed.meta, card, fixed, TODAY)!.diff).toBe(0)
    expect(-accountBalance(card, fixed, '2026-10-10')).toBe(500000)
  })
  it('payment source turns payment-like credits into transfers', () => {
    const p = prepareImport({ ...parsed, rows: [row('2026-10-02', 'HESAPTAN ODEME', 1000, 'credit')] }, card, snap, TODAY, { paymentSourceId: 'bank' })
    expect(p.rows[0].kind).toBe('transfer')
    const built = buildImport(p.rows, card, { importId: 'x', makeId: () => 'a', now: 0, paymentSourceId: 'bank' })
    expect(built.transactions[0]).toMatchObject({ kind: 'transfer', accountId: 'bank', toAccountId: 'card', amount: 1000 })
    expect(built.transactions[0].categoryId).toBeUndefined()
  })
})

describe('prepareImport (bank)', () => {
  it('outgoing transfers match debits; no installments or reconciliation', () => {
    const p = prepareImport({
      meta: {},
      rows: [
        row('2026-09-13', 'KREDI KARTI ODEMESI', 300000, 'debit'),
        row('2026-09-15', 'ISYERI MAAS', 4500000, 'credit'),
        row('2026-08-30', 'ESKI ISLEM', 100, 'debit'),
        row('2026-09-16', 'TAKSITLI 2/3', 100, 'debit', { installment: { current: 2, total: 3 } }),
      ],
    }, bank, snap, TODAY)
    expect(p.rows.map((r) => [r.kind, r.categoryId, r.duplicate, r.include, r.mode])).toEqual([
      ['expense', undefined, 'existing', false, 'tx'],
      ['income', 'salary', undefined, true, 'tx'],
      ['expense', undefined, undefined, false, 'tx'],
      ['expense', undefined, undefined, true, 'tx'],
    ])
    expect(p.reconciliation).toBeNull()
  })
})

describe('suggestCategory', () => {
  it('diacritic-insensitive words, multi-word keywords, prefixes', () => {
    expect(suggestCategory('ŞOK MARKETLER T.A.Ş.', 'expense', cats)).toBe('market')
    expect(suggestCategory('SOK MARKETLER', 'expense', cats)).toBe('market')
    expect(suggestCategory('TRENDYOL YEMEK ISTANBUL', 'expense', cats)).toBe('food')
    expect(suggestCategory('ECZANESI KADIKOY', 'expense', cats)).toBe('health')
    expect(suggestCategory('BILINMEYEN', 'expense', cats)).toBeUndefined()
    expect(suggestCategory('MAAS ODEMESI', 'expense', cats)).toBeUndefined()
  })
  it('quick entry keeps its exact-word behavior', () => {
    expect(parseQuickEntry('100 marketler', cats, TODAY)?.categoryId).toBeUndefined()
    expect(parseQuickEntry('100 migros', cats, TODAY)?.categoryId).toBe('market')
  })
})
