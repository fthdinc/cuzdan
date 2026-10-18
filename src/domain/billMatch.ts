// Linking expenses to bill plans (Faturalar): shared by statement import and manual entry. Pure.
import { BILL_TYPE_KEYWORDS, billDefaultName, billKeywords, detectBill, matchesKeywords, words } from './billProviders'
import { billInfo } from './bills'
import { addDays, addMonths, monthIndex, ymd } from './dates'
import { occurrencesForPlan } from './plans'
import { fold } from './import/text'
import type { Account, BillType, Category, ID, ISODate, Kurus, Occurrence, RecurringPlan, Snapshot, Transaction } from './types'

/** Days between a bill's due date and a payment that settles it. */
export const BILL_WINDOW = 20

const DAY = 86400000
export function dayDiff(a: ISODate, b: ISODate): number {
  const [y1, m1, d1] = ymd(a)
  const [y2, m2, d2] = ymd(b)
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / DAY)
}

const unpaid = (o: Occurrence) => o.status === 'pending' || o.status === 'overdue' || o.status === 'autopay_pending'

/**
 * The occurrence of one of `plans` a payment on `date` settles: the nearest unpaid one within ±BILL_WINDOW days
 * (a plan whose subscriberNo appears in `digits` wins; occurrences in `claimed` are skipped). When only a paid one
 * is that close, that paid occurrence is returned (the payment is a duplicate). sameMonth (manual entry): an unpaid
 * occurrence of an earlier month within the window comes first (paid late), then the one due in the payment's own
 * month, even beyond the window (if it is paid, the month is paid: a second payment does not settle next month).
 */
export function pickBillOccurrence(plans: RecurringPlan[], date: ISODate, snap: Snapshot, today: ISODate, opts: {
  claimed?: Set<string>; digits?: string; sameMonth?: boolean
} = {}): { plan: RecurringPlan; occurrence: Occurrence } | null {
  const month = date.slice(0, 7)
  const winEnd = addDays(date, BILL_WINDOW)
  const until = opts.sameMonth && `${month}-31` > winEnd ? `${month}-31` : winEnd
  type Pick = { plan: RecurringPlan; occurrence: Occurrence; score: number }
  let best: Pick | undefined
  let sameBest: Pick | undefined
  let lateBest: Pick | undefined
  let paid: Pick | undefined
  let samePaid: Pick | undefined
  for (const plan of plans) {
    const sub = plan.bill?.subscriberNo?.replace(/\D/g, '')
    const subMatch = !!sub && !!opts.digits?.includes(sub)
    for (const o of occurrencesForPlan(plan, snap, today, until)) {
      const d = Math.abs(dayDiff(o.dueDate, date))
      const same = !!opts.sameMonth && o.dueDate.slice(0, 7) === month
      if (d > BILL_WINDOW && !same) continue
      const c = { plan, occurrence: o, score: d - (subMatch ? 1000 : 0) }
      if (o.status === 'paid') {
        if (same) samePaid ??= c
        if (d <= BILL_WINDOW) paid ??= c
        continue
      }
      if (!unpaid(o) || opts.claimed?.has(o.key)) continue
      if (same && (!sameBest || c.score < sameBest.score)) sameBest = c
      if (opts.sameMonth && o.dueDate.slice(0, 7) < month && d <= BILL_WINDOW && (!lateBest || c.score < lateBest.score)) lateBest = c
      if (d <= BILL_WINDOW && (!best || c.score < best.score)) best = c
    }
  }
  const pick = lateBest ?? sameBest ?? samePaid ?? best ?? paid
  return pick ? { plan: pick.plan, occurrence: pick.occurrence } : null
}

export interface ExpenseBill {
  type: BillType
  provider?: string
  keywords: string[] // matchKeywords for a plan created from it
  strong: boolean // detected from the text (track by default); false = only the category suggests a bill
}

// Words that say nothing about which bill it is.
const NOISE = /^(fatura[a-z]*|ftr|odeme[a-z]*|otomatik|oto|talimat[a-z]*|tahsilat[a-z]*|no|nolu|abone[a-z]*|ay[a-z]*|ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|[0-9]+)$/
/** "Elektrik faturası ekim" -> ['elektrik'] (first 3 meaningful words, folded). */
function noteKeywords(note: string): string[] {
  const rest = words(note).split(' ').filter((w) => w && !NOISE.test(w)).slice(0, 3).join(' ')
  return rest ? [rest] : []
}

// Plain utility names need no "fatura" word in a manually entered expense ("Su", "Doğalgaz").
const TEXT_HINTS: [BillType, RegExp][] = [
  ['electricity', / (elektrik|elektrigi) /],
  ['gas', / dogal ?gaz[a-z]* /],
  ['water', / (su|suyu) /],
  ['internet', / internet /],
  ['dues', / aidat[a-z]* /],
]
// Only with a bill-like category ("Telefon" may be a phone purchase).
const WEAK_HINTS: [BillType, RegExp][] = [['phone', / (telefon[a-z]*|gsm|cep) /], ...TEXT_HINTS]

/**
 * Bill signals in a manually entered expense: catalog provider / rent / insurance / "... faturası" (detectBill), transport
 * cards and passes (Akbil, İstanbulkart, HGS...), plain utility names. Otherwise a bill-like category (Fatura, Kira,
 * a name with "abonelik" / "üyelik") makes a weak proposal, typed from the text when possible.
 */
export function detectExpenseBill(note: string, category?: Category): ExpenseBill | null {
  const d = detectBill(note)
  if (d) return { type: d.type, provider: d.provider, keywords: d.provider ? d.keywords : noteKeywords(note), strong: true }
  if (matchesKeywords(note, BILL_TYPE_KEYWORDS.transport ?? [])) return { type: 'transport', keywords: noteKeywords(note), strong: true }
  const t = words(note)
  const hint = TEXT_HINTS.find(([, re]) => re.test(t))?.[0]
  if (hint) return { type: hint, keywords: noteKeywords(note), strong: true }
  if (!category || category.kind !== 'expense') return null
  const c = fold(category.name)
  const type: BillType | undefined = c === 'kira' ? 'rent'
    : /abonelik|uyelik/.test(c) ? 'subscription'
    : c === 'fatura' ? WEAK_HINTS.find(([, re]) => re.test(t))?.[0] ?? 'other'
    : undefined
  return type ? { type, keywords: noteKeywords(note), strong: false } : null
}

// Types one usually has a single bill of: an expense of that type settles any such plan, whatever its name.
const BY_TYPE = new Set<BillType>(['electricity', 'water', 'gas', 'internet', 'phone', 'dues', 'rent', 'transport'])

export type ExpenseBillMatch =
  | { kind: 'link'; planId: ID; planName: string; occurrenceIndex: number; dueDate: ISODate }
  | { kind: 'already_paid'; planId: ID; planName: string; dueDate: ISODate }
  | ({ kind: 'propose'; name: string } & ExpenseBill)

export interface ExpenseLike { note?: string; categoryId?: ID; amount?: Kurus; date: ISODate; accountId?: ID }

/**
 * Bill of a manually entered expense. An existing bill plan matches when its keywords (billKeywords) or its name
 * appear in the note, or, for single-bill types (BY_TYPE), when the note is detected as that type. It then links to
 * the plan's occurrence due in the expense's month, else the nearest unpaid one within ±20 days ('already_paid' when
 * that occurrence is paid; null when the plan has none nearby). With no plan: 'propose' when the expense looks like a
 * bill (detectExpenseBill; named after the provider, else the note), else null. Empty notes never match.
 */
export function matchExpenseToBill(tx: ExpenseLike, snap: Snapshot, today: ISODate, claimed?: Set<string>): ExpenseBillMatch | null {
  const note = tx.note?.trim() ?? ''
  if (!note) return null
  const category = snap.categories.find((c) => c.id === tx.categoryId)
  const detected = detectExpenseBill(note, category)
  const bills = snap.plans.filter((p): p is RecurringPlan => p.kind === 'recurring_expense')
  let candidates = bills.filter((p) => matchesKeywords(note, billKeywords(p)) || matchesKeywords(note, [p.name]))
  if (!candidates.length && detected && BY_TYPE.has(detected.type)) candidates = bills.filter((p) => p.active && billInfo(p).type === detected.type)
  if (candidates.length) {
    const pick = pickBillOccurrence(candidates, tx.date, snap, today, { claimed, sameMonth: true })
    if (!pick) return null
    const { plan, occurrence: o } = pick
    return o.status === 'paid'
      ? { kind: 'already_paid', planId: plan.id, planName: plan.name, dueDate: o.dueDate }
      : { kind: 'link', planId: plan.id, planName: plan.name, occurrenceIndex: o.index, dueDate: o.dueDate }
  }
  if (!detected) return null
  const name = detected.provider ? billDefaultName(detected.type, detected.provider) : note.charAt(0).toLocaleUpperCase('tr-TR') + note.slice(1, 40)
  return { kind: 'propose', name, ...detected }
}

/** Default category of a new bill: Kira for rent, Ulaşım for transport, else Fatura (by name; undefined if missing). */
export function billCategoryId(type: BillType, categories: Category[]): ID | undefined {
  const name = type === 'rent' ? 'Kira' : type === 'transport' ? 'Ulaşım' : 'Fatura'
  return categories.find((c) => c.kind === 'expense' && c.name === name)?.id
}

const FIXED = new Set<BillType>(['rent', 'subscription'])

/**
 * Monthly bill plan started from an expense paid on `date` (its first occurrence, index 0). Fixed amount for rent and
 * subscriptions, variable otherwise. autopay: paid by credit card. Occurrences due before settledBefore (default: date)
 * are presettled.
 */
export function expenseBillPlan(i: {
  id: ID; createdAt: number; name: string; type: BillType; provider?: string; keywords: string[]
  amount: Kurus; date: ISODate; accountId: ID; categoryId?: ID; autopay: boolean; settledBefore?: ISODate
}): RecurringPlan {
  return {
    id: i.id, kind: 'recurring_expense', name: i.name, accountId: i.accountId, active: true, createdAt: i.createdAt,
    ...(i.categoryId && { categoryId: i.categoryId }),
    amount: i.amount, variable: !FIXED.has(i.type), frequency: 'monthly', startDate: i.date, settledBefore: i.settledBefore ?? i.date,
    bill: { type: i.type, ...(i.provider && { provider: i.provider }), autopay: i.autopay, matchKeywords: i.keywords },
  }
}

export interface BillSuggestion {
  key: string // 'plan:<id>' (link to an existing plan) or 'new:<group>'
  name: string
  type: BillType
  provider?: string
  keywords: string[]
  planId?: ID // set: link the items to this existing plan
  items: { tx: Transaction; index: number }[] // oldest first; index = occurrence index (new: months since the first)
}

// New bills of single-bill types group by type ("Akbil" + "İstanbulkart"), others by provider / keyword.
function groupKey(m: ExpenseBill & { name: string }): string {
  if (m.provider) return `p:${fold(m.provider)}`
  if (BY_TYPE.has(m.type)) return `t:${m.type}`
  return `k:${m.keywords[0] ?? fold(m.name)}`
}

/**
 * Regular payments hidden in past expenses (last 6 months up to today, not settling anything, not debt payments,
 * with a note, not in `ignored`): expenses linking to an existing plan, grouped by plan, and proposed new bills,
 * grouped by bill with one expense per month. A new bill detected only from the category needs 2+ months.
 */
export function billSuggestions(snap: Snapshot, today: ISODate, ignored: Iterable<ID> = []): BillSuggestion[] {
  const skip = new Set(ignored)
  const from = addMonths(today, -6)
  const txs = snap.transactions
    .filter((t) => t.kind === 'expense' && !t.occurrenceKey && !t.debtId && t.date >= from && t.date <= today && t.note?.trim() && !skip.has(t.id))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt))
  const claimed = new Set<string>()
  const groups = new Map<string, BillSuggestion & { strong: boolean; start: number }>()
  for (const tx of txs) {
    const m = matchExpenseToBill(tx, snap, today, claimed)
    if (!m || m.kind === 'already_paid') continue
    if (m.kind === 'link') {
      claimed.add(`${m.planId}:${m.occurrenceIndex}`)
      const key = `plan:${m.planId}`
      const plan = snap.plans.find((p) => p.id === m.planId) as RecurringPlan
      const g = groups.get(key) ?? { key, name: m.planName, type: billInfo(plan).type, keywords: [], planId: m.planId, items: [], strong: true, start: 0 }
      g.items.push({ tx, index: m.occurrenceIndex })
      groups.set(key, g)
      continue
    }
    const key = `new:${groupKey(m)}`
    const g = groups.get(key) ?? { key, name: m.name, type: m.type, provider: m.provider, keywords: m.keywords, items: [], strong: false, start: monthIndex(tx.date) }
    const index = monthIndex(tx.date) - g.start
    if (g.items.some((x) => x.index === index)) continue
    g.items.push({ tx, index })
    g.strong ||= m.strong
    groups.set(key, g)
  }
  return [...groups.values()]
    .filter((g) => g.planId || g.strong || g.items.length >= 2)
    .map(({ strong: _s, start: _st, ...g }) => g)
}

/**
 * Records for "Takibe al": links = occurrenceKey to set on each expense. A new bill starts at the first expense
 * (name, keywords from the suggestion; amount, account, category from the latest expense, category defaulting by
 * type; autopay when paid by card); months without an expense before the latest one are presettled.
 */
export function buildBillSuggestion(s: BillSuggestion, accounts: Account[], categories: Category[], o: { id: ID; now: number }): {
  plan?: RecurringPlan; links: { txId: ID; occurrenceKey: string }[]
} {
  if (s.planId) return { links: s.items.map((i) => ({ txId: i.tx.id, occurrenceKey: `${s.planId}:${i.index}` })) }
  const first = s.items[0].tx
  const last = s.items[s.items.length - 1].tx
  const plan = expenseBillPlan({
    id: o.id, createdAt: o.now, name: s.name, type: s.type, provider: s.provider, keywords: s.keywords,
    amount: last.amount, date: first.date, accountId: last.accountId,
    categoryId: last.categoryId ?? billCategoryId(s.type, categories),
    autopay: accounts.some((a) => a.id === last.accountId && a.kind === 'credit_card'),
    settledBefore: last.date,
  })
  return { plan, links: s.items.map((i) => ({ txId: i.tx.id, occurrenceKey: `${o.id}:${i.index}` })) }
}
