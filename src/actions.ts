// All DB writes the UI performs.
import { db, newId } from './db'
import type { Account, ID, ISODate, Kurus, Occurrence, Plan, Transaction } from './domain'

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
