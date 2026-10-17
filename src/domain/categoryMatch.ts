import type { Category } from './types'

/**
 * First category of `kind` whose name or one of its keywords, normalized with `norm`, is in `words`.
 * Shared by quick entry and statement import.
 */
export function findCategory(categories: Category[], kind: Category['kind'], words: Set<string>, norm: (s: string) => string): Category | undefined {
  return categories.find((c) => c.kind === kind && [c.name, ...(c.keywords ?? [])].some((k) => words.has(norm(k))))
}
