import { addDays, formatMoney, parseMoney, type ISODate, type Kurus } from '../domain'

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']

const parts = (d: ISODate) => d.split('-').map(Number) as [number, number, number]

/** '2026-10-17' -> '17 Ekim 2026' (year omitted when sameYearAs matches). */
export function fmtDate(d: ISODate, sameYearAs?: ISODate): string {
  const [y, m, day] = parts(d)
  const base = `${day} ${MONTHS[m - 1]}`
  return sameYearAs && sameYearAs.slice(0, 4) === d.slice(0, 4) ? base : `${base} ${y}`
}

export function weekday(d: ISODate): string {
  const [y, m, day] = parts(d)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]
}

/** bugün / dün / yarın / '17 Ekim'. */
export function relDay(d: ISODate, today: ISODate): string {
  if (d === today) return 'bugün'
  if (d === addDays(today, -1)) return 'dün'
  if (d === addDays(today, 1)) return 'yarın'
  return fmtDate(d, today)
}

/** '2026-10' -> 'Ekim 2026' */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/** '2026-10', +1 -> '2026-11' */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** Kuruş -> editable input text without currency sign, e.g. '1.250,50'. */
export function moneyToInput(k: Kurus | undefined): string {
  if (k === undefined || k === 0) return ''
  return formatMoney(Math.abs(k)).replace(/₺/g, '').trim()
}

/** parseMoney that also accepts a leading minus sign. */
export function parseSigned(input: string): Kurus | null {
  const s = input.trim()
  if (s.startsWith('-')) {
    const v = parseMoney(s.slice(1))
    return v === null ? null : -v
  }
  return parseMoney(s)
}

/** Alphabetical (tr), with the catch-all "Diğer..." categories last. */
export function sortCategories<T extends { name: string }>(list: T[]): T[] {
  const other = (n: string) => (n.startsWith('Diğer') ? 1 : 0)
  return [...list].sort((a, b) => other(a.name) - other(b.name) || a.name.localeCompare(b.name, 'tr'))
}
