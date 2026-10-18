import { useState, type FormEvent } from 'react'
import {
  annuityInstallment, formatMoney, loanFromRemaining, parseMoney, todayISO,
  type Account, type Frequency, type Plan, type PlanKind, type Snapshot,
} from '../domain'
import { savePlan } from '../actions'
import { newId } from '../db'
import { moneyToInput } from '../lib/format'
import { FREQ_LABEL } from '../lib/plans'
import { AccountSelect, CategorySelect, Field, FormError, MoneyInput, Segmented, Sheet } from './ui'
import { isLiquid, needsAccountPicker } from '../lib/accounts'
import { PayMethodChips } from './PayMethod'

const TITLES: Record<PlanKind, string> = {
  loan: 'Kredi',
  card_installment: 'Kartla taksitli alışveriş',
  recurring_expense: 'Fatura / abonelik',
  recurring_income: 'Düzenli gelir',
}

const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : NaN)

/** Create a plan of `kind`, or edit `plan`. */
export function PlanFormSheet({ snap, kind, plan, onClose }: {
  snap: Snapshot; kind: PlanKind; plan?: Plan; onClose: () => void
}) {
  return (
    <Sheet title={`${TITLES[kind]}${plan ? ' düzenle' : ''}`} onClose={onClose}>
      <PlanForm snap={snap} kind={kind} plan={plan} onDone={onClose} />
    </Sheet>
  )
}

/** The plan form without a sheet (also embedded in "Yeni hesap" for loans). */
export function PlanForm({ snap, kind, plan, onDone: onClose }: {
  snap: Snapshot; kind: PlanKind; plan?: Plan; onDone: () => void
}) {
  const today = todayISO()
  const isCardInst = kind === 'card_installment'
  const isRecurring = kind === 'recurring_expense' || kind === 'recurring_income'
  const rec = plan && (plan.kind === 'recurring_expense' || plan.kind === 'recurring_income') ? plan : undefined
  const catKind = kind === 'recurring_income' ? 'income' : 'expense'
  const cards = snap.accounts.filter((a) => a.kind === 'credit_card' && !a.archived)
  // Income is received into bank/cash; card installments need a card. Picker hidden when there is one choice.
  const accFilter = isCardInst ? (a: Account) => a.kind === 'credit_card' : kind === 'recurring_income' ? isLiquid : undefined
  // Recurring expenses pick the payer with "Ödeme yöntemi" chips instead.
  const showAccount = kind !== 'recurring_expense' && (isCardInst || needsAccountPicker(snap.accounts, accFilter))
  const defaultCat = kind === 'loan' ? snap.categories.find((c) => c.name === 'Kredi')?.id
    : kind === 'recurring_income' ? snap.categories.find((c) => c.name === 'Maaş')?.id
    : kind === 'recurring_expense' ? snap.categories.find((c) => c.name === 'Fatura')?.id
    : undefined

  const [name, setName] = useState(plan?.name ?? '')
  const [accountId, setAccountId] = useState(
    plan?.accountId ?? (isCardInst ? cards[0]?.id : snap.accounts.find((a) => !a.archived && a.kind !== 'credit_card')?.id) ?? '',
  )
  const [categoryId, setCategoryId] = useState(plan?.categoryId ?? defaultCat ?? '')
  const [active, setActive] = useState(plan?.active ?? true)
  // loan
  const [installment, setInstallment] = useState('')
  const [total, setTotal] = useState('')
  const [remaining, setRemaining] = useState('')
  const [nextDue, setNextDue] = useState(today)
  const [helper, setHelper] = useState(false)
  const [principal, setPrincipal] = useState('')
  const [ratePct, setRatePct] = useState('')
  // card installment
  const [amount, setAmount] = useState(moneyToInput(rec?.amount))
  const [count, setCount] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(today)
  const [billed, setBilled] = useState('0')
  // recurring
  const [variable, setVariable] = useState(rec?.variable ?? false)
  const [frequency, setFrequency] = useState<Frequency>(rec?.frequency ?? 'monthly')
  const [startDate, setStartDate] = useState(rec?.startDate ?? today)
  const [endDate, setEndDate] = useState(rec?.endDate ?? '')
  const [settlePast, setSettlePast] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // Payment history is keyed by occurrence index; changing the schedule would re-map it.
  const scheduleLocked = !!plan && (
    Object.keys(plan.overrides ?? {}).length > 0 ||
    snap.transactions.some((t) => t.occurrenceKey?.startsWith(`${plan.id}:`))
  )

  const rate = Number(ratePct.replace(',', '.')) / 100
  const p = parseMoney(principal)
  const n = int(total)
  const computed = helper && p && n > 0 && rate >= 0 && ratePct.trim() ? annuityInstallment(p, rate, n) : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) return setErr('Ad girin')
    // The stored account may be archived; fall back to the first eligible active account.
    const eligible = snap.accounts.filter((a) => !a.archived && (!accFilter || accFilter(a)))
    // Fallback payer: a bank/cash account rather than a card when one exists (cards first only for card installments).
    const accId = eligible.some((a) => a.id === accountId) ? accountId
      : (isCardInst ? undefined : eligible.find((a) => a.kind !== 'credit_card')?.id) ?? eligible[0]?.id
    if (!accId) return setErr(isCardInst ? 'Kart seçin' : 'Hesap seçin')
    const common = { name: name.trim(), accountId: accId, categoryId: categoryId || undefined, active }

    if (plan) {
      if (rec) {
        const a = parseMoney(amount)
        if (!a || a <= 0) return setErr('Geçerli bir tutar girin')
        const sched = scheduleLocked ? { frequency: rec.frequency, startDate: rec.startDate } : { frequency, startDate }
        if (endDate && endDate < sched.startDate) return setErr('Bitiş tarihi başlangıçtan önce olamaz')
        await savePlan({ ...rec, ...common, ...sched, amount: a, variable, endDate: endDate || undefined })
      } else {
        await savePlan({ ...plan, ...common })
      }
      return onClose()
    }

    if (kind === 'loan') {
      const inst = computed ?? parseMoney(installment)
      const rem = int(remaining)
      if (!inst || inst <= 0) return setErr('Taksit tutarı girin')
      if (!(n > 0)) return setErr('Toplam taksit sayısı girin')
      if (!(rem >= 1) || rem > n) return setErr('Kalan taksit 1 ile toplam arasında olmalı')
      const loan = loanFromRemaining({
        id: newId(), name: common.name, accountId: accId, categoryId: common.categoryId, createdAt: Date.now(),
        installmentAmount: inst, totalInstallments: n, remainingInstallments: rem, nextDueDate: nextDue,
      })
      if (computed && p) { loan.principal = p; loan.monthlyRate = rate }
      await savePlan(loan)
    } else if (isCardInst) {
      const t = parseMoney(amount)
      const c = int(count)
      const b = int(billed || '0')
      if (!t || t <= 0) return setErr('Toplam tutar girin')
      if (!(c >= 1)) return setErr('Taksit sayısı girin')
      if (!(b >= 0) || b >= c) return setErr('Faturalanmış taksit sayısı taksit sayısından az olmalı')
      await savePlan({
        ...common, id: newId(), kind: 'card_installment', createdAt: Date.now(),
        totalAmount: t, installmentCount: c, purchaseDate, preSettledCount: b,
      })
    } else {
      const a = parseMoney(amount)
      if (!a || a <= 0) return setErr('Geçerli bir tutar girin')
      if (endDate && endDate < startDate) return setErr('Bitiş tarihi başlangıçtan önce olamaz')
      await savePlan({
        ...common, id: newId(), kind: kind as 'recurring_expense' | 'recurring_income', createdAt: Date.now(),
        amount: a, variable, frequency, startDate, endDate: endDate || undefined,
        settledBefore: settlePast && startDate < today ? today : undefined,
      })
    }
    onClose()
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field label="Ad">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!plan}
          placeholder={kind === 'loan' ? 'ör. İhtiyaç kredisi' : isCardInst ? 'ör. Telefon' : kind === 'recurring_income' ? 'ör. Maaş' : 'ör. Elektrik'} />
      </Field>
      {kind === 'recurring_expense' && (
        <div>
          <span className="label">Ödeme yöntemi</span>
          <PayMethodChips accounts={snap.accounts} value={accountId} onChange={setAccountId} />
        </div>
      )}
      <div className={showAccount ? 'grid grid-cols-2 gap-3' : ''}>
        {showAccount && (
          <Field label={isCardInst ? 'Kart' : kind === 'recurring_income' ? 'Yatan hesap' : 'Ödeyen hesap'}>
            <AccountSelect accounts={snap.accounts} value={accountId} onChange={setAccountId}
              filter={accFilter} allowEmpty={accountId ? undefined : 'Seçin'} />
          </Field>
        )}
        <Field label="Kategori">
          <CategorySelect categories={snap.categories} kind={catKind} value={categoryId} onChange={setCategoryId} />
        </Field>
      </div>

      {!plan && kind === 'loan' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Toplam taksit"><input className="input" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
            <Field label="Kalan taksit"><input className="input" inputMode="numeric" value={remaining} onChange={(e) => setRemaining(e.target.value)} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={helper} onChange={(e) => setHelper(e.target.checked)} />
            Anapara + aylık faiz ile hesapla
          </label>
          {helper ? (
            <div className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Anapara"><MoneyInput value={principal} onChange={setPrincipal} /></Field>
                <Field label="Aylık faiz (%)"><input className="input" inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="ör. 2,99" /></Field>
              </div>
              <div className="text-sm">
                Taksit tutarı: <span className="font-semibold tabular-nums">{computed !== null ? formatMoney(computed) : '-'}</span>
              </div>
            </div>
          ) : (
            <Field label="Taksit tutarı"><MoneyInput value={installment} onChange={setInstallment} /></Field>
          )}
          <Field label="Sonraki ödeme tarihi"><input className="input" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} required /></Field>
        </>
      )}

      {!plan && isCardInst && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Toplam tutar"><MoneyInput value={amount} onChange={setAmount} /></Field>
            <Field label="Taksit sayısı"><input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Alışveriş tarihi"><input className="input" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required /></Field>
            <Field label="Faturalanmış taksit"><input className="input" inputMode="numeric" value={billed} onChange={(e) => setBilled(e.target.value)} /></Field>
          </div>
          <div className="text-xs text-slate-500">Takibe başlamadan önce ekstreye yansımış taksit sayısı. Bunlar kartın güncel borcuna dahil kabul edilir.</div>
        </>
      )}

      {isRecurring && (
        <>
          <Field label={variable ? 'Tahmini tutar' : 'Tutar'}><MoneyInput value={amount} onChange={setAmount} /></Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={variable} onChange={(e) => setVariable(e.target.checked)} />
            Değişken tutar (ödemede sorulsun)
          </label>
          <Segmented
            options={(Object.keys(FREQ_LABEL) as Frequency[]).map((f) => ({ value: f, label: FREQ_LABEL[f] }))}
            value={frequency}
            onChange={setFrequency}
            disabled={scheduleLocked}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="İlk vade"><input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={scheduleLocked} required /></Field>
            <Field label="Bitiş (isteğe bağlı)"><input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          </div>
          {scheduleLocked && <div className="text-xs text-slate-500">Periyot ve ilk vade: Geçmiş ödemeler olduğu için değiştirilemez; planı bitirip yenisini oluşturun.</div>}
          {!plan && startDate < today && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={settlePast} onChange={(e) => setSettlePast(e.target.checked)} />
              Bugünden önceki vadeler ödenmiş sayılsın
            </label>
          )}
        </>
      )}

      {plan && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Aktif
        </label>
      )}
      <FormError msg={err} />
      <button className="btn btn-primary w-full">Kaydet</button>
    </form>
  )
}
