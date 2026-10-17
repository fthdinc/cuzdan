import { useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  BILL_PROVIDERS, BILL_TYPE_LABEL, billDefaultName, billInfo, findProvider, parseMoney, todayISO,
  type BillInfo, type BillType, type Frequency, type RecurringPlan, type Snapshot,
} from '../domain'
import { savePlan } from '../actions'
import { newId } from '../db'
import { moneyToInput } from '../lib/format'
import { FREQ_LABEL } from '../lib/plans'
import { AccountSelect, CategorySelect, Field, FormError, MoneyInput, Segmented, Sheet } from './ui'
import { BillIcon } from './BillIcon'

const TYPES = Object.keys(BILL_TYPE_LABEL) as BillType[]

/** Create a bill (recurring_expense plan with bill info), or edit `plan`. */
export function BillFormSheet({ snap, plan, onClose }: { snap: Snapshot; plan?: RecurringPlan; onClose: () => void }) {
  const today = todayISO()
  const info = plan ? billInfo(plan) : undefined
  const [type, setType] = useState<BillType>(info?.type ?? 'electricity')
  const [provider, setProvider] = useState(info?.provider ?? '')
  const [name, setName] = useState(plan?.name ?? '')
  const [nameTouched, setNameTouched] = useState(!!plan)
  const [subscriberNo, setSubscriberNo] = useState(info?.subscriberNo ?? '')
  const [accountId, setAccountId] = useState(plan?.accountId ?? snap.accounts.find((a) => !a.archived)?.id ?? '')
  const [categoryId, setCategoryId] = useState(plan?.categoryId ?? snap.categories.find((c) => c.kind === 'expense' && c.name === 'Fatura')?.id ?? '')
  const [autopay, setAutopay] = useState(info?.autopay ?? false)
  const [variable, setVariable] = useState(plan?.variable ?? true)
  const [amount, setAmount] = useState(moneyToInput(plan?.amount))
  const [frequency, setFrequency] = useState<Frequency>(plan?.frequency ?? 'monthly')
  const [startDate, setStartDate] = useState(plan?.startDate ?? today)
  const [settlePast, setSettlePast] = useState(true)
  const [keywords, setKeywords] = useState<string[]>(info?.matchKeywords ?? [])
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

  const pickProvider = (v: string) => {
    setProvider(v)
    const prov = findProvider(v)
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
    <Sheet title={plan ? 'Faturayı düzenle' : 'Fatura ekle'} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <div>
          <span className="label">Tür</span>
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map((t) => (
              <button
                key={t} type="button" onClick={() => setType(t)}
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
          <Field label="Kurum">
            <input className="input" list="bill-providers" value={provider} onChange={(e) => pickProvider(e.target.value)} placeholder="ör. Enerjisa" />
            <datalist id="bill-providers">
              {suggestions.map((p) => <option key={p.name} value={p.name} />)}
            </datalist>
          </Field>
          <Field label="Abone / tesisat no">
            <input className="input" value={subscriberNo} onChange={(e) => setSubscriberNo(e.target.value)} placeholder="İsteğe bağlı" />
          </Field>
        </div>
        <Field label="Ad">
          <input className="input" value={shownName} onChange={(e) => { setNameTouched(true); setName(e.target.value) }} placeholder="ör. Ev elektriği" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ödeyen hesap / kart">
            <AccountSelect accounts={snap.accounts} value={accountId} onChange={setAccountId} allowEmpty={accountId ? undefined : 'Seçin'} />
          </Field>
          <Field label="Kategori">
            <CategorySelect categories={snap.categories} kind="expense" value={categoryId} onChange={setCategoryId} />
          </Field>
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
    </Sheet>
  )
}
