// Low-level text helpers for statement parsing. Pure, no DOM.
import { daysInMonth, toISO } from '../dates'
import type { ISODate, Kurus } from '../types'

const FOLD: Record<string, string> = {
  İ: 'i', I: 'i', ı: 'i', Ş: 's', ş: 's', Ğ: 'g', ğ: 'g', Ü: 'u', ü: 'u', Ö: 'o', ö: 'o', Ç: 'c', ç: 'c',
  Â: 'a', â: 'a', Î: 'i', î: 'i', Û: 'u', û: 'u',
}

/**
 * Lowercase + strip Turkish diacritics, 1:1 per UTF-16 unit (so indices stay aligned with the input).
 * "ÖDEME" / "Odeme" / "ödeme" -> "odeme"; "İADE" / "IADE" -> "iade".
 */
export function fold(s: string): string {
  let out = ''
  for (const c of s) {
    const f = FOLD[c]
    if (f) { out += f; continue }
    const l = c.toLowerCase()
    out += l.length === c.length ? l : c
  }
  return out
}

// --- dates ---

export interface PDate { y: number | null; m: number; d: number }

const MONTHS: Record<string, number> = {
  ocak: 1, oca: 1, subat: 2, sub: 2, mart: 3, mar: 3, nisan: 4, nis: 4, mayis: 5, may: 5,
  haziran: 6, haz: 6, temmuz: 7, tem: 7, agustos: 8, agu: 8, eylul: 9, eyl: 9, ekim: 10, eki: 10,
  kasim: 11, kas: 11, aralik: 12, ara: 12,
}
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')

const NUM_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?![\d.,/-]*\d)/
const NUM_DATE_NOYEAR = /^(\d{1,2})[./](\d{1,2})(?=\s)(?!\s*[.,]\d)/
const NAME_DATE = new RegExp(`^(\\d{1,2})\\s*(${MONTH_ALT})\\.?(?:\\s+(\\d{4}))?(?=\\s|$)`)

function valid(d: PDate): PDate | null {
  if (d.m < 1 || d.m > 12 || d.d < 1) return null
  if (d.d > daysInMonth(d.y ?? 2000, d.m)) return null
  return d
}

const year = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s))

/**
 * Date at the very start of `s`: dd.mm.yyyy, dd/mm/yyyy, dd-mm-yyyy, dd.mm.yy, "15 Ekim 2026", "15 Eki",
 * and (allowNoYear) "15.10" followed by a space. Returns the date and the matched length, or null.
 */
export function leadingDate(s: string, allowNoYear = true): { date: PDate; length: number } | null {
  let m = NUM_DATE.exec(s)
  if (m) {
    const d = valid({ y: year(m[3]), m: Number(m[2]), d: Number(m[1]) })
    return d && { date: d, length: m[0].length }
  }
  m = NAME_DATE.exec(fold(s))
  if (m) {
    const d = valid({ y: m[3] ? Number(m[3]) : null, m: MONTHS[m[2]], d: Number(m[1]) })
    return d && { date: d, length: m[0].length }
  }
  if (allowNoYear) {
    m = NUM_DATE_NOYEAR.exec(s)
    if (m) {
      const d = valid({ y: null, m: Number(m[2]), d: Number(m[1]) })
      return d && { date: d, length: m[0].length }
    }
  }
  return null
}

/** All dates anywhere in `s` (numeric with year, or "15 Ekim 2026"), with their index. */
export function findDates(s: string): { index: number; date: ISODate }[] {
  const out: { index: number; date: ISODate }[] = []
  const f = fold(s)
  const re = new RegExp(`(?<![\\d.,])(\\d{1,2})(?:[./-](\\d{1,2})[./-](\\d{4}|\\d{2})|\\s+(${MONTH_ALT})\\.?\\s+(\\d{4}))(?![\\d])`, 'g')
  for (const m of f.matchAll(re)) {
    const d = valid(m[2]
      ? { y: year(m[3]), m: Number(m[2]), d: Number(m[1]) }
      : { y: Number(m[5]), m: MONTHS[m[4]], d: Number(m[1]) })
    if (d) out.push({ index: m.index, date: toISO(d.y!, d.m, d.d) })
  }
  return out
}

/** Fill in a missing year: the latest date not after `ref` (statements list past transactions). */
export function resolveYear(d: PDate, ref: ISODate): ISODate {
  if (d.y !== null) return toISO(d.y, d.m, d.d)
  const y = Number(ref.slice(0, 4))
  const iso = toISO(y, d.m, Math.min(d.d, daysInMonth(y, d.m)))
  return iso > ref ? toISO(y - 1, d.m, Math.min(d.d, daysInMonth(y - 1, d.m))) : iso
}

// --- amounts ---

/**
 * A money number with exactly two decimals, Turkish ("1.234,56") or English ("1,234.56") grouping,
 * or ungrouped ("1234,56" / "1234.56"). Group and decimal separators must differ.
 */
export const AMOUNT_SRC = String.raw`(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+[.,]\d{2})`

/** "1.234,56" | "1,234.56" | "12,50" -> kuruş (unsigned). null when not an AMOUNT_SRC number. */
export function amountValue(s: string): Kurus | null {
  if (!new RegExp(`^${AMOUNT_SRC}$`).test(s)) return null
  const digits = s.replace(/[.,]/g, '')
  return Number(digits)
}

/** All amounts anywhere in a string (unsigned), with index. */
export function findAmounts(s: string): { index: number; value: Kurus }[] {
  const re = new RegExp(`(?<![\\d.,])${AMOUNT_SRC}(?![\\d]|[.,]\\d)`, 'g')
  return [...s.matchAll(re)].map((m) => ({ index: m.index, value: amountValue(m[0])! }))
}

/**
 * Loose money parsing for spreadsheet / CSV cells: "-1.234,56 TL", "1,234.56", "1234,5", "(12,00)", "125 B".
 * Returns signed kuruş plus a borç/alacak marker if present. null if not a number.
 */
export function parseCellAmount(raw: string): { value: Kurus; marker: 'B' | 'A' | null } | null {
  let s = raw.trim().replace(/\s+/g, ' ')
  let marker: 'B' | 'A' | null = null
  const mk = /\s?\(?([BA])\)?$/i.exec(s)
  if (mk && /\d/.test(s.slice(0, mk.index))) { marker = mk[1].toUpperCase() as 'B' | 'A'; s = s.slice(0, mk.index) }
  s = s.replace(/(?:TL|TRY|₺)/gi, '').replace(/\s/g, '')
  let sign = 1
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1) }
  if (/^[-−]/.test(s) || /[-−]$/.test(s)) { sign = -1; s = s.replace(/^[-−]|[-−]$/g, '') }
  else if (/^\+/.test(s) || /\+$/.test(s)) s = s.replace(/^\+|\+$/g, '')
  if (!/^\d[\d.,]*$/.test(s)) return null
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let intPart = s
  let frac = ''
  const dec = Math.max(lastDot, lastComma)
  if (lastDot >= 0 && lastComma >= 0) {
    intPart = s.slice(0, dec); frac = s.slice(dec + 1)
  } else if (dec >= 0 && s.length - dec - 1 <= 2 && s.indexOf(s[dec]) === dec) {
    intPart = s.slice(0, dec); frac = s.slice(dec + 1)
  }
  intPart = intPart.replace(/[.,]/g, '')
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(frac)) return null
  return { value: sign * (Number(intPart) * 100 + Number(frac.padEnd(2, '0'))), marker }
}

// --- EBCDIC (IBM AFP generated PDFs) ---

/**
 * Some bank PDFs are produced from IBM AFP print streams: Type3 fonts without a ToUnicode map, so the
 * extracted text is raw EBCDIC code points shown as Latin-1 ("ñò@ð" = "12 0"). Letters, digits, space and
 * common punctuation are invariant across EBCDIC code pages; the Turkish letters below were mapped from
 * real Turkish AFP statements and CP1026 (best effort, fonts in one document may differ).
 */
const EBCDIC: Record<number, string> = {
  0x40: ' ', 0x4B: '.', 0x4C: '<', 0x4D: '(', 0x4E: '+', 0x50: '&', 0x5C: '*', 0x5D: ')', 0x5E: ';',
  0x60: '-', 0x61: '/', 0x6B: ',', 0x6C: '%', 0x6D: '_', 0x6E: '>', 0x6F: '?', 0x7A: ':', 0x7D: "'", 0x7E: '=',
  // Turkish letters (observed + CP1026)
  0x48: 'ç', 0x4A: 'Ç', 0x5A: 'Ğ', 0x5B: 'İ', 0x68: 'Ç', 0x6A: 'ş', 0x79: 'ı', 0x7B: 'Ö', 0x7C: 'Ş', 0x7F: 'Ü',
  0xA1: 'ö', 0xAA: 'ı', 0xAB: 'İ', 0xAC: 'ş', 0xAE: 'Ş', 0xB4: 'İ', 0xB5: 'Ş', 0xB6: 'Ş', 0xB7: 'ı', 0xB8: 'İ',
  0xB9: 'ğ', 0xBA: 'ı', 0xBB: 'ı', 0xBC: 'İ', 0xBD: 'ş', 0xBE: 'ğ', 0xBF: 'ı', 0xC0: 'İ', 0xCC: 'Ö', 0xD0: 'ğ',
  0xDC: 'ü', 0xE0: 'ü', 0xEC: 'ö', 0xFC: 'Ü',
}
for (let i = 0; i < 9; i++) {
  EBCDIC[0x81 + i] = 'abcdefghi'[i]; EBCDIC[0x91 + i] = 'jklmnopqr'[i]
  EBCDIC[0xC1 + i] = 'ABCDEFGHI'[i]; EBCDIC[0xD1 + i] = 'JKLMNOPQR'[i]
}
for (let i = 0; i < 8; i++) { EBCDIC[0xA2 + i] = 'stuvwxyz'[i]; EBCDIC[0xE2 + i] = 'STUVWXYZ'[i] }
for (let i = 0; i < 10; i++) EBCDIC[0xF0 + i] = String(i)

const code = (c: string) => (c === 'μ' ? 0xb5 : c.charCodeAt(0)) // pdf.js normalizes µ (0xB5) to μ

/** True when the text looks like raw EBCDIC: '@' spaces and 0xF0-0xF9 digits dominate, almost no ASCII digits. */
export function looksLikeEbcdic(text: string): boolean {
  let ebcdic = 0, ascii = 0, total = 0
  for (const c of text) {
    const k = code(c)
    if (/\s/.test(c)) continue
    total++
    if (k === 0x40 || (k >= 0xf0 && k <= 0xf9) || (k >= 0x81 && k <= 0xa9) || (k >= 0xc1 && k <= 0xe9)) ebcdic++
    if (k >= 0x30 && k <= 0x39) ascii++
  }
  return total > 20 && ebcdic / total > 0.6 && ascii < ebcdic / 20
}

export function decodeEbcdic(s: string): string {
  let out = ''
  for (const c of s) {
    const k = code(c)
    out += k < 0x40 ? c : EBCDIC[k] ?? '?'
  }
  return out
}
