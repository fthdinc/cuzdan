import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMoney, suspectedCardPayments, todayISO, type Snapshot, type Transaction, type TxKind } from '../domain'
import { Amount, CategoryDot, CategorySelect, Empty, Field, PageHeader, Sheet } from '../components/ui'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { QuickAdd } from '../components/QuickAdd'
import { TxFormSheet } from '../components/TxForm'
import { PayMethodChips } from '../components/PayMethod'
import { bulkDeleteTx, bulkUpdateTx } from '../actions'
import { fmtDate, sortCategories, weekday } from '../lib/format'
import { readDismissedCardPayments } from '../lib/cardPayments'
import { MonthSwitcher } from '../components/MonthPicker'

export function TransactionsPage({ snap }: { snap: Snapshot }) {
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null)
  return (
    <div className="space-y-4">
      <PageHeader title="İşlemler" action={
        <div className="flex gap-2">
          <Link to="/ice-aktar" className="btn btn-soft">Ekstre içe aktar</Link>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ İşlem</button>
        </div>
      } />
      <ErrorBoundary>
        <QuickAdd snap={snap} />
      </ErrorBoundary>
      <ErrorBoundary>
        <TxList snap={snap} onEdit={setEditing} />
      </ErrorBoundary>
      {editing && <TxFormSheet snap={snap} tx={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

const KIND_FILTER: { value: '' | TxKind; label: string }[] = [
  { value: '', label: 'Tüm türler' },
  { value: 'expense', label: 'Gider' },
  { value: 'income', label: 'Gelir' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'adjustment', label: 'Düzeltme' },
]

/** Card payment: transfer from a bank/cash account to a credit card. */
function isCardPayment(t: Transaction, snap: Snapshot) {
  const kindOf = (id?: string) => snap.accounts.find((a) => a.id === id)?.kind
  return t.kind === 'transfer' && kindOf(t.accountId) !== 'credit_card' && kindOf(t.toAccountId) === 'credit_card'
}

/** Bulk edit: income / expense not linked to a personal debt. */
const selectable = (t: Transaction) => (t.kind === 'income' || t.kind === 'expense') && !t.debtId

function TxList({ snap, onEdit }: { snap: Snapshot; onEdit: (t: Transaction) => void }) {
  const today = todayISO()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [kind, setKind] = useState<'' | TxKind>('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<'method' | 'category' | null>(null)
  const exitSelect = () => { setSelecting(false); setSelected(new Set()); setBulk(null) }
  useEffect(() => {
    if (!selecting || bulk) return // an open sheet handles Escape itself
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSelecting(false); setSelected(new Set()) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting, bulk])

  const txMonths = new Set(snap.transactions.map((t) => t.date.slice(0, 7)))
  const dismissed = readDismissedCardPayments()
  const suspects = new Set(suspectedCardPayments(snap).map((t) => t.id).filter((id) => !dismissed.includes(id)))
  const list = snap.transactions
    .filter((t) => t.date.startsWith(month))
    .filter((t) => !accountId || t.accountId === accountId || t.toAccountId === accountId)
    .filter((t) => !categoryId || t.categoryId === categoryId)
    .filter((t) => !kind || t.kind === kind)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)

  const days = new Map<string, Transaction[]>()
  for (const t of list) days.set(t.date, [...(days.get(t.date) ?? []), t])

  // Debt-linked tx (elden borç / alacak) move balances but are not income or expense.
  const income = list.filter((t) => t.kind === 'income' && !t.debtId).reduce((s, t) => s + t.amount, 0)
  const expense = list.filter((t) => t.kind === 'expense' && !t.debtId).reduce((s, t) => s + t.amount, 0)
  // Hesaptan çıkan: expenses on bank/cash + card payments (as monthSummary.cashOut).
  const isCard = (id?: string) => snap.accounts.find((a) => a.id === id)?.kind === 'credit_card'
  const cashOut = list.filter((t) => (t.kind === 'expense' && !t.debtId && !isCard(t.accountId)) || isCardPayment(t, snap))
    .reduce((s, t) => s + t.amount, 0)
  const sel = 'rounded-lg border-0 bg-slate-100 px-2 py-1.5 text-xs font-medium dark:bg-slate-800'

  // Only rows still listed count as selected (month / filters may change while selecting).
  const chosen = list.filter((t) => selected.has(t.id) && selectable(t))
  const visible = list.filter(selectable)
  const allChosen = visible.length > 0 && chosen.length === visible.length
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const remove = async () => {
    if (!confirm(`${chosen.length} işlem silinsin mi?`)) return
    await bulkDeleteTx(chosen.map((t) => t.id))
    setSelected(new Set())
  }

  return (
    <div className="space-y-3">
      <MonthSwitcher month={month} onChange={setMonth} current={today.slice(0, 7)} hasData={(m) => txMonths.has(m)}>
        <div className="text-xs tabular-nums">
          <Amount value={income} tone="income" /> <span className="text-slate-400">/</span> <Amount value={-expense} tone="expense" />
        </div>
        {cashOut > 0 && <div className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">Hesaptan çıkan: {formatMoney(cashOut)}</div>}
      </MonthSwitcher>

      <div className="flex flex-wrap items-center gap-2">
        {snap.accounts.length > 1 && (
          <select className={sel} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Tüm hesaplar</option>
            {snap.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <select className={sel} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Tüm kategoriler</option>
          {sortCategories(snap.categories).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={sel} value={kind} onChange={(e) => setKind(e.target.value as '' | TxKind)}>
          {KIND_FILTER.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <button
          className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-medium ${selecting ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}
          aria-pressed={selecting} onClick={() => (selecting ? exitSelect() : setSelecting(true))}
        >
          {selecting ? 'Bitti' : 'Seç'}
        </button>
      </div>
      {selecting && (
        <div className="flex items-center justify-between gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
          <span>Gelir ve giderler seçilebilir</span>
          {visible.length > 0 && (
            <button className="font-medium text-indigo-600 dark:text-indigo-400" onClick={() => setSelected(allChosen ? new Set() : new Set(visible.map((t) => t.id)))}>
              {allChosen ? 'Seçimi kaldır' : 'Tümünü seç'}
            </button>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <div className="card"><Empty>Bu ay için işlem yok</Empty></div>
      ) : (
        [...days].map(([date, txs]) => (
          <div key={date} className="card overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
              {fmtDate(date, today)}, {weekday(date)}
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {txs.map((t) => (
                <TxRow
                  key={t.id} t={t} snap={snap} suspect={suspects.has(t.id)}
                  check={selecting ? (selectable(t) ? selected.has(t.id) : null) : undefined}
                  onClick={() => { if (!selecting) onEdit(t); else if (selectable(t)) toggle(t.id) }}
                />
              ))}
            </ul>
          </div>
        ))
      )}

      {selecting && (
        <>
          <div className="h-16" aria-hidden />
          {/* Above the mobile bottom nav; beside the sidebar on desktop. */}
          <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 px-4 md:bottom-4 md:left-60 md:px-8">
            <div className="mx-auto flex max-w-[44rem] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <span className="whitespace-nowrap pl-2 text-sm font-medium tabular-nums">{chosen.length} seçili</span>
              <div className="ml-auto flex gap-1.5">
                <button className="btn btn-soft btn-sm" disabled={!chosen.some((t) => t.kind === 'expense')} onClick={() => setBulk('method')}>Ödeme yöntemi</button>
                <button className="btn btn-soft btn-sm" disabled={!chosen.length} onClick={() => setBulk('category')}>Kategori</button>
                <button className="btn btn-danger btn-sm" disabled={!chosen.length} onClick={remove}>Sil</button>
              </div>
            </div>
          </div>
        </>
      )}
      {bulk === 'method' && <BulkMethodSheet snap={snap} txs={chosen.filter((t) => t.kind === 'expense')} onClose={() => setBulk(null)} />}
      {bulk === 'category' && <BulkCategorySheet snap={snap} txs={chosen} onClose={() => setBulk(null)} />}
    </div>
  )
}

/** Moves the selected expenses to another payment method (bank/cash or card). Plan links (occurrenceKey) are kept. */
function BulkMethodSheet({ snap, txs, onClose }: { snap: Snapshot; txs: Transaction[]; onClose: () => void }) {
  const [accountId, setAccountId] = useState('')
  const linked = new Set(txs.map((t) => t.occurrenceKey?.slice(0, t.occurrenceKey.lastIndexOf(':'))).filter(Boolean)).size
  const [withPlans, setWithPlans] = useState(true)
  const apply = async () => {
    await bulkUpdateTx(txs.map((t) => t.id), { accountId }, { withPlans })
    onClose()
  }
  return (
    <Sheet title="Ödeme yöntemi" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">Seçili {txs.length} gider bu yöntemle ödenmiş olarak güncellenir.</p>
        <PayMethodChips accounts={snap.accounts} value={accountId} onChange={setAccountId} />
        {linked > 0 && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={withPlans} onChange={(e) => setWithPlans(e.target.checked)} />
            <span>Bağlı {linked} fatura / düzenli giderin sonraki ödemeleri de bu yöntemle yapılsın</span>
          </label>
        )}
        <button className="btn btn-primary w-full" disabled={!accountId} onClick={apply}>Uygula</button>
      </div>
    </Sheet>
  )
}

/** Category for the selected tx of one kind (expense when any is selected, else income); the other kind is left alone. */
function BulkCategorySheet({ snap, txs, onClose }: { snap: Snapshot; txs: Transaction[]; onClose: () => void }) {
  const kind = txs.some((t) => t.kind === 'expense') ? 'expense' : 'income'
  const target = txs.filter((t) => t.kind === kind)
  const skipped = txs.length - target.length
  const [categoryId, setCategoryId] = useState<string | null>(null) // null: not chosen yet ('' = Kategorisiz)
  const apply = async () => {
    if (categoryId === null) return
    await bulkUpdateTx(target.map((t) => t.id), { categoryId })
    onClose()
  }
  return (
    <Sheet title="Kategori" onClose={onClose}>
      <div className="space-y-4">
        <Field
          label={`Seçili ${target.length} ${kind === 'expense' ? 'gider' : 'gelir'} için kategori`}
          hint={skipped > 0 ? `${skipped} gelir değişmez (gelir ve gider kategorileri ayrı)` : undefined}
        >
          <CategorySelect categories={snap.categories} kind={kind} value={categoryId ?? ''} onChange={setCategoryId} />
        </Field>
        <button className="btn btn-primary w-full" disabled={categoryId === null} onClick={apply}>Uygula</button>
      </div>
    </Sheet>
  )
}

/** check: undefined = not selecting; null = selecting but this row is not selectable; boolean = checkbox state. */
function TxRow({ t, snap, suspect, check, onClick }: {
  t: Transaction; snap: Snapshot; suspect: boolean; check?: boolean | null; onClick: () => void
}) {
  const acc = (id?: string) => snap.accounts.find((a) => a.id === id)?.name ?? '?'
  const cat = snap.categories.find((c) => c.id === t.categoryId)
  const debt = t.debtId ? snap.debts?.find((d) => d.id === t.debtId) : undefined
  // Income / expense: the description is the label (category below it); falls back to the category name.
  const described = !t.debtId && (t.kind === 'income' || t.kind === 'expense') && !!t.note
  const cardPayment = isCardPayment(t, snap)
  const title =
    t.debtId ? (debt?.direction === 'lent' ? 'Elden alacak' : 'Elden borç')
    : cardPayment ? 'Kart ödemesi'
    : t.kind === 'transfer' ? 'Transfer'
    : t.kind === 'adjustment' ? 'Bakiye düzeltme'
    : described ? t.note!.charAt(0).toLocaleUpperCase('tr-TR') + t.note!.slice(1)
    : cat?.name ?? 'Kategorisiz'
  const multiAccount = snap.accounts.filter((a) => !a.archived).length > 1
  const sub = [
    described ? cat?.name ?? 'Kategorisiz' : null,
    t.kind === 'transfer' ? `${acc(t.accountId)} → ${acc(t.toAccountId)}` : multiAccount ? acc(t.accountId) : null,
    // Card payment: the note after the accounts, unless it is just the default "<kart> ödemesi".
    cardPayment && t.note?.toLocaleLowerCase('tr-TR') !== `${acc(t.toAccountId)} ödemesi`.toLocaleLowerCase('tr-TR') ? t.note : null,
    t.occurrenceKey ? 'plan ödemesi' : null,
  ].filter(Boolean).join(' · ')
  const checkable = check !== undefined && check !== null
  return (
    <li>
      <button
        className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 ${check === null ? 'opacity-50' : ''} ${check ? 'bg-indigo-50/70 dark:bg-indigo-950/30' : ''}`}
        onClick={onClick} role={checkable ? 'checkbox' : undefined} aria-checked={checkable ? check : undefined}
      >
        {check !== undefined && (
          <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs ${
            check ? 'border-indigo-600 bg-indigo-600 text-white' : check === null ? 'border-transparent' : 'border-slate-300 dark:border-slate-600'
          }`}>{check && '✓'}</span>
        )}
        <CategoryDot color={t.debtId ? '#f59e0b' : t.kind === 'transfer' ? '#6366f1' : t.kind === 'adjustment' ? '#94a3b8' : cat?.color} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {suspect && (
              <svg viewBox="0 0 24 24" className="mr-1 inline h-4 w-4 -translate-y-px text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Kart ödemesi olabilir">
                <title>Kart ödemesi gibi görünüyor; gider sayılırsa harcamalar iki kez sayılır</title>
                <path d="M12 3l10 18H2L12 3zM12 10v5M12 18h.01" />
              </svg>
            )}
            {title}
            {t.note && !described && !cardPayment && <span className="font-normal text-slate-500"> · {t.note}</span>}
          </div>
          {sub && <div className="truncate text-xs text-slate-400">{sub}</div>}
        </div>
        {t.kind === 'income' ? <Amount value={t.amount} tone="income" signed className="text-sm font-semibold" />
          : t.kind === 'expense' || cardPayment ? <Amount value={-t.amount} tone="expense" signed className="text-sm font-semibold" />
          : t.kind === 'adjustment' ? <Amount value={t.amount} signed className="text-sm font-semibold" />
          : <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatMoney(t.amount)}</span>}
      </button>
    </li>
  )
}
