import { useState, type FormEvent } from 'react'
import { parseMoney, todayISO, type Account, type AccountKind, type ID } from '../domain'
import { saveAccount } from '../actions'
import { newId, useSnapshot } from '../db'
import { moneyToInput, parseSigned } from '../lib/format'
import { Field, FormError, Loading, MoneyInput, Segmented, Sheet } from './ui'
import { PlanForm } from './PlanForms'

// 'loan' is not an account kind: it shows the loan plan form, since users look for loans here.
const KINDS: { value: AccountKind | 'loan'; label: string }[] = [
  { value: 'bank', label: 'Banka' },
  { value: 'cash', label: 'Nakit' },
  { value: 'credit_card', label: 'Kredi kartı' },
  { value: 'loan', label: 'Kredi' },
]

const Hint = ({ children }: { children: string }) => <div className="text-xs text-slate-500">{children}</div>

/**
 * Create / edit an account. quickCard: the short "Kart ekle" form (card only; balance date today, automatic minimum
 * rate); onSaved gets the new account's id.
 */
export function AccountFormSheet({ account, onClose, quickCard, onSaved }: {
  account?: Account; onClose: () => void; quickCard?: boolean; onSaved?: (id: ID) => void
}) {
  const [kind, setKind] = useState<AccountKind | 'loan'>(account?.kind ?? (quickCard ? 'credit_card' : 'bank'))
  const [name, setName] = useState(account?.name ?? '')
  // Bank/cash: signed balance. Card: debt entered as positive.
  const [balance, setBalance] = useState(() => {
    if (!account) return ''
    if (account.kind === 'credit_card') return moneyToInput(-account.openingBalance)
    return (account.openingBalance < 0 ? '-' : '') + moneyToInput(account.openingBalance)
  })
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? todayISO())
  const [limit, setLimit] = useState(moneyToInput(account?.card?.limit))
  const [overdraft, setOverdraft] = useState(moneyToInput(account?.overdraftLimit))
  const [statementDay, setStatementDay] = useState(String(account?.card?.statementDay ?? ''))
  const [dueDays, setDueDays] = useState(String(account?.card?.dueDaysAfterStatement ?? 10))
  const [minRate, setMinRate] = useState(
    account?.card?.minPaymentRate !== undefined
      ? (Math.round(account.card.minPaymentRate * 10000) / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2, useGrouping: false })
      : '',
  )
  const [err, setErr] = useState<string | null>(null)
  const isCard = kind === 'credit_card'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setErr('Ad girin')
    const bal = balance.trim() ? parseSigned(balance) : 0
    if (bal === null) return setErr('Geçerli bir tutar girin')
    let card: Account['card']
    if (isCard) {
      const lim = limit.trim() ? parseMoney(limit) : undefined
      const day = Number(statementDay)
      const due = Number(dueDays)
      if (lim !== undefined && (!lim || lim <= 0)) return setErr('Geçerli bir limit girin ya da boş bırakın')
      if (!statementDay.trim() || !Number.isInteger(day) || day < 1 || day > 31) return setErr('Kesim günü 1-31 olmalı')
      if (!Number.isInteger(due) || due < 1 || due > 25) return setErr('Son ödeme gün sayısı 1-25 olmalı')
      const rate = minRate.trim() ? Number(minRate.trim().replace(',', '.')) : undefined
      if (rate !== undefined && (!(rate > 0) || rate > 100)) return setErr('Asgari oran 1-100 arası olmalı')
      if (bal < 0) return setErr('Kart borcunu pozitif girin')
      card = { ...(lim !== undefined && { limit: lim }), statementDay: day, dueDaysAfterStatement: due, ...(rate !== undefined && { minPaymentRate: rate / 100 }) }
    }
    if (kind === 'loan') return
    let overdraftLimit: number | undefined
    if (kind === 'bank' && overdraft.trim()) {
      const v = parseMoney(overdraft)
      if (v === null || v < 0) return setErr('Geçerli bir KMH limiti girin')
      overdraftLimit = v || undefined
    }
    const id = account?.id ?? newId()
    await saveAccount({
      id,
      name: name.trim(),
      kind,
      openingBalance: isCard ? -bal : bal,
      openingDate,
      card,
      overdraftLimit,
      archived: account?.archived,
    })
    onSaved?.(id)
    onClose()
  }

  return (
    <Sheet title={account ? 'Hesabı düzenle' : quickCard ? 'Kart ekle' : kind === 'loan' ? 'Yeni kredi' : 'Yeni hesap'} onClose={onClose}>
      {!account && !quickCard && <div className="mb-3"><Segmented options={KINDS} value={kind} onChange={setKind} /></div>}
      {kind === 'loan' ? <LoanSection onDone={onClose} /> : (
        <form className="space-y-3" onSubmit={submit}>
          {!account && kind === 'bank' && <Hint>Banka hesabı paranın durduğu yerdir; maaş gibi düzenli gelirleri Kurulum'dan veya Planlar → Gelirler'den ekleyin.</Hint>}
          {quickCard && <Hint>Kartla yaptığın harcamaları bu karta işle; kart ödemesi gider sayılmaz.</Hint>}
          <Field label={isCard ? 'Kart adı' : 'Ad'}><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={isCard ? 'ör. Axess, Bonus' : 'ör. Ziraat Vadesiz'} autoFocus /></Field>
          {isCard && (
            <div className="grid grid-cols-2 items-end gap-3">
              <Field label="Kesim günü"><input className="input" inputMode="numeric" value={statementDay} onChange={(e) => setStatementDay(e.target.value)} placeholder="1-31" /></Field>
              <Field label="Son ödeme (kesimden kaç gün sonra)"><input className="input" inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} placeholder="1-25" /></Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {isCard && <Field label="Limit (opsiyonel)"><MoneyInput value={limit} onChange={setLimit} placeholder="Bilinmiyor" /></Field>}
            <Field label={isCard ? 'Güncel borç' : 'Güncel bakiye'}><MoneyInput value={balance} onChange={setBalance} /></Field>
            {!quickCard && <Field label="Bakiye tarihi"><input className="input" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} required /></Field>}
          </div>
          {kind === 'bank' && (
            <Field label="KMH limiti (opsiyonel)" hint="Kredili mevduat hesabı: bakiye bu tutara kadar eksiye düşebilir. Eksi bakiye borç olarak gösterilir.">
              <MoneyInput value={overdraft} onChange={setOverdraft} placeholder="Yok" />
            </Field>
          )}
          {isCard && !quickCard && (
            <Field label="Asgari ödeme oranı (%)" hint="Boş bırakılırsa limit 50.000 ₺ altında (veya bilinmiyorsa) %20, üstünde %40">
              <input className="input" inputMode="decimal" value={minRate} onChange={(e) => setMinRate(e.target.value)} placeholder="Otomatik" />
            </Field>
          )}
          <FormError msg={err} />
          <button className="btn btn-primary w-full">Kaydet</button>
        </form>
      )}
    </Sheet>
  )
}

/** "Kredi" segment: the loan plan form; installments are paid from a bank/cash account, so one must exist. */
function LoanSection({ onDone }: { onDone: () => void }) {
  const snap = useSnapshot()
  if (!snap) return <Loading />
  const hasPayer = snap.accounts.some((a) => !a.archived && a.kind !== 'credit_card')
  return (
    <div className="space-y-3">
      <Hint>Krediler hesap değil, borç planı olarak takip edilir; taksitleri otomatik hesaplanır.</Hint>
      {hasPayer
        ? <PlanForm snap={snap} kind="loan" onDone={onDone} />
        : <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Kredi taksitleri bir hesaptan ödenir. Önce "Banka" veya "Nakit" sekmesinden bir hesap ekleyin, sonra krediyi buradan ekleyin.</div>}
    </div>
  )
}
