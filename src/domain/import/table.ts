// Spreadsheet / CSV statements: column mapping + row parsing. Pure.
import { toISO } from '../dates'
import { finalizeRows, isSummary, parseMeta, type DraftRow, type ParseOptions, type ParsedStatement } from './statement'
import { fold, leadingDate, parseCellAmount, type PDate } from './text'

export type Cell = string | number | boolean | Date | null | undefined

export interface ColumnMapping {
  headerRow: number // index of the header row; data starts after it (-1 = no header)
  date: number
  description: number
  amount?: number // single signed amount column
  debit?: number // borç column (used when amount is not set)
  credit?: number // alacak column
  balance?: number
}

const text = (c: Cell): string =>
  c === null || c === undefined ? '' : c instanceof Date ? `${c.getUTCDate()}.${c.getUTCMonth() + 1}.${c.getUTCFullYear()}` : String(c).trim()

function cellDate(c: Cell): PDate | null {
  if (c instanceof Date && !Number.isNaN(c.getTime())) return { y: c.getUTCFullYear(), m: c.getUTCMonth() + 1, d: c.getUTCDate() }
  if (typeof c === 'number' && c > 20000 && c < 80000) {
    // Excel serial date (days since 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86400000)
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
  }
  const s = text(c)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) }
  return leadingDate(s + ' ')?.date ?? null
}

function cellAmount(c: Cell): { value: number; marker: 'B' | 'A' | null } | null {
  if (typeof c === 'number') return Number.isFinite(c) ? { value: Math.round(c * 100), marker: null } : null
  const s = text(c)
  return s ? parseCellAmount(s) : null
}

/**
 * Rows of a spreadsheet / CSV -> statement. Rows without a parsable date or a non-zero amount are skipped,
 * as are summary rows. Amount column sign: negative = credit for cards (payment / refund), debit for
 * bank accounts. Borç / alacak columns decide direction directly.
 */
export function parseTable(rows: Cell[][], mapping: ColumnMapping, opts: ParseOptions = {}): ParsedStatement {
  const meta = parseMeta(rows.map((r) => r.map(text).filter(Boolean).join('   ')))
  const drafts: DraftRow[] = []
  rows.forEach((r, i) => {
    if (i <= mapping.headerRow) return
    const date = cellDate(r[mapping.date])
    const description = text(r[mapping.description]).replace(/\s+/g, ' ')
    if (!date || !description || isSummary(description)) return
    const balance = mapping.balance !== undefined ? cellAmount(r[mapping.balance])?.value : undefined
    let draft: DraftRow | null = null
    if (mapping.amount !== undefined) {
      const a = cellAmount(r[mapping.amount])
      if (a && a.value !== 0) {
        draft = { date, description, amounts: [Math.abs(a.value)], sign: a.value < 0 ? '-' : null, marker: a.marker, balance, source: i }
      }
    } else {
      const d = mapping.debit !== undefined ? cellAmount(r[mapping.debit]) : null
      const c = mapping.credit !== undefined ? cellAmount(r[mapping.credit]) : null
      if (d && d.value !== 0) draft = { date, description, amounts: [Math.abs(d.value)], sign: null, marker: null, column: 'debit', balance, source: i }
      else if (c && c.value !== 0) draft = { date, description, amounts: [Math.abs(c.value)], sign: null, marker: null, column: 'credit', balance, source: i }
    }
    if (draft) drafts.push(draft)
  })
  return { rows: finalizeRows(drafts, meta, opts), meta }
}

const HEAD = {
  date: /^(?:islem\s+)?tarih(?:i)?\b|^tarih|islem tarihi/,
  valor: /valor|hesaba gecis|kayit tarihi/,
  description: /aciklama|islem detay|detay|isyeri|uye isyeri|islem adi|^islem$|^islemler$|bilgi/,
  amount: /tutar|miktar|^tl$|islem tutari/,
  notAmount: /bonus|puan|doviz|chip|maxipuan|worldpuan|taksit sayisi/,
  debit: /^borc\b|borc tutari|cikan|giden|cekilen/,
  credit: /^alacak|alacak tutari|giren|gelen|yatan/,
  balance: /bakiye/,
}

/**
 * Detects the header row among the first 30 rows (needs a date and a description/amount header) and maps
 * columns from Turkish headers. Without a header row, guesses from data: the column that is mostly dates,
 * the text column with the longest values, and the first mostly-numeric column after it. null if unsure.
 */
export function guessMapping(rows: Cell[][]): ColumnMapping | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const h = rows[i].map((c) => fold(text(c)))
    const find = (re: RegExp, not?: RegExp) => {
      const k = h.findIndex((x) => x && re.test(x) && !(not && not.test(x)))
      return k < 0 ? undefined : k
    }
    const date = find(HEAD.date, HEAD.valor) ?? find(HEAD.date)
    const description = find(HEAD.description, /tarih/)
    if (date === undefined || description === undefined) continue
    const debit = find(HEAD.debit)
    const credit = find(HEAD.credit)
    const amount = find(HEAD.amount, new RegExp(`${HEAD.notAmount.source}|${HEAD.balance.source}`))
    const balance = find(HEAD.balance)
    if (amount === undefined && debit === undefined && credit === undefined) continue
    return amount !== undefined && (debit === undefined || credit === undefined)
      ? { headerRow: i, date, description, amount, balance }
      : { headerRow: i, date, description, debit, credit, balance }
  }
  // No header: infer from data.
  const width = Math.max(0, ...rows.map((r) => r.length))
  const data = rows.slice(0, 200)
  const score = (k: number, f: (c: Cell) => boolean) => data.filter((r) => f(r[k])).length
  let date = -1, best = 0
  for (let k = 0; k < width; k++) { const s = score(k, (c) => cellDate(c) !== null); if (s > best) { best = s; date = k } }
  if (date < 0 || best < 2) return null
  let description = -1, longest = 0
  for (let k = 0; k < width; k++) {
    if (k === date) continue
    const len = data.reduce((s, r) => s + (cellAmount(r[k]) || cellDate(r[k]) ? 0 : text(r[k]).length), 0)
    if (len > longest) { longest = len; description = k }
  }
  if (description < 0) return null
  const numeric = [...Array(width).keys()].filter((k) => k !== date && k !== description && score(k, (c) => cellAmount(c) !== null) >= best * 0.6)
  if (!numeric.length) return null
  return { headerRow: -1, date, description, amount: numeric[0], balance: numeric.length > 1 ? numeric[numeric.length - 1] : undefined }
}

/** Minimal CSV parser: auto-detects ; , or tab delimiter, handles quotes ("" escapes, newlines in quotes). */
export function parseCsv(input: string): string[][] {
  const s = input.replace(/^﻿/, '')
  const sample = s.split(/\r?\n/).slice(0, 10).join('\n').replace(/"[^"]*"/g, '')
  const count = (ch: string) => sample.split(ch).length - 1
  const delim = [';', '\t', ','].reduce((a, b) => (count(b) > count(a) ? b : a))
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delim) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** For display: ISO date of a cell (used by the mapping preview). */
export function cellDateISO(c: Cell): string | null {
  const d = cellDate(c)
  return d && d.y !== null ? toISO(d.y, d.m, d.d) : null
}
