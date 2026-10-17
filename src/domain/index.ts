// Public engine API. Pure functions, no I/O. `today` is always passed in explicitly.
// The engine agent implements these; the UI imports only from this file.
import type {
  Account, CardStatement, DebtSummary, ISODate, Kurus, LoanPlan, MonthSummary,
  Occurrence, Plan, QuickEntry, Category, Snapshot, UpcomingItem,
} from './types'

export * from './types'

const todo = (): never => { throw new Error('not implemented') }

// --- money / dates ---
/** "1.250,50" | "1250.5" | "1250" -> 125050. Returns null if unparsable. */
export function parseMoney(input: string): Kurus | null { return todo() }
/** 125050 -> "1.250,50 ₺" (tr-TR). signed=true prefixes +/-. */
export function formatMoney(k: Kurus, opts?: { signed?: boolean }): string { return todo() }
/** Adds months, clamping day to month end (Jan 31 + 1 = Feb 28/29). */
export function addMonths(d: ISODate, n: number): ISODate { return todo() }
export function addDays(d: ISODate, n: number): ISODate { return todo() }
export function todayISO(): ISODate { return todo() }

// --- plans / occurrences ---
/** Loan from what the bank app shows: installment amount, total count, remaining count, next due date. */
export function loanFromRemaining(input: {
  id: string; name: string; accountId: string; categoryId?: string; createdAt: number
  installmentAmount: Kurus; totalInstallments: number; remainingInstallments: number; nextDueDate: ISODate
}): LoanPlan { return todo() }
/** Annuity installment: principal * r / (1 - (1+r)^-n), rounded to kuruş. r=0 -> principal/n. */
export function annuityInstallment(principal: Kurus, monthlyRate: number, n: number): Kurus { return todo() }
/** All occurrences of loan/recurring plans with due date <= until (recurring without endDate is open-ended).
 *  card_installment plans have no occurrences (they are billed via statements). */
export function occurrencesForPlan(plan: Plan, snap: Snapshot, today: ISODate, until: ISODate): Occurrence[] { return todo() }
/** Loan progress. */
export function loanProgress(plan: LoanPlan, snap: Snapshot, today: ISODate): {
  paidCount: number; remainingCount: number; remainingAmount: Kurus; nextDue?: Occurrence
} { return todo() }

// --- cards ---
/** Statements from the card's openingDate through the currently open period (inclusive). Newest last. */
export function cardStatements(card: Account, snap: Snapshot, today: ISODate): CardStatement[] { return todo() }
/** Signed balance of any account as of date (card: negative = debt, includes billed installment parts). */
export function accountBalance(account: Account, snap: Snapshot, asOf: ISODate): Kurus { return todo() }
/** Installment parts of a card not yet billed as of today. */
export function cardFutureInstallments(card: Account, snap: Snapshot, today: ISODate): Kurus { return todo() }
export function minPaymentRate(card: Account): number { return todo() }

// --- summaries ---
export function monthSummary(snap: Snapshot, month: string, today: ISODate): MonthSummary { return todo() }
/** Pending/overdue occurrences and unpaid card statements with dueDate <= to (overdue ones included regardless of from). Sorted by dueDate. */
export function upcoming(snap: Snapshot, today: ISODate, to: ISODate): UpcomingItem[] { return todo() }
export function debtSummary(snap: Snapshot, today: ISODate): DebtSummary { return todo() }

// --- quick entry ---
/** "120 market", "+45000 maaş", "350,50 benzin dün", "1.250 kira 15.10" -> QuickEntry. null if no amount. */
export function parseQuickEntry(text: string, categories: Category[], today: ISODate): QuickEntry | null { return todo() }
