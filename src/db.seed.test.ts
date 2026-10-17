import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeAll, describe, expect, it } from 'vitest'

// Separate file = fresh fake-indexeddb: the app DB is created empty here (first run).
let mod: typeof import('./db')
beforeAll(async () => {
  mod = await import('./db')
  await mod.db.open()
})

describe('default account seeding', () => {
  it('first run creates exactly one default bank account', async () => {
    const accounts = await mod.db.accounts.toArray()
    expect(accounts).toMatchObject([{ name: 'Ana hesap', kind: 'bank', openingBalance: 0, openingDate: '2000-01-01' }])
    expect(accounts[0].archived).toBeUndefined()
    expect(await mod.db.categories.count()).toBeGreaterThan(0)
  })

  it('is idempotent across reopen and repeated calls', async () => {
    mod.db.close()
    await mod.db.open()
    await mod.ensureDefaultAccount()
    expect(await mod.db.accounts.count()).toBe(1)
  })

  it('adds nothing when only archived accounts exist', async () => {
    await mod.db.accounts.clear()
    await mod.db.accounts.add({ id: 'old', name: 'Eski', kind: 'cash', openingBalance: 0, openingDate: '2026-01-01', archived: true })
    await mod.ensureDefaultAccount()
    expect((await mod.db.accounts.toArray()).map((a) => a.id)).toEqual(['old'])
  })

  it('works on another Dexie instance (vipDb during open)', async () => {
    const other = new Dexie('seed-other')
    other.version(1).stores({ accounts: 'id' })
    await mod.ensureDefaultAccount(other)
    expect(await other.table('accounts').count()).toBe(1)
    other.close()
  })
})
