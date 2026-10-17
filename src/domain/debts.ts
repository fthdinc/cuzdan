import { accountBalance } from './cards'
import type { Account, ISODate, Kurus, PersonalDebt, Snapshot, Transaction } from './types'

/** Tx kind of a payment on the debt: repaying a borrowed debt is money out, collecting a receivable is money in. */
export function debtPaymentKind(debt: PersonalDebt): 'income' | 'expense' {
  return debt.direction === 'borrowed' ? 'expense' : 'income'
}

export interface DebtStatus {
  paid: Kurus
  remaining: Kurus // 0 when closed
  overdue: boolean // dueDate < today and remaining > 0
  done: boolean // fully paid or closed
  payments: Transaction[] // date asc
  principalTx?: Transaction // the tx that moved the money at the start (only when debt.accountId was set)
}

/**
 * Payments = tx with debtId in the payment direction (any date). The principal tx (opposite direction) is not a payment.
 * remaining = max(0, amount - paid), or 0 when closed.
 */
export function debtStatus(debt: PersonalDebt, snap: Snapshot, today: ISODate): DebtStatus {
  const kind = debtPaymentKind(debt)
  const linked = snap.transactions.filter((t) => t.debtId === debt.id)
  const payments = linked.filter((t) => t.kind === kind).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
  const principalTx = linked.find((t) => t.kind !== kind)
  const paid = payments.reduce((s, t) => s + t.amount, 0)
  const remaining = debt.closed ? 0 : Math.max(0, debt.amount - paid)
  return {
    paid, remaining, done: remaining === 0, overdue: remaining > 0 && !!debt.dueDate && debt.dueDate < today,
    payments, ...(principalTx && { principalTx }),
  }
}

export interface OverdraftUsage {
  used: Kurus // max(0, -balance)
  limit?: Kurus // account.overdraftLimit when set (> 0)
  over: boolean // used > limit (only when a limit is set)
}

/** KMH / eksi bakiye usage of a bank or cash account as of today. Credit cards -> used 0. */
export function overdraftUsage(account: Account, snap: Snapshot, today: ISODate): OverdraftUsage {
  if (account.kind === 'credit_card') return { used: 0, over: false }
  const used = Math.max(0, -accountBalance(account, snap, today))
  const limit = account.overdraftLimit && account.overdraftLimit > 0 ? account.overdraftLimit : undefined
  return { used, ...(limit !== undefined && { limit }), over: limit !== undefined && used > limit }
}
