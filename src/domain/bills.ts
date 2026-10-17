// Bill (fatura) views over recurring_expense plans. Pure.
import { dateInMonth, daysInMonth, monthIndex, ymd } from './dates'
import { generate, occurrencesForPlan } from './plans'
import type { BillInfo, ISODate, Kurus, Occurrence, OccurrenceStatus, RecurringPlan, Snapshot } from './types'

/** plan.bill, or the defaults for bills created before bill info existed. */
export function billInfo(plan: RecurringPlan): BillInfo {
  return plan.bill ?? { type: 'other', autopay: false, matchKeywords: [] }
}

const monthOf = (mi: number) => dateInMonth(mi, 1).slice(0, 7)

export interface BillMonth {
  month: string // 'YYYY-MM'
  amount: Kurus | null // sum of paid occurrences due in the month; null = nothing paid
  prev: Kurus | null // previous month's amount
  lastYear: Kurus | null // same month last year
}

/**
 * Paid amounts of the last `months` months ending with today's month (oldest first), by occurrence due date.
 * prev / lastYear look at the whole history, not only the window. Computed even when the plan is inactive.
 */
export function billHistory(plan: RecurringPlan, snap: Snapshot, today: ISODate, months: number): BillMonth[] {
  const [y, m] = ymd(today)
  const end = `${today.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`
  const byMonth = new Map<number, Kurus>()
  for (const o of generate(plan, snap, today, end)) {
    if (o.status !== 'paid' || o.actual === undefined) continue
    const mi = monthIndex(o.dueDate)
    byMonth.set(mi, (byMonth.get(mi) ?? 0) + o.actual)
  }
  const cur = monthIndex(today)
  const out: BillMonth[] = []
  for (let mi = cur - months + 1; mi <= cur; mi++) {
    out.push({ month: monthOf(mi), amount: byMonth.get(mi) ?? null, prev: byMonth.get(mi - 1) ?? null, lastYear: byMonth.get(mi - 12) ?? null })
  }
  return out
}

/** (cur - prev) / prev, or null when either is missing or prev is 0. */
export function changeRatio(cur: Kurus | null, prev: Kurus | null): number | null {
  return cur === null || prev === null || prev === 0 ? null : (cur - prev) / prev
}

const STATUS_RANK: OccurrenceStatus[] = ['overdue', 'autopay_pending', 'pending', 'paid', 'skipped', 'presettled']

export interface BillMonthState {
  occurrences: Occurrence[] // due in the month
  amount: Kurus // paid actuals + expected of unpaid ones (skipped / presettled excluded)
  estimated: boolean // some unpaid variable amount is included
  status: OccurrenceStatus | null // most urgent status in the month (null = no occurrence)
}

/** One bill's state for the month of `today` (active plans only, like the rest of the summaries). */
export function billThisMonth(plan: RecurringPlan, snap: Snapshot, today: ISODate): BillMonthState {
  const start = `${today.slice(0, 7)}-01`
  const [y, m] = ymd(today)
  const end = `${today.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`
  const occurrences = occurrencesForPlan(plan, snap, today, end).filter((o) => o.dueDate >= start)
  let amount = 0
  let estimated = false
  for (const o of occurrences) {
    if (o.status === 'paid') amount += o.actual ?? o.expected
    else if (o.status === 'pending' || o.status === 'overdue' || o.status === 'autopay_pending') {
      amount += o.expected
      if (plan.variable) estimated = true
    }
  }
  const status = STATUS_RANK.find((s) => occurrences.some((o) => o.status === s)) ?? null
  return { occurrences, amount, estimated, status }
}
