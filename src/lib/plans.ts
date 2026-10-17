import { addMonths, installmentSchedule, type Account, type CardInstallmentPlan, type ISODate, type Kurus, type Plan, type Snapshot } from '../domain'

export const PLAN_KIND_LABEL: Record<Plan['kind'], string> = {
  loan: 'Kredi',
  card_installment: 'Taksit',
  recurring_expense: 'Fatura',
  recurring_income: 'Gelir',
}

export const FREQ_LABEL = { weekly: 'Haftalık', monthly: 'Aylık', yearly: 'Yıllık' } as const

export interface InstallmentRow {
  index: number
  kesim: ISODate
  amount: Kurus
  state: 'presettled' | 'billed' | 'future'
}

export function installmentRows(plan: CardInstallmentPlan, card: Account | undefined, today: ISODate): InstallmentRow[] {
  if (!card) return []
  return installmentSchedule(plan, card).map((p) => ({
    index: p.index, kesim: p.kesim, amount: p.amount,
    state: p.index < plan.preSettledCount ? 'presettled' : p.kesim <= today ? 'billed' : 'future',
  }))
}

export function installmentProgress(plan: CardInstallmentPlan, snap: Snapshot, today: ISODate) {
  const card = snap.accounts.find((a) => a.id === plan.accountId)
  const rows = installmentRows(plan, card, today)
  const future = rows.filter((r) => r.state === 'future')
  return {
    rows,
    billedCount: rows.length - future.length,
    remainingCount: future.length,
    remainingAmount: future.reduce((s, r) => s + r.amount, 0),
    next: future[0],
  }
}

/** How far ahead to list occurrences for a plan. */
export function occurrenceHorizon(plan: Plan, today: ISODate): ISODate {
  if (plan.kind === 'loan') return addMonths(plan.firstDueDate, plan.totalInstallments)
  if (plan.kind === 'recurring_expense' || plan.kind === 'recurring_income') {
    const ahead = addMonths(today, plan.frequency === 'yearly' ? 24 : 3)
    return plan.endDate && plan.endDate < ahead ? plan.endDate : ahead
  }
  return today
}
