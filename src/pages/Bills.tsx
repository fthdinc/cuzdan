import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BILL_TYPE_LABEL, billHistory, billInfo, billThisMonth, changeRatio, formatMoney, occurrencesForPlan, todayISO,
  type BillType, type Occurrence, type RecurringPlan, type Snapshot,
} from '../domain'
import { Empty, PageHeader } from '../components/ui'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { OccBadge } from '../components/Status'
import { BillIcon } from '../components/BillIcon'
import { BillFormSheet } from '../components/BillForm'
import { BillSuggestions } from '../components/BillSuggestions'
import { usePay, type PayTarget } from '../components/Pay'
import { fmtDate, monthLabel } from '../lib/format'

const TYPES = Object.keys(BILL_TYPE_LABEL) as BillType[]
const isOpen = (o: Occurrence) => o.status === 'pending' || o.status === 'overdue' || o.status === 'autopay_pending'

export function BillsPage({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const [adding, setAdding] = useState(false)
  const { pay, sheet, busy } = usePay(snap)
  const bills = snap.plans
    .filter((p): p is RecurringPlan => p.kind === 'recurring_expense')
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'tr'))
  const months = new Map(bills.map((b) => [b.id, billThisMonth(b, snap, today)]))

  let total = 0
  let paidTotal = 0
  let estimated = false
  const count = { paid: 0, pending: 0, autopay: 0 }
  for (const m of months.values()) {
    total += m.amount
    estimated ||= m.estimated
    for (const o of m.occurrences) {
      if (o.status === 'paid') { count.paid++; paidTotal += o.actual ?? o.expected }
      else if (o.status === 'autopay_pending') count.autopay++
      else if (o.status === 'pending' || o.status === 'overdue') count.pending++
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Faturalar ve düzenli giderler" action={<button className="btn btn-primary shrink-0" onClick={() => setAdding(true)}>+ Ekle</button>} />
      <section className="card p-4">
        <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">{monthLabel(today.slice(0, 7))} faturaları</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{estimated && <span className="text-slate-400">≈ </span>}{formatMoney(total)}</div>
        <div className="mt-1 text-xs text-slate-500">
          Ödenen {formatMoney(paidTotal)}{total > paidTotal && <> · bekleyen {estimated ? '≈ ' : ''}{formatMoney(total - paidTotal)}</>}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Count label="Ödendi" value={count.paid} cls="text-emerald-600 dark:text-emerald-400" />
          <Count label="Bekliyor" value={count.pending} cls="text-amber-600 dark:text-amber-400" />
          <Count label="Otomatik, tutar bekleniyor" value={count.autopay} cls="text-sky-600 dark:text-sky-400" />
        </div>
      </section>

      <BillSuggestions snap={snap} />

      {bills.length === 0 ? (
        <div className="card"><Empty>Henüz kayıt yok. Gider girerken elektrik, su, doğalgaz, telefon, abonelik ve ulaşım (Akbil, İstanbulkart) ödemelerin otomatik olarak buraya gelir. Kira, aidat, sigorta ve okulu + Ekle ile ekleyebilirsin.</Empty></div>
      ) : TYPES.map((t) => {
        const group = bills.filter((b) => billInfo(b).type === t)
        if (!group.length) return null
        return (
          <section key={t} className="card p-2">
            <h2 className="px-2 pb-1 pt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">{BILL_TYPE_LABEL[t]}</h2>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {group.map((b) => (
                <li key={b.id}>
                  <ErrorBoundary><BillRow plan={b} snap={snap} today={today} busy={busy} onPay={pay} /></ErrorBoundary>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {adding && <BillFormSheet snap={snap} onClose={() => setAdding(false)} />}
      {sheet}
    </div>
  )
}

function Count({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-950/60">
      <div className={`text-lg font-semibold tabular-nums ${value ? cls : 'text-slate-400'}`}>{value}</div>
      <div className="text-[11px] leading-tight text-slate-500">{label}</div>
    </div>
  )
}

/** ▲ red for increases, ▼ green for decreases. */
export function Change({ ratio, suffix }: { ratio: number | null; suffix?: string }) {
  if (ratio === null) return null
  const pct = Math.round(Math.abs(ratio) * 100)
  if (pct === 0) return <span className="text-xs text-slate-400">= {suffix}</span>
  const up = ratio > 0
  return (
    <span className={`whitespace-nowrap text-xs font-medium ${up ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
      {up ? '▲' : '▼'} %{pct}{suffix && <span className="font-normal text-slate-400"> {suffix}</span>}
    </span>
  )
}

function BillRow({ plan, snap, today, busy, onPay }: {
  plan: RecurringPlan; snap: Snapshot; today: string; busy: string | null; onPay: (t: PayTarget) => void
}) {
  const info = billInfo(plan)
  const month = billThisMonth(plan, snap, today)
  // Oldest unpaid occurrence up to the end of this month (an older overdue one comes first).
  const open = occurrencesForPlan(plan, snap, today, `${today.slice(0, 7)}-31`).find(isOpen)
  const status = open?.status ?? month.status
  const hist = billHistory(plan, snap, today, 2)
  const ref = hist[1].amount !== null ? hist[1] : hist[0] // this month if paid, else last month
  const ratio = changeRatio(ref.amount, ref.prev)
  const account = snap.accounts.find((a) => a.id === plan.accountId)?.name
  const showProvider = info.provider && !plan.name.toLocaleLowerCase('tr').includes(info.provider.toLocaleLowerCase('tr'))

  return (
    <div className={`flex items-center gap-3 px-2 py-3 ${plan.active ? '' : 'opacity-60'}`}>
      <Link to={`/faturalar/${plan.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <BillIcon type={info.type} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {plan.name}{showProvider && <span className="font-normal text-slate-400"> · {info.provider}</span>}
            {!plan.active && <span className="ml-2 text-xs text-slate-400">(pasif)</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="truncate">{account ?? '?'}</span>
            {info.autopay && <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">Otomatik ödeme</span>}
          </div>
          {plan.active && status && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <OccBadge status={status} />
              {open && open.dueDate.slice(0, 7) !== today.slice(0, 7) && <span className="text-[11px] text-slate-400">{fmtDate(open.dueDate, today)}</span>}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          {plan.active && month.occurrences.length > 0 && (
            <div className={`text-sm tabular-nums ${month.estimated ? 'text-slate-400' : 'font-semibold text-rose-600 dark:text-rose-400'}`}>
              {month.estimated && '≈ '}{formatMoney(month.amount)}
            </div>
          )}
          <Change ratio={ratio} />
        </div>
      </Link>
      {plan.active && open && (
        <button
          className={`btn btn-sm shrink-0 ${open.status === 'autopay_pending' ? 'btn-soft' : 'btn-pay'}`}
          disabled={busy === open.key}
          onClick={() => onPay({ type: 'occurrence', plan, occurrence: open })}
        >
          {open.status === 'autopay_pending' ? 'Tutar gir' : 'Öde'}
        </button>
      )}
    </div>
  )
}
