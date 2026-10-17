import { useRef, useState, type FormEvent } from 'react'
import {
  accountBalance, formatMoney, todayISO,
  type Account, type Category, type Snapshot,
} from '../domain'
import { addTx, removeAccount, saveAccount } from '../actions'
import { db, exportBackup, importBackup, newId } from '../db'
import { parseSigned, sortCategories } from '../lib/format'
import { AccountFormSheet } from '../components/AccountForm'
import { AccountSelect, Amount, CategoryDot, Empty, Field, FormError, MoneyInput, PageHeader, Section, Segmented, Sheet } from '../components/ui'

const KIND_LABEL = { cash: 'Nakit', bank: 'Banka', credit_card: 'Kredi kartı' }

export function SettingsPage({ snap }: { snap: Snapshot }) {
  return (
    <div className="space-y-4">
      <PageHeader title="Ayarlar" />
      <Section title="Hesaplar"><Accounts snap={snap} /></Section>
      {snap.accounts.some((a) => !a.archived) && <Section title="Bakiye düzelt"><Adjust snap={snap} /></Section>}
      <Section title="Kategoriler"><Categories snap={snap} /></Section>
      <Section title="Yedek"><Backup /></Section>
    </div>
  )
}

function Accounts({ snap }: { snap: Snapshot }) {
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const sorted = [...snap.accounts].sort((a, b) => Number(!!a.archived) - Number(!!b.archived))

  const remove = async (a: Account) => {
    if (!confirm(`"${a.name}" silinsin mi? İşlemi olan hesaplar arşivlenir.`)) return
    const r = await removeAccount(a.id)
    if (r === 'archived') alert('Hesabın işlemleri olduğu için arşivlendi.')
  }

  return (
    <>
      {sorted.length === 0 ? <Empty>Hesap yok</Empty> : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {sorted.map((a) => (
            <li key={a.id} className={`flex items-center gap-2 py-2.5 ${a.archived ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{a.name}</div>
                <div className="text-xs text-slate-400">
                  {KIND_LABEL[a.kind]}
                  {a.card && ` · limit ${formatMoney(a.card.limit)} · kesim ${a.card.statementDay}`}
                  {a.archived && ' · arşivde'}
                </div>
              </div>
              {a.archived ? (
                <button className="btn btn-ghost btn-sm" onClick={() => saveAccount({ ...a, archived: false })}>Geri al</button>
              ) : (
                <>
                  <button className="btn btn-soft btn-sm" onClick={() => setEditing(a)}>Düzenle</button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(a)}>Sil</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <button className="btn btn-primary mt-3" onClick={() => setEditing('new')}>+ Hesap ekle</button>
      {editing && <AccountFormSheet account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/** Reconcile: enter the real balance, the difference becomes an adjustment tx. */
function Adjust({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const active = snap.accounts.filter((a) => !a.archived)
  const [accountId, setAccountId] = useState(active[0]?.id ?? '')
  const [real, setReal] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const acc = active.find((a) => a.id === accountId)
  if (!acc) return null
  const isCard = acc.kind === 'credit_card'
  const current = accountBalance(acc, snap, today)
  const entered = real.trim() ? parseSigned(real) : null
  const target = entered === null ? null : isCard ? -entered : entered
  const diff = target === null ? null : target - current

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (diff === null) return setErr('Geçerli bir tutar girin')
    setErr(null)
    if (diff === 0) return setMsg('Bakiye zaten doğru.')
    await addTx({ date: today, kind: 'adjustment', amount: diff, accountId, note: 'Bakiye düzeltme' })
    setReal('')
    setMsg(`${formatMoney(diff, { signed: true })} düzeltme eklendi.`)
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hesap"><AccountSelect accounts={snap.accounts} value={accountId} onChange={(v) => { setAccountId(v); setMsg(null) }} /></Field>
        <Field label={isCard ? 'Gerçek borç' : 'Gerçek bakiye'}><MoneyInput value={real} onChange={setReal} /></Field>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span className="text-slate-500">Uygulamadaki: <Amount value={current} /></span>
        {diff !== null && <span>Fark: <Amount value={diff} signed /></span>}
      </div>
      <FormError msg={err} />
      {msg && <div className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</div>}
      <button className="btn btn-primary" disabled={diff === null}>Düzeltme ekle</button>
    </form>
  )
}

function Categories({ snap }: { snap: Snapshot }) {
  const [kind, setKind] = useState<'expense' | 'income'>('expense')
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const list = sortCategories(snap.categories.filter((c) => c.kind === kind))

  const remove = async (c: Category) => {
    const used = snap.transactions.some((t) => t.categoryId === c.id) || snap.plans.some((p) => p.categoryId === c.id)
    if (!confirm(`"${c.name}" silinsin mi?${used ? ' Bu kategorideki kayıtlar kategorisiz görünecek.' : ''}`)) return
    await db.categories.delete(c.id)
  }

  return (
    <>
      <Segmented options={[{ value: 'expense', label: 'Gider' }, { value: 'income', label: 'Gelir' }]} value={kind} onChange={setKind} />
      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2">
            <CategoryDot color={c.color} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{c.name}</div>
              {!!c.keywords?.length && <div className="truncate text-xs text-slate-400">{c.keywords.join(', ')}</div>}
            </div>
            <button className="btn btn-soft btn-sm" onClick={() => setEditing(c)}>Düzenle</button>
            <button className="btn btn-danger btn-sm" onClick={() => remove(c)}>Sil</button>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary mt-3" onClick={() => setEditing('new')}>+ Kategori ekle</button>
      {editing && <CategorySheet kind={kind} category={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function CategorySheet({ kind, category, onClose }: { kind: 'expense' | 'income'; category?: Category; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? '')
  const [color, setColor] = useState(category?.color ?? '#6366f1')
  const [keywords, setKeywords] = useState(category?.keywords?.join(', ') ?? '')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await db.categories.put({
      id: category?.id ?? newId(),
      name: name.trim(),
      kind: category?.kind ?? kind,
      color,
      keywords: keywords.split(',').map((k) => k.trim().toLocaleLowerCase('tr')).filter(Boolean),
    })
    onClose()
  }
  return (
    <Sheet title={category ? 'Kategoriyi düzenle' : 'Yeni kategori'} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <div className="flex gap-3">
          <Field label="Ad"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="Renk"><input type="color" className="h-10 w-14 cursor-pointer rounded-xl border border-slate-200 bg-transparent dark:border-slate-700" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
        </div>
        <Field label="Anahtar kelimeler" hint="Virgülle ayırın. Hızlı ekle bu kelimelerle kategori önerir.">
          <input className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="ör. migros, bim, a101" />
        </Field>
        <button className="btn btn-primary w-full">Kaydet</button>
      </form>
    </Sheet>
  )
}

function Backup() {
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const download = async () => {
    const data = await exportBackup()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cuzdan-yedek-${data.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const restore = async (f: File) => {
    setMsg(null)
    setErr(null)
    try {
      const data = JSON.parse(await f.text())
      if (!confirm('Mevcut tüm veriler silinip yedekteki verilerle değiştirilecek. Devam edilsin mi?')) return
      await importBackup(data)
      setMsg('Yedek yüklendi.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Yedek okunamadı')
    } finally {
      if (file.current) file.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Veriler yalnızca bu cihazda saklanır. Düzenli olarak yedek alın.</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={download}>Yedek indir (JSON)</button>
        <button className="btn btn-soft" onClick={() => file.current?.click()}>Yedekten geri yükle</button>
        <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
      </div>
      <FormError msg={err} />
      {msg && <div className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</div>}
    </div>
  )
}
