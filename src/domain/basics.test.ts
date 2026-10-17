import { describe, expect, it } from 'vitest'
import { addDays, addMonths, annuityInstallment, formatMoney, loanFromRemaining, parseMoney, todayISO } from './index'

describe('parseMoney', () => {
  it.each([
    ['1.250,50', 125050],
    ['350,5', 35050],
    ['45000', 4500000],
    ['1250.50', 125050],
    ['1250.5', 125050],
    ['1.250', 125000],
    ['1.250.000', 125000000],
    ['0,05', 5],
    [' 120 ₺ ', 12000],
    ['-12,30', -1230],
  ])('%s -> %i', (input, expected) => {
    expect(parseMoney(input)).toBe(expected)
  })

  it.each(['', 'abc', '1,2,3', '12,345', '1.25.0', '1.2345'])('rejects %s', (input) => {
    expect(parseMoney(input)).toBeNull()
  })
})

describe('formatMoney', () => {
  it('formats tr-TR', () => {
    expect(formatMoney(125050)).toBe('1.250,50 ₺')
    expect(formatMoney(5)).toBe('0,05 ₺')
    expect(formatMoney(0)).toBe('0,00 ₺')
    expect(formatMoney(123456789)).toBe('1.234.567,89 ₺')
    expect(formatMoney(-1230)).toBe('-12,30 ₺')
  })
  it('signed', () => {
    expect(formatMoney(1230, { signed: true })).toBe('+12,30 ₺')
    expect(formatMoney(-1230, { signed: true })).toBe('-12,30 ₺')
    expect(formatMoney(0, { signed: true })).toBe('0,00 ₺')
  })
})

describe('dates', () => {
  it('addMonths clamps', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15')
  })
  it('addDays crosses months/years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-10-17', 10)).toBe('2026-10-27')
  })
  it('todayISO shape', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('loans', () => {
  it('annuityInstallment', () => {
    expect(annuityInstallment(1200000, 0, 12)).toBe(100000)
    // 100.000 TL, %3, 12 ay -> 10.046,21 TL
    expect(annuityInstallment(10000000, 0.03, 12)).toBe(1004621)
  })
  it('loanFromRemaining', () => {
    const p = loanFromRemaining({
      id: 'l', name: 'Kredi', accountId: 'b', createdAt: 1,
      installmentAmount: 100000, totalInstallments: 12, remainingInstallments: 9, nextDueDate: '2026-10-10',
    })
    expect(p.kind).toBe('loan')
    expect(p.preSettledCount).toBe(3)
    expect(p.firstDueDate).toBe('2026-07-10')
    expect(p.active).toBe(true)
  })
})
