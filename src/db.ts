import Dexie, { type EntityTable } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Account, Category, PersonalDebt, Plan, Snapshot, Transaction } from './domain'

export const db = new Dexie('cuzdan') as Dexie & {
  accounts: EntityTable<Account, 'id'>
  transactions: EntityTable<Transaction, 'id'>
  plans: EntityTable<Plan, 'id'>
  categories: EntityTable<Category, 'id'>
  debts: EntityTable<PersonalDebt, 'id'>
}

db.version(1).stores({
  accounts: 'id',
  transactions: 'id, date, accountId, toAccountId, occurrenceKey',
  plans: 'id, kind, accountId',
  categories: 'id, kind',
})
// v2: elden borç / alacak table + debtId index on transactions. Existing data is kept.
db.version(2).stores({
  transactions: 'id, date, accountId, toAccountId, occurrenceKey, debtId',
  debts: 'id',
})

export const newId = () => crypto.randomUUID()

type SeedCat = [name: string, color: string, keywords: string[]]

const EXPENSE: SeedCat[] = [
  ['Market', '#16a34a', ['market', 'migros', 'bim', 'a101', 'şok', 'carrefour', 'manav', 'kasap', 'fırın', 'bakkal']],
  ['Fatura', '#0891b2', ['fatura', 'elektrik', 'su', 'doğalgaz', 'internet', 'telefon', 'gsm', 'aidat']],
  ['Kira', '#7c3aed', ['kira']],
  ['Ulaşım', '#2563eb', ['benzin', 'akaryakıt', 'mazot', 'dizel', 'taksi', 'otobüs', 'metro', 'dolmuş', 'otopark', 'köprü', 'otoyol', 'hgs', 'ulaşım']],
  ['Yemek', '#ea580c', ['yemek', 'restoran', 'kafe', 'kahve', 'yemeksepeti', 'getir', 'trendyol yemek', 'lokanta', 'öğle']],
  ['Sağlık', '#dc2626', ['eczane', 'ilaç', 'doktor', 'hastane', 'muayene', 'diş']],
  ['Eğlence', '#db2777', ['sinema', 'netflix', 'spotify', 'konser', 'oyun', 'tatil', 'eğlence']],
  ['Giyim', '#ca8a04', ['giyim', 'ayakkabı', 'kıyafet', 'zara', 'lcw', 'mavi', 'koton']],
  ['Eğitim', '#0d9488', ['okul', 'kurs', 'kitap', 'eğitim', 'kırtasiye']],
  ['Kredi', '#475569', ['kredi', 'taksit', 'kart ödemesi']],
  ['Diğer', '#64748b', []],
]

const INCOME: SeedCat[] = [
  ['Maaş', '#059669', ['maaş', 'maas', 'ücret']],
  ['Ek gelir', '#10b981', ['ek gelir', 'prim', 'ikramiye', 'freelance', 'kira geliri']],
  ['Diğer gelir', '#34d399', []],
]

export function defaultCategories(): Category[] {
  return [
    ...EXPENSE.map(([name, color, keywords]): Category => ({ id: newId(), name, kind: 'expense', color, keywords })),
    ...INCOME.map(([name, color, keywords]): Category => ({ id: newId(), name, kind: 'income', color, keywords })),
  ]
}

db.on('populate', (tx) => {
  tx.table('categories').bulkAdd(defaultCategories())
})

/**
 * Accounts are optional: when the DB has no account at all (archived ones included), add one bank account so
 * income/expense can be entered right away. Early opening date so back-dated entries still count. Idempotent.
 */
export async function ensureDefaultAccount(d: Dexie = db): Promise<void> {
  const accounts = d.table<Account, string>('accounts')
  await d.transaction('rw', accounts, async () => {
    if (await accounts.count()) return
    await accounts.add({ id: newId(), name: 'Ana hesap', kind: 'bank', openingBalance: 0, openingDate: '2000-01-01' })
  })
}

// Sticky: runs on every open (vipDb may be used before the open completes).
db.on('ready', (vipDb) => ensureDefaultAccount(vipDb), true)

/** Live snapshot of the whole DB. undefined while the first query is loading. */
export function useSnapshot(): Snapshot | undefined {
  return useLiveQuery(async () => {
    const [accounts, transactions, plans, categories, debts] = await Promise.all([
      db.accounts.toArray(),
      db.transactions.toArray(),
      db.plans.toArray(),
      db.categories.toArray(),
      db.debts.toArray(),
    ])
    return { accounts, transactions, plans, categories, debts }
  }, [])
}

// --- backup ---
export interface Backup extends Snapshot {
  app: 'cuzdan'
  version: 1
  exportedAt: string
}

export async function exportBackup(): Promise<Backup> {
  const [accounts, transactions, plans, categories, debts] = await Promise.all([
    db.accounts.toArray(),
    db.transactions.toArray(),
    db.plans.toArray(),
    db.categories.toArray(),
    db.debts.toArray(),
  ])
  return { app: 'cuzdan', version: 1, exportedAt: new Date().toISOString(), accounts, transactions, plans, categories, debts }
}

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const optNum = (v: unknown) => v === undefined || isNum(v)

/** Shape check of a backup file. Throws (Turkish message) on malformed input. */
export function validateBackup(data: unknown): Snapshot {
  const bad = (why: string): never => { throw new Error(`Geçersiz yedek dosyası: ${why}`) }
  if (!data || typeof data !== 'object' || Array.isArray(data)) bad('beklenen biçimde değil')
  const d = data as Record<string, unknown>
  if (d.app !== undefined && d.app !== 'cuzdan') bad('bu uygulamaya ait değil')
  if (d.version !== undefined && d.version !== 1) bad('desteklenmeyen sürüm')
  const keys = ['accounts', 'transactions', 'plans', 'categories'] as const
  for (const k of keys) {
    const list = d[k]
    if (!Array.isArray(list)) bad(`"${k}" listesi yok`)
    for (const o of list as unknown[]) {
      if (!o || typeof o !== 'object' || typeof (o as { id?: unknown }).id !== 'string') bad(`"${k}" içinde kimliksiz kayıt`)
    }
  }
  // debts was added later: older backups have none.
  if (d.debts !== undefined) {
    if (!Array.isArray(d.debts)) bad('"debts" listesi değil')
    for (const o of d.debts as unknown[]) {
      const x = o as Partial<PersonalDebt> | null
      if (!x || typeof x !== 'object' || typeof x.id !== 'string') bad('"debts" içinde kimliksiz kayıt')
      if (!isNum(x!.amount)) bad('borç tutarı sayı değil')
      if (x!.direction !== 'borrowed' && x!.direction !== 'lent') bad('borç yönü geçersiz')
    }
  }
  const s = d as unknown as Snapshot
  if (s.accounts.some((a) => !isNum(a.openingBalance) || !optNum(a.overdraftLimit) || (a.card !== undefined && !isNum(a.card.limit)))) bad('hesap tutarı sayı değil')
  if (s.transactions.some((t) => !isNum(t.amount))) bad('işlem tutarı sayı değil')
  if (s.plans.some((p) =>
    p.kind === 'loan' ? !isNum(p.installmentAmount) || !optNum(p.principal)
    : p.kind === 'card_installment' ? !isNum(p.totalAmount)
    : !isNum(p.amount))) bad('plan tutarı sayı değil')
  return s
}

/** Throws on malformed input. Replaces the whole DB. */
export async function importBackup(data: unknown): Promise<void> {
  const d = validateBackup(data)
  await db.transaction('rw', [db.accounts, db.transactions, db.plans, db.categories, db.debts], async () => {
    await Promise.all([db.accounts.clear(), db.transactions.clear(), db.plans.clear(), db.categories.clear(), db.debts.clear()])
    await db.accounts.bulkAdd(d.accounts)
    await db.transactions.bulkAdd(d.transactions)
    await db.plans.bulkAdd(d.plans)
    await db.categories.bulkAdd(d.categories)
    await db.debts.bulkAdd(d.debts ?? [])
  })
}
