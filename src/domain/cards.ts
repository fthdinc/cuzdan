import { addDays, dateInMonth, monthIndex } from './dates'
import type { Account, CardInstallmentPlan, CardStatement, ID, ISODate, InstallmentPart, Kurus, Snapshot, StatementStatus } from './types'

export function minPaymentRate(card: Account): number {
  const s = card.card
  return s?.minPaymentRate ?? ((s?.limit ?? 0) < 5_000_000 ? 0.2 : 0.4)
}

/** Month index of the first kesim on or after `date`. */
function firstKesimIndex(statementDay: number, date: ISODate): number {
  const mi = monthIndex(date)
  return dateInMonth(mi, statementDay) < date ? mi + 1 : mi
}

export interface BilledPart extends InstallmentPart {
  kesim: ISODate
  categoryId?: ID
}

/**
 * Every installment part of the card that is (or will be) billed by the engine, past and future.
 * Excludes parts with index < preSettledCount and parts whose kesim is before the card's first statement
 * (both are assumed to be inside openingBalance). Billing ignores plan.active.
 */
export function billedParts(card: Account, snap: Snapshot): BilledPart[] {
  if (!card.card) return []
  const firstMi = firstKesimIndex(card.card.statementDay, card.openingDate)
  const out: BilledPart[] = []
  for (const plan of snap.plans) {
    if (plan.kind !== 'card_installment' || plan.accountId !== card.id) continue
    for (const p of installmentSchedule(plan, card)) {
      if (p.index < plan.preSettledCount || monthIndex(p.kesim) < firstMi) continue
      out.push({ ...p, categoryId: plan.categoryId })
    }
  }
  return out
}

/**
 * Full per-part schedule of one card installment plan, including pre-settled parts.
 * Part i is billed at the i-th kesim on/after purchaseDate; part 0 carries the rounding remainder.
 */
export function installmentSchedule(plan: CardInstallmentPlan, card: Account): (InstallmentPart & { kesim: ISODate })[] {
  const day = card.card?.statementDay ?? 1
  const startMi = firstKesimIndex(day, plan.purchaseDate)
  const base = Math.floor(plan.totalAmount / plan.installmentCount)
  const remainder = plan.totalAmount - base * plan.installmentCount
  return Array.from({ length: plan.installmentCount }, (_, i) => ({
    planId: plan.id, index: i, amount: i === 0 ? base + remainder : base, kesim: dateInMonth(startMi + i, day),
  }))
}

/**
 * Signed balance as of date (inclusive). openingBalance is the balance AT openingDate, so tx dated before
 * openingDate are ignored (per side for transfers: each account uses its own openingDate). openingBalance + income - expense - outgoing transfers
 * + incoming transfers + adjustments (signed). Cards additionally subtract installment parts billed
 * in statements with kesim <= asOf. Card: negative = debt.
 */
export function accountBalance(account: Account, snap: Snapshot, asOf: ISODate): Kurus {
  let bal = account.openingBalance
  for (const t of snap.transactions) {
    if (t.date > asOf || t.date < account.openingDate) continue
    if (t.accountId === account.id) {
      if (t.kind === 'income' || t.kind === 'adjustment') bal += t.amount
      else bal -= t.amount // expense, outgoing transfer
    }
    if (t.kind === 'transfer' && t.toAccountId === account.id) bal += t.amount
  }
  if (account.kind === 'credit_card') {
    for (const p of billedParts(account, snap)) if (p.kesim <= asOf) bal -= p.amount
  }
  return bal
}

/** Installment parts of a card billed in statements with kesim > today. */
export function cardFutureInstallments(card: Account, snap: Snapshot, today: ISODate): Kurus {
  return billedParts(card, snap).filter((p) => p.kesim > today).reduce((s, p) => s + p.amount, 0)
}

/**
 * Statements from the card's openingDate through the currently open period (inclusive). Newest last.
 * The open statement's total is the debt at its kesim from data known so far. Non-card accounts -> [].
 * paid = transfers into the card in (periodEnd, next kesim], so late payments still count and each payment
 * is attributed to exactly one statement. Spending starts at openingDate (consistent with accountBalance).
 */
export function cardStatements(card: Account, snap: Snapshot, today: ISODate): CardStatement[] {
  const settings = card.card
  if (card.kind !== 'credit_card' || !settings) return []
  const parts = billedParts(card, snap)
  const rate = minPaymentRate(card)
  const out: CardStatement[] = []
  let periodStart = card.openingDate
  for (let mi = firstKesimIndex(settings.statementDay, card.openingDate); ; mi++) {
    const periodEnd = dateInMonth(mi, settings.statementDay)
    const dueDate = addDays(periodEnd, settings.dueDaysAfterStatement)
    const nextPeriodEnd = dateInMonth(mi + 1, settings.statementDay)
    let spending = 0
    let paid = 0
    for (const t of snap.transactions) {
      if (t.kind === 'expense' && t.accountId === card.id && t.date >= periodStart && t.date <= periodEnd) spending += t.amount
      if (t.kind === 'transfer' && t.toAccountId === card.id && t.date > periodEnd && t.date <= nextPeriodEnd) paid += t.amount
    }
    const total = Math.max(0, -accountBalance(card, snap, periodEnd))
    const minPayment = Math.round(total * rate)
    let status: StatementStatus
    if (today <= periodEnd) status = 'open'
    else if (paid >= total) status = 'paid'
    else if (paid >= minPayment) status = 'min_paid'
    else if (today > dueDate) status = 'overdue'
    else if (paid > 0) status = 'partial'
    else status = 'unpaid'
    out.push({
      cardId: card.id, periodStart, periodEnd, dueDate, spending,
      installmentParts: parts.filter((p) => p.kesim === periodEnd).map(({ planId, index, amount }) => ({ planId, index, amount })),
      total, minPayment, paid, status,
    })
    if (periodEnd >= today) break
    periodStart = addDays(periodEnd, 1)
  }
  return out
}
