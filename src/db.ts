import Dexie, { type EntityTable } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Account, Category, Plan, Snapshot, Transaction } from './domain'

export const db = new Dexie('cuzdan') as Dexie & {
  accounts: EntityTable<Account, 'id'>
  transactions: EntityTable<Transaction, 'id'>
  plans: EntityTable<Plan, 'id'>
  categories: EntityTable<Category, 'id'>
}

db.version(1).stores({
  accounts: 'id',
  transactions: 'id, date, accountId, toAccountId, occurrenceKey',
  plans: 'id, kind, accountId',
  categories: 'id, kind',
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

/** Live snapshot of the whole DB. undefined while the first query is loading. */
export function useSnapshot(): Snapshot | undefined {
  return useLiveQuery(async () => {
    const [accounts, transactions, plans, categories] = await Promise.all([
      db.accounts.toArray(),
      db.transactions.toArray(),
      db.plans.toArray(),
      db.categories.toArray(),
    ])
    return { accounts, transactions, plans, categories }
  }, [])
}

// --- backup ---
export interface Backup extends Snapshot {
  app: 'cuzdan'
  version: 1
  exportedAt: string
}

export async function exportBackup(): Promise<Backup> {
  const [accounts, transactions, plans, categories] = await Promise.all([
    db.accounts.toArray(),
    db.transactions.toArray(),
    db.plans.toArray(),
    db.categories.toArray(),
  ])
  return { app: 'cuzdan', version: 1, exportedAt: new Date().toISOString(), accounts, transactions, plans, categories }
}

/** Throws on malformed input. Replaces the whole DB. */
export async function importBackup(data: unknown): Promise<void> {
  const d = data as Partial<Backup>
  const keys = ['accounts', 'transactions', 'plans', 'categories'] as const
  if (!d || typeof d !== 'object' || keys.some((k) => !Array.isArray(d[k]))) {
    throw new Error('Geçersiz yedek dosyası')
  }
  await db.transaction('rw', [db.accounts, db.transactions, db.plans, db.categories], async () => {
    await Promise.all([db.accounts.clear(), db.transactions.clear(), db.plans.clear(), db.categories.clear()])
    await db.accounts.bulkAdd(d.accounts!)
    await db.transactions.bulkAdd(d.transactions!)
    await db.plans.bulkAdd(d.plans!)
    await db.categories.bulkAdd(d.categories!)
  })
}
