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

// --- cards ---
export { cardStatements, accountBalance, cardFutureInstallments, minPaymentRate, installmentSchedule } from './cards'

// --- summaries ---
export { monthSummary, upcoming, debtSummary } from './summaries'

// --- KMH / personal debts / forecast ---
export { debtStatus, debtPaymentKind, overdraftUsage, type DebtStatus, type OverdraftUsage } from './debts'
export { balanceForecast, type BalanceForecast, type ForecastDay } from './forecast'

// --- quick entry ---
export { parseQuickEntry } from './quickEntry'
// suggestCategory: category for a free-text description (income/expense "Açıklama").
export { suggestCategory } from './categoryMatch'
