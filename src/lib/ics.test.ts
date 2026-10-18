import { describe, expect, it } from 'vitest'
import type { Account, LoanPlan, PersonalDebt, RecurringPlan, Snapshot } from '../domain'
import { buildIcs, escapeText, foldLine, kesimRule } from './ics'

const S = { kesimDaysBefore: 3, dueDaysBefore: 2 }
const bank: Account = { id: 'b', name: 'Banka', kind: 'bank', openingBalance: 0, openingDate: '2026-10-01' }
const card = (day: number): Account => ({
  id: 'c', name: 'Axess, Bonus; Kart', kind: 'credit_card', openingBalance: 0, openingDate: '2026-10-01',
  card: { statementDay: day, dueDaysAfterStatement: 10 },
})
const loan: LoanPlan = {
  id: 'L', name: 'Taşıt kredisi', kind: 'loan', accountId: 'b', active: true, createdAt: 0,
  installmentAmount: 250000, totalInstallments: 3, firstDueDate: '2026-10-05', preSettledCount: 0,
}
const bill: RecurringPlan = {
  id: 'E', name: 'Elektrik', kind: 'recurring_expense', accountId: 'b', active: true, createdAt: 0,
  amount: 40000, variable: true, frequency: 'monthly', startDate: '2026-10-20',
}
const debt: PersonalDebt = { id: 'd', direction: 'borrowed', counterparty: 'Ali', amount: 100000, date: '2026-10-01', dueDate: '2026-11-15', createdAt: 0 }
const snap = (accounts: Account[] = [bank, card(31)]): Snapshot =>
  ({ accounts, categories: [], transactions: [], plans: [loan, bill], debts: [debt] })

const unfold = (ics: string) => ics.replace(/\r\n /g, '')
const vevents = (ics: string) => unfold(ics).split('BEGIN:VEVENT').slice(1)

describe('ics helpers', () => {
  it('escapes TEXT', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })

  it('folds at 75 octets without splitting UTF-8 characters', () => {
    const line = `SUMMARY:${'ş'.repeat(80)}`
    const folded = foldLine(line)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75)
    for (const p of parts.slice(1)) expect(p.startsWith(' ')).toBe(true)
    expect(folded.replace(/\r\n /g, '')).toBe(line)
    expect(foldLine('SHORT:x')).toBe('SHORT:x')
    expect(foldLine('X'.repeat(75))).toBe('X'.repeat(75))
    expect(foldLine('X'.repeat(76))).toBe(`${'X'.repeat(75)}\r\n X`)
  })

  it('kesim RRULE clamps to month end like the engine', () => {
    expect(kesimRule(15)).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
    expect(kesimRule(28)).toBe('FREQ=MONTHLY;BYMONTHDAY=28')
    expect(kesimRule(29)).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1')
    expect(kesimRule(30)).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1')
    expect(kesimRule(31)).toBe('FREQ=MONTHLY;BYMONTHDAY=-1')
  })
})

describe('buildIcs', () => {
  const ics = buildIcs(snap(), '2026-10-18', S)

  it('CRLF only, every line <= 75 octets, wrapped in VCALENDAR', () => {
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    for (const l of ics.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.split('BEGIN:VEVENT').length).toBe(ics.split('END:VEVENT').length)
  })

  it('card kesim: monthly RRULE from the next kesim, escaped name, alarms', () => {
    const e = vevents(ics).find((x) => x.includes('UID:kesim-c@cuzdan'))!
    expect(e).toContain('DTSTART;VALUE=DATE:20261031\r\n')
    expect(e).toContain('DTEND;VALUE=DATE:20261101\r\n')
    expect(e).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1\r\n')
    expect(e).toContain('SUMMARY:Axess\\, Bonus\\; Kart hesap kesimi\r\n')
    expect(e).toContain('DTSTAMP:20261018T000000Z\r\n')
    expect(e).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\n')
    expect(e).toContain('TRIGGER;RELATED=START:-P2DT15H\r\n') // 3 days before, 09:00
    expect(e).toContain('TRIGGER;RELATED=START:PT9H\r\n')
  })

  it('card due: 12 individual events, kesim + 10 days (Feb 28 + 10 = Mar 10)', () => {
    const due = vevents(ics).filter((x) => x.includes('UID:due-c-'))
    expect(due).toHaveLength(12)
    expect(due[0]).toContain('DTSTART;VALUE=DATE:20261110\r\n')
    expect(due.some((x) => x.includes('UID:due-c-2027-02-28@cuzdan') && x.includes('DTSTART;VALUE=DATE:20270310'))).toBe(true)
    expect(due[0]).toContain('TRIGGER;RELATED=START:-P1DT15H\r\n') // dueDaysBefore 2
  })

  it('loans: remaining installments; bills: next 12 with estimate; debts', () => {
    const ev = vevents(ics)
    const loanEv = ev.filter((x) => x.includes('UID:occ-L:'))
    expect(loanEv.map((x) => /DTSTART;VALUE=DATE:(\d+)/.exec(x)![1])).toEqual(['20261105', '20261205'])
    expect(loanEv[0]).toContain('DESCRIPTION:Taksit 2/3: 2.500\\,00 ₺')
    const billEv = ev.filter((x) => x.includes('UID:occ-E:'))
    expect(billEv).toHaveLength(12)
    expect(billEv[0]).toContain('DTSTART;VALUE=DATE:20261020')
    expect(billEv[0]).toContain('DESCRIPTION:Tahmini tutar: 400\\,00 ₺')
    expect(ev.find((x) => x.includes('UID:debt-d@cuzdan'))).toContain('SUMMARY:Borç ödemesi: Ali')
  })

  it('cardId limits the file to that card', () => {
    const one = buildIcs(snap(), '2026-10-18', S, { cardId: 'c' })
    expect(vevents(one).every((x) => /UID:(kesim|due)-c/.test(x))).toBe(true)
    expect(vevents(one)).toHaveLength(13)
  })

  it('no "before" alarm when days-before is 0', () => {
    const e = vevents(buildIcs(snap(), '2026-10-18', { kesimDaysBefore: 0, dueDaysBefore: 0 }))[0]
    expect(e.match(/BEGIN:VALARM/g)).toHaveLength(1)
  })
})
