import { useState, type FormEvent } from 'react'
import { formatMoney, looksLikeCardPayment, matchCard, parseQuickEntry, todayISO, type ID, type Snapshot } from '../domain'
import { addTx, defaultPayMethod, lastAccountId } from '../actions'
import { relDay } from '../lib/format'
import { activeAccounts, isLiquid, payMethodLabel, pickAccount } from '../lib/accounts'
import { PayMethodChips } from './PayMethod'
import { AccountFormSheet } from './AccountForm'

/**
 * One-line entry: "120 market", "+45000 maaş", "350,50 benzin dün". Expenses are paid with a card named in the text
 * ("120 market axess"), else the chip picked, else the method last used for the category. A text that looks like a card
 * payment ("30000 axess ödemesi") is saved as a transfer to that card when a card exists.
 */
export function QuickAdd({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<ID | null>(null)
  const [addingCard, setAddingCard] = useState(false)
  const entry = text.trim() ? parseQuickEntry(text, snap.categories, today) : null
  const cat = entry?.categoryId ? snap.categories.find((c) => c.id === entry.categoryId) : undefined
  const accounts = activeAccounts(snap.accounts)
  const cards = accounts.filter((a) => a.kind === 'credit_card')
  const income = entry?.kind === 'income'
  const textCard = entry ? matchCard(entry.note, cards) : undefined
  // Card payment: transfer from bank/cash to the named (or first) card.
  const payCard = entry && !income && cards.length > 0 && looksLikeCardPayment(entry.note, entry.categoryId, snap) ? textCard ?? cards[0] : undefined
  const pickedOk = picked && accounts.some((a) => a.id === picked) ? picked : null
  const accountId = income || payCard
    ? pickAccount(snap.accounts, pickedOk ?? lastAccountId(snap.accounts) ?? '', isLiquid)
    : pickedOk ?? textCard?.id ?? defaultPayMethod(snap.accounts, entry?.categoryId) ?? ''
  const account = accounts.find((a) => a.id === accountId)
  const liquidCount = accounts.filter(isLiquid).length
  const showChips = income || payCard ? liquidCount > 1 : true

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!entry || !accountId) return
    // Clear before the async write so text typed meanwhile is not wiped afterwards.
    setText('')
    setPicked(null)
    await addTx(payCard
      ? { date: entry.date, kind: 'transfer', amount: entry.amount, accountId, toAccountId: payCard.id, note: entry.note || undefined }
      : { date: entry.date, kind: entry.kind, amount: entry.amount, accountId, categoryId: entry.categoryId, note: entry.note || undefined })
  }

  const method = account && (account.kind === 'credit_card' || liquidCount > 1) ? payMethodLabel(account, snap.accounts) : null
  return (
    <>
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
        {showChips && (
          <div className="mt-2">
            <PayMethodChips
              accounts={snap.accounts} value={accountId} onChange={setPicked} size="sm"
              show={income || payCard ? 'liquid' : 'all'} onAddCard={income || payCard ? undefined : () => setAddingCard(true)}
            />
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
          {entry ? (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${
                payCard ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                : entry.kind === 'income'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
              }`}
            >
              {(payCard
                ? ['Kart ödemesi', formatMoney(entry.amount), `→ ${payCard.name}`, relDay(entry.date, today)]
                : [entry.kind === 'income' ? 'Gelir' : 'Gider', formatMoney(entry.amount), cat?.name ?? 'Kategorisiz', method, relDay(entry.date, today)]
              ).filter(Boolean).join(' · ')}
              {entry.note && <span className="opacity-70"> · "{entry.note}"</span>}
            </span>
          ) : text.trim() ? (
            <span className="text-xs text-slate-400">Tutar bulunamadı</span>
          ) : null}
        </div>
        {payCard && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Kart ödemesi gider sayılmaz; harcamalar karta girildiğinde sayılır.</div>}
        {entry && account && entry.date < account.openingDate && (
          <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">Bu tarih hesabın açılış bakiyesinden önce; bakiyeye etki etmez.</div>
        )}
      </form>
      {/* Outside the form: the card form is a form of its own. */}
      {addingCard && <AccountFormSheet quickCard onSaved={setPicked} onClose={() => setAddingCard(false)} />}
    </>
  )
}
