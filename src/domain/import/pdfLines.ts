// Turn positioned PDF text items into text lines. Pure (no pdf.js dependency) so it can be unit tested.
import { decodeEbcdic, looksLikeEbcdic } from './text'

export interface TextPiece {
  str: string
  x: number // left, PDF units
  y: number // baseline, PDF units (grows upwards)
  width: number
  height: number // ~font size
}

/**
 * Groups one page's items into lines: items whose baselines are within ~40% of the font size share a line
 * (amount cells are often a point or two off the description baseline). Within a line items are sorted by
 * x; touching items are concatenated, a normal gap becomes ' ', a gap wider than ~1.5 font sizes becomes
 * '   ' (column separator; the parser treats any whitespace run as one space). Whitespace-only items are
 * ignored because the geometry already tells us where gaps are.
 */
export function groupTextItems(items: TextPiece[]): string[] {
  const pieces = items.filter((i) => i.str.trim() !== '')
  pieces.sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: TextPiece[][] = []
  for (const p of pieces) {
    const cur = lines[lines.length - 1]
    const tol = Math.max(1.5, (p.height || 8) * 0.4)
    if (cur && Math.abs(cur[0].y - p.y) <= tol) cur.push(p)
    else lines.push([p])
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x)
    let out = ''
    let end = -Infinity
    for (const p of line) {
      const fs = p.height || 8
      const gap = p.x - end
      if (out) out += gap > fs * 1.5 ? '   ' : gap > fs * 0.2 ? ' ' : ''
      out += p.str
      end = Math.max(end, p.x + p.width)
    }
    return out.replace(/\s+$/, '')
  }).filter((l) => l.trim() !== '')
}

/** Lines for a whole document (pages in order). Decodes AFP/EBCDIC text when detected. */
export function linesFromPages(pages: TextPiece[][]): string[] {
  const all = pages.flatMap((p) => p.map((i) => i.str)).join('')
  const ebcdic = looksLikeEbcdic(all)
  return pages.flatMap((p) => groupTextItems(ebcdic ? p.map((i) => ({ ...i, str: decodeEbcdic(i.str) })) : p))
}
