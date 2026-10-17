import type { Category } from './types'

/**
 * First category of `kind` whose name or one of its keywords, normalized with `norm`, is in `words`.
 * Shared by quick entry and statement import.
 */
export function findCategory(categories: Category[], kind: Category['kind'], words: Set<string>, norm: (s: string) => string): Category | undefined {
  return categories.find((c) => c.kind === kind && [c.name, ...(c.keywords ?? [])].some((k) => words.has(norm(k))))
}

const lowerTr = (s: string) => s.toLocaleLowerCase('tr-TR')

/**
 * Category suggestion for a free-text description ("Maaş ekim", "kira geliri"): first category of `kind` whose name or
 * a keyword appears in the text as whole word(s), tr-TR case-insensitive. Multi-word keywords match as a phrase.
 */
export function suggestCategory(text: string, categories: Category[], kind: Category['kind']): Category | undefined {
  const words = lowerTr(text).split(/[\s,.;:!?()/'"-]+/).filter(Boolean)
  if (!words.length) return undefined
  const padded = ` ${words.join(' ')} `
  return categories.find((c) => c.kind === kind && [c.name, ...(c.keywords ?? [])].some((k) => {
    const kw = lowerTr(k).trim()
    return kw !== '' && padded.includes(` ${kw} `)
  }))
}
