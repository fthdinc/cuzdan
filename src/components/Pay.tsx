import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { formatMoney, parseMoney, todayISO, type Account, type CardStatement, type Occurrence, type Plan, type Snapshot } from '../domain'
import { lastAccountId, payCard, payOccurrence } from '../actions'
import { moneyToInput, fmtDate } from '../lib/format'
import { AccountSelect, Field, FormError, MoneyInput, Sheet } from './ui'

export type PayTarget =
  | { type: 'occurrence'; plan: Plan; occurrence: Occurrence }
  | { type: 'statement'; card: Account; statement: CardStatement }

/** Fixed-amount occurrences are paid in one tap; variable / autopay-pending ones and card statements ask first. */
function needsSheet(t: PayTarget): boolean {
  if (t.type === 'statement' || t.occurrence.status === 'autopay_pending') return true
  return t.plan.kind === 'recurring_expense' || t.plan.kind === 'recurring_income' ? t.plan.variable : false
}

/** `id` if it is an active account passing `filter`, otherwise the first such account (or ''). */
function eligibleAccount(accounts: Account[], id: string, filter?: (a: Account) => boolean): string {
  const list = accounts.filter((a) => !a.archived && (!filter || filter(a)))
  return list.some((a) => a.id === id) ? id : (list[0]?.id ?? '')
}

/**
 * Returns a `pay(target)` function, the sheet element to render, and `busy`:
 * the occurrence key of a one-tap payment being saved (disable its button meanwhile).
 */
export function usePay(snap: Snapshot): { pay: (t: PayTarget) => void; sheet: ReactNode; busy: string | null } {
  const [target, setTarget] = useState<PayTarget | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const inFlight = useRef(new Set<string>())
  const pay = (t: PayTarget) => {
    if (needsSheet(t) || t.type !== 'occurrence') return setTarget(t)
    const key = t.occurrence.key
    if (inFlight.current.has(key)) return
    const accountId = eligibleAccount(snap.accounts, t.plan.accountId)
    if (!accountId) return setTarget(t)
    inFlight.current.add(key)
    setBusy(key)
    void payOccurrence(t.plan, t.occurrence, t.occurrence.expected, accountId, todayISO()).finally(() => {
      inFlight.current.delete(key)
      setBusy((b) => (b === key ? null : b))
    })
  }
  const sheet = target ? <PaySheet snap={snap} target={target} onClose={() => setTarget(null)} /> : null
  return { pay, sheet, busy }
}

function PaySheet({ snap, target, onClose }: { snap: Snapshot; target: PayTarget; onClose: () => void }) {
  const isStmt = target.type === 'statement'
  // Autopay: the bank already charged it on the due date; ask for the real amount (estimate only as a hint).
  const autopay = !isStmt && target.occurrence.status === 'autopay_pending'
  const nonCards = snap.accounts.filter((a) => a.kind !== 'credit_card' && !a.archived)
  const [amount, setAmount] = useState(() =>
    autopay ? '' : moneyToInput(isStmt ? Math.max(0, target.statement.total - target.statement.paid) : target.occurrence.expected),
  )
  const accFilter = isStmt ? (a: Account) => a.kind !== 'credit_card' : undefined
  const [accountId, setAccountId] = useState(() =>
    isStmt ? (lastAccountId(nonCards) ?? '') : eligibleAccount(snap.accounts, target.plan.accountId),
  )
  const [date, setDate] = useState(() => (autopay ? target.occurrence.dueDate : todayISO()))
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const title = isStmt ? `${target.card.name} ekstre ödemesi` : target.plan.name

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const k = parseMoney(amount)
    if (!k || k <= 0) return setErr('Geçerli bir tutar girin')
    // An archived account may still be the stored value; fall back to the first eligible one.
    const accId = eligibleAccount(snap.accounts, accountId, accFilter)
    if (!accId) return setErr('Hesap seçin')
    if (saving) return
    setSaving(true)
    try {
      if (isStmt) await payCard(target.card, accId, k, date)
      else await payOccurrence(target.plan, target.occurrence, k, accId, date)
    } finally {
      setSaving(false)
    }
    onClose()
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        {isStmt ? (
          <div className="text-sm text-slate-500">
            Son ödeme {fmtDate(target.statement.dueDate)} · Asgari{' '}
            <span className="tabular-nums">{formatMoney(target.statement.minPayment)}</span>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            Vade {fmtDate(target.occurrence.dueDate)}
            {autopay && <> · Otomatik ödeme talimatıyla ödendi. Bankanın kestiği tutarı girin (SMS / ekstre).</>}
          </div>
        )}
        <Field label="Tutar" hint={autopay ? `Tahmini ${formatMoney(target.occurrence.expected)}` : undefined}>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        {isStmt && (
          <div className="flex gap-2">
            <button type="button" className="chip" onClick={() => setAmount(moneyToInput(target.statement.minPayment))}>Asgari</button>
            <button type="button" className="chip" onClick={() => setAmount(moneyToInput(Math.max(0, target.statement.total - target.statement.paid)))}>Tamamı</button>
          </div>
        )}
        <Field label={!isStmt && target.plan.kind === 'recurring_income' ? 'Yatan hesap' : 'Ödenen hesap'}>
          <AccountSelect
            accounts={snap.accounts}
            value={accountId}
            onChange={setAccountId}
            filter={accFilter}
          />
        </Field>
        <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <FormError msg={err} />
        <button className="btn btn-primary w-full" disabled={saving}>Ödendi olarak kaydet</button>
      </form>
    </Sheet>
  )
}
