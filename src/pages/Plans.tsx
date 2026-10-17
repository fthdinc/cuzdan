import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  addDays, formatMoney, loanProgress, occurrencesForPlan, todayISO,
  type Plan, type PlanKind, type Snapshot,
} from '../domain'
import { Amount, Empty, PageHeader, ProgressBar, Segmented } from '../components/ui'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { OccBadge } from '../components/Status'
import { PlanFormSheet } from '../components/PlanForms'
import { fmtDate } from '../lib/format'
import { FREQ_LABEL, installmentProgress } from '../lib/plans'

const TABS: { value: PlanKind; label: string; add: string }[] = [
  { value: 'loan', label: 'Krediler', add: 'Kredi ekle' },
  { value: 'card_installment', label: 'Taksitler', add: 'Taksit ekle' },
  { value: 'recurring_expense', label: 'Faturalar', add: 'Fatura ekle' },
  { value: 'recurring_income', label: 'Gelirler', add: 'Gelir ekle' },
]

export function PlansPage({ snap }: { snap: Snapshot }) {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'loan') as PlanKind
  const [adding, setAdding] = useState(false)
  const plans = snap.plans.filter((p) => p.kind === tab).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'tr'))
  const meta = TABS.find((t) => t.value === tab)!
  const noCard = tab === 'card_installment' && !snap.accounts.some((a) => a.kind === 'credit_card' && !a.archived)

  return (
    <div className="space-y-4">
      <PageHeader title="Planlar" action={<button className="btn btn-primary" disabled={noCard} onClick={() => setAdding(true)}>+ {meta.add}</button>} />
      <Segmented options={TABS} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} />
      {noCard && <div className="card p-4 text-sm text-slate-500">Taksit eklemek için önce Ayarlar'dan bir kredi kartı ekleyin.</div>}
      {plans.length === 0 ? (
        <div className="card"><Empty>Henüz kayıt yok</Empty></div>
      ) : (
        <div className="space-y-3">
          {plans.map((p) => (
            <Link key={p.id} to={`/planlar/${p.id}`} className={`card block p-4 transition hover:border-indigo-300 dark:hover:border-indigo-800 ${p.active ? '' : 'opacity-60'}`}>
              <ErrorBoundary><PlanCard plan={p} snap={snap} /></ErrorBoundary>
            </Link>
          ))}
        </div>
      )}
      {adding && <PlanFormSheet snap={snap} kind={tab} onClose={() => setAdding(false)} />}
    </div>
  )
}

function PlanCard({ plan, snap }: { plan: Plan; snap: Snapshot }) {
  const today = todayISO()
  const account = snap.accounts.find((a) => a.id === plan.accountId)?.name
  const head = (right: ReactNode, sub: string) => (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate font-medium">{plan.name}{!plan.active && <span className="ml-2 text-xs text-slate-400">(pasif)</span>}</div>
        <div className="text-xs text-slate-400">{sub}</div>
      </div>
      <div className="text-right">{right}</div>
    </div>
  )

  if (plan.kind === 'loan') {
    const pr = loanProgress(plan, snap, today)
    const paid = plan.totalInstallments - pr.remainingCount
    return (
      <>
        {head(<><Amount value={pr.remainingAmount} tone="expense" className="font-semibold" /><div className="text-xs text-slate-400">kalan</div></>,
          `${account ?? ''} · aylık ${formatMoney(plan.installmentAmount)}`)}
        <div className="mt-3"><ProgressBar value={paid / plan.totalInstallments} tone="green" /></div>
        <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
          <span>{paid}/{plan.totalInstallments} taksit ödendi</span>
          {pr.nextDue && <span className="flex items-center gap-1.5">Sonraki {fmtDate(pr.nextDue.dueDate, today)} <OccBadge status={pr.nextDue.status} /></span>}
        </div>
      </>
    )
  }

  if (plan.kind === 'card_installment') {
    const pr = installmentProgress(plan, snap, today)
    return (
      <>
        {head(<><Amount value={pr.remainingAmount} tone="expense" className="font-semibold" /><div className="text-xs text-slate-400">kalan</div></>,
          `${account ?? ''} · ${plan.installmentCount} x ${formatMoney(Math.floor(plan.totalAmount / plan.installmentCount))}`)}
        <div className="mt-3"><ProgressBar value={pr.billedCount / plan.installmentCount} /></div>
        <div className="mt-1.5 flex justify-between text-xs text-slate-500">
          <span>{pr.billedCount}/{plan.installmentCount} taksit ekstreye yansıdı</span>
          {pr.next && <span>Sonraki kesim {fmtDate(pr.next.kesim, today)}</span>}
        </div>
      </>
    )
  }

  const occs = occurrencesForPlan(plan, snap, today, addDays(today, 400))
  const next = occs.find((o) => o.status === 'overdue') ?? occs.find((o) => o.status === 'pending')
  const income = plan.kind === 'recurring_income'
  return (
    <>
      {head(<><Amount value={plan.amount} tone={income ? 'income' : 'expense'} className="font-semibold" />{plan.variable && <div className="text-xs text-slate-400">tahmini</div>}</>,
        `${account ?? ''} · ${FREQ_LABEL[plan.frequency]}${plan.endDate ? ` · ${fmtDate(plan.endDate)} bitiş` : ''}`)}
      {next && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          Sonraki vade {fmtDate(next.dueDate, today)} <OccBadge status={next.status} />
        </div>
      )}
    </>
  )
}
