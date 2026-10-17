/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseStatementText } from '../../domain/import'
import { extractPdfLinesWith, PdfPasswordError, type PdfJsLike } from './pdfCore'

pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
const sample = fileURLToPath(new URL('../../../samples/ornek-kart-ekstresi.pdf', import.meta.url))

describe('PDF extraction end to end (pdf.js legacy build in node)', () => {
  it('reads the sample statement and parses every row and the metadata', async () => {
    const lines = await extractPdfLinesWith(pdfjs as unknown as PdfJsLike, readFileSync(sample))
    expect(lines).toContain('Islem Tarihi   Aciklama   Tutar (TL)   Puan')
    const r = parseStatementText(lines, { kind: 'card', today: '2026-10-17' })
    expect(r.meta).toEqual({ statementDate: '2026-10-10', dueDate: '2026-10-20', totalDebt: 713540, minPayment: 142708, limit: 3000000 })
    expect(r.rows.map((x) => [x.date, x.description, x.amount, x.direction])).toEqual([
      ['2026-09-12', 'ODEMENIZ ICIN TESEKKURLER', 600000, 'credit'],
      ['2026-09-14', 'MIGROS KADIKOY ISTANBUL', 125040, 'debit'],
      ['2026-09-15', 'ELEKTRONIK MAGAZA 2/6 TAKSIT', 150000, 'debit'],
      ['2026-09-18', 'AMAZON WEB SERVICES USD 12,00', 41235, 'debit'],
      ['2026-09-20', 'UZUN ADLI BIR ISYERI TICARET LIMITED SIRKETI ANKARA', 64000, 'debit'],
      ['2026-09-22', 'GIYIM MAGAZASI IADE', 35000, 'credit'],
      ['2026-10-01', 'ECZANE SAGLIK', 18265, 'debit'],
      ['2026-10-05', 'KAFE ANKARA', 350000, 'debit'],
    ])
    expect(r.rows[2].installment).toEqual({ current: 2, total: 6 })
    expect(r.rows[3].foreign).toEqual({ currency: 'USD', amount: 1200 })
    // previous 6.000 - payments/refunds + spending = dönem borcu
    const net = r.rows.reduce((s, x) => s + (x.direction === 'debit' ? x.amount : -x.amount), 0)
    expect(600000 + net).toBe(r.meta.totalDebt)
  })

  it('maps pdf.js PasswordException to PdfPasswordError', async () => {
    const fake = (code: number): PdfJsLike => ({
      getDocument: () => ({ promise: Promise.reject(Object.assign(new Error('pw'), { name: 'PasswordException', code })) }),
    })
    await expect(extractPdfLinesWith(fake(1), new Uint8Array(1))).rejects.toMatchObject({ name: 'PdfPasswordError', incorrect: false })
    await expect(extractPdfLinesWith(fake(2), new Uint8Array(1), 'x')).rejects.toBeInstanceOf(PdfPasswordError)
  })
})
