import { useState } from 'react'
import { formatMoney, todayISO, type Snapshot, type Transaction, type TxKind } from '../domain'
import { Amount, CategoryDot, Empty, PageHeader } from '../components/ui'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { QuickAdd } from '../components/QuickAdd'
import { TxFormSheet } from '../components/TxForm'
import { fmtDate, monthLabel, shiftMonth, sortCategories, weekday } from '../lib/format'

export function TransactionsPage({ snap }: { snap: Snapshot }) {
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null)
  return (
    <div className="space-y-4">
      <PageHeader title="İşlemler" action={<button className="btn btn-primary" onClick={() => setEditing('new')}>+ İşlem</button>} />
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

function TxList({ snap, onEdit }: { snap: Snapshot; onEdit: (t: Transaction) => void }) {
  const today = todayISO()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [kind, setKind] = useState<'' | TxKind>('')

  const list = snap.transactions
    .filter((t) => t.date.startsWith(month))
    .filter((t) => !accountId || t.accountId === accountId || t.toAccountId === accountId)
    .filter((t) => !categoryId || t.categoryId === categoryId)
    .filter((t) => !kind || t.kind === kind)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)

  const days = new Map<string, Transaction[]>()
  for (const t of list) days.set(t.date, [...(days.get(t.date) ?? []), t])

  const income = list.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0)
  const expense = list.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount, 0)
  const sel = 'rounded-lg border-0 bg-slate-100 px-2 py-1.5 text-xs font-medium dark:bg-slate-800'

  return (
    <div className="space-y-3">
      <div className="card flex items-center justify-between p-2">
        <button className="btn btn-ghost px-3" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Önceki ay">‹</button>
        <div className="text-center">
          <div className="font-semibold">{monthLabel(month)}</div>
          <div className="text-xs tabular-nums">
            <Amount value={income} tone="income" /> <span className="text-slate-400">/</span> <Amount value={-expense} tone="expense" />
          </div>
        </div>
        <button className="btn btn-ghost px-3" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Sonraki ay">›</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select className={sel} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Tüm hesaplar</option>
          {snap.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className={sel} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Tüm kategoriler</option>
          {sortCategories(snap.categories).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={sel} value={kind} onChange={(e) => setKind(e.target.value as '' | TxKind)}>
          {KIND_FILTER.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>

      {list.length === 0 ? (
        <div className="card"><Empty>Bu ay için işlem yok</Empty></div>
      ) : (
        [...days].map(([date, txs]) => (
          <div key={date} className="card overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
              {fmtDate(date, today)}, {weekday(date)}
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {txs.map((t) => <TxRow key={t.id} t={t} snap={snap} onClick={() => onEdit(t)} />)}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}

function TxRow({ t, snap, onClick }: { t: Transaction; snap: Snapshot; onClick: () => void }) {
  const acc = (id?: string) => snap.accounts.find((a) => a.id === id)?.name ?? '?'
  const cat = snap.categories.find((c) => c.id === t.categoryId)
  const title =
    t.kind === 'transfer' ? 'Transfer'
    : t.kind === 'adjustment' ? 'Bakiye düzeltme'
    : cat?.name ?? 'Kategorisiz'
  const sub = t.kind === 'transfer' ? `${acc(t.accountId)} → ${acc(t.toAccountId)}` : acc(t.accountId)
  return (
    <li>
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={onClick}>
        <CategoryDot color={t.kind === 'transfer' ? '#6366f1' : t.kind === 'adjustment' ? '#94a3b8' : cat?.color} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {title}
            {t.note && <span className="font-normal text-slate-500"> · {t.note}</span>}
          </div>
          <div className="truncate text-xs text-slate-400">
            {sub}
            {t.occurrenceKey && ' · plan ödemesi'}
          </div>
        </div>
        {t.kind === 'income' ? <Amount value={t.amount} tone="income" signed className="text-sm font-semibold" />
          : t.kind === 'expense' ? <Amount value={-t.amount} tone="expense" signed className="text-sm font-semibold" />
          : t.kind === 'adjustment' ? <Amount value={t.amount} signed className="text-sm font-semibold" />
          : <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatMoney(t.amount)}</span>}
      </button>
    </li>
  )
}
