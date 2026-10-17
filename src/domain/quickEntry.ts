import { addDays, daysInMonth, toISO, ymd } from './dates'
import { parseMoney } from './money'
import type { Category, ISODate, QuickEntry } from './types'

const lower = (s: string) => s.toLocaleLowerCase('tr-TR')

/** "15.10" / "15.10.2026" -> ISO date (year defaults to today's), null if not a valid date. */
function parseDateToken(token: string, today: ISODate): ISODate | null {
  const m = /^(\d{1,2})\.(\d{2})(?:\.(\d{4}))?$/.exec(token)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = m[3] ? Number(m[3]) : ymd(today)[0]
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return toISO(year, month, day)
}

/**
 * "120 market", "+45000 maaş", "350,50 benzin dün", "1.250 kira 15.10" -> QuickEntry. null if no amount (or 0).
 * Leading '+' = income. Amount = first numeric token. Later "dd.mm(.yyyy)" tokens set the date, "dün"/"bugün"
 * too (last one wins). All other words (original casing) form the note. Category = first category of the
 * entry's kind whose name or keyword equals a note word (tr-TR case-insensitive).
 */
export function parseQuickEntry(text: string, categories: Category[], today: ISODate): QuickEntry | null {
  let s = text.trim()
  const kind = s.startsWith('+') ? 'income' : 'expense'
  if (kind === 'income') s = s.slice(1)
  let amount: number | null = null
  let date = today
  const noteWords: string[] = []
  for (const token of s.split(/\s+/).filter(Boolean)) {
    const isNumber = /^\d[\d.,]*$/.test(token)
    if (isNumber && amount === null) {
      amount = parseMoney(token)
      if (amount !== null) continue
    }
    const w = lower(token)
    const tokenDate = w === 'dün' ? addDays(today, -1) : w === 'bugün' ? today : isNumber ? parseDateToken(token, today) : null
    if (tokenDate) date = tokenDate
    else noteWords.push(token)
  }
  if (!amount) return null

  const words = new Set(noteWords.map(lower))
  const category = categories.find((c) => c.kind === kind
    && [c.name, ...(c.keywords ?? [])].some((k) => words.has(lower(k))))
  return { kind, amount, date, categoryId: category?.id, note: noteWords.join(' ') }
}
