import { useState, type FormEvent } from 'react'
import {
  debtStatus, formatMoney, parseMoney, todayISO,
  type DebtDirection, type PersonalDebt, type Snapshot,
} from '../domain'
import { deleteDebt, deleteTx, lastAccountId, payDebt, saveDebt } from '../actions'
import { newId } from '../db'
import { fmtDate, moneyToInput } from '../lib/format'
import { AccountSelect, Amount, Empty, Field, FormError, MoneyInput, ProgressBar, Segmented, Sheet } from './ui'

const DIRECTIONS: { value: DebtDirection; label: string }[] = [
  { value: 'borrowed', label: 'Borç aldım' },
  { value: 'lent', label: 'Borç verdim' },
]

const OverdueBadge = () => (
  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">Gecikti</span>
)

/** Planlar → "Borç / Alacak": personal debts (red) and receivables (green); open ones first. */
export function DebtsList({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = (snap.debts ?? []).map((d) => ({ d, st: debtStatus(d, snap, today) }))
    .sort((a, b) => Number(a.st.done) - Number(b.st.done) || (a.d.dueDate ?? '9999').localeCompare(b.d.dueDate ?? '9999') || b.d.date.localeCompare(a.d.date))
  const owe = rows.filter((r) => r.d.direction === 'borrowed').reduce((s, r) => s + r.st.remaining, 0)
  const owed = rows.filter((r) => r.d.direction === 'lent').reduce((s, r) => s + r.st.remaining, 0)
  const selected = snap.debts?.find((d) => d.id === openId)

  if (!rows.length) return <div className="card"><Empty>Henüz elden borç veya alacak yok</Empty></div>
  return (
    <div className="space-y-3">
      <div className="card grid grid-cols-2 gap-2 p-3">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
          <div className="text-xs text-slate-500 dark:text-slate-400">Borçlarım</div>
          <Amount value={owe} tone={owe > 0 ? 'expense' : 'neutral'} className="mt-1 block text-base font-semibold" />
        </div>
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
          <div className="text-xs text-slate-500 dark:text-slate-400">Alacaklarım</div>
          <Amount value={owed} tone={owed > 0 ? 'income' : 'neutral'} className="mt-1 block text-base font-semibold" />
        </div>
      </div>
      {rows.map(({ d, st }) => {
        const borrowed = d.direction === 'borrowed'
        return (
          <button key={d.id} onClick={() => setOpenId(d.id)}
            className={`card block w-full p-4 text-left transition hover:border-indigo-300 dark:hover:border-indigo-800 ${st.done ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{d.counterparty}</div>
                <div className="text-xs text-slate-400">{borrowed ? 'Ondan borç aldım' : 'Ona borç verdim'} · {formatMoney(d.amount)}</div>
              </div>
              <div className="text-right">
                <Amount value={st.remaining} tone={st.done ? 'neutral' : borrowed ? 'expense' : 'income'} className="font-semibold" />
                <div className="text-xs text-slate-400">{st.done ? (d.closed ? 'kapatıldı' : 'tamamlandı') : 'kalan'}</div>
              </div>
            </div>
            <div className="mt-3"><ProgressBar value={d.amount ? st.paid / d.amount : 0} tone={borrowed ? 'red' : 'green'} /></div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>{formatMoney(st.paid)} {borrowed ? 'ödendi' : 'tahsil edildi'}</span>
              {d.dueDate && !st.done && <span className="flex items-center gap-1.5">Vade {fmtDate(d.dueDate, today)} {st.overdue && <OverdueBadge />}</span>}
            </div>
          </button>
        )
      })}
      {selected && <DebtDetailSheet snap={snap} debt={selected} onClose={() => setOpenId(null)} />}
    </div>
  )
}

/** Create (debt undefined) or edit a personal debt. */
export function DebtFormSheet({ snap, debt, onClose }: { snap: Snapshot; debt?: PersonalDebt; onClose: () => void }) {
  const today = todayISO()
  const liquid = snap.accounts.filter((a) => !a.archived && a.kind !== 'credit_card')
  const [direction, setDirection] = useState<DebtDirection>(debt?.direction ?? 'borrowed')
  const [counterparty, setCounterparty] = useState(debt?.counterparty ?? '')
  const [amount, setAmount] = useState(moneyToInput(debt?.amount))
  const [date, setDate] = useState(debt?.date ?? today)
  const [dueDate, setDueDate] = useState(debt?.dueDate ?? '')
  const [accountId, setAccountId] = useState(debt ? (debt.accountId ?? '') : (lastAccountId(liquid) ?? ''))
  const [note, setNote] = useState(debt?.note ?? '')
  const [err, setErr] = useState<string | null>(null)
  const paid = debt ? debtStatus(debt, snap, today).paid : 0
  const borrowed = direction === 'borrowed'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!counterparty.trim()) return setErr('Kişi adını girin')
    const a = parseMoney(amount)
    if (!a || a <= 0) return setErr('Geçerli bir tutar girin')
    if (a < paid) return setErr(`Tutar ödenenden (${formatMoney(paid)}) az olamaz`)
    if (dueDate && dueDate < date) return setErr('Vade tarihi borç tarihinden önce olamaz')
    await saveDebt({
      id: debt?.id ?? newId(), direction, counterparty: counterparty.trim(), amount: a, date,
      dueDate: dueDate || undefined, accountId: accountId || undefined, note: note.trim() || undefined,
      closed: debt?.closed, createdAt: debt?.createdAt ?? Date.now(),
    })
    onClose()
  }

  return (
    <Sheet title={debt ? 'Borç / alacak düzenle' : 'Elden borç / alacak'} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <Segmented options={DIRECTIONS} value={direction} onChange={setDirection} disabled={!!debt} />
        <Field label={borrowed ? 'Kimden aldın?' : 'Kime verdin?'}>
          <input className="input" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="ör. Ahmet" autoFocus={!debt} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tutar"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        </div>
        <Field label="Vade (opsiyonel)" hint="Ne zamana kadar ödenecek / tahsil edilecek">
          <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label={borrowed ? 'Para hangi hesaba girdi?' : 'Para hangi hesaptan çıktı?'}
          hint={borrowed ? 'Seçilirse hesabın bakiyesi artar; gelir sayılmaz.' : 'Seçilirse hesabın bakiyesi azalır; gider sayılmaz.'}>
          <AccountSelect accounts={snap.accounts} value={accountId} onChange={setAccountId} filter={(a) => a.kind !== 'credit_card'} allowEmpty="Hesaba işleme" />
        </Field>
        <Field label="Not"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opsiyonel" /></Field>
        <FormError msg={err} />
        <button className="btn btn-primary w-full">Kaydet</button>
      </form>
    </Sheet>
  )
}

function DebtDetailSheet({ snap, debt, onClose }: { snap: Snapshot; debt: PersonalDebt; onClose: () => void }) {
  const today = todayISO()
  const st = debtStatus(debt, snap, today)
  const borrowed = debt.direction === 'borrowed'
  const liquid = snap.accounts.filter((a) => !a.archived && a.kind !== 'credit_card')
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(moneyToInput(st.remaining))
  const [accountId, setAccountId] = useState(debt.accountId && liquid.some((a) => a.id === debt.accountId) ? debt.accountId : (lastAccountId(liquid) ?? ''))
  const [date, setDate] = useState(today)
  const [err, setErr] = useState<string | null>(null)
  const acc = (id?: string) => snap.accounts.find((a) => a.id === id)?.name ?? '?'
  const verb = borrowed ? 'Ödeme yap' : 'Tahsil et'

  const pay = async (e: FormEvent) => {
    e.preventDefault()
    const a = parseMoney(amount)
    if (!a || a <= 0) return setErr('Geçerli bir tutar girin')
    if (a > st.remaining) return setErr(`Kalan tutardan (${formatMoney(st.remaining)}) fazla olamaz`)
    if (!accountId) return setErr('Hesap seçin')
    setErr(null)
    await payDebt(debt, a, accountId, date)
    setAmount(moneyToInput(st.remaining - a))
  }
  const undo = async (id: string) => {
    if (confirm('Bu ödeme geri alınsın mı?')) await deleteTx(id)
  }
  const remove = async () => {
    if (!confirm(`"${debt.counterparty}" kaydı silinsin mi? Bağlı ${st.payments.length + (st.principalTx ? 1 : 0)} işlem de silinir.`)) return
    await deleteDebt(debt.id)
    onClose()
  }
  const toggleClosed = () => saveDebt({ ...debt, closed: !debt.closed || undefined })

  if (editing) return <DebtFormSheet snap={snap} debt={debt} onClose={() => setEditing(false)} />
  return (
    <Sheet title={debt.counterparty} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="text-xs text-slate-500">{borrowed ? 'Elden borç (ben ödeyeceğim)' : 'Alacak (bana ödenecek)'} · {fmtDate(debt.date, today)}</div>
          <div className="mt-1 flex items-end justify-between gap-2">
            <div>
              <Amount value={st.remaining} tone={st.done ? 'neutral' : borrowed ? 'expense' : 'income'} className="text-2xl font-semibold" />
              <span className="ml-1 text-sm text-slate-400">kalan / {formatMoney(debt.amount)}</span>
            </div>
            {st.overdue && <OverdueBadge />}
          </div>
          <div className="mt-2"><ProgressBar value={st.paid / debt.amount} tone={borrowed ? 'red' : 'green'} /></div>
          <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
            <span>{formatMoney(st.paid)} {borrowed ? 'ödendi' : 'tahsil edildi'}</span>
            {debt.dueDate && <span>Vade {fmtDate(debt.dueDate, today)}</span>}
          </div>
          {debt.accountId && <div className="mt-1 text-xs text-slate-400">{borrowed ? 'Para girdi' : 'Para çıktı'}: {acc(debt.accountId)}</div>}
          {debt.note && <div className="mt-1 text-xs text-slate-400">{debt.note}</div>}
        </div>

        {!st.done && (
          <form className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60" onSubmit={pay}>
            <div className="text-sm font-semibold">{verb}</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tutar"><MoneyInput value={amount} onChange={setAmount} /></Field>
              <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
            </div>
            <Field label={borrowed ? 'Hangi hesaptan?' : 'Hangi hesaba?'}>
              <AccountSelect accounts={snap.accounts} value={accountId} onChange={setAccountId} filter={(a) => a.kind !== 'credit_card'} allowEmpty={accountId ? undefined : 'Seçin'} />
            </Field>
            <FormError msg={err} />
            <button className="btn btn-pay w-full">{verb}</button>
          </form>
        )}

        <div>
          <div className="mb-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{borrowed ? 'Ödemeler' : 'Tahsilatlar'}</div>
          {st.payments.length === 0 ? <div className="py-2 text-sm text-slate-400">Henüz yok</div> : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {st.payments.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{fmtDate(t.date, today)}</div>
                    <div className="truncate text-xs text-slate-400">{acc(t.accountId)}</div>
                  </div>
                  <Amount value={borrowed ? -t.amount : t.amount} signed className="text-sm font-semibold" />
                  <button className="btn btn-ghost btn-sm" onClick={() => undo(t.id)}>Geri al</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn btn-soft btn-sm" onClick={() => setEditing(true)}>Düzenle</button>
          {(debt.closed || !st.done) && (
            <button className="btn btn-soft btn-sm" onClick={toggleClosed}>{debt.closed ? 'Yeniden aç' : 'Kapat (vazgeç)'}</button>
          )}
          <button className="btn btn-danger btn-sm ml-auto" onClick={remove}>Sil</button>
        </div>
      </div>
    </Sheet>
  )
}
