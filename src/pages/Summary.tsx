import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  accountBalance, addDays, debtSummary, formatMoney, monthSummary, todayISO, upcoming,
  type Snapshot, type UpcomingItem,
} from '../domain'
import { Amount, Empty, PageHeader, Section } from '../components/ui'
import { OccBadge, StmtBadge } from '../components/Status'
import { usePay } from '../components/Pay'
import { QuickAdd } from '../components/QuickAdd'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { fmtDate, monthLabel, relDay } from '../lib/format'

const KIND_LABEL = { cash: 'Nakit', bank: 'Banka', credit_card: 'Kredi kartı' }

export function SummaryPage({ snap }: { snap: Snapshot }) {
  return (
    <div className="space-y-4">
      <PageHeader title="Özet" />
      <ErrorBoundary><QuickAdd snap={snap} /></ErrorBoundary>
      <Section><MonthCards snap={snap} /></Section>
      <Section title="Yaklaşan 30 gün"><Upcoming snap={snap} /></Section>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Hesaplar"><Balances snap={snap} /></Section>
        <Section title="Toplam borç"><Debt snap={snap} /></Section>
      </div>
    </div>
  )
}

function MonthCards({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const m = monthSummary(snap, today.slice(0, 7), today)
  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400">{monthLabel(m.month)}</div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Gelir" value={<Amount value={m.income} tone="income" />} sub={m.projectedIncome > 0 ? <>+ <Amount value={m.projectedIncome} tone="neutral" /> beklenen</> : null} />
        <Stat label="Gider" value={<Amount value={m.expense} tone="expense" />} sub={m.projectedExpense > 0 ? <>+ <Amount value={m.projectedExpense} tone="neutral" /> beklenen</> : null} />
        <Stat label="Net" value={<Amount value={m.net} signed />} />
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-base font-semibold sm:text-lg">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
}

function Balances({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const accounts = snap.accounts.filter((a) => !a.archived)
  const rows = accounts.map((a) => ({ a, bal: accountBalance(a, snap, today) }))
  const cash = rows.filter((r) => r.a.kind !== 'credit_card').reduce((s, r) => s + r.bal, 0)
  return (
    <div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map(({ a, bal }) => (
          <li key={a.id} className="flex items-center justify-between py-2">
            <div>
              <div className="text-sm font-medium">{a.name}</div>
              <div className="text-xs text-slate-400">{KIND_LABEL[a.kind]}</div>
            </div>
            <Amount value={bal} className="font-medium" />
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
        <span className="text-slate-500">Nakit + banka</span>
        <Amount value={cash} className="font-semibold" />
      </div>
    </div>
  )
}

function Debt({ snap }: { snap: Snapshot }) {
  const d = debtSummary(snap, todayISO())
  const row = (label: string, v: number) => (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <Amount value={v} tone={v > 0 ? 'expense' : 'neutral'} />
    </div>
  )
  return (
    <div>
      <div className="mb-2 text-2xl font-semibold"><Amount value={d.total} tone={d.total > 0 ? 'expense' : 'neutral'} /></div>
      {row('Kalan kredi taksitleri', d.loansRemaining)}
      {row('Kart borçları', d.cardsCurrent)}
      {row('Faturalanmamış taksitler', d.cardsFutureInstallments)}
    </div>
  )
}

function Upcoming({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const items = upcoming(snap, today, addDays(today, 30))
  const { pay, sheet, busy } = usePay(snap)
  if (!items.length) return <Empty>Önümüzdeki 30 günde ödeme yok</Empty>
  return (
    <>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((it) => <UpcomingRow key={itemKey(it)} it={it} today={today} busy={busy === itemKey(it)} onPay={() => pay(
          it.type === 'occurrence'
            ? { type: 'occurrence', plan: it.plan, occurrence: it.occurrence }
            : { type: 'statement', card: it.card, statement: it.statement },
        )} />)}
      </ul>
      {sheet}
    </>
  )
}

const itemKey = (it: UpcomingItem) => (it.type === 'occurrence' ? it.occurrence.key : `${it.card.id}:${it.statement.periodEnd}`)

function UpcomingRow({ it, today, busy, onPay }: { it: UpcomingItem; today: string; busy: boolean; onPay: () => void }) {
  const autopay = it.type === 'occurrence' && it.occurrence.status === 'autopay_pending'
  const overdue = it.dueDate < today && !autopay
  const isIncome = it.type === 'occurrence' && it.plan.kind === 'recurring_income'
  const name = it.type === 'occurrence' ? it.plan.name : `${it.card.name} ekstresi`
  const link = it.type === 'statement' ? '/kartlar' : it.plan.kind === 'recurring_expense' ? `/faturalar/${it.plan.id}` : `/planlar/${it.plan.id}`
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className={`w-14 shrink-0 text-center text-xs font-medium ${overdue ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>
        {overdue ? 'Gecikti' : relDay(it.dueDate, today)}
        {overdue && <div className="font-normal">{fmtDate(it.dueDate, today)}</div>}
      </div>
      <Link to={link} className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="mt-0.5">
          {it.type === 'occurrence' ? <OccBadge status={it.occurrence.status} /> : <StmtBadge status={it.statement.status} />}
        </div>
      </Link>
      {autopay
        ? <span className="whitespace-nowrap text-sm tabular-nums text-slate-400">≈ {formatMoney(it.amount)}</span>
        : <Amount value={it.amount} tone={isIncome ? 'income' : 'expense'} className="text-sm font-semibold" />}
      <button className={`btn btn-sm ${autopay ? 'btn-soft' : 'btn-pay'}`} disabled={busy} onClick={onPay}>{autopay ? 'Tutar gir' : isIncome ? 'Alındı' : 'Ödendi'}</button>
    </li>
  )
}
