import { useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  BILL_TYPE_LABEL, billHistory, billInfo, billThisMonth, changeRatio, estimatedBillAmount, formatMoney, todayISO,
  type BillMonth, type Kurus, type RecurringPlan, type Snapshot,
} from '../domain'
import { deletePlan } from '../actions'
import { Empty, Section } from '../components/ui'
import { BillIcon } from '../components/BillIcon'
import { BillFormSheet } from '../components/BillForm'
import { OccurrenceList } from './PlanDetail'
import { Change } from './Bills'
import { FREQ_LABEL } from '../lib/plans'
import { monthLabel } from '../lib/format'

export function BillDetailPage({ snap }: { snap: Snapshot }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const plan = snap.plans.find((p) => p.id === id)
  if (!plan) return <div className="card p-6 text-center text-sm text-slate-500">Fatura bulunamadı. <Link className="text-indigo-600" to="/faturalar">Faturalara dön</Link></div>
  if (plan.kind !== 'recurring_expense') return <Navigate to={`/planlar/${plan.id}`} replace />

  const info = billInfo(plan)
  const account = snap.accounts.find((a) => a.id === plan.accountId)?.name ?? '?'
  const remove = async () => {
    if (!confirm(`"${plan.name}" silinsin mi? Bu faturaya bağlı ödeme işlemleri silinmez.`)) return
    await deletePlan(plan.id)
    navigate('/faturalar')
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to="/faturalar" className="text-sm text-indigo-600 dark:text-indigo-400">‹ Faturalar</Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <BillIcon type={info.type} />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">{plan.name}</h1>
              <div className="text-sm text-slate-500">
                {[BILL_TYPE_LABEL[info.type], info.provider, account, FREQ_LABEL[plan.frequency]].filter(Boolean).join(' · ')}
                {!plan.active && ' · pasif'}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {info.autopay && <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">Otomatik ödeme</span>}
                {info.subscriberNo && <span className="text-slate-400">Abone no {info.subscriberNo}</span>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button className="btn btn-soft" onClick={() => setEditing(true)}>Düzenle</button>
            <button className="btn btn-danger" onClick={remove}>Sil</button>
          </div>
        </div>
      </div>
      <Section title="Son 12 ay"><History plan={plan} snap={snap} /></Section>
      <Section title="Vadeler"><OccurrenceList plan={plan} snap={snap} /></Section>
      {editing && <BillFormSheet snap={snap} plan={plan} onClose={() => setEditing(false)} />}
    </div>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums">{children}</div>
    </div>
  )
}

function History({ plan, snap }: { plan: RecurringPlan; snap: Snapshot }) {
  const today = todayISO()
  const hist = billHistory(plan, snap, today, 12)
  const paid = hist.filter((h) => h.amount !== null).map((h) => h.amount!)
  const now = billThisMonth(plan, snap, today)
  const estimate = plan.active && hist[11].amount === null && now.amount > 0 ? now.amount : null
  const latest = [...hist].reverse().find((h) => h.amount !== null)
  const avg = paid.length ? Math.round(paid.reduce((s, a) => s + a, 0) / paid.length) : null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={plan.variable ? 'Tahmini tutar' : 'Tutar'}>{formatMoney(estimatedBillAmount(plan, snap))}</Stat>
        <Stat label="Ortalama">{avg !== null ? formatMoney(avg) : '-'}</Stat>
        <Stat label="En düşük / en yüksek">{paid.length ? `${formatMoney(Math.min(...paid))} / ${formatMoney(Math.max(...paid))}` : '-'}</Stat>
        <Stat label={latest ? `${monthLabel(latest.month)}, geçen yıla göre` : 'Geçen yıla göre'}>
          {latest && latest.lastYear !== null
            ? <><Change ratio={changeRatio(latest.amount, latest.lastYear)} /> <span className="text-xs font-normal text-slate-400">({formatMoney(latest.lastYear)})</span></>
            : <span className="text-sm font-normal text-slate-400">veri yok</span>}
        </Stat>
      </div>
      {paid.length === 0 && estimate === null ? <Empty>Henüz ödeme kaydı yok</Empty> : <BarChart hist={hist} estimate={estimate} />}
    </div>
  )
}

const SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/** Paid amount per month; this month's estimate as a muted bar when not paid yet. */
function BarChart({ hist, estimate }: { hist: BillMonth[]; estimate: Kurus | null }) {
  const [hover, setHover] = useState<number | null>(null)
  // Fixed pixel height, x in percent so bars and labels keep their size at any width.
  const H = 150, TOP = 12, BASE = 128, slot = 100 / hist.length, bw = slot * 0.7
  const values = hist.map((h, i) => h.amount ?? (i === hist.length - 1 ? estimate : null))
  const max = Math.max(1, ...values.map((v) => v ?? 0))
  const lastPaid = hist.reduce((acc, h, i) => (h.amount !== null ? i : acc), -1)
  const shown = hover ?? (lastPaid >= 0 ? lastPaid : hist.length - 1)
  return (
    <div>
      <div className="mb-1 h-5 text-xs text-slate-500">
        {values[shown] !== null && (
          <>
            {monthLabel(hist[shown].month)}: <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
              {hist[shown].amount === null && '≈ '}{formatMoney(values[shown]!)}
            </span>
            {hist[shown].amount === null && ' (tahmini)'}
          </>
        )}
      </div>
      <svg width="100%" height={H} role="img" aria-label="Son 12 ayın fatura tutarları">
        <line x1="0" x2="100%" y1={BASE + 0.5} y2={BASE + 0.5} className="stroke-slate-200 dark:stroke-slate-700" />
        {hist.map((h, i) => {
          const v = values[i]
          const x = i * slot + (slot - bw) / 2
          const bh = v ? Math.max(2, ((BASE - TOP) * v) / max) : 0
          const est = h.amount === null
          const r = Math.min(4, bh / 2)
          const fill = est
            ? 'fill-slate-200 stroke-slate-400 dark:fill-slate-800 dark:stroke-slate-500'
            : hover === i ? 'fill-indigo-600 dark:fill-indigo-300' : 'fill-indigo-500 dark:fill-indigo-400'
          return (
            <g key={h.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={`${i * slot}%`} y={0} width={`${slot}%`} height={H} fill="transparent" />
              {v !== null && (
                <>
                  {/* rounded top; a square strip squares off the baseline end */}
                  <rect x={`${x}%`} y={BASE - bh} width={`${bw}%`} height={bh} rx={r} className={fill} strokeDasharray={est ? '3 2' : undefined}>
                    <title>{`${monthLabel(h.month)}: ${est ? '≈ ' : ''}${formatMoney(v)}`}</title>
                  </rect>
                  {!est && <rect x={`${x}%`} y={BASE - r} width={`${bw}%`} height={r} className={fill} />}
                </>
              )}
              <text x={`${x + bw / 2}%`} y={H - 6} textAnchor="middle" className="fill-slate-400 text-[10px]">{SHORT[Number(h.month.slice(5)) - 1]}</text>
            </g>
          )
        })}
      </svg>
      <details className="mt-2 text-xs text-slate-500">
        <summary className="cursor-pointer">Tablo olarak göster</summary>
        <table className="mt-2 w-full tabular-nums">
          <tbody>
            {[...hist].reverse().map((h) => (
              <tr key={h.month} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-1">{monthLabel(h.month)}</td>
                <td className="py-1 text-right">{h.amount !== null ? formatMoney(h.amount) : '-'}</td>
                <td className="py-1 text-right"><Change ratio={changeRatio(h.amount, h.prev)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
