import { useState, type FormEvent } from 'react'
import { parseMoney, todayISO, type Account, type AccountKind } from '../domain'
import { saveAccount } from '../actions'
import { newId } from '../db'
import { moneyToInput, parseSigned } from '../lib/format'
import { Field, FormError, MoneyInput, Segmented, Sheet } from './ui'

const KINDS: { value: AccountKind; label: string }[] = [
  { value: 'bank', label: 'Banka' },
  { value: 'cash', label: 'Nakit' },
  { value: 'credit_card', label: 'Kredi kartı' },
]

export function AccountFormSheet({ account, onClose }: { account?: Account; onClose: () => void }) {
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'bank')
  const [name, setName] = useState(account?.name ?? '')
  // Bank/cash: signed balance. Card: debt entered as positive.
  const [balance, setBalance] = useState(() => {
    if (!account) return ''
    if (account.kind === 'credit_card') return moneyToInput(-account.openingBalance)
    return (account.openingBalance < 0 ? '-' : '') + moneyToInput(account.openingBalance)
  })
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? todayISO())
  const [limit, setLimit] = useState(moneyToInput(account?.card?.limit))
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
      const lim = parseMoney(limit)
      const day = Number(statementDay)
      const due = Number(dueDays)
      if (!lim || lim <= 0) return setErr('Kart limiti girin')
      if (!Number.isInteger(day) || day < 1 || day > 31) return setErr('Kesim günü 1-31 olmalı')
      if (!Number.isInteger(due) || due < 1 || due > 25) return setErr('Son ödeme gün sayısı 1-25 olmalı')
      const rate = minRate.trim() ? Number(minRate.trim().replace(',', '.')) : undefined
      if (rate !== undefined && (!(rate > 0) || rate > 100)) return setErr('Asgari oran 1-100 arası olmalı')
      if (bal < 0) return setErr('Kart borcunu pozitif girin')
      card = { limit: lim, statementDay: day, dueDaysAfterStatement: due, ...(rate !== undefined && { minPaymentRate: rate / 100 }) }
    }
    await saveAccount({
      id: account?.id ?? newId(),
      name: name.trim(),
      kind,
      openingBalance: isCard ? -bal : bal,
      openingDate,
      card,
      archived: account?.archived,
    })
    onClose()
  }

  return (
    <Sheet title={account ? 'Hesabı düzenle' : 'Yeni hesap'} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        {!account && <Segmented options={KINDS} value={kind} onChange={setKind} />}
        <Field label="Ad"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={isCard ? 'ör. Bonus Kart' : 'ör. Ziraat Vadesiz'} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={isCard ? 'Güncel borç' : 'Güncel bakiye'}><MoneyInput value={balance} onChange={setBalance} /></Field>
          <Field label="Bakiye tarihi"><input className="input" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} required /></Field>
        </div>
        {isCard && (
          <>
            <Field label="Kart limiti"><MoneyInput value={limit} onChange={setLimit} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kesim günü"><input className="input" inputMode="numeric" value={statementDay} onChange={(e) => setStatementDay(e.target.value)} placeholder="1-31" /></Field>
              <Field label="Son ödeme (kesimden kaç gün sonra)"><input className="input" inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} placeholder="1-25" /></Field>
            </div>
            <Field label="Asgari ödeme oranı (%)" hint="Boş bırakılırsa limit 50.000 ₺ altında %20, üstünde %40">
              <input className="input" inputMode="decimal" value={minRate} onChange={(e) => setMinRate(e.target.value)} placeholder="Otomatik" />
            </Field>
          </>
        )}
        <FormError msg={err} />
        <button className="btn btn-primary w-full">Kaydet</button>
      </form>
    </Sheet>
  )
}
