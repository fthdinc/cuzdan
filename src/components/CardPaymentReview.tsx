import { useState } from 'react'
import { cardPaymentTransfer, suspectedCardPayments, todayISO, type ID, type Snapshot, type Transaction } from '../domain'
import { convertToCardPayment } from '../actions'
import { fmtDate } from '../lib/format'
import { activeAccounts } from '../lib/accounts'
import { dismissCardPayments, readDismissedCardPayments } from '../lib/cardPayments'
import { Amount, Sheet } from './ui'
import { PayMethodChips } from './PayMethod'
import { AccountFormSheet } from './AccountForm'

/** Özet: amber notice for expenses that look like card payments (double counted), with a review sheet to fix them. */
export function CardPaymentNotice({ snap }: { snap: Snapshot }) {
  const [dismissed, setDismissed] = useState(readDismissedCardPayments)
  const [open, setOpen] = useState(false)
  const list = suspectedCardPayments(snap).filter((t) => !dismissed.includes(t.id))
  if (!list.length) return null
  const keep = (ids: ID[]) => setDismissed(dismissCardPayments(ids))
  return (
    <>
      <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            {list.length} gider kart ödemesi gibi görünüyor; gider olarak sayılırsa harcamaların iki kez sayılır.
          </span>
          <button className="-mr-1 -mt-1 px-1.5 text-amber-700 dark:text-amber-300" onClick={() => keep(list.map((t) => t.id))} aria-label="Uyarıyı kapat">✕</button>
        </div>
        <button className="btn btn-sm mt-2 bg-amber-600 text-white hover:bg-amber-500" onClick={() => setOpen(true)}>İncele</button>
      </div>
      {open && (
        <Sheet title="Kart ödemesi olabilecek giderler" onClose={() => setOpen(false)}>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Kart ödemesi gider sayılmaz; harcamalar karta girildiğinde sayılır. Kart ödemesine çevrilen kayıt, aynı tarih ve
            tutarla hesabından karta transfer olur.
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((t) => <SuspectRow key={t.id} t={t} snap={snap} onKeep={() => keep([t.id])} />)}
          </ul>
        </Sheet>
      )}
    </>
  )
}

function SuspectRow({ t, snap, onKeep }: { t: Transaction; snap: Snapshot; onKeep: () => void }) {
  const cards = activeAccounts(snap.accounts, (a) => a.kind === 'credit_card')
  const transfer = cardPaymentTransfer(t, snap)
  const [cardId, setCardId] = useState<ID>(() => transfer?.toAccountId ?? '')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const target = cards.find((c) => c.id === cardId)
  const cat = snap.categories.find((c) => c.id === t.categoryId)
  const acc = snap.accounts.find((a) => a.id === t.accountId)
  const convert = async () => {
    if (!target || !transfer || busy) return
    setBusy(true)
    try { await convertToCardPayment(t, transfer.accountId, target.id) } finally { setBusy(false) }
  }
  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{t.note || cat?.name || 'Kategorisiz'}</div>
          <div className="truncate text-xs text-slate-400">
            {[fmtDate(t.date, todayISO()), t.note ? cat?.name : null, acc?.name].filter(Boolean).join(' · ')}
          </div>
        </div>
        <Amount value={-t.amount} tone="expense" signed className="text-sm font-semibold" />
      </div>
      {cards.length > 1 && <PayMethodChips accounts={snap.accounts} value={cardId} onChange={setCardId} show="cards" size="sm" />}
      <div className="flex flex-wrap gap-2">
        {target
          ? <button className="btn btn-primary btn-sm" disabled={busy} onClick={convert}>Kart ödemesine çevir{cards.length === 1 ? ` (${target.name})` : ''}</button>
          : <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>+ Kart ekle</button>}
        <button className="btn btn-soft btn-sm" onClick={onKeep}>Gider olarak kalsın</button>
      </div>
      {adding && <AccountFormSheet quickCard onSaved={setCardId} onClose={() => setAdding(false)} />}
    </li>
  )
}
