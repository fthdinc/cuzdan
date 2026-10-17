import { describe, expect, it } from 'vitest'
import { findCategory, suggestCategory } from './categoryMatch'
import { parseQuickEntry } from './quickEntry'
import type { Category } from './types'

// "Kredi kartı" is added after "Kredi" on existing databases, so order must not decide the match.
const cats: Category[] = [
  { id: 'kredi', name: 'Kredi', kind: 'expense', keywords: ['kredi', 'taksit'] },
  { id: 'kart', name: 'Kredi kartı', kind: 'expense', keywords: ['kredi kartı', 'kart ödemesi', 'axess', 'bonus'] },
]

describe('category matching prefers the most specific keyword', () => {
  it('free-text description', () => {
    expect(suggestCategory('Axess Kredi Kartı', cats, 'expense')?.id).toBe('kart')
    expect(suggestCategory('kredi kartı ödemesi', cats, 'expense')?.id).toBe('kart')
    expect(suggestCategory('ihtiyaç kredisi taksit', cats, 'expense')?.id).toBe('kredi')
    expect(suggestCategory('kredi', cats, 'expense')?.id).toBe('kredi')
  })

  it('word-set matching (quick entry, import)', () => {
    const lower = (s: string) => s.toLocaleLowerCase('tr-TR')
    expect(findCategory(cats, 'expense', new Set(['kredi', 'kartı']), lower)?.id).toBe('kart')
    expect(findCategory(cats, 'expense', new Set(['kredi']), lower)?.id).toBe('kredi')
    expect(parseQuickEntry('5000 kredi kartı', cats, '2026-10-18')?.categoryId).toBe('kart')
    expect(parseQuickEntry('3500 axess', cats, '2026-10-18')?.categoryId).toBe('kart')
  })
})
