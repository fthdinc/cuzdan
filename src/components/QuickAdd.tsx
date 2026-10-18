import { useState, type FormEvent, type ReactNode } from 'react'
import { formatMoney, looksLikeCardPayment, matchCard, matchExpenseToBill, parseQuickEntry, todayISO, type ID, type Snapshot } from '../domain'
import { addExpenseForBill, addTx, defaultPayMethod, lastAccountId } from '../actions'
import { monthName, relDay } from '../lib/format'
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
  // Faturalar: settle the matched bill occurrence / start tracking a monthly bill (null = default).
  const [link, setLink] = useState(true)
  const [track, setTrack] = useState<boolean | null>(null)
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
  const billMatch = entry && !income && !payCard && entry.note
    ? matchExpenseToBill({ note: entry.note, categoryId: entry.categoryId, date: entry.date, accountId }, snap, today)
    : null
  const tracking = track ?? (billMatch?.kind === 'propose' && billMatch.strong)
  const canTrack = !!entry?.note && billMatch?.kind !== 'link' && billMatch?.kind !== 'already_paid'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!entry || !accountId) return
    // Clear before the async write so text typed meanwhile is not wiped afterwards.
    setText('')
    setPicked(null)
    setLink(true)
    setTrack(null)
    if (payCard) await addTx({ date: entry.date, kind: 'transfer', amount: entry.amount, accountId, toAccountId: payCard.id, note: entry.note || undefined })
    else {
      const draft = { date: entry.date, kind: entry.kind, amount: entry.amount, accountId, categoryId: entry.categoryId, note: entry.note || undefined }
      if (income) await addTx(draft)
      else await addExpenseForBill(draft, billMatch, { link, track: canTrack && tracking, accounts: snap.accounts, categories: snap.categories })
    }
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
          {billMatch?.kind === 'link' ? (
            <Toggle on={link} onClick={() => setLink(!link)} title="Faturalar'da bu ayı ödendi işaretle">
              ✓ {billMatch.planName} ({monthName(billMatch.dueDate)})
            </Toggle>
          ) : billMatch?.kind === 'already_paid' ? (
            <span className="text-xs text-slate-400">{billMatch.planName} ({monthName(billMatch.dueDate)}) zaten ödendi</span>
          ) : entry && !income && !payCard && canTrack ? (
            <Toggle on={tracking} onClick={() => setTrack(!tracking)} title="Faturalar'da her ay takip et">↻ Her ay takip</Toggle>
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

function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button" aria-pressed={on} title={title} onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
        on ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
        : 'border border-dashed border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400'
      }`}
    >
      {children}
    </button>
  )
}
