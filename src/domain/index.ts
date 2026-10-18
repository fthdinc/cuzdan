// Public engine API. Pure functions, no I/O. `today` is always passed in explicitly.
// The UI imports only from this file. Contracts are documented on each implementation.
export * from './types'

// --- money / dates ---
// parseMoney: "1.250,50" | "1250.5" | "1250" -> 125050. Returns null if unparsable.
// formatMoney: 125050 -> "1.250,50 ₺" (tr-TR). signed=true prefixes +/-.
export { parseMoney, formatMoney } from './money'
// addMonths clamps day to month end (Jan 31 + 1 = Feb 28/29).
export { addMonths, addDays, todayISO } from './dates'

// --- plans / occurrences ---
export { loanFromRemaining, annuityInstallment, occurrencesForPlan, loanProgress, estimatedBillAmount, monthlyIncomePlan } from './plans'

// --- bills (recurring_expense plans) ---
export { billInfo, billHistory, billThisMonth, changeRatio, type BillMonth, type BillMonthState } from './bills'
export {
  BILL_PROVIDERS, BILL_TYPE_LABEL, BILL_TYPE_KEYWORDS, detectBill, matchesKeywords, findProvider, billKeywords, billDefaultName,
  type BillProvider, type DetectedBill,
} from './billProviders'
// matchExpenseToBill: links a manual expense to a bill occurrence, or proposes a new bill; billSuggestions: the same over past expenses.
export {
  matchExpenseToBill, detectExpenseBill, expenseBillPlan, billCategoryId, billSuggestions, buildBillSuggestion,
  type ExpenseBill, type ExpenseBillMatch, type ExpenseLike, type BillSuggestion,
} from './billMatch'

// --- cards ---
export { cardStatements, accountBalance, cardFutureInstallments, minPaymentRate, installmentSchedule } from './cards'

// --- card payments (a card payment is a transfer, not an expense) ---
export { matchCard, looksLikeCardPayment, suspectedCardPayments } from './cardPayments'

// --- summaries ---
export { monthSummary, upcoming, debtSummary } from './summaries'

// --- KMH / personal debts / forecast ---
export { debtStatus, debtPaymentKind, overdraftUsage, type DebtStatus, type OverdraftUsage } from './debts'
export { balanceForecast, type BalanceForecast, type ForecastDay } from './forecast'

// --- quick entry ---
export { parseQuickEntry } from './quickEntry'
// suggestCategory: category for a free-text description (income/expense "Açıklama").
export { suggestCategory } from './categoryMatch'

// --- reminders ---
// reminders: what needs attention today (card kesim/due, plan and debt due dates), sorted by urgency. Ids are stable per period.
export { reminders, nextCardDates, daysBetween, DEFAULT_REMINDER_SETTINGS } from './reminders'
// dateInMonth(monthIndex, day) clamps day to month end; monthIndex('2026-10-18') = 2026*12+9. Used by the calendar export.
export { dateInMonth, monthIndex } from './dates'
