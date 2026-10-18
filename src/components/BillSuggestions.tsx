import { useState } from 'react'
import { billSuggestions, buildBillSuggestion, formatMoney, todayISO, type BillSuggestion, type ID, type Snapshot } from '../domain'
import { applyBillSuggestion } from '../actions'
import { newId } from '../db'
import { monthName } from '../lib/format'
import { BillIcon } from './BillIcon'

// Expenses the user chose to leave out of Faturalar ("Yoksay"). Per device; new expenses of the same bill show again.
const IGNORED = 'cuzdan.ignoredBillSuggestions'
function readIgnored(): ID[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(IGNORED) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is ID => typeof x === 'string') : []
  } catch { return [] }
}

/** "Giderlerinde N düzenli ödeme bulundu": past expenses that look like bills, to track or link in one tap. */
export function BillSuggestions({ snap }: { snap: Snapshot }) {
  const [ignored, setIgnored] = useState(readIgnored)
  const [busy, setBusy] = useState(false)
  const list = billSuggestions(snap, todayISO(), ignored)
  if (!list.length) return null

  const take = async (items: BillSuggestion[]) => {
    if (busy) return
    setBusy(true)
    try {
      for (const s of items) await applyBillSuggestion(buildBillSuggestion(s, snap.accounts, snap.categories, { id: newId(), now: Date.now() }))
    } finally {
      setBusy(false)
    }
  }
  const ignore = (s: BillSuggestion) => {
    const next = [...ignored, ...s.items.map((i) => i.tx.id)]
    setIgnored(next)
    try { localStorage.setItem(IGNORED, JSON.stringify(next)) } catch { /* ignore */ }
  }

  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Giderlerinde {list.length} düzenli ödeme bulundu</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Takibe alınca her ay ödendi / bekliyor durumu ve tahmini tutar burada görünür.</p>
        </div>
        {list.length > 1 && (
          <button className="btn btn-soft btn-sm shrink-0" disabled={busy} onClick={() => take(list)}>Tümünü takibe al</button>
        )}
      </div>
      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        {list.map((s) => (
          <li key={s.key} className="py-3">
            <div className="flex items-center gap-3">
              <BillIcon type={s.type} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {s.items.map((i) => `${monthName(i.tx.date)} ${formatMoney(i.tx.amount)}`).join(' · ')}
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button className="btn btn-sm text-slate-500" disabled={busy} onClick={() => ignore(s)}>Yoksay</button>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => take([s])}>
                {s.planId ? `${s.name} faturasına bağla` : 'Takibe al'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
