import { useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  BILL_PROVIDERS, BILL_TYPE_KEYWORDS, BILL_TYPE_LABEL, billCategoryId, billDefaultName, billInfo, findProvider, parseMoney, todayISO,
  type BillInfo, type BillType, type Frequency, type RecurringPlan, type Snapshot,
} from '../domain'
import { billPayMethod, savePlan } from '../actions'
import { newId } from '../db'
import { moneyToInput } from '../lib/format'
import { FREQ_LABEL } from '../lib/plans'
import { CategorySelect, Field, FormError, MoneyInput, Segmented, Sheet } from './ui'
import { PayMethodChips } from './PayMethod'
import { AccountFormSheet } from './AccountForm'
import { BillIcon } from './BillIcon'

const TYPES = Object.keys(BILL_TYPE_LABEL) as BillType[]

/** Create a bill (recurring_expense plan with bill info; `initialType` presets the type), or edit `plan`. */
export function BillFormSheet({ snap, plan, initialType = 'electricity', onClose }: {
  snap: Snapshot; plan?: RecurringPlan; initialType?: BillType; onClose: () => void
}) {
  const today = todayISO()
  const info = plan ? billInfo(plan) : undefined
  // New bills: rent defaults to the Kira category and a fixed amount, transport to Ulaşım; others to Fatura and a variable amount.
  const defaultCat = (t: BillType) => billCategoryId(t, snap.categories) ?? ''
  const [type, setType] = useState<BillType>(info?.type ?? initialType)
  const [provider, setProvider] = useState(info?.provider ?? '')
  const [name, setName] = useState(plan?.name ?? '')
  const [nameTouched, setNameTouched] = useState(!!plan)
  const [subscriberNo, setSubscriberNo] = useState(info?.subscriberNo ?? '')
  // Paid from bank/cash by default; a card only when it was last used for the type's category.
  const defaultAccount = (t: BillType) => billPayMethod(snap.accounts, defaultCat(t) || undefined) ?? ''
  const [accountId, setAccountId] = useState(plan?.accountId ?? defaultAccount(initialType))
  const [categoryId, setCategoryId] = useState(plan?.categoryId ?? defaultCat(initialType))
  const [autopay, setAutopay] = useState(info?.autopay ?? false)
  const [variable, setVariable] = useState(plan?.variable ?? initialType !== 'rent')
  const [amount, setAmount] = useState(moneyToInput(plan?.amount))
  const [frequency, setFrequency] = useState<Frequency>(plan?.frequency ?? 'monthly')
  const [startDate, setStartDate] = useState(plan?.startDate ?? today)
  const [settlePast, setSettlePast] = useState(true)
  const [keywords, setKeywords] = useState<string[]>(info?.matchKeywords ?? BILL_TYPE_KEYWORDS[initialType] ?? [])
  const [kwInput, setKwInput] = useState('')
  const [active, setActive] = useState(plan?.active ?? true)
  const [err, setErr] = useState<string | null>(null)
  // Payment history is keyed by occurrence index; changing the schedule would re-map it.
  const scheduleLocked = !!plan && (
    Object.keys(plan.overrides ?? {}).length > 0 ||
    snap.transactions.some((t) => t.occurrenceKey?.startsWith(`${plan.id}:`))
  )

  const shownName = nameTouched ? name : billDefaultName(type, provider.trim() || undefined)
  const suggestions = BILL_PROVIDERS.filter((p) => p.type === type)
  const isRent = type === 'rent'
  const [addingCard, setAddingCard] = useState(false)

  const chooseType = (t: BillType) => {
    setType(t)
    if (plan) return
    // Replace defaults of the previous type; keep what the user changed.
    if (categoryId === defaultCat(type)) setCategoryId(defaultCat(t))
    if (accountId === defaultAccount(type)) setAccountId(defaultAccount(t))
    setVariable(t !== 'rent')
    const prov = findProvider(provider)
    if (prov && prov.type !== t) setProvider('')
    const prevDefault = prov?.keywords ?? BILL_TYPE_KEYWORDS[type] ?? []
    if (!keywords.length || keywords.join() === prevDefault.join()) setKeywords(BILL_TYPE_KEYWORDS[t] ?? [])
  }

  const pickProvider = (v: string) => {
    setProvider(v)
    const prov = isRent ? undefined : findProvider(v)
    if (prov) {
      setType(prov.type)
      setKeywords(prov.keywords)
    }
  }
  const addKeyword = () => {
    const k = kwInput.trim()
    if (k && !keywords.some((x) => x.toLocaleLowerCase('tr') === k.toLocaleLowerCase('tr'))) setKeywords([...keywords, k])
    setKwInput('')
  }
  const onKwKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addKeyword() }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    const finalName = shownName.trim()
    if (!finalName) return setErr('Ad girin')
    const eligible = snap.accounts.filter((a) => !a.archived)
    const accId = eligible.some((a) => a.id === accountId) ? accountId : eligible[0]?.id
    if (!accId) return setErr('Hesap seçin')
    const a = parseMoney(amount)
    if (!a || a <= 0) return setErr(variable ? 'Tahmini tutar girin' : 'Geçerli bir tutar girin')
    const bill: BillInfo = { type, autopay, matchKeywords: keywords }
    if (provider.trim()) bill.provider = provider.trim()
    if (subscriberNo.trim()) bill.subscriberNo = subscriberNo.trim()
    const common = { name: finalName, accountId: accId, categoryId: categoryId || undefined, amount: a, variable, bill }
    if (plan) {
      const sched = scheduleLocked ? { frequency: plan.frequency, startDate: plan.startDate } : { frequency, startDate }
      if (plan.endDate && plan.endDate < sched.startDate) return setErr('İlk vade planın bitiş tarihinden sonra olamaz')
      await savePlan({ ...plan, ...common, ...sched, active })
    } else {
      await savePlan({
        ...common, id: newId(), kind: 'recurring_expense', createdAt: Date.now(), active: true, frequency, startDate,
        settledBefore: settlePast && startDate < today ? today : undefined,
      })
    }
    onClose()
  }

  return (
    <Sheet title={plan ? 'Faturayı düzenle' : 'Fatura / sabit gider ekle'} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <div>
          <span className="label">Tür</span>
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map((t) => (
              <button
                key={t} type="button" onClick={() => chooseType(t)}
                className={`flex items-center gap-2 rounded-xl border p-2 text-left text-xs font-medium transition ${
                  type === t ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <BillIcon type={t} size="sm" />
                <span className="min-w-0 truncate">{BILL_TYPE_LABEL[t]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={isRent ? 'Ev sahibi / açıklama' : 'Kurum'}>
            <input className="input" list={isRent ? undefined : 'bill-providers'} value={provider} onChange={(e) => pickProvider(e.target.value)}
              placeholder={isRent ? 'İsteğe bağlı' : suggestions[0] ? `ör. ${suggestions[0].name}` : 'İsteğe bağlı'} />
            {!isRent && (
              <datalist id="bill-providers">
                {suggestions.map((p) => <option key={p.name} value={p.name} />)}
              </datalist>
            )}
          </Field>
          <Field label="Abone / tesisat no">
            <input className="input" value={subscriberNo} onChange={(e) => setSubscriberNo(e.target.value)} placeholder="İsteğe bağlı" />
          </Field>
        </div>
        <Field label="Ad">
          <input className="input" value={shownName} onChange={(e) => { setNameTouched(true); setName(e.target.value) }} placeholder={isRent ? 'ör. Ev kirası' : 'ör. Ev elektriği'} />
        </Field>
        <Field label="Kategori">
          <CategorySelect categories={snap.categories} kind="expense" value={categoryId} onChange={setCategoryId} />
        </Field>
        <div>
          <span className="label">Ödeme yöntemi</span>
          <PayMethodChips accounts={snap.accounts} value={accountId} onChange={setAccountId} onAddCard={() => setAddingCard(true)} />
          {snap.accounts.some((a) => a.id === accountId && a.kind === 'credit_card') && (
            <div className="mt-1 text-xs text-slate-500">Kartla ödenen fatura karta harcama olarak işlenir; ekstreyle ödenir.</div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
          Otomatik ödeme talimatı var
        </label>
        {autopay && <div className="-mt-1 text-xs text-slate-500">Vadesi geçen fatura "Gecikti" yerine "Otomatik ödendi · tutar bekleniyor" görünür; tutarı ekstre içe aktarınca ya da elle girersiniz.</div>}

        <div className="grid grid-cols-2 gap-3">
          <Field label={variable ? 'Tahmini tutar' : 'Tutar'}><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="İlk vade (son ödeme)">
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={scheduleLocked} required />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={variable} onChange={(e) => setVariable(e.target.checked)} />
          Tutar her dönem değişir (son 3 ödemenin ortalaması tahmin edilir)
        </label>
        <Segmented
          options={(Object.keys(FREQ_LABEL) as Frequency[]).map((f) => ({ value: f, label: FREQ_LABEL[f] }))}
          value={frequency}
          onChange={setFrequency}
          disabled={scheduleLocked}
        />
        {scheduleLocked
          ? <div className="text-xs text-slate-500">Periyot ve ilk vade: Geçmiş ödemeler olduğu için değiştirilemez; faturayı pasif yapıp yenisini oluşturun.</div>
          : <div className="text-xs text-slate-500">Sonraki vadeler aynı gün tekrarlanır (ay sonuna kırpılır).</div>}
        {!plan && startDate < today && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settlePast} onChange={(e) => setSettlePast(e.target.checked)} />
            Bugünden önceki vadeler ödenmiş sayılsın
          </label>
        )}

        <div>
          <span className="label">Ekstre eşleştirme kelimeleri</span>
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((k) => (
              <span key={k} className="chip inline-flex items-center gap-1">
                {k}
                <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => setKeywords(keywords.filter((x) => x !== k))} aria-label={`${k} kaldır`}>✕</button>
              </span>
            ))}
            {!keywords.length && <span className="text-xs text-slate-400">Yok. Kurum seçince otomatik dolar.</span>}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="input" value={kwInput} onChange={(e) => setKwInput(e.target.value)} onKeyDown={onKwKey} placeholder="ör. ENERJISA" />
            <button type="button" className="btn btn-soft" onClick={addKeyword} disabled={!kwInput.trim()}>Ekle</button>
          </div>
          <div className="mt-1 text-xs text-slate-500">Ekstre açıklamasında bu kelimelerden biri geçerse satır bu faturaya bağlanır (büyük/küçük harf ve Türkçe karakter fark etmez).</div>
        </div>

        {plan && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Aktif
          </label>
        )}
        <FormError msg={err} />
        <button className="btn btn-primary w-full">Kaydet</button>
      </form>
      {addingCard && <AccountFormSheet quickCard onSaved={setAccountId} onClose={() => setAddingCard(false)} />}
    </Sheet>
  )
}
