// Bank-agnostic statement parsing: text lines (PDF / pasted) and shared row post-processing.
import type { ISODate, Kurus } from '../types'
import { AMOUNT_SRC, amountValue, findAmounts, findDates, fold, leadingDate, resolveYear, type PDate } from './text'

export type Direction = 'debit' | 'credit'
/** 'card': credit = payment / refund (debt goes down). 'bank': credit = money in. */
export type StatementKind = 'card' | 'bank'

export interface Installment { current: number; total: number }

export interface ParsedRow {
  date: ISODate
  description: string
  amount: Kurus // > 0
  direction: Direction
  installment?: Installment
  installmentTotal?: Kurus // whole purchase amount when the statement shows it
  balance?: Kurus // running balance column, when present
  foreign?: { currency: string; amount: Kurus }
  source: number // index of the first source line / table row
}

export interface StatementMeta {
  statementDate?: ISODate // hesap kesim tarihi
  dueDate?: ISODate // son ödeme tarihi
  totalDebt?: Kurus // dönem borcu / toplam borç
  minPayment?: Kurus // asgari ödeme
  limit?: Kurus // kart limiti
}

export interface ParsedStatement {
  rows: ParsedRow[]
  meta: StatementMeta
}

export interface ParseOptions {
  kind?: StatementKind // default 'card'
  today?: ISODate // reference for dates without a year when no kesim date is found
}

/** Intermediate row before direction / year / installment resolution (shared with table parsing). */
export interface DraftRow {
  date: PDate
  description: string
  amounts: Kurus[] // unsigned, left to right
  sign: '-' | '+' | null // explicit sign on the main amount
  marker: 'B' | 'A' | null // borç / alacak marker
  column?: Direction // from separate borç / alacak columns
  balance?: Kurus
  source: number
}

const CURRENCIES = 'USD|EUR|GBP|CHF|JPY|CAD|AUD|SEK|NOK|DKK|SAR|AED|RUB|CNY|PLN|HUF|CZK|RON|BGN|KWD|QAR'

// One trailing amount (optionally signed, with TL / ₺, sign after, "(-)", or B/A marker) at the end of the string.
const TRAIL = new RegExp(
  String.raw`(?:^|\s)([+-])?(?:(?:TL|TRY|₺)\s?)?(${AMOUNT_SRC})(?:\s?([+-]))?(?:\s?(?:TL|TRY|₺))?(?:\s?\(\s?([+-])\s?\))?(?:\s?([BA])(?![A-Za-z0-9]))?\s*$`,
  'i',
)
const FOREIGN = new RegExp(String.raw`(?:\b(${CURRENCIES})\s?(${AMOUNT_SRC})|(${AMOUNT_SRC})\s?(${CURRENCIES})\b)`, 'i')
const CUR_BEFORE = new RegExp(String.raw`\b(?:${CURRENCIES})\s?$`, 'i')

// --- summary / noise detection (on folded text) ---

const SUMMARY = /^(?:devreden|devir\b|bakiye devri|onceki (?:donem|ekstre|bakiye|hesap)|ara toplam|genel toplam|toplam(?:\s+(?:borc|tutar|harcama|odeme|alacak|islem))?\s*$|toplam (?:borc|tutar|harcama|odeme)|donem (?:borcu|ici toplam)|acilis bakiye|kapanis bakiye|asgari odeme|son odeme tarihi|hesap kesim)/
const CHARGE = /faiz|ucret|komisyon|vergi|bsmv|kkdf|masraf|aidat/

export function isSummary(description: string): boolean {
  const f = fold(description).trim()
  if (f.includes('devreden')) return true
  return SUMMARY.test(f) && !CHARGE.test(f)
}

const NOISE = /tarih|aciklama|tutar|sayfa|toplam|bakiye|www\.|http|musteri hizmet|ekstre|hesap ozeti|^\d+\s*\/\s*\d+$/

// --- direction keywords (folded) ---
const CREDIT_COMMON = /\b(?:iade|iptal|alacak|geri odeme)/
const CREDIT_CARD = /\b(?:odeme|odemeniz|tahsilat)/
const CREDIT_BANK = /\b(?:gelen|maas|maaş|faiz geliri|kar payi)/
const NOT_CREDIT = /talimat|fatura|faiz|ucret/

function keywordDirection(description: string, kind: StatementKind): Direction | null {
  const f = fold(description)
  if (CREDIT_COMMON.test(f)) return 'credit'
  if (NOT_CREDIT.test(f)) return null
  if (kind === 'card' ? CREDIT_CARD.test(f) : CREDIT_BANK.test(f)) return 'credit'
  return null
}

// --- installments ---

/**
 * "3/6", "(3/6)", "3/6 TAKSİT", "TAKSIT 3/6", "3. TAKSİT / 6", "6/4. taksit" (total/current, the ordinal dot
 * marks current), "3 / 6 TKS". current <= total, 2 <= total <= 48; if the first number is larger they are swapped.
 */
export function detectInstallment(description: string): Installment | null {
  const f = fold(description)
  const tk = String.raw`(?:taksit|tkst|tks|tak\.)`
  const make = (cur: number, tot: number): Installment | null => {
    if (cur > tot) [cur, tot] = [tot, cur]
    return tot >= 2 && tot <= 48 && cur >= 1 ? { current: cur, total: tot } : null
  }
  let m = new RegExp(String.raw`(\d{1,2})\s*\.\s*${tk}\w*\s*/\s*(\d{1,2})`).exec(f)
  if (m) return make(Number(m[1]), Number(m[2]))
  m = new RegExp(String.raw`(?:^|[\s(])(\d{1,2})\s*/\s*(\d{1,2})\s*\.\s*${tk}`).exec(f)
  if (m) return make(Number(m[2]), Number(m[1])) // total/current.
  m = new RegExp(String.raw`${tk}\w*\s*:?\s*(\d{1,2})\s*/\s*(\d{1,2})`).exec(f)
  if (m) return make(Number(m[1]), Number(m[2]))
  m = /(?:^|[\s(])(\d{1,2})\s*\/\s*(\d{1,2})(?=$|[\s).,])/.exec(f)
  if (m && Number(m[1]) <= Number(m[2])) return make(Number(m[1]), Number(m[2]))
  return null
}

// --- metadata ---

type MetaKey = keyof StatementMeta
const META_LABELS: { key: MetaKey; re: RegExp; type: 'date' | 'amount' }[] = [
  { key: 'statementDate', type: 'date', re: /(?<!sonraki\s)(?<!sonraki\s(?:hesap\s|ekstre\s))(?:hesap\s+|ekstre\s+)?kesim\s+tarihi|ekstre\s+tarihi|hesap\s+ozeti\s+tarihi/g },
  { key: 'dueDate', type: 'date', re: /(?<!sonraki\s)son\s+odeme\s+tarihi/g },
  { key: 'totalDebt', type: 'amount', re: /(?<!onceki\s)(?<!onceki\s(?:hesap|ekstre)\s)(?:guncel\s+|toplam\s+)?donem\s+borcu|toplam\s+borc(?:unuz)?|ekstre\s+borcu|hesap\s+ozeti\s+borcu|odenmesi\s+gereken\s+tutar/g },
  { key: 'minPayment', type: 'amount', re: /asgari\s+odeme(?:\s+tutari)?|en\s+az\s+odeme(?:\s+tutari)?|asgari\s+tutar/g },
  { key: 'limit', type: 'amount', re: /(?<!kullanilabilir\s)(?:kart|kredi)\s+(?:karti\s+)?limiti|toplam\s+(?:kart\s+)?limit(?:i|iniz)?\b/g },
]

/**
 * Statement metadata from free text. For each label the first value of the right type after it on the
 * same line (before the next label) is used; a lone label line takes the value before it on the same
 * line, or the k-th value of the next line when labels and values are laid out as a two-row table.
 * First match per key wins (summary boxes come first in statements).
 */
export function parseMeta(lines: string[]): StatementMeta {
  const meta: StatementMeta = {}
  const values = (s: string) => [
    ...findDates(s).map((d) => ({ index: d.index, type: 'date' as const, date: d.date, amount: 0 })),
    ...findAmounts(s).map((a) => ({ index: a.index, type: 'amount' as const, date: '', amount: a.value })),
  ].sort((a, b) => a.index - b.index)
  for (let i = 0; i < lines.length; i++) {
    const f = fold(lines[i])
    const labels = META_LABELS.flatMap((l) => [...f.matchAll(l.re)].map((m) => ({ ...l, index: m.index, end: m.index + m[0].length })))
      .sort((a, b) => a.index - b.index)
    if (!labels.length) continue
    const vals = values(lines[i])
    const rest = labels.reduce((s, l) => s.slice(0, l.index) + ' '.repeat(l.end - l.index) + s.slice(l.end), f)
    const labelOnly = vals.length === 0 && rest.replace(/[\s:.]/g, '').length <= 3
    labels.forEach((l, k) => {
      if (meta[l.key] !== undefined) return
      const next = labels[k + 1]?.index ?? Infinity
      let v = vals.find((x) => x.type === l.type && x.index >= l.end && x.index < next)
      if (!v && labels.length === 1) v = vals.filter((x) => x.type === l.type && x.index < l.index).pop()
      if (!v && labelOnly && i + 1 < lines.length) {
        const nv = values(lines[i + 1])
        const cand = nv.length === labels.length ? nv[k] : nv.find((x) => x.type === l.type)
        if (cand?.type === l.type) v = cand
      }
      if (!v) return
      if (l.type === 'date') (meta[l.key] as ISODate) = v.date
      else (meta[l.key] as Kurus) = v.amount
    })
  }
  return meta
}

// --- text line parsing ---

/** Parse one line as a transaction row, or null. Exported for tests. */
export function parseRowLine(line: string, source = 0): DraftRow | null {
  const d = leadingDate(line)
  if (!d) return null
  let rest = line.slice(d.length).trim()
  const d2 = leadingDate(rest, false) // valör / hesaba geçiş tarihi
  if (d2) rest = rest.slice(d2.length).trim()
  rest = rest.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, '')
  rest = rest.replace(/(?<=\d)\s*x\d{1,2}$/i, '') // "kalan taksit" count after the remaining amount
  const amounts: { value: Kurus; sign: '-' | '+' | null; marker: 'B' | 'A' | null }[] = []
  while (amounts.length < 4) {
    const m = TRAIL.exec(rest)
    if (!m) break
    const before = rest.slice(0, m.index)
    if (CUR_BEFORE.test(before)) break // "USD 12,00" belongs to the description
    const sign = (m[1] ?? m[3] ?? m[4] ?? null) as '-' | '+' | null
    amounts.unshift({ value: amountValue(m[2])!, sign, marker: m[5] ? (m[5].toUpperCase() as 'B' | 'A') : null })
    rest = before.trimEnd()
  }
  const description = rest.replace(/\s+/g, ' ').trim()
  if (!amounts.length || !description || !/\p{L}/u.test(description)) return null
  let main = 0
  // Separate borç / alacak columns with a zero in the unused one: [0,00 | 2.000,00 | balance].
  if (amounts.length >= 3 && amounts[0].value === 0 && amounts[1].value > 0) main = 1
  const a = amounts[main]
  return {
    date: d.date,
    description,
    amounts: amounts.slice(main).map((x) => x.value),
    sign: a.sign,
    marker: a.marker,
    column: main === 1 ? 'credit' : amounts.length >= 3 && amounts[1].value === 0 && a.value > 0 ? 'debit' : undefined,
    balance: amounts.length - main >= 2 ? amounts[amounts.length - 1].value * (amounts[amounts.length - 1].sign === '-' ? -1 : 1) : undefined,
    source,
  }
}

/** A line that continues the previous row's description (wrapped text / foreign amount line). */
function isContinuation(line: string): boolean {
  if (line.length > 70 || leadingDate(line)) return false
  const f = fold(line)
  if (NOISE.test(f) || META_LABELS.some((l) => new RegExp(l.re.source).test(f))) return false
  if (FOREIGN.test(line)) return true
  if (TRAIL.test(line)) return false
  // Wrapped merchant text is upper case; prose (ads, notes) between rows is not.
  return !/\p{Ll}/u.test(line.replace(/\b(?:www\.\S+|\S+\.com\S*)/g, ''))
}

/**
 * Generic statement text parser. A transaction row is a line that starts with a date, has a description
 * and ends with one or more amounts. Heuristics:
 * - amounts: Turkish "1.234,56" or English "1,234.56", optional TL/₺, sign before/after, "(-)", or B/A marker.
 * - several trailing amounts (amount + bonus/puan, amount + balance, borç + alacak + bakiye): the first one
 *   after the description is the transaction amount, except [0,00 | X | bakiye] which means alacak column,
 *   and installment rows showing [total, part] where the part is used.
 * - "USD 12,00" style foreign amounts stay in the description and are reported in `foreign`.
 * - lines without date/amount right after a row are appended to its description (max 2, upper case only).
 * - summary rows (devreden, toplam, önceki dönem ...) are dropped even when they carry a date.
 */
export function parseStatementText(lines: string[], opts: ParseOptions = {}): ParsedStatement {
  const clean = lines.map((l) => l.normalize('NFC').replace(/\s+/g, ' ').trim())
  const meta = parseMeta(clean)
  const drafts: DraftRow[] = []
  let last: DraftRow | null = null
  let cont = 0
  const merged = new Set<number>()
  clean.forEach((line, i) => {
    if (!line) { last = null; return }
    let r = parseRowLine(line, i)
    // Description wrapped before the amount: "date text" + "more text amount".
    if (!r && leadingDate(line) && clean[i + 1] && !leadingDate(clean[i + 1]) && !NOISE.test(fold(clean[i + 1])) && !merged.has(i)) {
      r = parseRowLine(`${line} ${clean[i + 1]}`, i)
      if (r) merged.add(i + 1)
    }
    if (merged.has(i)) return
    if (r) {
      if (isSummary(r.description)) { last = null; return }
      drafts.push(r); last = r; cont = 0
      return
    }
    if (last && cont < 2 && isContinuation(line)) {
      last.description += ' ' + line
      cont++
      return
    }
    last = null
  })
  return { rows: finalizeRows(drafts, meta, opts), meta }
}

/** Direction, year, installment and foreign-amount resolution shared by text and table parsing. */
export function finalizeRows(drafts: DraftRow[], meta: StatementMeta, opts: ParseOptions = {}): ParsedRow[] {
  const kind = opts.kind ?? 'card'
  const ref = meta.statementDate ?? opts.today ?? `${new Date().getFullYear()}-12-31`
  // When only one sign is ever used ("-" on payments of a card, "-" on outflows of an account), unsigned
  // rows are the other direction. Keywords are only a last resort.
  const signs = new Set(drafts.map((d) => d.sign).filter(Boolean))
  const oneSign = signs.size === 1 && !drafts.some((d) => d.marker || d.column) ? [...signs][0] : null
  const signDir = (s: '-' | '+'): Direction => (kind === 'card' ? 'credit' : s === '-' ? 'debit' : 'credit')
  const unsigned: Direction | null = oneSign ? (signDir(oneSign) === 'credit' ? 'debit' : 'credit') : null
  const rows = drafts.map((d) => {
    const installment = detectInstallment(d.description) ?? undefined
    let amount = d.amounts[0]
    let installmentTotal: Kurus | undefined
    if (installment && d.amounts.length >= 2) {
      const [a0, a1] = d.amounts
      const n = installment.total
      if (a1 > 0 && Math.abs(a0 - a1 * n) <= n * 100) { amount = a1; installmentTotal = a0 }
      else if (Math.abs(a1 - a0 * n) <= n * 100) installmentTotal = a1
    }
    if (installment && !installmentTotal) {
      const inDesc = findAmounts(d.description).find((x) => Math.abs(x.value - amount * installment.total) <= installment.total * 100)
      if (inDesc) installmentTotal = inDesc.value
    }
    const fm = FOREIGN.exec(d.description)
    const foreign = fm ? { currency: (fm[1] ?? fm[4]).toUpperCase(), amount: amountValue(fm[2] ?? fm[3])! } : undefined
    let direction: Direction | null = null
    if (d.marker) direction = d.marker === 'A' ? 'credit' : 'debit'
    else if (d.column) direction = d.column
    else if (d.sign) direction = signDir(d.sign)
    return {
      row: {
        date: resolveYear(d.date, ref), description: d.description, amount, direction: direction ?? 'debit',
        installment, installmentTotal, balance: d.balance, foreign, source: d.source,
      } satisfies ParsedRow,
      decided: direction !== null,
    }
  })
  // Running balance: prev ± amount = balance decides direction (works for ascending and descending order).
  rows.forEach((r, i) => {
    if (r.decided || r.row.balance === undefined || r.row.amount === 0) return
    const { amount, balance } = r.row
    const check = (other: number | undefined, sign: 1 | -1) => {
      if (other === undefined) return null
      if (other + sign * -amount === balance) return 'debit'
      if (other + sign * amount === balance) return 'credit'
      return null
    }
    const prev = rows[i - 1]?.row.balance
    const next = rows[i + 1]?.row.balance
    const dir = check(prev, 1) ?? check(next, 1)
    if (dir) { r.row.direction = dir; r.decided = true }
  })
  for (const r of rows) {
    if (r.decided) continue
    r.row.direction = unsigned ?? keywordDirection(r.row.description, kind) ?? 'debit'
  }
  return rows.map((r) => r.row).filter((r) => r.amount > 0)
}
