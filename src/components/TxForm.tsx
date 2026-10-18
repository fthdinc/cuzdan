import { useState, type FormEvent } from 'react'
import { BILL_TYPE_LABEL, looksLikeCardPayment, matchCard, matchExpenseToBill, suggestCategory, todayISO, type ID, type Snapshot, type Transaction, type TxKind } from '../domain'
import { addExpenseForBill, addTx, defaultPayMethod, deleteTx, lastAccountId, updateTx, type TxDraft } from '../actions'
import { monthName, moneyToInput, parseSigned } from '../lib/format'
import { AccountSelect, CategorySelect, Field, FormError, MoneyInput, Segmented, Sheet } from './ui'
import { activeAccounts, isLiquid, needsAccountPicker, pickAccount } from '../lib/accounts'
import { PayMethodChips } from './PayMethod'
import { AccountFormSheet } from './AccountForm'

const KINDS: { value: TxKind; label: string }[] = [
  { value: 'expense', label: 'Gider' },
  { value: 'income', label: 'Gelir' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'adjustment', label: 'Düzeltme' },
]

const isCardAcc = (a: { kind: string }) => a.kind === 'credit_card'

/**
 * Add (tx undefined) or edit a transaction. cardPayment: open as "Kart ödemesi" (transfer bank/cash -> card).
 * A new expense whose description / category looks like a card payment switches to that mode by itself.
 */
export function TxFormSheet({ snap, tx, cardPayment, onClose }: { snap: Snapshot; tx?: Transaction; cardPayment?: boolean; onClose: () => void }) {
  const cards = activeAccounts(snap.accounts, isCardAcc)
  const [kind, setKind] = useState<TxKind>(tx?.kind ?? (cardPayment ? 'transfer' : 'expense'))
  // Kart ödemesi mode: a transfer shown with bank/cash chips and card chips.
  const [cardMode, setCardMode] = useState(!!cardPayment)
  // The user left the card payment mode: do not switch to it again by itself.
  const [autoOff, setAutoOff] = useState(false)
  const [amount, setAmount] = useState(() =>
    tx ? (tx.amount < 0 ? '-' : '') + moneyToInput(tx.amount) : '',
  )
  const [accountId, setAccountId] = useState(() =>
    tx?.accountId
    ?? (cardPayment ? pickAccount(snap.accounts, lastAccountId(snap.accounts) ?? '', isLiquid) : defaultPayMethod(snap.accounts))
    ?? '')
  // New expenses: the payment method follows the category (last method used for it) until a chip is tapped.
  const [methodTouched, setMethodTouched] = useState(!!tx)
  const [toAccountId, setToAccountId] = useState(tx?.toAccountId ?? (cardPayment ? cards[0]?.id ?? '' : ''))
  const [categoryId, setCategoryId] = useState(tx?.categoryId ?? '')
  // New entries: category follows the description until picked by hand.
  const [catTouched, setCatTouched] = useState(!!tx)
  const [date, setDate] = useState(tx?.date ?? todayISO())
  const [note, setNote] = useState(tx?.note ?? '')
  const [addingCard, setAddingCard] = useState(false)
  // Faturalar: settle the matched bill occurrence (link) / start tracking a monthly bill (track; null = default).
  const [link, setLink] = useState(true)
  const [track, setTrack] = useState<boolean | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const openingDate = snap.accounts.find((a) => a.id === accountId)?.openingDate
  // Income goes to bank/cash, a card payment comes from bank/cash. With a single choice the income picker is hidden.
  const accFilter = kind === 'income' || cardMode ? isLiquid : undefined
  const showAccount = kind === 'transfer' || needsAccountPicker(snap.accounts, accFilter)
  const catKind = kind === 'income' || kind === 'expense' ? kind : null
  const looksLikePayment = kind === 'expense' && looksLikeCardPayment(note, categoryId || undefined, snap)
  // New expenses only: an edited expense keeps whatever it settles.
  const billMatch = !tx && kind === 'expense' && !cardMode && !looksLikePayment
    ? matchExpenseToBill({ note, categoryId: categoryId || undefined, date, accountId }, snap, todayISO())
    : null
  const tracking = track ?? (billMatch?.kind === 'propose' && billMatch.strong)

  const toCardMode = (text: string) => {
    setKind('transfer')
    setCardMode(true)
    const cur = cards.find((c) => c.id === toAccountId)
    setToAccountId((matchCard(text, cards) ?? cur ?? cards[0])?.id ?? '')
    setAccountId(pickAccount(snap.accounts, accountId, isLiquid))
    setCategoryId('')
  }
  /** New expense: switch to card payment when it looks like one, else let the payment method follow text / category. */
  const follow = (text: string, catId: string) => {
    if (kind !== 'expense' || tx) return
    if (!autoOff && looksLikeCardPayment(text, catId || undefined, snap)) return toCardMode(text)
    if (!methodTouched) setAccountId(matchCard(text, cards)?.id ?? defaultPayMethod(snap.accounts, catId || undefined) ?? '')
  }

  const changeNote = (v: string) => {
    setNote(v)
    const cat = !catTouched && catKind ? suggestCategory(v, snap.categories, catKind)?.id ?? '' : categoryId
    setCategoryId(cat)
    follow(v, cat)
  }
  const changeCategory = (v: string) => {
    setCatTouched(true)
    setCategoryId(v)
    follow(note, v)
  }
  const pickMethod = (id: ID) => {
    setMethodTouched(true)
    setAccountId(id)
  }
  const cardAdded = (id: ID) => {
    if (cardMode) setToAccountId(id)
    else pickMethod(id)
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
    if (cardMode && !toAccountId) return setErr('Önce kartını ekle')
    const tracked = !tx && kind === 'expense' && !cardMode && tracking && billMatch?.kind !== 'link' && billMatch?.kind !== 'already_paid'
    if (tracked && !note.trim()) return setErr('Takip için açıklama girin (ör. Spotify)')
    if (kind === 'transfer' && (!toAccountId || toAccountId === accId)) return setErr('Farklı bir hedef hesap seçin')
    const draft: TxDraft = {
      date,
      kind,
      amount: k,
      accountId: accId,
      toAccountId: kind === 'transfer' ? toAccountId : undefined,
      categoryId: kind === 'income' || kind === 'expense' ? categoryId || undefined : undefined,
      // Card payment without a description: "<kart> ödemesi", like statement payments.
      note: note.trim() || (cardMode ? `${snap.accounts.find((a) => a.id === toAccountId)?.name ?? 'Kart'} ödemesi` : undefined),
      // A transfer/adjustment cannot settle a plan occurrence.
      occurrenceKey: kind === 'income' || kind === 'expense' ? tx?.occurrenceKey : undefined,
      debtId: kind === 'income' || kind === 'expense' ? tx?.debtId : undefined,
    }
    if (tx) await updateTx({ ...draft, id: tx.id, createdAt: tx.createdAt })
    else if (kind === 'expense' && !cardMode) await addExpenseForBill(draft, billMatch, { link, track: tracked, accounts: snap.accounts, categories: snap.categories })
    else await addTx(draft)
    onClose()
  }

  const remove = async () => {
    if (!tx || !confirm('Bu işlem silinsin mi?')) return
    await deleteTx(tx.id)
    onClose()
  }

  return (
    <Sheet title={cardMode ? 'Kart ödemesi' : tx ? 'İşlemi düzenle' : 'Yeni işlem'} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <Segmented options={KINDS} value={kind} onChange={(v) => {
          if (cardMode) setAutoOff(true)
          setCardMode(false)
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
        {cardMode ? (
          <>
            <div>
              <span className="label">Ödenen hesap</span>
              <PayMethodChips accounts={snap.accounts} value={accountId} onChange={setAccountId} show="liquid" />
            </div>
            <div>
              <span className="label">Kart</span>
              {cards.length ? (
                <PayMethodChips accounts={snap.accounts} value={toAccountId} onChange={setToAccountId} show="cards" onAddCard={() => setAddingCard(true)} />
              ) : (
                <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  Önce kartını ekle.
                  <button type="button" className="btn btn-soft btn-sm ml-2" onClick={() => setAddingCard(true)}>+ Kart ekle</button>
                </div>
              )}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Kart ödemesi gider sayılmaz; harcamalar karta girildiğinde sayılır.</div>
          </>
        ) : kind === 'expense' ? (
          <>
            <Field label="Kategori">
              <CategorySelect categories={snap.categories} kind="expense" value={categoryId} onChange={changeCategory} />
            </Field>
            <div>
              <span className="label">Ödeme yöntemi</span>
              <PayMethodChips accounts={snap.accounts} value={accountId} onChange={pickMethod} onAddCard={() => setAddingCard(true)} />
            </div>
          </>
        ) : (
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
            ) : kind === 'income' ? (
              <Field label="Kategori">
                <CategorySelect categories={snap.categories} kind={kind} value={categoryId} onChange={(v) => { setCatTouched(true); setCategoryId(v) }} />
              </Field>
            ) : null}
          </div>
        )}
        <Field
          label="Tarih"
          hint={date && openingDate && date < openingDate ? 'Bu tarih hesabın açılış bakiyesinden önce; bakiyeye etki etmez.' : undefined}
        >
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        {!tx && kind === 'expense' && !cardMode && !looksLikePayment && (
          billMatch?.kind === 'link' ? (
            <label className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <input type="checkbox" className="mt-0.5" checked={link} onChange={(e) => setLink(e.target.checked)} />
              <span>Faturalar: {billMatch.planName} ({monthName(billMatch.dueDate)}) ödendi olarak işaretlenecek</span>
            </label>
          ) : billMatch?.kind === 'already_paid' ? (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Faturalar: {billMatch.planName} ({monthName(billMatch.dueDate)}) zaten ödendi; bu ayrı bir gider olarak kaydedilir.
            </div>
          ) : (
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={tracking} onChange={(e) => setTrack(e.target.checked)} />
                {billMatch ? "Faturalar'da her ay takip et" : 'Her ay tekrarlanıyor'}
              </label>
              {tracking && (
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Faturalar'a {BILL_TYPE_LABEL[billMatch?.type ?? 'other']} olarak eklenir; sonraki aylar tahmini tutarla beklenen gider olarak görünür.
                </div>
              )}
            </div>
          )
        )}
        {looksLikePayment && !snap.accounts.find((a) => a.id === accountId && isCardAcc(a)) && (
          <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Bu bir kart ödemesi gibi görünüyor. Kart ödemesi gider sayılırsa kartla yaptığın harcamalar iki kez sayılır.
            <button type="button" className="mt-2 block font-semibold underline" onClick={() => toCardMode(note)}>
              Kart ödemesi olarak kaydet
            </button>
          </div>
        )}
        {tx?.occurrenceKey && <div className="text-xs text-slate-500">Bu işlem bir plan vadesini kapatıyor. Silinirse vade tekrar bekliyor olur.</div>}
        <FormError msg={err} />
        <div className="flex gap-2">
          {tx && <button type="button" className="btn btn-danger" onClick={remove}>Sil</button>}
          <button className="btn btn-primary flex-1">Kaydet</button>
        </div>
      </form>
      {addingCard && <AccountFormSheet quickCard onSaved={cardAdded} onClose={() => setAddingCard(false)} />}
    </Sheet>
  )
}
