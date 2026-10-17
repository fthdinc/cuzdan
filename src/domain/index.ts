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
export { loanFromRemaining, annuityInstallment, occurrencesForPlan, loanProgress } from './plans'

// --- cards ---
export { cardStatements, accountBalance, cardFutureInstallments, minPaymentRate, installmentSchedule } from './cards'

// --- summaries ---
export { monthSummary, upcoming, debtSummary } from './summaries'

// --- quick entry ---
export { parseQuickEntry } from './quickEntry'
