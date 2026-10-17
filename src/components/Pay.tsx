import { useState, type FormEvent, type ReactNode } from 'react'
import { formatMoney, parseMoney, todayISO, type Account, type CardStatement, type Occurrence, type Plan, type Snapshot } from '../domain'
import { lastAccountId, payCard, payOccurrence } from '../actions'
import { moneyToInput, fmtDate } from '../lib/format'
import { AccountSelect, Field, FormError, MoneyInput, Sheet } from './ui'

export type PayTarget =
  | { type: 'occurrence'; plan: Plan; occurrence: Occurrence }
  | { type: 'statement'; card: Account; statement: CardStatement }

/** Fixed-amount occurrences are paid in one tap; variable ones and card statements ask first. */
function needsSheet(t: PayTarget): boolean {
  if (t.type === 'statement') return true
  return t.plan.kind === 'recurring_expense' || t.plan.kind === 'recurring_income' ? t.plan.variable : false
}

/** Returns a `pay(target)` function plus the sheet element to render. */
export function usePay(snap: Snapshot): { pay: (t: PayTarget) => void; sheet: ReactNode } {
  const [target, setTarget] = useState<PayTarget | null>(null)
  const pay = (t: PayTarget) => {
    if (needsSheet(t) || t.type !== 'occurrence') return setTarget(t)
    void payOccurrence(t.plan, t.occurrence, t.occurrence.expected, t.plan.accountId, todayISO())
  }
  const sheet = target ? <PaySheet snap={snap} target={target} onClose={() => setTarget(null)} /> : null
  return { pay, sheet }
}

function PaySheet({ snap, target, onClose }: { snap: Snapshot; target: PayTarget; onClose: () => void }) {
  const isStmt = target.type === 'statement'
  const nonCards = snap.accounts.filter((a) => a.kind !== 'credit_card' && !a.archived)
  const [amount, setAmount] = useState(() =>
    moneyToInput(isStmt ? Math.max(0, target.statement.total - target.statement.paid) : target.occurrence.expected),
  )
  const [accountId, setAccountId] = useState(() =>
    isStmt ? (lastAccountId(nonCards) ?? '') : target.plan.accountId,
  )
  const [date, setDate] = useState(todayISO)
  const [err, setErr] = useState<string | null>(null)

  const title = isStmt ? `${target.card.name} ekstre ödemesi` : target.plan.name

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const k = parseMoney(amount)
    if (!k || k <= 0) return setErr('Geçerli bir tutar girin')
    if (!accountId) return setErr('Hesap seçin')
    if (isStmt) await payCard(target.card, accountId, k, date)
    else await payOccurrence(target.plan, target.occurrence, k, accountId, date)
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
          <div className="text-sm text-slate-500">Vade {fmtDate(target.occurrence.dueDate)}</div>
        )}
        <Field label="Tutar"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
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
            filter={isStmt ? (a) => a.kind !== 'credit_card' : undefined}
          />
        </Field>
        <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <FormError msg={err} />
        <button className="btn btn-primary w-full">Ödendi olarak kaydet</button>
      </form>
    </Sheet>
  )
}
