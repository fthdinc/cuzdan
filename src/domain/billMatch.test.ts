import { describe, expect, it } from 'vitest'
import {
  billSuggestions, billThisMonth, buildBillSuggestion, detectExpenseBill, expenseBillPlan, matchExpenseToBill, occurrencesForPlan,
  type Category, type RecurringPlan, type Snapshot, type Transaction,
} from './index'

const TODAY = '2026-10-18'
const cat = (id: string, name: string): Category => ({ id, name, kind: 'expense' })
const CATS = [cat('fatura', 'Fatura'), cat('market', 'Market'), cat('kira', 'Kira'), cat('ulasim', 'Ulaşım'), cat('abo', 'Dijital abonelikler')]
const ACCOUNTS: Snapshot['accounts'] = [
  { id: 'b', name: 'Banka', kind: 'bank', openingBalance: 0, openingDate: '2000-01-01' },
  { id: 'k', name: 'Kart', kind: 'credit_card', openingBalance: 0, openingDate: '2000-01-01', card: { statementDay: 10, dueDaysAfterStatement: 10 } },
]
const bill = (p: Partial<RecurringPlan>): RecurringPlan => ({
  id: 'e', name: 'Elektrik', accountId: 'b', active: true, createdAt: 0, kind: 'recurring_expense', amount: 50000, variable: true,
  frequency: 'monthly', startDate: '2026-08-05', bill: { type: 'electricity', autopay: false, matchKeywords: ['elektrik'] }, ...p,
})
let seq = 0
const exp = (note: string, date: string, amount = 10000, extra: Partial<Transaction> = {}): Transaction =>
  ({ id: `t${++seq}`, date, kind: 'expense', amount, accountId: 'b', note, createdAt: seq, ...extra })
const snapOf = (plans: RecurringPlan[] = [], transactions: Transaction[] = []): Snapshot =>
  ({ accounts: ACCOUNTS, categories: CATS, plans, transactions })
const tx = (note: string, date = TODAY, categoryId?: string) => ({ note, date, categoryId, amount: 10000, accountId: 'b' })

describe('detectExpenseBill', () => {
  it('detects bills from plain Turkish descriptions, any casing', () => {
    expect(detectExpenseBill('Telefon Faturası')).toMatchObject({ type: 'phone', keywords: ['telefon'], strong: true })
    expect(detectExpenseBill('Doğalgaz')).toMatchObject({ type: 'gas', keywords: ['dogalgaz'], strong: true })
    expect(detectExpenseBill('DOĞALGAZ FATURASI')).toMatchObject({ type: 'gas' })
    expect(detectExpenseBill('doğal gaz')).toMatchObject({ type: 'gas' })
    expect(detectExpenseBill('Su')).toMatchObject({ type: 'water', keywords: ['su'] })
    expect(detectExpenseBill('SU')).toMatchObject({ type: 'water' })
    expect(detectExpenseBill('Elektrik')).toMatchObject({ type: 'electricity', keywords: ['elektrik'] })
    expect(detectExpenseBill('ELEKTRİK ekim')).toMatchObject({ type: 'electricity', keywords: ['elektrik'] })
    expect(detectExpenseBill('İnternet')).toMatchObject({ type: 'internet' })
  })
  it('transport cards and passes', () => {
    expect(detectExpenseBill('Akbil')).toMatchObject({ type: 'transport', keywords: ['akbil'], strong: true })
    expect(detectExpenseBill('İSTANBULKART dolum')).toMatchObject({ type: 'transport' })
    expect(detectExpenseBill('HGS yükleme')).toMatchObject({ type: 'transport' })
    expect(detectExpenseBill('Otopark aboneliği')).toMatchObject({ type: 'transport' })
  })
  it('digital subscriptions from the catalog', () => {
    expect(detectExpenseBill('Claude')).toMatchObject({ type: 'subscription', provider: 'Claude', strong: true })
    expect(detectExpenseBill('chatgpt plus')).toMatchObject({ type: 'subscription', provider: 'ChatGPT' })
    expect(detectExpenseBill('Spotify')).toMatchObject({ type: 'subscription', provider: 'Spotify' })
    expect(detectExpenseBill('icloud')).toMatchObject({ type: 'subscription', provider: 'iCloud' })
    expect(detectExpenseBill('Disney')).toMatchObject({ type: 'tv', provider: 'Disney+' })
    expect(detectExpenseBill('Netflix')).toMatchObject({ type: 'tv', provider: 'Netflix' })
  })
  it('no false positives', () => {
    expect(detectExpenseBill('Market')).toBeNull()
    expect(detectExpenseBill('Susam')).toBeNull()
    expect(detectExpenseBill('Elektrikçi')).toBeNull()
    expect(detectExpenseBill('Telefon')).toBeNull() // may be a phone purchase
    expect(detectExpenseBill('Market', CATS[1])).toBeNull()
  })
  it('a bill-like category makes a weak proposal, typed from the text when possible', () => {
    expect(detectExpenseBill('Telefon', CATS[0])).toMatchObject({ type: 'phone', strong: false })
    expect(detectExpenseBill('Ev', CATS[0])).toMatchObject({ type: 'other', keywords: ['ev'], strong: false })
    expect(detectExpenseBill('Ev', CATS[2])).toMatchObject({ type: 'rent', strong: false })
    expect(detectExpenseBill('Medium', CATS[4])).toMatchObject({ type: 'subscription', strong: false })
  })
})

describe('matchExpenseToBill', () => {
  it('proposes a bill when there is no plan', () => {
    const s = snapOf()
    expect(matchExpenseToBill(tx('Telefon Faturası'), s, TODAY)).toMatchObject({ kind: 'propose', type: 'phone', name: 'Telefon Faturası' })
    expect(matchExpenseToBill(tx('Akbil'), s, TODAY)).toMatchObject({ kind: 'propose', type: 'transport' })
    expect(matchExpenseToBill(tx('claude'), s, TODAY)).toMatchObject({ kind: 'propose', type: 'subscription', provider: 'Claude', name: 'Claude' })
    expect(matchExpenseToBill(tx('ıslak su'), s, TODAY)).toMatchObject({ kind: 'propose', type: 'water', name: 'Islak su' })
    expect(matchExpenseToBill(tx('Market'), s, TODAY)).toBeNull()
    expect(matchExpenseToBill(tx('  '), s, TODAY)).toBeNull()
    expect(matchExpenseToBill(tx('', TODAY, 'fatura'), s, TODAY)).toBeNull()
  })
  it("links to the plan's occurrence in the expense's month", () => {
    const p = bill({})
    const s = snapOf([p])
    expect(matchExpenseToBill(tx('elektrik'), s, TODAY)).toEqual({ kind: 'link', planId: 'e', planName: 'Elektrik', occurrenceIndex: 2, dueDate: '2026-10-05' })
    // same month beats the window: Oct 28 is 23 days after Oct 5
    expect(matchExpenseToBill(tx('Elektrik', '2026-10-28'), s, TODAY)).toMatchObject({ kind: 'link', occurrenceIndex: 2 })
    // paid late: an unpaid occurrence of last month within 20 days comes before this month's
    const late = bill({ startDate: '2026-08-31' })
    expect(matchExpenseToBill(tx('Elektrik', '2026-10-02'), snapOf([late]), TODAY)).toMatchObject({ kind: 'link', occurrenceIndex: 1, dueDate: '2026-09-30' })
  })
  it('already_paid when that month is paid; never a new proposal while a plan matches', () => {
    const p = bill({})
    const s = snapOf([p], [exp('Elektrik', '2026-10-06', 50000, { occurrenceKey: 'e:2' })])
    expect(matchExpenseToBill(tx('Elektrik'), s, TODAY)).toEqual({ kind: 'already_paid', planId: 'e', planName: 'Elektrik', dueDate: '2026-10-05' })
    expect(matchExpenseToBill(tx('Elektrik', '2026-03-01'), s, TODAY)).toBeNull() // before the plan
    // a second payment in a paid month does not settle next month's (Nov 5 is 16 days away)
    expect(matchExpenseToBill(tx('Elektrik', '2026-10-20'), s, TODAY)).toMatchObject({ kind: 'already_paid' })
    expect(matchExpenseToBill(tx('Elektrik'), snapOf([{ ...p, active: false }]), TODAY)).toBeNull()
  })
  it('matches by plan name, provider keywords, or by type for single-bill types', () => {
    const named = bill({ id: 'n', name: 'Ev suyu', bill: { type: 'other', autopay: false, matchKeywords: [] } })
    expect(matchExpenseToBill(tx('ev suyu ekim'), snapOf([named]), TODAY)).toMatchObject({ kind: 'link', planId: 'n' })
    const enerjisa = bill({ id: 'en', name: 'Enerjisa elektrik', bill: { type: 'electricity', provider: 'Enerjisa', autopay: false, matchKeywords: [] } })
    expect(matchExpenseToBill(tx('ENERJİSA'), snapOf([enerjisa]), TODAY)).toMatchObject({ kind: 'link', planId: 'en' })
    expect(matchExpenseToBill(tx('Elektrik'), snapOf([enerjisa]), TODAY)).toMatchObject({ kind: 'link', planId: 'en' })
    const su = bill({ id: 'su', name: 'Su', bill: { type: 'water', autopay: false, matchKeywords: ['su'] } })
    expect(matchExpenseToBill(tx('Susam'), snapOf([su]), TODAY)).toBeNull()
    const netflix = bill({ id: 'nf', name: 'Netflix', bill: { type: 'tv', provider: 'Netflix', autopay: false, matchKeywords: [] } })
    expect(matchExpenseToBill(tx('Exxen'), snapOf([netflix]), TODAY)).toMatchObject({ kind: 'propose', provider: 'Exxen' })
  })
})

describe('expenseBillPlan', () => {
  it('monthly plan from an expense; fixed for rent and subscriptions', () => {
    const p = expenseBillPlan({ id: 'x', createdAt: 1, name: 'Spotify', type: 'subscription', provider: 'Spotify', keywords: ['spotify'], amount: 9900, date: '2026-10-03', accountId: 'k', autopay: true })
    expect(p).toEqual({
      id: 'x', kind: 'recurring_expense', name: 'Spotify', accountId: 'k', active: true, createdAt: 1, amount: 9900, variable: false,
      frequency: 'monthly', startDate: '2026-10-03', settledBefore: '2026-10-03',
      bill: { type: 'subscription', provider: 'Spotify', autopay: true, matchKeywords: ['spotify'] },
    })
    const e = expenseBillPlan({ id: 'y', createdAt: 1, name: 'Elektrik', type: 'electricity', keywords: ['elektrik'], amount: 1, date: '2026-10-03', accountId: 'b', categoryId: 'fatura', autopay: false })
    expect(e).toMatchObject({ variable: true, categoryId: 'fatura', bill: { type: 'electricity', autopay: false, matchKeywords: ['elektrik'] } })
    expect('provider' in e.bill!).toBe(false)
  })
})

describe('billSuggestions', () => {
  it('groups past expenses by bill, one per month, and builds a plan that marks them paid', () => {
    const txs = [
      exp('Elektrik', '2026-09-04', 180000, { categoryId: 'fatura' }),
      exp('elektrik faturası', '2026-10-05', 204500, { categoryId: 'fatura' }),
      exp('Elektrik', '2026-10-09', 100), // second one in October: left out
      exp('Akbil', '2026-09-20', 50800),
      exp('İstanbulkart', '2026-10-01', 50800), // same transport bill
      exp('Spotify', '2026-10-02', 9900, { accountId: 'k' }),
      exp('Market', '2026-10-02', 99900),
      exp('Telefon', '2026-10-02', 30000, { categoryId: 'fatura' }), // weak, one month only
      exp('Elektrik', '2026-03-01'), // older than 6 months
      exp('Doğalgaz', '2026-10-03', 200000, { debtId: 'd' }),
      exp('Su', '2026-10-03', 20000, { kind: 'transfer', toAccountId: 'k' }),
    ]
    const s = snapOf([], txs)
    const out = billSuggestions(s, TODAY)
    expect(out.map((g) => [g.key, g.name, g.items.map((i) => [i.tx.date, i.index])])).toEqual([
      ['new:t:electricity', 'Elektrik', [['2026-09-04', 0], ['2026-10-05', 1]]],
      ['new:t:transport', 'Akbil', [['2026-09-20', 0], ['2026-10-01', 1]]],
      ['new:p:spotify', 'Spotify', [['2026-10-02', 0]]],
    ])

    const built = buildBillSuggestion(out[0], s.accounts, s.categories, { id: 'P', now: 5 })
    expect(built.plan).toMatchObject({
      id: 'P', name: 'Elektrik', startDate: '2026-09-04', settledBefore: '2026-10-05', amount: 204500, accountId: 'b', categoryId: 'fatura',
      variable: true, bill: { type: 'electricity', autopay: false, matchKeywords: ['elektrik'] },
    })
    expect(built.links).toEqual([{ txId: txs[0].id, occurrenceKey: 'P:0' }, { txId: txs[1].id, occurrenceKey: 'P:1' }])
    const after: Snapshot = {
      ...s,
      plans: [built.plan!],
      transactions: s.transactions.map((t) => ({ ...t, occurrenceKey: built.links.find((l) => l.txId === t.id)?.occurrenceKey ?? t.occurrenceKey })),
    }
    expect(billThisMonth(built.plan!, after, TODAY)).toMatchObject({ amount: 204500, status: 'paid' })
    const nov = occurrencesForPlan(built.plan!, after, TODAY, '2026-11-30')[2]
    expect(nov).toMatchObject({ dueDate: '2026-11-04', status: 'pending', expected: 192250 })
    // Later Elektrik entries now link to the plan
    expect(matchExpenseToBill(tx('Elektrik', '2026-11-06'), after, TODAY)).toMatchObject({ kind: 'link', planId: 'P', occurrenceIndex: 2 })
    expect(billSuggestions(after, TODAY).map((g) => g.key)).toEqual(['new:t:transport', 'new:p:spotify'])

    const spotify = buildBillSuggestion(out[2], s.accounts, s.categories, { id: 'S', now: 5 })
    expect(spotify.plan).toMatchObject({ variable: false, bill: { autopay: true, provider: 'Spotify' }, categoryId: 'fatura' })
    const akbil = buildBillSuggestion(out[1], s.accounts, s.categories, { id: 'A', now: 5 })
    expect(akbil.plan).toMatchObject({ categoryId: 'ulasim', bill: { type: 'transport' } })
  })
  it('weak bills need two months; ignored expenses are skipped', () => {
    const txs = [exp('Telefon', '2026-09-02', 30000, { categoryId: 'fatura' }), exp('Telefon', '2026-10-02', 30000, { categoryId: 'fatura' })]
    expect(billSuggestions(snapOf([], txs), TODAY).map((g) => [g.type, g.items.length])).toEqual([['phone', 2]])
    expect(billSuggestions(snapOf([], txs), TODAY, [txs[0].id])).toEqual([])
  })
  it('offers to link unlinked expenses to an existing plan', () => {
    const p = bill({ startDate: '2026-09-05', settledBefore: undefined })
    const txs = [exp('Elektrik', '2026-09-06', 150000), exp('Elektrik', '2026-10-04', 160000), exp('Elektrik', '2026-10-10', 1)]
    const s = snapOf([p], txs)
    const [g] = billSuggestions(s, TODAY)
    expect(g).toMatchObject({ key: 'plan:e', planId: 'e', name: 'Elektrik', type: 'electricity' })
    expect(g.items.map((i) => i.index)).toEqual([0, 1])
    expect(buildBillSuggestion(g, s.accounts, s.categories, { id: 'unused', now: 0 })).toEqual({
      links: [{ txId: txs[0].id, occurrenceKey: 'e:0' }, { txId: txs[1].id, occurrenceKey: 'e:1' }],
    })
  })
})
