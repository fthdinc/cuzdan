import { describe, expect, it } from 'vitest'
import { parseQuickEntry } from './index'
import type { Category } from './index'

const TODAY = '2026-10-17'
const cats: Category[] = [
  { id: 'market', name: 'Market', kind: 'expense', keywords: ['migros', 'bim'] },
  { id: 'fuel', name: 'Ulaşım', kind: 'expense', keywords: ['benzin', 'İSTANBULKART'] },
  { id: 'rent', name: 'Kira', kind: 'expense' },
  { id: 'salary', name: 'Maaş', kind: 'income' },
  { id: 'rent-in', name: 'Kira', kind: 'income' },
]

describe('parseQuickEntry', () => {
  it('simple expense with category by name', () => {
    expect(parseQuickEntry('120 market', cats, TODAY)).toEqual({
      kind: 'expense', amount: 12000, date: TODAY, categoryId: 'market', note: 'market',
    })
  })
  it('income with +', () => {
    expect(parseQuickEntry('+45000 maaş', cats, TODAY)).toEqual({
      kind: 'income', amount: 4500000, date: TODAY, categoryId: 'salary', note: 'maaş',
    })
  })
  it('kind restricts category', () => {
    expect(parseQuickEntry('+5000 kira', cats, TODAY)?.categoryId).toBe('rent-in')
    expect(parseQuickEntry('5000 kira', cats, TODAY)?.categoryId).toBe('rent')
  })
  it('decimal comma, keyword, dün', () => {
    expect(parseQuickEntry('350,50 benzin dün', cats, TODAY)).toEqual({
      kind: 'expense', amount: 35050, date: '2026-10-16', categoryId: 'fuel', note: 'benzin',
    })
  })
  it('thousands + date token', () => {
    expect(parseQuickEntry('1.250 kira 15.10', cats, TODAY)).toEqual({
      kind: 'expense', amount: 125000, date: '2026-10-15', categoryId: 'rent', note: 'kira',
    })
    expect(parseQuickEntry('1.250,50 kira 01.09.2025', cats, TODAY)?.date).toBe('2025-09-01')
  })
  it('Turkish case folding and bugün', () => {
    const e = parseQuickEntry('80 İstanbulkart BUGÜN', cats, TODAY)
    expect(e).toMatchObject({ amount: 8000, date: TODAY, categoryId: 'fuel', note: 'İstanbulkart' })
  })
  it('amount not first word, no category, extra numbers stay in note', () => {
    expect(parseQuickEntry('kahve 45 2 adet', cats, TODAY)).toEqual({
      kind: 'expense', amount: 4500, date: TODAY, categoryId: undefined, note: 'kahve 2 adet',
    })
  })
  it('1250.50 dot decimal', () => {
    expect(parseQuickEntry('1250.50 migros', cats, TODAY)?.amount).toBe(125050)
  })
  it('invalid date token stays in note', () => {
    expect(parseQuickEntry('100 market 45.13', cats, TODAY)).toMatchObject({ date: TODAY, note: 'market 45.13' })
  })
  it('null without amount', () => {
    expect(parseQuickEntry('market', cats, TODAY)).toBeNull()
    expect(parseQuickEntry('', cats, TODAY)).toBeNull()
  })
})
