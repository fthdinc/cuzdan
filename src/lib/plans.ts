import { addMonths, type Account, type CardInstallmentPlan, type ISODate, type Kurus, type Plan, type Snapshot } from '../domain'

export const PLAN_KIND_LABEL: Record<Plan['kind'], string> = {
  loan: 'Kredi',
  card_installment: 'Taksit',
  recurring_expense: 'Fatura',
  recurring_income: 'Gelir',
}

export const FREQ_LABEL = { weekly: 'Haftalık', monthly: 'Aylık', yearly: 'Yıllık' } as const

/** Kesim date in the month of `d` (day clamped to month end). */
function kesimInMonth(d: ISODate, day: number): ISODate {
  const [y, m] = d.split('-').map(Number)
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${d.slice(0, 7)}-${String(Math.min(day, dim)).padStart(2, '0')}`
}

export interface InstallmentRow {
  index: number
  kesim: ISODate
  amount: Kurus
  state: 'presettled' | 'billed' | 'future'
}

/**
 * Per-part schedule of a card installment plan. Mirrors the engine's billing rule
 * (part i billed at the (i)th kesim on/after purchaseDate; part 0 carries the rounding remainder),
 * because the engine does not export a per-plan view.
 */
export function installmentSchedule(plan: CardInstallmentPlan, card: Account | undefined, today: ISODate): InstallmentRow[] {
  const day = card?.card?.statementDay ?? 1
  let k0 = kesimInMonth(plan.purchaseDate, day)
  if (k0 < plan.purchaseDate) k0 = kesimInMonth(addMonths(`${plan.purchaseDate.slice(0, 7)}-01`, 1), day)
  const base = Math.floor(plan.totalAmount / plan.installmentCount)
  const remainder = plan.totalAmount - base * plan.installmentCount
  return Array.from({ length: plan.installmentCount }, (_, i) => {
    const kesim = kesimInMonth(addMonths(`${k0.slice(0, 7)}-01`, i), day)
    const state: InstallmentRow['state'] = i < plan.preSettledCount ? 'presettled' : kesim <= today ? 'billed' : 'future'
    return { index: i, kesim, amount: i === 0 ? base + remainder : base, state }
  })
}

export function installmentProgress(plan: CardInstallmentPlan, snap: Snapshot, today: ISODate) {
  const card = snap.accounts.find((a) => a.id === plan.accountId)
  const rows = installmentSchedule(plan, card, today)
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
