import { findCategory } from '../categoryMatch'
import type { Category, ID } from '../types'
import { fold } from './text'

/**
 * Category suggestion for a statement description. Same matching as quick entry (name / keyword equals a
 * word) but diacritic-insensitive ("MIGROS" = "migros", "ECZANE" = "eczane"), then two fallbacks:
 * multi-word keywords contained in the text, and words starting with a keyword of 4+ letters ("marketler").
 */
export function suggestCategory(description: string, kind: Category['kind'], categories: Category[]): ID | undefined {
  const f = fold(description)
  const words = f.split(/[^a-z0-9]+/).filter(Boolean)
  const exact = findCategory(categories, kind, new Set(words), fold)
  if (exact) return exact.id
  const padded = ` ${words.join(' ')} `
  return categories.find((c) => c.kind === kind && [c.name, ...(c.keywords ?? [])].some((k) => {
    const fk = fold(k).trim()
    if (fk.includes(' ')) return padded.includes(` ${fk} `)
    return fk.length >= 4 && words.some((w) => w.startsWith(fk))
  }))?.id
}
