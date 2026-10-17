// Shared domain types. Money is integer kuruş (1 TL = 100). Dates are 'YYYY-MM-DD'.
export type ID = string
export type ISODate = string
export type Kurus = number

export type AccountKind = 'cash' | 'bank' | 'credit_card'

export interface CardSettings {
  limit: Kurus
  statementDay: number // kesim günü, 1-31 (ay sonuna kırpılır)
  dueDaysAfterStatement: number // son ödeme = kesim + N gün (TR genelde 10)
  minPaymentRate?: number // 0-1, verilmezse limit < 50.000 TL ise 0.2, değilse 0.4
}

export interface Account {
  id: ID
  name: string
  kind: AccountKind
  // Signed. Bank/cash: current balance. Credit card: negative = current debt (güncel borç).
  openingBalance: Kurus
  openingDate: ISODate
  card?: CardSettings
  overdraftLimit?: Kurus // bank only: KMH (kredili mevduat) limiti; balance may go down to -overdraftLimit
  archived?: boolean
}

export type TxKind = 'income' | 'expense' | 'transfer' | 'adjustment'

export interface Transaction {
  id: ID
  date: ISODate
  kind: TxKind
  // Always positive for income/expense/transfer. Signed for adjustment.
  amount: Kurus
  accountId: ID
  toAccountId?: ID // transfer only (card payment = transfer bank -> card)
  categoryId?: ID
  note?: string
  occurrenceKey?: string // set when this tx settles a plan occurrence: `${planId}:${index}`
  importId?: string // set on tx created by a statement import (undo deletes exactly these)
  // Set on tx linked to a PersonalDebt (principal or payment). Counted in balances, excluded from income/expense stats.
  debtId?: ID
  createdAt: number
}

export type DebtDirection = 'borrowed' | 'lent' // borrowed = elden borç (I owe), lent = alacak (owed to me)

/**
 * Elden borç / alacak. If accountId is set, a principal tx (borrowed: income, lent: expense, with debtId) moved the
 * money at `date`. Payments are tx with debtId in the opposite direction (borrowed: expense, lent: income).
 */
export interface PersonalDebt {
  id: ID
  direction: DebtDirection
  counterparty: string
  amount: Kurus
  date: ISODate
  dueDate?: ISODate
  accountId?: ID
  note?: string
  closed?: boolean // closed manually: remaining is no longer counted
  createdAt: number
}

export interface Category {
  id: ID
  name: string
  kind: 'income' | 'expense'
  color?: string
  keywords?: string[] // used by quick-entry parser for suggestions
}

export type PlanKind = 'loan' | 'card_installment' | 'recurring_expense' | 'recurring_income'
export type Frequency = 'weekly' | 'monthly' | 'yearly'

export interface OccurrenceOverride {
  skipped?: boolean
  amount?: Kurus // overrides expected amount for this index
}

interface PlanBase {
  id: ID
  name: string
  categoryId?: ID
  accountId: ID // payer (loan/recurring_expense), receiver (recurring_income), card (card_installment)
  active: boolean
  note?: string
  createdAt: number
  overrides?: Record<number, OccurrenceOverride>
  importId?: string // set on plans created by a statement import
}

export interface LoanPlan extends PlanBase {
  kind: 'loan'
  installmentAmount: Kurus
  totalInstallments: number
  firstDueDate: ISODate // due date of installment index 0; index i = firstDueDate + i months
  preSettledCount: number // installments paid before tracking started (no tx)
  dueDay?: number // day of month installments are due (1-31, clamped); defaults to firstDueDate's day
  principal?: Kurus
  monthlyRate?: number // e.g. 0.0299
}

export interface CardInstallmentPlan extends PlanBase {
  kind: 'card_installment'
  totalAmount: Kurus
  installmentCount: number
  purchaseDate: ISODate // part 0 is billed in the first statement whose kesim >= purchaseDate
  preSettledCount: number // parts already billed before tracking started
}

export type BillType =
  | 'rent' | 'dues' | 'electricity' | 'water' | 'gas' | 'internet' | 'phone' | 'tv' | 'subscription' | 'insurance' | 'education' | 'other'

/** Extra info on a recurring_expense plan managed as a bill (Faturalar). Plans without it count as type 'other', no autopay. */
export interface BillInfo {
  type: BillType
  provider?: string // catalog provider name (billProviders.ts) or free text
  subscriberNo?: string
  autopay: boolean // otomatik ödeme talimatı: past-due unpaid occurrences are 'autopay_pending', not 'overdue'
  matchKeywords: string[] // statement import: description contains one of these (diacritic-insensitive, whole words)
}

export interface RecurringPlan extends PlanBase {
  kind: 'recurring_expense' | 'recurring_income'
  amount: Kurus // expected
  variable: boolean // true = amount is an estimate, ask on payment
  frequency: Frequency
  startDate: ISODate // first occurrence
  endDate?: ISODate
  settledBefore?: ISODate // occurrences due before this date are 'presettled' (history before tracking)
  bill?: BillInfo // recurring_expense only
}

export type Plan = LoanPlan | CardInstallmentPlan | RecurringPlan

// autopay_pending: unpaid, past due, on a bill with autopay (charged by the bank, amount not entered yet). Never overdue.
export type OccurrenceStatus = 'paid' | 'pending' | 'overdue' | 'autopay_pending' | 'skipped' | 'presettled'

export interface Occurrence {
  key: string // `${planId}:${index}`
  planId: ID
  planKind: PlanKind
  index: number
  dueDate: ISODate
  expected: Kurus
  status: OccurrenceStatus
  transactionId?: ID
  actual?: Kurus
}

export type StatementStatus = 'open' | 'unpaid' | 'partial' | 'min_paid' | 'paid' | 'overdue'

export interface InstallmentPart {
  planId: ID
  index: number
  amount: Kurus
}

export interface CardStatement {
  cardId: ID
  periodStart: ISODate // day after previous kesim
  periodEnd: ISODate // kesim date
  dueDate: ISODate
  spending: Kurus // card expense tx in period
  installmentParts: InstallmentPart[]
  total: Kurus // card debt at periodEnd (>= 0)
  minPayment: Kurus
  paid: Kurus // payments into card in (periodEnd, next statement's periodEnd]
  status: StatementStatus // 'open' while today <= periodEnd
}

export interface Snapshot {
  accounts: Account[]
  transactions: Transaction[]
  plans: Plan[]
  categories: Category[]
  debts?: PersonalDebt[] // optional: older backups / fixtures have none
}

export interface MonthSummary {
  month: string // 'YYYY-MM'
  income: Kurus
  expense: Kurus // expense tx + card installment parts billed in this month's statements
  net: Kurus
  projectedIncome: Kurus // pending recurring_income occurrences in month
  projectedExpense: Kurus // pending/overdue/autopay_pending loan + recurring_expense occurrences due in month (card spending is already in expense)
  byCategory: { categoryId: ID | null; amount: Kurus }[] // expenses only
}

export type UpcomingItem =
  | { type: 'occurrence'; dueDate: ISODate; amount: Kurus; occurrence: Occurrence; plan: Plan }
  | { type: 'statement'; dueDate: ISODate; amount: Kurus; statement: CardStatement; card: Account }

export interface DebtSummary {
  loansRemaining: Kurus // sum of unpaid loan installments (includes interest)
  cardsCurrent: Kurus // sum of current card debt
  cardsFutureInstallments: Kurus // installment parts not yet billed
  overdraft: Kurus // sum of negative bank/cash balances (KMH / eksi bakiye)
  personalDebts: Kurus // remaining of open borrowed personal debts
  total: Kurus // all of the above
  receivables: Kurus // remaining of open lent personal debts (NOT in total)
}

export interface QuickEntry {
  kind: 'income' | 'expense'
  amount: Kurus
  date: ISODate
  categoryId?: ID
  note: string
}
