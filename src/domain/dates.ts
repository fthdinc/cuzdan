import type { ISODate } from './types'

// All date math is done in UTC on 'YYYY-MM-DD' strings to avoid timezone bugs.

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

export function ymd(d: ISODate): [number, number, number] {
  const [y, m, day] = d.split('-').map(Number)
  return [y, m, day]
}

export function toISO(y: number, m: number, d: number): ISODate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`
}

/** m is 1-12. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Month index (y*12 + m-1) -> date with `day` clamped to month end. */
export function dateInMonth(monthIndex: number, day: number): ISODate {
  const y = Math.floor(monthIndex / 12)
  const m = monthIndex - y * 12 + 1
  return toISO(y, m, Math.min(day, daysInMonth(y, m)))
}

export function monthIndex(d: ISODate): number {
  const [y, m] = ymd(d)
  return y * 12 + m - 1
}

export function addMonths(d: ISODate, n: number): ISODate {
  const [, , day] = ymd(d)
  return dateInMonth(monthIndex(d) + n, day)
}

export function addDays(d: ISODate, n: number): ISODate {
  const [y, m, day] = ymd(d)
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10)
}

/** The user's local calendar date. */
export function todayISO(): ISODate {
  const now = new Date()
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate())
}
