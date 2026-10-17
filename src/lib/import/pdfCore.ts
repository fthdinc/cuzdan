// PDF text extraction with an injected pdf.js module (browser build in the app, legacy build in tests).
import { linesFromPages, type TextPiece } from '../../domain/import'

/** Thrown when the PDF is encrypted. `incorrect` = a password was given but rejected. */
export class PdfPasswordError extends Error {
  incorrect: boolean
  constructor(incorrect: boolean) {
    super(incorrect ? 'Şifre yanlış' : 'Bu PDF şifreli')
    this.name = 'PdfPasswordError'
    this.incorrect = incorrect
  }
}

/** Minimal slice of the pdf.js API we use. */
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; password?: string; isEvalSupported?: boolean }): { promise: Promise<PdfDocLike>; destroy?(): Promise<void> }
}
interface PdfDocLike {
  numPages: number
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>
}
interface RawItem { str?: string; transform?: number[]; width?: number; height?: number }

export async function extractPdfLinesWith(pdfjs: PdfJsLike, data: ArrayBuffer | Uint8Array, password?: string): Promise<string[]> {
  // pdf.js transfers (detaches) the buffer it is given, so always pass a copy.
  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data).slice()
  const task = pdfjs.getDocument({ data: bytes, password, isEvalSupported: false })
  let doc: PdfDocLike
  try {
    doc = await task.promise
  } catch (e) {
    await task.destroy?.()
    const err = e as { name?: string; code?: number }
    if (err?.name === 'PasswordException') throw new PdfPasswordError(err.code === 2)
    throw e
  }
  try {
    const pages: TextPiece[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const { items } = await page.getTextContent()
      pages.push((items as RawItem[]).filter((i) => typeof i.str === 'string' && i.transform).map((i) => ({
        str: i.str!,
        x: i.transform![4],
        y: i.transform![5],
        width: i.width ?? 0,
        height: i.height || Math.hypot(i.transform![2], i.transform![3]),
      })))
    }
    return linesFromPages(pages)
  } finally {
    await task.destroy?.()
  }
}
