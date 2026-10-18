// Matching parsed statement rows against the app's data. Pure.
import { billDefaultName, billKeywords, detectBill, matchesKeywords, type DetectedBill } from '../billProviders'
import { dayDiff, pickBillOccurrence } from '../billMatch'
import { accountBalance, cardStatements } from '../cards'
import { dateInMonth, monthIndex } from '../dates'
import type { Account, CardInstallmentPlan, ID, ISODate, Kurus, RecurringPlan, Snapshot, Transaction } from '../types'
import { suggestCategory } from './category'
import type { ParsedRow, ParsedStatement, StatementMeta } from './statement'
import { fold } from './text'

export type ImportKind = 'income' | 'expense' | 'transfer'
export type PlanDraft = Omit<CardInstallmentPlan, 'id' | 'createdAt'>
export type BillPlanDraft = Omit<RecurringPlan, 'id' | 'createdAt'>

export interface ImportRow {
  id: number
  row: ParsedRow
  include: boolean // user-editable; defaults below
  kind: ImportKind
  categoryId?: ID
  mode: 'tx' | 'plan' // 'plan' = create installment plan instead of a transaction
  duplicate?: 'existing' | 'file' // same amount ±1 day already on the account / repeated in this file
  beforeOpening: boolean // date < account.openingDate (already inside the opening balance)
  looksLikePayment: boolean // card credit row that reads like a card payment
  installment?: {
    current: number
    total: number
    coveredBy?: ID | 'file' // existing plan id, or an earlier row of this file creating the same plan
    plan?: PlanDraft // proposal when not covered
  }
  // Debit row paying an existing bill plan. occurrenceKey: the occurrence this row settles; absent when the
  // matching occurrence is already paid (then the row is flagged duplicate).
  bill?: { planId: ID; planName: string; occurrenceKey?: string }
  // Bill without a plan: "Fatura olarak takip et" proposal (track = user toggle, default on).
  billProposal?: { plan: BillPlanDraft; track: boolean }
  // Later month of the same new bill in this file: settles occurrence `index` of row `rowId`'s proposed plan.
  billFollows?: { rowId: number; index: number }
}

export interface Reconciliation {
  bankKesim: ISODate
  bankTotal: Kurus
  kesim: ISODate | null // matching engine statement (null if none within ±5 days)
  engineTotal: Kurus | null // engine debt at that kesim (unclamped)
  diff: Kurus | null // engineTotal - bankTotal; an adjustment of +diff on the card makes them equal
}

export interface PreparedImport {
  rows: ImportRow[]
  reconciliation: Reconciliation | null
}

export interface PrepareOptions {
  paymentSourceId?: ID // card import: credit rows that look like payments become transfers from this account
}

const firstKesimMi = (day: number, date: ISODate) => {
  const mi = monthIndex(date)
  return dateInMonth(mi, day) < date ? mi + 1 : mi
}

/** Signed effect of an existing transaction on `accountId` (adjustments excluded: they are never statement rows). */
function effect(t: Transaction, accountId: ID): number | null {
  if (t.kind === 'adjustment') return null
  if (t.accountId === accountId) return t.kind === 'income' ? t.amount : -t.amount
  if (t.kind === 'transfer' && t.toAccountId === accountId) return t.amount
  return null
}

const PAYMENT = /odeme|tahsilat|havale|eft|fast/
const NOT_PAYMENT = /iade|iptal/

/**
 * Proposes how each parsed row is imported.
 * Kind mapping (consistent with accountBalance): debit -> expense, credit -> income on the same account.
 * On a card, income raises the balance (debt goes down), which is what a payment or refund does. When the
 * user picks a payment source account, card credits that read like payments become transfers source -> card
 * instead (so they count as statement payments and are not reported as income).
 * Defaults: duplicates of existing transactions and rows before the account's opening date are skipped.
 * Card installment rows ("3/6"): if a plan on this card has the same count and per-part amount (±1 TL) with
 * that part billed within a month of this statement, the row is 'covered' and skipped (the engine already
 * bills plan parts). Otherwise a plan is proposed (mode 'plan') so the current part lands in this statement;
 * parts billed before the card's tracking start become preSettledCount.
 * Bills (debit rows that are not duplicates / before opening): if a recurring_expense plan's keywords
 * (billKeywords) match the description, the row settles the nearest unpaid occurrence within ±20 days
 * (a plan whose subscriberNo appears in the description wins; each occurrence is claimed once per file);
 * if only a paid one is that close, the row is a duplicate. Rows matching the provider catalog / generic
 * "fatura" patterns with no matching plan get a bill plan proposal; later months of the same bill in the
 * file follow that proposal.
 */
export function prepareImport(parsed: ParsedStatement, account: Account, snap: Snapshot, today: ISODate, opts: PrepareOptions = {}): PreparedImport {
  const isCard = account.kind === 'credit_card' && !!account.card
  const day = account.card?.statementDay ?? 1
  const trackMi = isCard ? firstKesimMi(day, account.openingDate) : 0
  const pool = snap.transactions
    .map((t) => ({ t, e: effect(t, account.id) }))
    .filter((x): x is { t: Transaction; e: number } => x.e !== null)
  const used = new Set<ID>()
  const seen = new Set<string>()
  const newPlans = new Map<string, number>()
  const plans = snap.plans.filter((p): p is CardInstallmentPlan => p.kind === 'card_installment' && p.accountId === account.id)
  const billPlans = snap.plans
    .filter((p): p is RecurringPlan => p.kind === 'recurring_expense' && p.active)
    .map((plan) => ({ plan, keywords: billKeywords(plan) }))
    .filter((x) => x.keywords.length > 0)
  const claimed = new Set<string>()
  const detected = new Map<number, DetectedBill>() // rows to propose a new bill for

  const linkBill = (out: ImportRow) => {
    const { row } = out
    const candidates = billPlans.filter((x) => matchesKeywords(row.description, x.keywords))
    if (!candidates.length) {
      const d = detectBill(row.description)
      if (d) detected.set(out.id, d)
      return
    }
    const pick = pickBillOccurrence(candidates.map((x) => x.plan), row.date, snap, today, { claimed, digits: row.description.replace(/\D/g, '') })
    if (!pick) return
    const { plan, occurrence } = pick
    if (occurrence.status !== 'paid') {
      claimed.add(occurrence.key)
      out.bill = { planId: plan.id, planName: plan.name, occurrenceKey: occurrence.key }
      out.categoryId = plan.categoryId ?? out.categoryId
    } else {
      out.bill = { planId: plan.id, planName: plan.name }
      out.duplicate = 'existing'
    }
  }

  const rows = parsed.rows.map((row, id): ImportRow => {
    const credit = row.direction === 'credit'
    const f = fold(row.description)
    const looksLikePayment = isCard && credit && PAYMENT.test(f) && !NOT_PAYMENT.test(f)
    const kind: ImportKind = !credit ? 'expense' : looksLikePayment && opts.paymentSourceId ? 'transfer' : 'income'
    const out: ImportRow = {
      id, row, kind, include: true, mode: 'tx', looksLikePayment,
      categoryId: kind === 'transfer' ? undefined : suggestCategory(row.description, credit ? 'income' : 'expense', snap.categories),
      beforeOpening: row.date < account.openingDate,
    }

    if (isCard && row.installment && !credit) {
      const { current, total } = row.installment
      const kesimMi = parsed.meta.statementDate ? monthIndex(parsed.meta.statementDate) : firstKesimMi(day, row.date)
      const part0Mi = kesimMi - (current - 1)
      const covering = plans.find((p) => {
        if (p.installmentCount !== total) return false
        const base = Math.floor(p.totalAmount / p.installmentCount)
        const part = current === 1 ? p.totalAmount - base * (total - 1) : base
        return Math.abs(part - row.amount) <= 100 && Math.abs(firstKesimMi(day, p.purchaseDate) - part0Mi) <= 1
      })
      const totalAmount = row.installmentTotal ?? row.amount * total
      const key = `${total}:${Math.round(totalAmount / 100)}:${part0Mi}`
      out.installment = { current, total }
      if (covering) {
        out.installment.coveredBy = covering.id
        out.include = false
      } else if (newPlans.has(key)) {
        out.installment.coveredBy = 'file'
        out.include = false
      } else {
        newPlans.set(key, id)
        out.mode = 'plan'
        out.installment.plan = {
          kind: 'card_installment',
          name: row.description.slice(0, 60),
          accountId: account.id,
          categoryId: out.categoryId,
          active: true,
          totalAmount,
          installmentCount: total,
          purchaseDate: firstKesimMi(day, row.date) === part0Mi ? row.date : dateInMonth(part0Mi, day),
          preSettledCount: Math.min(total, Math.max(0, trackMi - part0Mi)),
        }
      }
      return out
    }

    const signed = credit ? row.amount : -row.amount
    const match = pool.find((x) => !used.has(x.t.id) && x.e === signed && Math.abs(dayDiff(x.t.date, row.date)) <= 1)
    const fileKey = `${row.date}|${signed}|${f}`
    if (match) {
      used.add(match.t.id)
      out.duplicate = 'existing'
    } else if (seen.has(fileKey)) out.duplicate = 'file'
    seen.add(fileKey)
    if (!credit && !out.duplicate && !out.beforeOpening) linkBill(out)
    out.include = out.duplicate !== 'existing' && !out.beforeOpening
    return out
  })

  // Proposals: one new plan per detected bill (earliest row); later months of the same bill follow it.
  const fatura = snap.categories.find((c) => c.kind === 'expense' && c.name === 'Fatura')?.id
  const kira = snap.categories.find((c) => c.kind === 'expense' && c.name === 'Kira')?.id
  const groups = new Map<string, ImportRow[]>()
  for (const [id, d] of detected) {
    const key = d.provider ?? `${d.type}|${d.keywords.join(',')}`
    groups.set(key, [...(groups.get(key) ?? []), rows[id]])
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : a.id - b.id))
    const lead = group[0]
    const d = detected.get(lead.id)!
    lead.categoryId ??= d.type === 'rent' ? kira ?? fatura : fatura
    lead.billProposal = {
      track: true,
      plan: {
        kind: 'recurring_expense',
        name: d.provider ? billDefaultName(d.type, d.provider) : lead.row.description.slice(0, 40),
        accountId: account.id,
        categoryId: lead.categoryId,
        active: true,
        amount: lead.row.amount,
        variable: d.type !== 'rent',
        frequency: 'monthly',
        startDate: lead.row.date,
        settledBefore: lead.row.date,
        bill: { type: d.type, provider: d.provider, autopay: d.autopay, matchKeywords: d.keywords },
      },
    }
    const months = new Set([monthIndex(lead.row.date)])
    for (const r of group.slice(1)) {
      const mi = monthIndex(r.row.date)
      if (months.has(mi)) continue
      months.add(mi)
      r.billFollows = { rowId: lead.id, index: mi - monthIndex(lead.row.date) }
      r.categoryId ??= lead.categoryId
    }
  }
  return { rows, reconciliation: reconcile(parsed.meta, account, snap, today) }
}

export interface BuiltImport {
  transactions: Transaction[]
  plans: (CardInstallmentPlan | RecurringPlan)[]
}

/**
 * Turns the (user-edited) rows into records tagged with importId. adjustment: optional reconciliation fix,
 * a signed adjustment on the account at `date`.
 */
export function buildImport(rows: ImportRow[], account: Account, o: {
  importId: string; makeId: () => string; now: number; paymentSourceId?: ID
  adjustment?: { amount: Kurus; date: ISODate }
}): BuiltImport {
  const transactions: Transaction[] = []
  const plans: (CardInstallmentPlan | RecurringPlan)[] = []
  // Bill proposals that will be created (included expense rows with track on): row id -> plan id.
  const billPlanIds = new Map<number, ID>()
  for (const r of rows) {
    if (!r.include || r.mode !== 'tx' || r.kind !== 'expense' || !r.billProposal?.track) continue
    const id = o.makeId()
    billPlanIds.set(r.id, id)
    plans.push({ ...r.billProposal.plan, categoryId: r.categoryId, id, createdAt: o.now, importId: o.importId })
  }
  for (const r of rows) {
    if (!r.include) continue
    if (r.mode === 'plan' && r.installment?.plan) {
      plans.push({ ...r.installment.plan, categoryId: r.categoryId, id: o.makeId(), createdAt: o.now, importId: o.importId })
      continue
    }
    const proposed = billPlanIds.get(r.id)
    const follows = r.billFollows && billPlanIds.get(r.billFollows.rowId)
    const occurrenceKey = r.kind !== 'expense' ? undefined
      : r.bill?.occurrenceKey ?? (proposed ? `${proposed}:0` : follows ? `${follows}:${r.billFollows!.index}` : undefined)
    const transfer = r.kind === 'transfer' && o.paymentSourceId
    transactions.push({
      id: o.makeId(),
      date: r.row.date,
      kind: transfer ? 'transfer' : r.kind === 'transfer' ? 'income' : r.kind,
      amount: r.row.amount,
      accountId: transfer ? o.paymentSourceId! : account.id,
      ...(transfer ? { toAccountId: account.id } : r.categoryId ? { categoryId: r.categoryId } : {}),
      note: r.row.description,
      ...(occurrenceKey ? { occurrenceKey } : {}),
      createdAt: o.now,
      importId: o.importId,
    })
  }
  if (o.adjustment && o.adjustment.amount !== 0) {
    transactions.push({
      id: o.makeId(), date: o.adjustment.date, kind: 'adjustment', amount: o.adjustment.amount, accountId: account.id,
      note: 'Ekstre mutabakatı', createdAt: o.now, importId: o.importId,
    })
  }
  return { transactions, plans }
}

/** Snapshot as it would be after the import (for previewing reconciliation). */
export function withImport(snap: Snapshot, built: BuiltImport): Snapshot {
  return { ...snap, transactions: [...snap.transactions, ...built.transactions], plans: [...snap.plans, ...built.plans] }
}

/**
 * Compares the bank's dönem borcu with the engine's debt at the matching kesim (the engine statement whose
 * kesim is within ±5 days of the bank's, banks shift kesim around weekends). Cards only.
 */
export function reconcile(meta: StatementMeta, account: Account, snap: Snapshot, today: ISODate): Reconciliation | null {
  if (account.kind !== 'credit_card' || !meta.statementDate || meta.totalDebt === undefined) return null
  const bankKesim = meta.statementDate
  const near = cardStatements(account, snap, today > bankKesim ? today : bankKesim)
    .map((s) => ({ s, d: Math.abs(dayDiff(s.periodEnd, bankKesim)) }))
    .filter((x) => x.d <= 5)
    .sort((a, b) => a.d - b.d)[0]
  if (!near) return { bankKesim, bankTotal: meta.totalDebt, kesim: null, engineTotal: null, diff: null }
  const engineTotal = -accountBalance(account, snap, near.s.periodEnd)
  return { bankKesim, bankTotal: meta.totalDebt, kesim: near.s.periodEnd, engineTotal, diff: engineTotal - meta.totalDebt }
}
