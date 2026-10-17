import { accountBalance, billedParts, cardFutureInstallments, cardStatements } from './cards'
import { daysInMonth } from './dates'
import { loanEnd, occurrencesForPlan } from './plans'
import type { DebtSummary, ID, ISODate, Kurus, MonthSummary, Snapshot, UpcomingItem } from './types'

const cards = (snap: Snapshot) => snap.accounts.filter((a) => a.kind === 'credit_card')
// Unpaid occurrences. autopay_pending counts as unpaid (amount not entered yet) but never as overdue.
const isOpen = (status: string) => status === 'pending' || status === 'overdue' || status === 'autopay_pending'

/**
 * income/expense: tx dated in the month (transfers and adjustments excluded); expense also includes
 * card installment parts billed in statements whose kesim is in the month (category = plan.categoryId).
 * projectedIncome/Expense: pending/overdue/autopay_pending occurrences due in the month (variable bills at their estimate). Card statements are not added:
 * card expense tx and billed installment parts are already counted in expense.
 * byCategory: expenses grouped by categoryId (null = uncategorized), sorted by amount desc.
 */
export function monthSummary(snap: Snapshot, month: string, today: ISODate): MonthSummary {
  const start = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const end = `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`
  const inMonth = (d: ISODate) => d >= start && d <= end

  let income = 0
  let expense = 0
  const byCat = new Map<ID | null, Kurus>()
  const addExpense = (categoryId: ID | undefined, amount: Kurus) => {
    expense += amount
    const k = categoryId ?? null
    byCat.set(k, (byCat.get(k) ?? 0) + amount)
  }
  for (const t of snap.transactions) {
    if (!inMonth(t.date)) continue
    if (t.kind === 'income') income += t.amount
    else if (t.kind === 'expense') addExpense(t.categoryId, t.amount)
  }

  let projectedIncome = 0
  let projectedExpense = 0
  for (const card of cards(snap)) {
    for (const p of billedParts(card, snap)) if (inMonth(p.kesim)) addExpense(p.categoryId, p.amount)
  }
  for (const plan of snap.plans) {
    for (const o of occurrencesForPlan(plan, snap, today, end)) {
      if (!inMonth(o.dueDate) || !isOpen(o.status)) continue
      if (plan.kind === 'recurring_income') projectedIncome += o.expected
      else projectedExpense += o.expected
    }
  }

  return {
    month, income, expense, net: income - expense, projectedIncome, projectedExpense,
    byCategory: [...byCat].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount),
  }
}

/**
 * Pending/overdue/autopay_pending occurrences with dueDate <= to (past-due ones included however old), plus per card
 * only the most recent closed statement if it is not 'paid' (amount = total - paid). Older statements
 * are skipped because their unpaid debt is carried into the newer statement's total.
 * Sorted by dueDate asc (income occurrences are included; check item.plan.kind).
 */
export function upcoming(snap: Snapshot, today: ISODate, to: ISODate): UpcomingItem[] {
  const items: UpcomingItem[] = []
  for (const plan of snap.plans) {
    for (const o of occurrencesForPlan(plan, snap, today, to)) {
      if (isOpen(o.status)) items.push({ type: 'occurrence', dueDate: o.dueDate, amount: o.expected, occurrence: o, plan })
    }
  }
  for (const card of cards(snap)) {
    const latest = cardStatements(card, snap, today).filter((s) => s.status !== 'open').at(-1)
    if (latest && latest.status !== 'paid' && latest.dueDate <= to) {
      items.push({ type: 'statement', dueDate: latest.dueDate, amount: latest.total - latest.paid, statement: latest, card })
    }
  }
  return items.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
}

/** Active loans only (inactive plans have no occurrences). */
export function debtSummary(snap: Snapshot, today: ISODate): DebtSummary {
  let loansRemaining = 0
  for (const plan of snap.plans) {
    if (plan.kind !== 'loan') continue
    for (const o of occurrencesForPlan(plan, snap, today, loanEnd(plan))) if (isOpen(o.status)) loansRemaining += o.expected
  }
  let cardsCurrent = 0
  let cardsFuture = 0
  for (const card of cards(snap)) {
    cardsCurrent += Math.max(0, -accountBalance(card, snap, today))
    cardsFuture += cardFutureInstallments(card, snap, today)
  }
  return {
    loansRemaining, cardsCurrent, cardsFutureInstallments: cardsFuture,
    total: loansRemaining + cardsCurrent + cardsFuture,
  }
}
