import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PersonalDebt, Plan } from './domain'

// The app DB module opens 'cuzdan' at its latest version; seed a v1 database first to check the upgrade keeps data.
let mod: typeof import('./db')
let actions: typeof import('./actions')
beforeAll(async () => {
  const v1 = new Dexie('cuzdan')
  v1.version(1).stores({ accounts: 'id', transactions: 'id, date, accountId, toAccountId, occurrenceKey', plans: 'id, kind, accountId', categories: 'id, kind' })
  await v1.table('accounts').add({ id: 'b', name: 'Banka', kind: 'bank', openingBalance: 1000, openingDate: '2026-10-01' })
  await v1.table('transactions').add({ id: 'x', date: '2026-10-02', kind: 'expense', amount: 10, accountId: 'b', createdAt: 0 })
  await v1.table('categories').add({ id: 'k', name: 'Kredi', kind: 'expense', keywords: ['kredi', 'taksit', 'kart ödemesi'] })
  v1.close()
  mod = await import('./db')
  actions = await import('./actions')
})

describe('db v2', () => {
  it('upgrade from v1 keeps existing data and adds an empty debts table (no default account added)', async () => {
    expect(await mod.db.accounts.toArray()).toMatchObject([{ id: 'b' }])
    expect(await mod.db.transactions.get('x')).toMatchObject({ amount: 10 })
    expect(await mod.db.debts.count()).toBe(0)
  })

  it('v3 adds the Kredi kartı category once and moves "kart ödemesi" off Kredi', async () => {
    const cats = await mod.db.categories.toArray()
    expect(cats.filter((c) => c.name === 'Kredi kartı')).toMatchObject([{ kind: 'expense' }])
    expect(cats.find((c) => c.id === 'k')?.keywords).toEqual(['kredi', 'taksit'])
  })

  it('debt principal tx sync, payments and delete', async () => {
    const d: PersonalDebt = { id: 'd', direction: 'borrowed', counterparty: 'Ali', amount: 5000, date: '2026-10-03', accountId: 'b', createdAt: 0 }
    await actions.saveDebt(d)
    let linked = await mod.db.transactions.where('debtId').equals('d').toArray()
    expect(linked).toMatchObject([{ kind: 'income', amount: 5000, accountId: 'b', date: '2026-10-03' }])
    await actions.saveDebt({ ...d, amount: 6000 })
    linked = await mod.db.transactions.where('debtId').equals('d').toArray()
    expect(linked).toMatchObject([{ id: linked[0].id, kind: 'income', amount: 6000 }])
    await actions.payDebt(d, 1000, 'b', '2026-10-05')
    expect((await mod.db.transactions.where('debtId').equals('d').toArray()).map((t) => t.kind).sort()).toEqual(['expense', 'income'])
    await actions.saveDebt({ ...d, accountId: undefined })
    expect((await mod.db.transactions.where('debtId').equals('d').toArray()).map((t) => t.kind)).toEqual(['expense'])
    await actions.deleteDebt('d')
    expect(await mod.db.debts.count()).toBe(0)
    expect(await mod.db.transactions.where('debtId').equals('d').count()).toBe(0)
    expect(await mod.db.transactions.count()).toBe(1)
  })
})

describe('addIncome', () => {
  it('plain income adds one tx; monthly also adds a plan settled by that tx', async () => {
    await actions.addIncome({ amount: 300000, date: '2026-10-10', note: 'Freelance iş', accountId: 'b', monthly: false })
    expect(await mod.db.transactions.where('date').equals('2026-10-10').toArray()).toMatchObject([{ kind: 'income', amount: 300000, note: 'Freelance iş' }])
    await actions.addIncome({ amount: 4500000, date: '2026-10-11', note: 'Maaş', accountId: 'b', categoryId: 'c', monthly: true })
    const plans = await mod.db.plans.toArray()
    expect(plans).toMatchObject([{ kind: 'recurring_income', name: 'Maaş', amount: 4500000, frequency: 'monthly', startDate: '2026-10-11', accountId: 'b', categoryId: 'c' }])
    expect(await mod.db.transactions.where('occurrenceKey').equals(`${plans[0].id}:0`).toArray()).toMatchObject([{ kind: 'income', amount: 4500000, date: '2026-10-11' }])
  })
})

describe('backup', () => {
  const base = { app: 'cuzdan', version: 1, accounts: [], transactions: [], plans: [], categories: [] }
  it('old backups without debts are valid and import', async () => {
    expect(() => mod.validateBackup(base)).not.toThrow()
    await mod.importBackup(base)
    expect(await mod.db.debts.count()).toBe(0)
  })
  it('debts are validated, exported and restored', async () => {
    expect(() => mod.validateBackup({ ...base, debts: [{ id: 'd', amount: 'x', direction: 'lent' }] })).toThrow(/borç tutarı/)
    expect(() => mod.validateBackup({ ...base, debts: [{ id: 'd', amount: 1, direction: 'x' }] })).toThrow(/borç yönü/)
    const debts = [{ id: 'd', direction: 'lent', counterparty: 'Ayşe', amount: 100, date: '2026-10-01', createdAt: 0 }]
    await mod.importBackup({ ...base, debts })
    expect((await mod.exportBackup()).debts).toEqual(debts)
  })
})

describe('card payments', () => {
  it('convertToCardPayment turns an expense into a transfer to the card, keeping date, amount and note', async () => {
    await mod.db.accounts.add({ id: 'card', name: 'Axess', kind: 'credit_card', openingBalance: 0, openingDate: '2026-10-01', card: { statementDay: 5, dueDaysAfterStatement: 10 } })
    await mod.db.transactions.add({ id: 'p', date: '2026-10-12', kind: 'expense', amount: 3000000, accountId: 'b', categoryId: 'k', note: 'Axess kredi kartı', createdAt: 1 })
    await actions.convertToCardPayment((await mod.db.transactions.get('p'))!, 'b', 'card')
    const t = await mod.db.transactions.get('p')
    expect(t).toMatchObject({ kind: 'transfer', accountId: 'b', toAccountId: 'card', amount: 3000000, date: '2026-10-12', note: 'Axess kredi kartı' })
    expect(t?.categoryId).toBeUndefined()
  })

  it('an expense recorded on the card becomes a transfer from bank/cash to it', async () => {
    await mod.db.transactions.add({ id: 'q', date: '2026-10-18', kind: 'expense', amount: 3000000, accountId: 'card', note: 'Axess Kredi Kartı', createdAt: 2 })
    await actions.convertToCardPayment((await mod.db.transactions.get('q'))!, 'b', 'card')
    expect(await mod.db.transactions.get('q')).toMatchObject({ kind: 'transfer', accountId: 'b', toAccountId: 'card' })
  })

  it('defaultPayMethod: method last used for the category, else last expense method, else bank/cash', async () => {
    const store = new Map<string, string>()
    const prev = globalThis.localStorage
    globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage
    try {
      // Earlier backup tests replaced the DB: make sure the bank account exists.
      await mod.db.accounts.put({ id: 'b', name: 'Banka', kind: 'bank', openingBalance: 0, openingDate: '2026-10-01' })
      const accounts = await mod.db.accounts.toArray()
      expect(actions.defaultPayMethod(accounts, 'food')).toBe('b')
      await actions.addTx({ date: '2026-10-13', kind: 'expense', amount: 100, accountId: 'card', categoryId: 'food' })
      await actions.addTx({ date: '2026-10-13', kind: 'expense', amount: 100, accountId: 'b', categoryId: 'market' })
      expect(actions.defaultPayMethod(accounts, 'food')).toBe('card')
      expect(actions.defaultPayMethod(accounts, 'other')).toBe('b')
      expect(actions.defaultPayMethod(accounts)).toBe('b')
    } finally {
      globalThis.localStorage = prev
    }
  })

  it('backup accepts a card without a limit', () => {
    const acc = { id: 'c', name: 'K', kind: 'credit_card', openingBalance: 0, openingDate: '2026-10-01', card: { statementDay: 5, dueDaysAfterStatement: 10 } }
    expect(() => mod.validateBackup({ accounts: [acc], transactions: [], plans: [], categories: [] })).not.toThrow()
  })
})

describe('bulk edit', () => {
  it('bulkUpdateTx patches only the given tx (occurrenceKey kept); empty categoryId clears it; bulkDeleteTx removes them', async () => {
    await mod.db.transactions.bulkPut([
      { id: 'u1', date: '2026-10-05', kind: 'expense', amount: 100, accountId: 'b', categoryId: 'food', occurrenceKey: 'p:0', createdAt: 1 },
      { id: 'u2', date: '2026-10-06', kind: 'expense', amount: 200, accountId: 'b', categoryId: 'food', createdAt: 2 },
      { id: 'u3', date: '2026-10-07', kind: 'expense', amount: 300, accountId: 'b', categoryId: 'food', createdAt: 3 },
    ])
    await actions.bulkUpdateTx(['u1', 'u2'], { accountId: 'card' })
    expect(await mod.db.transactions.get('u1')).toMatchObject({ accountId: 'card', occurrenceKey: 'p:0', categoryId: 'food' })
    expect(await mod.db.transactions.get('u2')).toMatchObject({ accountId: 'card' })
    expect(await mod.db.transactions.get('u3')).toMatchObject({ accountId: 'b' })
    await actions.bulkUpdateTx(['u2'], { categoryId: '' })
    expect('categoryId' in (await mod.db.transactions.get('u2'))!).toBe(false)
    await actions.bulkDeleteTx(['u1', 'u2'])
    expect((await mod.db.transactions.bulkGet(['u1', 'u2', 'u3'])).map((t) => t?.id)).toEqual([undefined, undefined, 'u3'])
  })

  it('withPlans also moves the linked plans to the new payment method (future occurrences), other plans untouched', async () => {
    const plans: Plan[] = [
      { id: 'bp', kind: 'recurring_expense', name: 'Elektrik', accountId: 'b', active: true, createdAt: 0, amount: 100, variable: true, frequency: 'monthly', startDate: '2026-10-01' },
      { id: 'op', kind: 'recurring_expense', name: 'Su', accountId: 'b', active: true, createdAt: 0, amount: 100, variable: true, frequency: 'monthly', startDate: '2026-10-01' },
    ]
    await mod.db.plans.bulkPut(plans)
    await mod.db.transactions.put({ id: 'w1', date: '2026-10-05', kind: 'expense', amount: 100, accountId: 'b', occurrenceKey: 'bp:0', createdAt: 1 })
    await actions.bulkUpdateTx(['w1'], { accountId: 'card' }, { withPlans: true })
    expect(await mod.db.plans.get('bp')).toMatchObject({ accountId: 'card' })
    expect(await mod.db.plans.get('op')).toMatchObject({ accountId: 'b' })
  })
})
