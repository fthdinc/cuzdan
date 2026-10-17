import { addDays, addMonths, dateInMonth, monthIndex, ymd } from './dates'
import type { ISODate, Kurus, LoanPlan, Occurrence, OccurrenceStatus, Plan, RecurringPlan, Snapshot } from './types'

export function loanFromRemaining(input: {
  id: string; name: string; accountId: string; categoryId?: string; createdAt: number
  installmentAmount: Kurus; totalInstallments: number; remainingInstallments: number; nextDueDate: ISODate
}): LoanPlan {
  const preSettledCount = input.totalInstallments - input.remainingInstallments
  return {
    id: input.id,
    name: input.name,
    accountId: input.accountId,
    categoryId: input.categoryId,
    createdAt: input.createdAt,
    active: true,
    kind: 'loan',
    installmentAmount: input.installmentAmount,
    totalInstallments: input.totalInstallments,
    preSettledCount,
    firstDueDate: addMonths(input.nextDueDate, -preSettledCount),
    dueDay: ymd(input.nextDueDate)[2],
  }
}

export function annuityInstallment(principal: Kurus, monthlyRate: number, n: number): Kurus {
  if (monthlyRate === 0) return Math.round(principal / n)
  return Math.round((principal * monthlyRate) / (1 - (1 + monthlyRate) ** -n))
}

/** Due date of loan installment i: month of firstDueDate + i, on dueDay (clamped to month end). */
function loanDueDate(plan: LoanPlan, i: number): ISODate {
  return dateInMonth(monthIndex(plan.firstDueDate) + i, plan.dueDay ?? ymd(plan.firstDueDate)[2])
}

/** Due date of occurrence index i, or null when the plan has no such occurrence. */
function dueDateOf(plan: Plan, i: number): ISODate | null {
  switch (plan.kind) {
    case 'loan':
      return i < plan.totalInstallments ? loanDueDate(plan, i) : null
    case 'card_installment':
      return null
    default: {
      const d = plan.frequency === 'weekly' ? addDays(plan.startDate, 7 * i)
        : plan.frequency === 'monthly' ? addMonths(plan.startDate, i)
        : addMonths(plan.startDate, 12 * i)
      return plan.endDate && d > plan.endDate ? null : d
    }
  }
}

/**
 * Expected amount of a recurring plan's next unpaid occurrences. Variable recurring_expense (bill): average of
 * the actual amounts of the last 3 paid occurrences (by index), rounded; plan.amount when none is paid.
 * Fixed plans and income: plan.amount.
 */
export function estimatedBillAmount(plan: RecurringPlan, snap: Snapshot): Kurus {
  if (plan.kind !== 'recurring_expense' || !plan.variable) return plan.amount
  const prefix = `${plan.id}:`
  const paid = snap.transactions
    .filter((t) => t.occurrenceKey?.startsWith(prefix))
    .map((t) => ({ i: Number(t.occurrenceKey!.slice(prefix.length)), amount: t.amount }))
    .sort((a, b) => b.i - a.i)
    .slice(0, 3)
  return paid.length ? Math.round(paid.reduce((s, x) => s + x.amount, 0) / paid.length) : plan.amount
}

/** Occurrences regardless of plan.active. */
export function generate(plan: Plan, snap: Snapshot, today: ISODate, until: ISODate): Occurrence[] {
  const out: Occurrence[] = []
  const recurring = plan.kind === 'recurring_expense' || plan.kind === 'recurring_income'
  const baseAmount = plan.kind === 'loan' ? plan.installmentAmount : plan.kind === 'card_installment' ? 0 : plan.amount
  // Unpaid occurrences of variable bills expect the recent average instead of the stored estimate.
  const openAmount = recurring ? estimatedBillAmount(plan, snap) : baseAmount
  const preSettled = plan.kind === 'loan' ? plan.preSettledCount : 0
  const settledBefore = recurring ? plan.settledBefore : undefined
  const autopay = plan.kind === 'recurring_expense' && !!plan.bill?.autopay
  for (let i = 0; ; i++) {
    const dueDate = dueDateOf(plan, i)
    if (dueDate === null || dueDate > until) break
    const key = `${plan.id}:${i}`
    const override = plan.overrides?.[i]
    const tx = snap.transactions.find((t) => t.occurrenceKey === key)
    let status: OccurrenceStatus
    if (i < preSettled) status = 'presettled'
    else if (tx) status = 'paid'
    else if (settledBefore && dueDate < settledBefore) status = 'presettled'
    else if (override?.skipped) status = 'skipped'
    else if (dueDate < today) status = autopay ? 'autopay_pending' : 'overdue'
    else status = 'pending'
    const open = status === 'pending' || status === 'overdue' || status === 'autopay_pending'
    const occ: Occurrence = {
      key, planId: plan.id, planKind: plan.kind, index: i, dueDate,
      expected: override?.amount ?? (open ? openAmount : baseAmount), status,
    }
    if (status === 'paid' && tx) {
      occ.transactionId = tx.id
      occ.actual = tx.amount
    }
    out.push(occ)
  }
  return out
}

/**
 * All occurrences of loan/recurring plans with due date <= until (recurring without endDate is open-ended).
 * card_installment plans have no occurrences (they are billed via statements).
 * Inactive plans (active=false) of any kind produce no occurrences.
 */
export function occurrencesForPlan(plan: Plan, snap: Snapshot, today: ISODate, until: ISODate): Occurrence[] {
  return plan.active ? generate(plan, snap, today, until) : []
}

/** Last due date of a loan. */
export function loanEnd(plan: LoanPlan): ISODate {
  return loanDueDate(plan, plan.totalInstallments - 1)
}

/**
 * Loan progress (computed even when the plan is inactive).
 * paidCount = presettled + paid; remainingCount/remainingAmount = pending + overdue (skipped count in neither);
 * nextDue = earliest pending/overdue installment.
 */
export function loanProgress(plan: LoanPlan, snap: Snapshot, today: ISODate): {
  paidCount: number; remainingCount: number; remainingAmount: Kurus; nextDue?: Occurrence
} {
  const occ = generate(plan, snap, today, loanEnd(plan))
  const open = occ.filter((o) => o.status === 'pending' || o.status === 'overdue')
  return {
    paidCount: occ.filter((o) => o.status === 'paid' || o.status === 'presettled').length,
    remainingCount: open.length,
    remainingAmount: open.reduce((s, o) => s + o.expected, 0),
    nextDue: open[0],
  }
}
