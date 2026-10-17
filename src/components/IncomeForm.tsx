import { useState, type FormEvent } from 'react'
import { parseMoney, suggestCategory, todayISO, type Snapshot } from '../domain'
import { addIncome, lastAccountId } from '../actions'
import { AccountSelect, CategorySelect, Field, FormError, MoneyInput, Sheet } from './ui'
import { activeAccounts, isLiquid, needsAccountPicker, pickAccount } from '../lib/accounts'

/** "Gelir ekle": amount + free-text description; optionally repeats monthly (creates a recurring_income plan). */
export function IncomeFormSheet({ snap, onClose }: { snap: Snapshot; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayISO())
  const [categoryId, setCategoryId] = useState('')
  const [catTouched, setCatTouched] = useState(false)
  const [accountId, setAccountId] = useState(() => lastAccountId(activeAccounts(snap.accounts, isLiquid)) ?? '')
  const [monthly, setMonthly] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const changeNote = (v: string) => {
    setNote(v)
    if (!catTouched) setCategoryId(suggestCategory(v, snap.categories, 'income')?.id ?? '')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const a = parseMoney(amount)
    if (!a || a <= 0) return setErr('Geçerli bir tutar girin')
    if (!note.trim()) return setErr('Açıklama girin (ör. Maaş)')
    const accId = pickAccount(snap.accounts, accountId, isLiquid)
    if (!accId) return setErr('Önce Ayarlar\'dan bir banka veya nakit hesabı ekleyin')
    if (saving) return
    setSaving(true)
    try {
      await addIncome({ amount: a, date, note: note.trim(), accountId: accId, categoryId: categoryId || undefined, monthly })
    } finally {
      setSaving(false)
    }
    onClose()
  }

  const showAccount = needsAccountPicker(snap.accounts, isLiquid)
  return (
    <Sheet title="Gelir ekle" onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Tutar"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Açıklama">
          <input className="input" value={note} onChange={(e) => changeNote(e.target.value)} placeholder="ör. Maaş, kira geliri, freelance iş" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Kategori (isteğe bağlı)">
            <CategorySelect categories={snap.categories} kind="income" value={categoryId} onChange={(v) => { setCatTouched(true); setCategoryId(v) }} />
          </Field>
        </div>
        {showAccount && (
          <Field label="Yatan hesap">
            <AccountSelect accounts={snap.accounts} value={accountId} onChange={setAccountId} filter={isLiquid} />
          </Field>
        )}
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
            Her ay tekrarlanıyor
          </label>
          {monthly && (
            <div className="mt-1 text-xs text-slate-500">
              Sonraki aylarda beklenen gelir olarak görünür; geldiğinde "Yaklaşan 30 gün" listesinden "Alındı" ile onaylarsın. Planlar → Gelirler'den düzenlenir.
            </div>
          )}
        </div>
        <FormError msg={err} />
        <button className="btn btn-primary w-full" disabled={saving}>Kaydet</button>
      </form>
    </Sheet>
  )
}
