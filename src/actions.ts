// All DB writes the UI performs.
import { db, newId } from './db'
import { debtPaymentKind, type Account, type ID, type ISODate, type Kurus, type Occurrence, type PersonalDebt, type Plan, type Transaction } from './domain'
import type { BuiltImport } from './domain/import'

export type TxDraft = Omit<Transaction, 'id' | 'createdAt'>

export async function addTx(draft: TxDraft): Promise<ID> {
  const id = newId()
  await db.transactions.add({ ...clean(draft), id, createdAt: Date.now() })
  rememberAccount(draft.accountId)
  return id
}

export async function updateTx(tx: Transaction): Promise<void> {
  await db.transactions.put(clean(tx))
}

export async function deleteTx(id: ID): Promise<void> {
  await db.transactions.delete(id)
}

/** Settle a loan / recurring plan occurrence. No-op (returns false) if it is already settled. */
export async function payOccurrence(plan: Plan, occ: Occurrence, amount: Kurus, accountId: ID, date: ISODate): Promise<boolean> {
  return db.transaction('rw', db.transactions, async () => {
    if (await db.transactions.where('occurrenceKey').equals(occ.key).count()) return false
    await addTx({
      date,
      kind: plan.kind === 'recurring_income' ? 'income' : 'expense',
      amount,
      accountId,
      categoryId: plan.categoryId,
      note: plan.name,
      occurrenceKey: occ.key,
    })
    return true
  })
}

/** Card statement payment = transfer from a bank/cash account to the card. */
export async function payCard(card: Account, fromAccountId: ID, amount: Kurus, date: ISODate) {
  await addTx({ date, kind: 'transfer', amount, accountId: fromAccountId, toAccountId: card.id, note: `${card.name} ödemesi` })
}

export async function setSkipped(planId: ID, index: number, skipped: boolean) {
  await db.transaction('rw', db.plans, async () => {
    const plan = await db.plans.get(planId)
    if (!plan) return
    const overrides = { ...(plan.overrides ?? {}) }
    const cur = { ...(overrides[index] ?? {}) }
    if (skipped) cur.skipped = true
    else delete cur.skipped
    if (Object.keys(cur).length) overrides[index] = cur
    else delete overrides[index]
    await db.plans.update(planId, { overrides })
  })
}

export async function savePlan(plan: Plan) {
  await db.plans.put(clean(plan))
}

export async function deletePlan(id: ID) {
  await db.plans.delete(id)
}

export async function saveAccount(acc: Account) {
  await db.accounts.put(clean(acc))
}

/** Deletes if unused, otherwise archives. Returns what happened. */
export async function removeAccount(id: ID): Promise<'deleted' | 'archived'> {
  const used =
    (await db.transactions.where('accountId').equals(id).count()) +
    (await db.transactions.where('toAccountId').equals(id).count()) +
    (await db.plans.where('accountId').equals(id).count())
  if (used > 0) {
    await db.accounts.update(id, { archived: true })
    return 'archived'
  }
  await db.accounts.delete(id)
  return 'deleted'
}

// --- elden borç / alacak ---

const principalNote = (d: PersonalDebt) => `${d.direction === 'borrowed' ? 'Borç alındı' : 'Borç verildi'}: ${d.counterparty}`
const paymentNote = (d: PersonalDebt) => `${d.direction === 'borrowed' ? 'Borç ödemesi' : 'Tahsilat'}: ${d.counterparty}`

/**
 * Create or update a personal debt. When debt.accountId is set, keeps exactly one principal tx in sync
 * (borrowed: income, lent: expense; tagged with debtId). Clearing accountId removes it.
 */
export async function saveDebt(debt: PersonalDebt): Promise<void> {
  await db.transaction('rw', db.debts, db.transactions, async () => {
    await db.debts.put(clean(debt))
    const kind = debtPaymentKind(debt) === 'expense' ? 'income' : 'expense'
    const principal = (await db.transactions.where('debtId').equals(debt.id).toArray()).find((t) => t.kind === kind)
    if (!debt.accountId) {
      if (principal) await db.transactions.delete(principal.id)
      return
    }
    await db.transactions.put(clean({
      ...(principal ?? { id: newId(), createdAt: Date.now() }),
      date: debt.date, kind, amount: debt.amount, accountId: debt.accountId, note: principalNote(debt), debtId: debt.id,
    }))
  })
}

/** Repay a borrowed debt (money out of accountId) or collect a receivable (money in). */
export async function payDebt(debt: PersonalDebt, amount: Kurus, accountId: ID, date: ISODate): Promise<void> {
  await addTx({ date, kind: debtPaymentKind(debt), amount, accountId, note: paymentNote(debt), debtId: debt.id })
}

/** Deletes the debt and every tx linked to it (principal and payments). */
export async function deleteDebt(id: ID): Promise<void> {
  await db.transaction('rw', db.debts, db.transactions, async () => {
    await db.transactions.where('debtId').equals(id).delete()
    await db.debts.delete(id)
  })
}

// --- statement import ---

/** Writes an import (transactions + installment plans, all tagged with the same importId) atomically. */
export async function commitImport(built: BuiltImport): Promise<void> {
  await db.transaction('rw', db.transactions, db.plans, async () => {
    await db.transactions.bulkAdd(built.transactions.map(clean))
    await db.plans.bulkAdd(built.plans.map(clean))
  })
}

/** Deletes exactly the records created by one import. Returns how many were removed. */
export async function undoImport(importId: string): Promise<number> {
  return db.transaction('rw', db.transactions, db.plans, async () => {
    const txIds = (await db.transactions.filter((t) => t.importId === importId).primaryKeys()) as ID[]
    const planIds = (await db.plans.filter((p) => p.importId === importId).primaryKeys()) as ID[]
    await db.transactions.bulkDelete(txIds)
    await db.plans.bulkDelete(planIds)
    return txIds.length + planIds.length
  })
}

// --- smart defaults ---
const LAST_ACC = 'cuzdan.lastAccountId'
export function rememberAccount(id: ID) {
  try { localStorage.setItem(LAST_ACC, id) } catch { /* ignore */ }
}
export function lastAccountId(accounts: Account[]): ID | undefined {
  let id: string | null = null
  try { id = localStorage.getItem(LAST_ACC) } catch { /* ignore */ }
  const active = accounts.filter((a) => !a.archived)
  return active.find((a) => a.id === id)?.id ?? active[0]?.id
}

/** Drop undefined / empty-string optional fields so stored objects stay tidy. */
function clean<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === '') delete out[k]
  return out as T
}
