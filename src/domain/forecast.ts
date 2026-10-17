import { accountBalance, cardStatements } from './cards'
import { addDays, daysInMonth } from './dates'
import { debtStatus } from './debts'
import { occurrencesForPlan } from './plans'
import { monthSummary } from './summaries'
import type { ISODate, Kurus, Snapshot } from './types'

export interface ForecastDay {
  date: ISODate
  balance: Kurus // liquid balance (sum of active bank + cash accounts) at end of day
  projected: boolean // false = actual
}

export interface BalanceForecast {
  days: ForecastDay[]
  endBalance: Kurus
  minBalance: Kurus
  firstNegativeDate?: ISODate // first day of the month whose balance is < 0 (may be in the past)
  incomeThisMonth: Kurus // monthSummary income (actual, debt-linked tx excluded)
  expenseThisMonth: Kurus // monthSummary expense (actual, incl. card spending and billed installment parts)
  spentRatio: number | null // expense / income, null when there is no income
  overdraftLimit: Kurus // sum of overdraftLimit of the liquid accounts
}

const max = (a: ISODate, b: ISODate) => (a > b ? a : b)

/**
 * Future cash movements of liquid (bank/cash) money, each dated >= today:
 * - open (pending/overdue/autopay_pending) loan/recurring occurrences due <= until whose plan account is not a credit card
 *   (card-paid bills reach liquid money through the card statement). Income +, expense -. Past-due ones are applied on today.
 * - per card: the latest closed statement if unpaid (total - paid, on max(dueDate, today)), and the open statement if its
 *   dueDate <= until (total minus the closed statement's remaining already counted, i.e. only new debt).
 * - open personal debts due <= until: borrowed = repayment (-remaining, past-due applied on today); lent = collection
 *   (+remaining on dueDate) only when not yet past due, since an overdue receivable cannot be counted on.
 */
function projectedEvents(snap: Snapshot, today: ISODate, until: ISODate): { date: ISODate; amount: Kurus }[] {
  const out: { date: ISODate; amount: Kurus }[] = []
  const push = (date: ISODate, amount: Kurus) => { if (date <= until && amount !== 0) out.push({ date, amount }) }
  for (const plan of snap.plans) {
    if (snap.accounts.find((a) => a.id === plan.accountId)?.kind === 'credit_card') continue
    for (const o of occurrencesForPlan(plan, snap, today, until)) {
      if (o.status !== 'pending' && o.status !== 'overdue' && o.status !== 'autopay_pending') continue
      push(max(o.dueDate, today), plan.kind === 'recurring_income' ? o.expected : -o.expected)
    }
  }
  for (const card of snap.accounts) {
    if (card.kind !== 'credit_card') continue
    const sts = cardStatements(card, snap, today)
    const closed = sts.filter((s) => s.status !== 'open').at(-1)
    const open = sts.find((s) => s.status === 'open')
    let carry = 0
    if (closed && closed.status !== 'paid') {
      carry = Math.max(0, closed.total - closed.paid)
      push(max(closed.dueDate, today), -carry)
    }
    if (open) push(open.dueDate, -Math.max(0, open.total - carry))
  }
  for (const debt of snap.debts ?? []) {
    if (!debt.dueDate) continue
    const st = debtStatus(debt, snap, today)
    if (st.done) continue
    if (debt.direction === 'borrowed') push(max(debt.dueDate, today), -st.remaining)
    else if (debt.dueDate >= today) push(debt.dueDate, st.remaining)
  }
  return out
}

/**
 * Daily liquid balance for `month` ('YYYY-MM'): days before today are actual end-of-day balances; today and later are
 * today's actual balance plus projectedEvents up to that day. Today counts as projected only if an event lands on it.
 */
export function balanceForecast(snap: Snapshot, today: ISODate, month: string): BalanceForecast {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const end = `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`
  const liquid = snap.accounts.filter((a) => !a.archived && a.kind !== 'credit_card')
  const balanceAt = (d: ISODate) => liquid.reduce((s, a) => s + accountBalance(a, snap, d), 0)
  const events = end >= today ? projectedEvents(snap, today, end) : []
  const base = end >= today ? balanceAt(today) : 0

  const days: ForecastDay[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (d < today) {
      days.push({ date: d, balance: balanceAt(d), projected: false })
      continue
    }
    const upTo = events.filter((e) => e.date <= d)
    days.push({ date: d, balance: base + upTo.reduce((s, e) => s + e.amount, 0), projected: d > today || upTo.length > 0 })
  }

  const ms = monthSummary(snap, month, today)
  const firstNegative = days.find((x) => x.balance < 0)
  return {
    days,
    endBalance: days[days.length - 1].balance,
    minBalance: Math.min(...days.map((x) => x.balance)),
    ...(firstNegative && { firstNegativeDate: firstNegative.date }),
    incomeThisMonth: ms.income,
    expenseThisMonth: ms.expense,
    spentRatio: ms.income > 0 ? ms.expense / ms.income : null,
    overdraftLimit: liquid.reduce((s, a) => s + (a.overdraftLimit ?? 0), 0),
  }
}
