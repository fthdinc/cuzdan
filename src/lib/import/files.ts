// Browser-side statement file reading. Heavy libraries are loaded on demand (separate chunks).
import { parseCsv, type Cell } from '../../domain/import'
import { extractPdfLinesWith, PdfPasswordError, type PdfJsLike } from './pdfCore'

export { PdfPasswordError }

export type StatementSource =
  | { type: 'lines'; lines: string[]; name: string }
  | { type: 'table'; rows: Cell[][]; name: string }

let pdfjsPromise: Promise<PdfJsLike> | null = null
function loadPdfJs(): Promise<PdfJsLike> {
  pdfjsPromise ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs as unknown as PdfJsLike
  })
  return pdfjsPromise
}

/** Text lines of a PDF. Throws PdfPasswordError for encrypted files (the password is never stored). */
export async function readPdf(file: Blob, password?: string): Promise<string[]> {
  return extractPdfLinesWith(await loadPdfJs(), await file.arrayBuffer(), password)
}

/** First sheet of an .xlsx file. */
export async function readXlsx(file: Blob): Promise<Cell[][]> {
  const { readSheet } = await import('read-excel-file/browser')
  try {
    return (await readSheet(file)) as Cell[][]
  } catch {
    throw new Error('Excel dosyası okunamadı. Dosya bozuk ya da şifreli olabilir; CSV olarak kaydedip deneyin.')
  }
}

/** UTF-8, falling back to Windows-1254 (Turkish) when the bytes are not valid UTF-8. */
export function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  const text = utf8.includes('�') ? new TextDecoder('windows-1254').decode(buf) : utf8
  return text.replace(/^﻿/, '')
}

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? ''

/** Detects the format by extension / MIME type. */
export async function readStatementFile(file: File, password?: string): Promise<StatementSource> {
  const e = ext(file.name)
  if (e === 'pdf' || file.type === 'application/pdf') return { type: 'lines', lines: await readPdf(file, password), name: file.name }
  if (e === 'xlsx') return { type: 'table', rows: await readXlsx(file), name: file.name }
  if (e === 'xls') throw new Error('Eski .xls biçimi desteklenmiyor. Dosyayı Excel\'de .xlsx ya da .csv olarak kaydedip tekrar deneyin.')
  if (e === 'csv' || e === 'tsv' || e === 'txt' || file.type.startsWith('text/')) {
    const text = decodeText(await file.arrayBuffer())
    if (e === 'txt') return { type: 'lines', lines: text.split(/\r?\n/), name: file.name }
    return { type: 'table', rows: parseCsv(text), name: file.name }
  }
  throw new Error('Desteklenmeyen dosya türü. PDF, Excel (.xlsx) veya CSV seçin.')
}
