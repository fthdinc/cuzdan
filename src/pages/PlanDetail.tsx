import { useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  formatMoney, installmentSchedule, loanProgress, occurrencesForPlan, todayISO,
  type CardInstallmentPlan, type Occurrence, type Plan, type Snapshot,
} from '../domain'
import { deletePlan, deleteTx, setSkipped } from '../actions'
import { Amount, Empty, ProgressBar, Section } from '../components/ui'
import { OccBadge, OCC_BORDER, Badge } from '../components/Status'
import { usePay } from '../components/Pay'
import { PlanFormSheet } from '../components/PlanForms'
import { fmtDate } from '../lib/format'
import { FREQ_LABEL, PLAN_KIND_LABEL, installmentProgress, occurrenceHorizon } from '../lib/plans'

export function PlanDetailPage({ snap }: { snap: Snapshot }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const plan = snap.plans.find((p) => p.id === id)
  if (!plan) return <div className="card p-6 text-center text-sm text-slate-500">Plan bulunamadı. <Link className="text-indigo-600" to="/planlar">Planlara dön</Link></div>
  if (plan.kind === 'recurring_expense') return <Navigate to={`/faturalar/${plan.id}`} replace />

  const tab = plan.kind
  const remove = async () => {
    if (plan.kind === 'card_installment') {
      const card = snap.accounts.find((a) => a.id === plan.accountId)
      const today = todayISO()
      if (card && installmentSchedule(plan, card).some((p) => p.index >= plan.preSettledCount && p.kesim <= today)) {
        return alert('Bu alışverişin taksitleri kart ekstresine yansıdığı için silinemez; silinirse faturalanmış kart borcu da kaybolur.')
      }
    }
    if (!confirm(`"${plan.name}" silinsin mi? Bu plana bağlı ödeme işlemleri silinmez.`)) return
    await deletePlan(plan.id)
    navigate(`/planlar?tab=${tab}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to={`/planlar?tab=${tab}`} className="text-sm text-indigo-600 dark:text-indigo-400">‹ Planlar</Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{plan.name}</h1>
            <div className="text-sm text-slate-500">
              {PLAN_KIND_LABEL[plan.kind]} · {snap.accounts.find((a) => a.id === plan.accountId)?.name ?? '?'}
              {!plan.active && ' · pasif'}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-soft" onClick={() => setEditing(true)}>Düzenle</button>
            <button className="btn btn-danger" onClick={remove}>Sil</button>
          </div>
        </div>
      </div>
      <Section><Overview plan={plan} snap={snap} /></Section>
      {plan.kind === 'card_installment'
        ? <Section title="Taksit dağılımı"><InstallmentList plan={plan} snap={snap} /></Section>
        : <Section title="Vadeler"><OccurrenceList plan={plan} snap={snap} /></Section>}
      {editing && <PlanFormSheet snap={snap} kind={plan.kind} plan={plan} onClose={() => setEditing(false)} />}
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

function Overview({ plan, snap }: { plan: Plan; snap: Snapshot }) {
  const today = todayISO()
  if (plan.kind === 'loan') {
    const pr = loanProgress(plan, snap, today)
    const done = plan.totalInstallments - pr.remainingCount
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Kalan borç"><Amount value={pr.remainingAmount} tone="expense" /></Stat>
          <Stat label="Taksit">{formatMoney(plan.installmentAmount)}</Stat>
          <Stat label="Kalan taksit">{pr.remainingCount}/{plan.totalInstallments}</Stat>
        </div>
        <ProgressBar value={done / plan.totalInstallments} tone="green" />
        <div className="flex justify-between text-xs text-slate-500">
          <span>{done} taksit tamamlandı</span>
          {pr.nextDue && <span className={pr.nextDue.status === 'overdue' ? 'text-rose-600 dark:text-rose-400' : ''}>Sonraki vade {fmtDate(pr.nextDue.dueDate, today)}</span>}
        </div>
        {plan.principal !== undefined && (
          <div className="text-xs text-slate-500">
            Anapara {formatMoney(plan.principal)}{plan.monthlyRate !== undefined && ` · aylık faiz %${(plan.monthlyRate * 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`}
          </div>
        )}
      </div>
    )
  }
  if (plan.kind === 'card_installment') {
    const pr = installmentProgress(plan, snap, today)
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Kalan"><Amount value={pr.remainingAmount} tone="expense" /></Stat>
          <Stat label="Toplam">{formatMoney(plan.totalAmount)}</Stat>
          <Stat label="Kalan taksit">{pr.remainingCount}/{plan.installmentCount}</Stat>
        </div>
        <ProgressBar value={pr.billedCount / plan.installmentCount} />
        <div className="text-xs text-slate-500">Alışveriş {fmtDate(plan.purchaseDate)}</div>
      </div>
    )
  }
  const income = plan.kind === 'recurring_income'
  return (
    <div className="grid grid-cols-3 gap-3">
      <Stat label={plan.variable ? 'Tahmini tutar' : 'Tutar'}><Amount value={plan.amount} tone={income ? 'income' : 'expense'} /></Stat>
      <Stat label="Periyot">{FREQ_LABEL[plan.frequency]}</Stat>
      <Stat label="Dönem">{fmtDate(plan.startDate, today)}{plan.endDate ? ` - ${fmtDate(plan.endDate, today)}` : ' →'}</Stat>
    </div>
  )
}

/** Occurrences with pay / skip / undo. Also used by the bill detail page. */
export function OccurrenceList({ plan, snap }: { plan: Plan; snap: Snapshot }) {
  const today = todayISO()
  const { pay, sheet, busy } = usePay(snap)
  let occs = occurrencesForPlan(plan, snap, today, occurrenceHorizon(plan, today))
  const recurring = plan.kind !== 'loan'
  if (recurring) occs = occs.slice(-24).reverse() // newest first, recent history only
  if (!occs.length) return <Empty>Vade yok</Empty>
  const income = plan.kind === 'recurring_income'

  const undo = async (o: Occurrence) => {
    if (o.status === 'skipped') return setSkipped(plan.id, o.index, false)
    if (o.transactionId && confirm('Ödeme kaydı silinsin mi? Vade tekrar bekliyor olur.')) await deleteTx(o.transactionId)
  }

  return (
    <>
      <ul className="space-y-1.5">
        {occs.map((o) => (
          <li key={o.key} className={`flex items-center gap-3 rounded-lg border-l-4 bg-slate-50 px-3 py-2 dark:bg-slate-950/50 ${OCC_BORDER[o.status]}`}>
            <div className="w-8 shrink-0 text-xs tabular-nums text-slate-400">#{o.index + 1}</div>
            <div className="min-w-0 flex-1">
              <div className={`text-sm ${o.status === 'skipped' ? 'text-slate-400 line-through' : ''}`}>{fmtDate(o.dueDate, today)}</div>
              <div className="mt-0.5"><OccBadge status={o.status} /></div>
            </div>
            <div className="text-right">
              {o.status === 'autopay_pending' ? (
                <span className="text-sm tabular-nums text-slate-400">≈ {formatMoney(o.expected)}</span>
              ) : (
                <Amount
                  value={o.actual ?? o.expected}
                  tone={o.status === 'skipped' || o.status === 'presettled' ? 'neutral' : income ? 'income' : 'expense'}
                  className="text-sm font-medium"
                />
              )}
              {o.actual !== undefined && o.actual !== o.expected && (
                <div className="text-[11px] text-slate-400 tabular-nums">beklenen {formatMoney(o.expected)}</div>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              {(o.status === 'pending' || o.status === 'overdue' || o.status === 'autopay_pending') && (
                <>
                  <button className={`btn btn-sm ${o.status === 'autopay_pending' ? 'btn-soft' : 'btn-pay'}`} disabled={busy === o.key} onClick={() => pay({ type: 'occurrence', plan, occurrence: o })}>
                    {o.status === 'autopay_pending' ? 'Tutar gir' : income ? 'Alındı' : 'Öde'}
                  </button>
                  <button className="btn btn-soft btn-sm" onClick={() => setSkipped(plan.id, o.index, true)}>Atla</button>
                </>
              )}
              {(o.status === 'paid' || o.status === 'skipped') && (
                <button className="btn btn-ghost btn-sm" onClick={() => undo(o)}>Geri al</button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {sheet}
    </>
  )
}

function InstallmentList({ plan, snap }: { plan: CardInstallmentPlan; snap: Snapshot }) {
  const today = todayISO()
  const { rows } = installmentProgress(plan, snap, today)
  const look = {
    presettled: { label: 'Önceden faturalandı', cls: 'bg-emerald-50 text-emerald-600/70 dark:bg-emerald-950/30 dark:text-emerald-400/60', icon: '✓' },
    billed: { label: 'Ekstreye yansıdı', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300', icon: '✓' },
    future: { label: 'Bekliyor', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.index} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-950/50">
          <div className="w-8 shrink-0 text-xs tabular-nums text-slate-400">#{r.index + 1}</div>
          <div className="flex-1 text-sm">Kesim {fmtDate(r.kesim, today)}</div>
          <Badge look={look[r.state]} />
          <span className="w-28 text-right text-sm font-medium tabular-nums">{formatMoney(r.amount)}</span>
        </li>
      ))}
    </ul>
  )
}
