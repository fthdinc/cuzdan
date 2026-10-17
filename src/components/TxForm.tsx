import { useState, type FormEvent } from 'react'
import { suggestCategory, todayISO, type Snapshot, type Transaction, type TxKind } from '../domain'
import { addTx, deleteTx, lastAccountId, updateTx, type TxDraft } from '../actions'
import { moneyToInput, parseSigned } from '../lib/format'
import { AccountSelect, CategorySelect, Field, FormError, MoneyInput, Segmented, Sheet } from './ui'
import { isLiquid, needsAccountPicker, pickAccount } from '../lib/accounts'

const KINDS: { value: TxKind; label: string }[] = [
  { value: 'expense', label: 'Gider' },
  { value: 'income', label: 'Gelir' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'adjustment', label: 'Düzeltme' },
]

/** Add (tx undefined) or edit a transaction. */
export function TxFormSheet({ snap, tx, onClose }: { snap: Snapshot; tx?: Transaction; onClose: () => void }) {
  const [kind, setKind] = useState<TxKind>(tx?.kind ?? 'expense')
  const [amount, setAmount] = useState(() =>
    tx ? (tx.amount < 0 ? '-' : '') + moneyToInput(tx.amount) : '',
  )
  const [accountId, setAccountId] = useState(tx?.accountId ?? lastAccountId(snap.accounts) ?? '')
  const [toAccountId, setToAccountId] = useState(tx?.toAccountId ?? '')
  const [categoryId, setCategoryId] = useState(tx?.categoryId ?? '')
  // New entries: category follows the description until picked by hand.
  const [catTouched, setCatTouched] = useState(!!tx)
  const [date, setDate] = useState(tx?.date ?? todayISO())
  const [note, setNote] = useState(tx?.note ?? '')
  const [err, setErr] = useState<string | null>(null)
  const openingDate = snap.accounts.find((a) => a.id === accountId)?.openingDate
  // Income goes to bank/cash. With a single choice (the default account) the picker is hidden.
  const accFilter = kind === 'income' ? isLiquid : undefined
  const showAccount = kind === 'transfer' || needsAccountPicker(snap.accounts, accFilter)
  const catKind = kind === 'income' || kind === 'expense' ? kind : null

  const changeNote = (v: string) => {
    setNote(v)
    if (!catTouched && catKind) setCategoryId(suggestCategory(v, snap.categories, catKind)?.id ?? '')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const k = parseSigned(amount)
    if (k === null || k === 0) return setErr('Geçerli bir tutar girin')
    if (kind !== 'adjustment' && k < 0) return setErr('Tutar pozitif olmalı (yönü tür belirler)')
    // Selected (or, with the picker hidden, the only) eligible account. An edited tx keeps its own account.
    const keepOwn = tx && accountId === tx.accountId && kind === tx.kind
    const accId = keepOwn ? accountId : pickAccount(snap.accounts, accountId, accFilter)
    if (!accId) return setErr('Hesap seçin')
    if (kind === 'transfer' && (!toAccountId || toAccountId === accId)) return setErr('Farklı bir hedef hesap seçin')
    const draft: TxDraft = {
      date,
      kind,
      amount: k,
      accountId: accId,
      toAccountId: kind === 'transfer' ? toAccountId : undefined,
      categoryId: kind === 'income' || kind === 'expense' ? categoryId || undefined : undefined,
      note: note.trim() || undefined,
      // A transfer/adjustment cannot settle a plan occurrence.
      occurrenceKey: kind === 'income' || kind === 'expense' ? tx?.occurrenceKey : undefined,
      debtId: kind === 'income' || kind === 'expense' ? tx?.debtId : undefined,
    }
    if (tx) await updateTx({ ...draft, id: tx.id, createdAt: tx.createdAt })
    else await addTx(draft)
    onClose()
  }

  const remove = async () => {
    if (!tx || !confirm('Bu işlem silinsin mi?')) return
    await deleteTx(tx.id)
    onClose()
  }

  return (
    <Sheet title={tx ? 'İşlemi düzenle' : 'Yeni işlem'} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <Segmented options={KINDS} value={kind} onChange={(v) => {
          setKind(v)
          setCategoryId(!catTouched && (v === 'income' || v === 'expense') ? suggestCategory(note, snap.categories, v)?.id ?? '' : '')
        }} />
        <Field label="Tutar" hint={kind === 'adjustment' ? 'Düzeltmede eksi tutar bakiyeyi azaltır (ör. -150)' : undefined}>
          <MoneyInput value={amount} onChange={setAmount} autoFocus={!tx} />
        </Field>
        <Field label="Açıklama">
          <input className="input" value={note} onChange={(e) => changeNote(e.target.value)}
            placeholder={kind === 'income' ? 'ör. Maaş, kira geliri, freelance iş' : kind === 'expense' ? 'ör. Market alışverişi, benzin' : 'İsteğe bağlı'} />
        </Field>
        <div className={showAccount ? 'grid grid-cols-2 gap-3' : 'empty:hidden'}>
          {showAccount && (
            <Field label={kind === 'transfer' ? 'Kaynak hesap' : 'Hesap'}>
              <AccountSelect accounts={snap.accounts} value={accountId} onChange={setAccountId} filter={accFilter} />
            </Field>
          )}
          {kind === 'transfer' ? (
            <Field label="Hedef hesap">
              <AccountSelect accounts={snap.accounts} value={toAccountId} onChange={setToAccountId} allowEmpty="Seçin" />
            </Field>
          ) : kind === 'income' || kind === 'expense' ? (
            <Field label="Kategori">
              <CategorySelect categories={snap.categories} kind={kind} value={categoryId} onChange={(v) => { setCatTouched(true); setCategoryId(v) }} />
            </Field>
          ) : null}
        </div>
        <Field
          label="Tarih"
          hint={date && openingDate && date < openingDate ? 'Bu tarih hesabın açılış bakiyesinden önce; bakiyeye etki etmez.' : undefined}
        >
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        {tx?.occurrenceKey && <div className="text-xs text-slate-500">Bu işlem bir plan vadesini kapatıyor. Silinirse vade tekrar bekliyor olur.</div>}
        <FormError msg={err} />
        <div className="flex gap-2">
          {tx && <button type="button" className="btn btn-danger" onClick={remove}>Sil</button>}
          <button className="btn btn-primary flex-1">Kaydet</button>
        </div>
      </form>
    </Sheet>
  )
}
