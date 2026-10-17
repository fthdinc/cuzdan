import { describe, expect, it } from 'vitest'
import { accountBalance, cardStatements, occurrencesForPlan, parseQuickEntry, type Account, type Category, type Snapshot } from '../index'
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

describe('bills in statement import', () => {
  const elec = {
    id: 'elec', kind: 'recurring_expense' as const, name: 'Elektrik', accountId: 'bank', active: true, createdAt: 1, categoryId: 'fatura',
    amount: 40000, variable: true, frequency: 'monthly' as const, startDate: '2026-09-12',
    bill: { type: 'electricity' as const, provider: 'Enerjisa', autopay: true, matchKeywords: [] },
  }
  const phone1 = {
    id: 'ph1', kind: 'recurring_expense' as const, name: 'Hat 1', accountId: 'bank', active: true, createdAt: 1,
    amount: 20000, variable: false, frequency: 'monthly' as const, startDate: '2026-09-20',
    bill: { type: 'phone' as const, provider: 'Turkcell', subscriberNo: '5320000001', autopay: false, matchKeywords: ['turkcell'] },
  }
  const phone2 = { ...phone1, id: 'ph2', name: 'Hat 2', bill: { ...phone1.bill, subscriberNo: '5320000002' } }
  const bsnap: Snapshot = {
    ...snap,
    categories: [...cats, { id: 'fatura', name: 'Fatura', kind: 'expense', keywords: ['fatura'] }],
    plans: [elec, phone1, phone2],
    // elec occurrence 0 (2026-09-12) is paid with the SMS amount
    transactions: [{ id: 'e0', date: '2026-09-13', kind: 'expense', amount: 41000, accountId: 'bank', occurrenceKey: 'elec:0', createdAt: 1 }],
  }
  const file: ParsedStatement = {
    meta: {},
    rows: [
      row('2026-09-14', 'ENERJISA ISTANBUL OTOMATIK ODEME', 41500, 'debit'), // elec:0 already paid -> duplicate
      row('2026-10-13', 'ENERJİSA İSTANBUL OTOMATİK ÖDEME', 43210, 'debit'), // elec:1 (2026-10-12)
      row('2026-09-21', 'TURKCELL FATURA 5320000002', 20000, 'debit'), // subscriber no -> Hat 2
      row('2026-09-21', 'TURKCELL FATURA 5329999999', 20000, 'debit'), // remaining line -> Hat 1
      row('2026-09-05', 'IGDAS FATURA TALIMATI 1234567', 85000, 'debit'), // no plan -> proposal
      row('2026-10-05', 'IGDAS FATURA TALIMATI 1234567', 99000, 'debit'), // same new bill, next month
      row('2026-09-20', 'XYZ SU FATURASI', 12000, 'debit'), // generic pattern -> proposal (water)
      row('2026-09-22', 'MIGROS', 5000, 'debit'),
      row('2026-09-23', 'NETFLIX IADE', 5000, 'credit'), // credits are never bills
    ],
  }
  const { rows } = prepareImport(file, bank, bsnap, TODAY)

  it('links rows to existing bill occurrences and flags paid ones', () => {
    expect(rows[0]).toMatchObject({ duplicate: 'existing', include: false, bill: { planId: 'elec', planName: 'Elektrik' } })
    expect(rows[0].bill?.occurrenceKey).toBeUndefined()
    expect(rows[1].bill).toEqual({ planId: 'elec', planName: 'Elektrik', occurrenceKey: 'elec:1' })
    expect(rows[1].categoryId).toBe('fatura')
    expect(rows[2].bill?.occurrenceKey).toBe('ph2:0')
    expect(rows[3].bill?.occurrenceKey).toBe('ph1:0')
    expect(rows.slice(7).map((r) => [r.bill, r.billProposal, r.billFollows])).toEqual([[undefined, undefined, undefined], [undefined, undefined, undefined]])
  })

  it('proposes new bill plans for unknown bills', () => {
    expect(rows[4].billProposal).toEqual({
      track: true,
      plan: {
        kind: 'recurring_expense', name: 'İGDAŞ doğalgaz', accountId: 'bank', categoryId: 'fatura', active: true,
        amount: 85000, variable: true, frequency: 'monthly', startDate: '2026-09-05', settledBefore: '2026-09-05',
        bill: { type: 'gas', provider: 'İGDAŞ', autopay: true, matchKeywords: expect.arrayContaining(['igdas']) },
      },
    })
    expect(rows[5].billProposal).toBeUndefined()
    expect(rows[5].billFollows).toEqual({ rowId: 4, index: 1 })
    expect(rows[6].billProposal?.plan).toMatchObject({ name: 'XYZ SU FATURASI', bill: { type: 'water', autopay: false, matchKeywords: ['xyz su'] } })
  })

  it('commit creates the plans and settles occurrences; undo data is tagged', () => {
    let n = 0
    const built = buildImport(rows, bank, { importId: 'imp', makeId: () => `n${++n}`, now: 9 })
    expect(built.plans.map((p) => [p.name, p.importId])).toEqual([['İGDAŞ doğalgaz', 'imp'], ['XYZ SU FATURASI', 'imp']])
    const igdas = built.plans[0].id
    const keyOf = (amount: number) => built.transactions.find((t) => t.amount === amount)?.occurrenceKey
    expect(built.transactions.every((t) => t.importId === 'imp')).toBe(true)
    expect(keyOf(43210)).toBe('elec:1')
    expect(keyOf(85000)).toBe(`${igdas}:0`)
    expect(keyOf(99000)).toBe(`${igdas}:1`)
    expect(keyOf(5000)).toBeUndefined()

    const after = withImport(bsnap, built)
    const occ = occurrencesForPlan(after.plans.find((p) => p.id === igdas)!, after, TODAY, '2026-11-30')
    expect(occ.map((o) => [o.status, o.actual])).toEqual([['paid', 85000], ['paid', 99000], ['pending', undefined]])
    expect(occurrencesForPlan(elec, after, TODAY, '2026-11-30').map((o) => o.status)).toEqual(['paid', 'paid', 'pending'])
  })

  it('toggling a proposal off imports plain transactions', () => {
    const off = rows.map((r) => (r.billProposal ? { ...r, billProposal: { ...r.billProposal, track: false } } : r))
    const built = buildImport(off, bank, { importId: 'imp', makeId: () => 'x', now: 0 })
    expect(built.plans).toEqual([])
    expect(built.transactions.filter((t) => t.occurrenceKey).map((t) => t.occurrenceKey)).toEqual(['elec:1', 'ph2:0', 'ph1:0'])
  })

  it('a second import of the same file finds the bills already paid', () => {
    let n = 0
    const after = withImport(bsnap, buildImport(rows, bank, { importId: 'imp', makeId: () => `n${++n}`, now: 9 }))
    const again = prepareImport(file, bank, after, TODAY).rows
    expect(again.filter((r) => r.include).map((r) => r.row.description)).toEqual([])
  })
})

describe('prepareImport: rent and insurance', () => {
  const rsnap: Snapshot = {
    accounts: [bank], transactions: [], plans: [],
    categories: [{ id: 'fatura', name: 'Fatura', kind: 'expense' }, { id: 'kira', name: 'Kira', kind: 'expense' }],
  }
  const file: ParsedStatement = {
    meta: {},
    rows: [
      row('2026-09-03', 'EFT KIRA EYLUL AHMET YILMAZ', 1500000, 'debit'),
      row('2026-10-03', 'EFT KIRA EKIM AHMET YILMAZ', 1500000, 'debit'),
      row('2026-09-10', 'AXA SIGORTA KASKO', 120000, 'debit'),
    ],
  }
  const { rows } = prepareImport(file, bank, rsnap, TODAY)

  it('proposes a fixed-amount rent bill in the Kira category and follows later months', () => {
    expect(rows[0].categoryId).toBe('kira')
    expect(rows[0].billProposal?.plan).toMatchObject({ variable: false, categoryId: 'kira', bill: { type: 'rent', matchKeywords: ['kira'] } })
    expect(rows[1].billFollows).toEqual({ rowId: 0, index: 1 })
  })
  it('proposes an insurance bill for a catalog insurer', () => {
    expect(rows[2].billProposal?.plan).toMatchObject({ name: 'Axa', variable: true, categoryId: 'fatura', bill: { type: 'insurance', provider: 'Axa' } })
  })
})
