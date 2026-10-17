import { useEffect, useState, type FormEvent } from 'react'
import { formatMoney, parseQuickEntry, todayISO, type Snapshot } from '../domain'
import { addTx, lastAccountId } from '../actions'
import { relDay } from '../lib/format'

/** One-line entry: "120 market", "+45000 maaş", "350,50 benzin dün". */
export function QuickAdd({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const [text, setText] = useState('')
  const [accountId, setAccountId] = useState(() => lastAccountId(snap.accounts) ?? '')
  const entry = text.trim() ? parseQuickEntry(text, snap.categories, today) : null
  const cat = entry?.categoryId ? snap.categories.find((c) => c.id === entry.categoryId) : undefined
  const accounts = snap.accounts.filter((a) => !a.archived)
  const account = accounts.find((a) => a.id === accountId)

  // Re-validate when accounts change (e.g. the selected one was archived).
  useEffect(() => {
    if (!account) setAccountId(lastAccountId(snap.accounts) ?? '')
  }, [account, snap.accounts])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const accId = account?.id ?? accounts[0]?.id
    if (!entry || !accId) return
    // Clear before the async write so text typed meanwhile is not wiped afterwards.
    setText('')
    await addTx({
      date: entry.date,
      kind: entry.kind,
      amount: entry.amount,
      accountId: accId,
      categoryId: entry.categoryId,
      note: entry.note || undefined,
    })
  }

  return (
    <form onSubmit={submit} className="card p-3">
      <div className="flex gap-2">
        <input
          className="input flex-1 text-base"
          placeholder="Hızlı ekle: 120 market, +45000 maaş, 350,50 benzin dün"
          value={text}
          onChange={(e) => setText(e.target.value)}
          enterKeyHint="done"
          autoComplete="off"
        />
        <button className="btn btn-primary shrink-0" disabled={!entry || !accountId}>Ekle</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
        {/* Only one account (the default): nothing to choose. */}
        {accounts.length > 1 && (
          <select
            className="rounded-lg border-0 bg-slate-100 px-2 py-1 text-xs font-medium dark:bg-slate-800"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            aria-label="Hesap"
          >
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {entry ? (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${
              entry.kind === 'income'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
            }`}
          >
            {[
              entry.kind === 'income' ? 'Gelir' : 'Gider',
              formatMoney(entry.amount),
              cat?.name ?? 'Kategorisiz',
              relDay(entry.date, today),
            ].join(' · ')}
            {entry.note && <span className="opacity-70"> · "{entry.note}"</span>}
          </span>
        ) : text.trim() ? (
          <span className="text-xs text-slate-400">Tutar bulunamadı</span>
        ) : null}
      </div>
      {entry && account && entry.date < account.openingDate && (
        <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">Bu tarih hesabın açılış bakiyesinden önce; bakiyeye etki etmez.</div>
      )}
    </form>
  )
}
