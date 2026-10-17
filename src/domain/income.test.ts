import { describe, expect, it } from 'vitest'
import { monthSummary, monthlyIncomePlan, occurrencesForPlan, suggestCategory } from './index'
import type { Category, Snapshot, Transaction } from './index'

const TODAY = '2026-10-17'
const acc = { id: 'b', name: 'Ana hesap', kind: 'bank' as const, openingBalance: 0, openingDate: '2000-01-01' }

describe('monthlyIncomePlan', () => {
  const input = { id: 'p', name: 'Maaş', amount: 4500000, date: '2026-10-05', accountId: 'b', categoryId: 'sal', createdAt: 0 }
  const { plan, occurrenceKey } = monthlyIncomePlan(input, TODAY)
  const tx: Transaction = { id: 't', date: '2026-10-05', kind: 'income', amount: 4500000, accountId: 'b', categoryId: 'sal', note: 'Maaş', occurrenceKey, createdAt: 0 }
  const snap: Snapshot = { accounts: [acc], transactions: [tx], plans: [plan], categories: [] }

  it('builds a fixed monthly income plan starting at the entry date, first occurrence settled by the entry', () => {
    expect(plan).toMatchObject({ kind: 'recurring_income', name: 'Maaş', amount: 4500000, frequency: 'monthly', startDate: '2026-10-05', variable: false, active: true })
    expect(occurrenceKey).toBe('p:0')
    const occ = occurrencesForPlan(plan, snap, TODAY, '2026-12-31')
    expect(occ.map((o) => [o.dueDate, o.status])).toEqual([
      ['2026-10-05', 'paid'], ['2026-11-05', 'pending'], ['2026-12-05', 'pending'],
    ])
  })

  it('counts the entry as income once and future months as expected income', () => {
    expect(monthSummary(snap, '2026-10', TODAY)).toMatchObject({ income: 4500000, projectedIncome: 0 })
    expect(monthSummary(snap, '2026-11', TODAY)).toMatchObject({ income: 0, projectedIncome: 4500000 })
  })

  it('back-dated entry: months between the entry and today are presettled, not overdue', () => {
    const r = monthlyIncomePlan({ ...input, date: '2026-08-01' }, TODAY)
    expect(r.plan.settledBefore).toBe(TODAY)
    const t = { ...tx, date: '2026-08-01', occurrenceKey: r.occurrenceKey }
    const occ = occurrencesForPlan(r.plan, { ...snap, transactions: [t], plans: [r.plan] }, TODAY, '2026-11-30')
    expect(occ.map((o) => o.status)).toEqual(['paid', 'presettled', 'presettled', 'pending'])
  })

  it('entry dated today has no settledBefore', () => {
    expect(monthlyIncomePlan({ ...input, date: TODAY }, TODAY).plan.settledBefore).toBeUndefined()
  })
})

describe('suggestCategory', () => {
  const cats: Category[] = [
    { id: 'sal', name: 'Maaş', kind: 'income', keywords: ['maaş', 'maas', 'ücret'] },
    { id: 'extra', name: 'Ek gelir', kind: 'income', keywords: ['freelance', 'kira geliri'] },
    { id: 'rent', name: 'Kira', kind: 'expense', keywords: ['kira'] },
  ]
  it('matches name / keyword as a whole word, case-insensitive (tr)', () => {
    expect(suggestCategory('MAAŞ ekim', cats, 'income')?.id).toBe('sal')
    expect(suggestCategory('Freelance iş, logo', cats, 'income')?.id).toBe('extra')
  })
  it('multi-word keyword matches as a phrase; kind is respected', () => {
    expect(suggestCategory('Dükkan kira geliri', cats, 'income')?.id).toBe('extra')
    expect(suggestCategory('kira', cats, 'income')).toBeUndefined()
    expect(suggestCategory('kira', cats, 'expense')?.id).toBe('rent')
  })
  it('no match / empty text', () => {
    expect(suggestCategory('maaşlar', cats, 'income')).toBeUndefined()
    expect(suggestCategory('  ', cats, 'income')).toBeUndefined()
  })
})
