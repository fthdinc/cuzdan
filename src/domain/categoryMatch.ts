import type { Category } from './types'

/** Category with the longest matching name/keyword ("kredi kartı" beats "kredi"); ties keep list order. */
function bestMatch(categories: Category[], kind: Category['kind'], matches: (keyword: string) => boolean): Category | undefined {
  let best: Category | undefined
  let bestLen = 0
  for (const c of categories) {
    if (c.kind !== kind) continue
    for (const k of [c.name, ...(c.keywords ?? [])]) {
      const len = k.trim().length
      if (len > bestLen && matches(k)) {
        best = c
        bestLen = len
      }
    }
  }
  return best
}

/**
 * Category of `kind` whose name or a keyword, normalized with `norm`, is in `words`. A multi-word keyword matches
 * when all its words are present. Shared by quick entry and statement import.
 */
export function findCategory(categories: Category[], kind: Category['kind'], words: Set<string>, norm: (s: string) => string): Category | undefined {
  return bestMatch(categories, kind, (k) => {
    const parts = norm(k).split(/\s+/).filter(Boolean)
    return parts.length > 0 && parts.every((p) => words.has(p))
  })
}

const lowerTr = (s: string) => s.toLocaleLowerCase('tr-TR')

/**
 * Category suggestion for a free-text description ("Maaş ekim", "kira geliri"): category of `kind` whose name or
 * a keyword appears in the text as whole word(s), tr-TR case-insensitive. Multi-word keywords match as a phrase.
 */
export function suggestCategory(text: string, categories: Category[], kind: Category['kind']): Category | undefined {
  const words = lowerTr(text).split(/[\s,.;:!?()/'"-]+/).filter(Boolean)
  if (!words.length) return undefined
  const padded = ` ${words.join(' ')} `
  return bestMatch(categories, kind, (k) => {
    const kw = lowerTr(k).trim()
    return kw !== '' && padded.includes(` ${kw} `)
  })
}
