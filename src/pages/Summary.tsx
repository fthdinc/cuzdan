import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  accountBalance, addDays, debtSummary, formatMoney, monthSummary, overdraftUsage, todayISO, upcoming,
  type Snapshot, type UpcomingItem,
} from '../domain'
import { Amount, Empty, PageHeader, ProgressBar, Section } from '../components/ui'
import { OccBadge, StmtBadge } from '../components/Status'
import { usePay } from '../components/Pay'
import { QuickAdd } from '../components/QuickAdd'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { SetupChecklist } from '../components/SetupChecklist'
import { ForecastCard } from '../components/ForecastCard'
import { IncomeFormSheet } from '../components/IncomeForm'
import { TxFormSheet } from '../components/TxForm'
import { CardPaymentNotice } from '../components/CardPaymentReview'
import { CardIcon } from '../components/PayMethod'
import { RemindersCard } from '../components/Reminders'
import { fmtDate, formatMoneyShort, monthLabel, percentSuffix, relDay } from '../lib/format'

const KIND_LABEL = { cash: 'Nakit', bank: 'Banka', credit_card: 'Kredi kartı' }

export function SummaryPage({ snap }: { snap: Snapshot }) {
  const [sheet, setSheet] = useState<'income' | 'expense' | 'cardPayment' | null>(null)
  // Only the default account: the account list adds nothing beyond "Toplam bakiye".
  const showAccounts = snap.accounts.filter((a) => !a.archived).length > 1
  return (
    <div className="space-y-4">
      <PageHeader title="Özet" />
      <ErrorBoundary><RemindersCard snap={snap} /></ErrorBoundary>
      <ErrorBoundary><SetupChecklist snap={snap} /></ErrorBoundary>
      <ErrorBoundary><CardPaymentNotice snap={snap} /></ErrorBoundary>
      <Section><MonthCard snap={snap} /></Section>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-pay py-3 text-base" onClick={() => setSheet('income')}>+ Gelir ekle</button>
        <button className="btn bg-rose-600 py-3 text-base text-white hover:bg-rose-500" onClick={() => setSheet('expense')}>− Gider ekle</button>
        <button className="btn btn-soft col-span-2" onClick={() => setSheet('cardPayment')}><CardIcon className="h-4 w-4" /> Kart ödemesi</button>
      </div>
      <ErrorBoundary><QuickAdd snap={snap} /></ErrorBoundary>
      <Section title="Bakiye gidişatı"><ForecastCard snap={snap} /></Section>
      <Section title="Yaklaşan 30 gün"><Upcoming snap={snap} /></Section>
      <div className={`grid gap-4 ${showAccounts ? 'md:grid-cols-2' : ''}`}>
        {showAccounts && <Section title="Hesaplar"><Balances snap={snap} /></Section>}
        <Section title="Toplam borç"><Debt snap={snap} /></Section>
      </div>
      {sheet === 'income' && <IncomeFormSheet snap={snap} onClose={() => setSheet(null)} />}
      {sheet === 'expense' && <TxFormSheet snap={snap} onClose={() => setSheet(null)} />}
      {sheet === 'cardPayment' && <TxFormSheet snap={snap} cardPayment onClose={() => setSheet(null)} />}
    </div>
  )
}

/** Net liquid money (active bank + cash); negative balances (KMH) reduce it and can make it negative. */
function liquidBalance(snap: Snapshot, today: string) {
  const liquid = snap.accounts.filter((a) => !a.archived && a.kind !== 'credit_card')
  return {
    balance: liquid.reduce((s, a) => s + accountBalance(a, snap, today), 0),
    overdraftLimit: liquid.reduce((s, a) => s + (a.overdraftLimit ?? 0), 0),
  }
}

/** This month: income, spent, what is left (income - expense), spent/income bar, then the carried-over total balance. */
function MonthCard({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const m = monthSummary(snap, today.slice(0, 7), today)
  const ratio = m.income > 0 ? m.expense / m.income : null
  const pct = ratio === null ? 0 : Math.round(ratio * 100)
  const { balance, overdraftLimit } = liquidBalance(snap, today)
  const used = Math.max(0, -balance)
  const cardDebt = debtSummary(snap, today).cardsCurrent
  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400">{monthLabel(m.month)}</div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Bu ay gelir" value={<Amount value={m.income} tone="income" />} />
        <Stat label="Harcanan" value={<Amount value={m.expense} tone="expense" />} sub={m.cardExpense > 0 ? (
          <>Kartla: {formatMoneyShort(m.cardExpense)} · Nakit/banka: {formatMoneyShort(m.expense - m.cardExpense)}</>
        ) : undefined} />
        <Stat label="Kalan" value={<Amount value={m.net} tone={m.net < 0 ? 'expense' : 'income'} />} />
      </div>
      <div className="mt-3">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span className="font-medium">
            {ratio === null ? (m.expense > 0 ? 'Bu ay henüz gelir girilmedi' : 'Bu ay henüz gelir yok') : `Gelirinin %${pct}'${percentSuffix(pct)} harcadın`}
          </span>
        </div>
        <ProgressBar value={ratio ?? (m.expense > 0 ? 1 : 0)} tone={ratio === null ? (m.expense > 0 ? 'red' : 'green') : ratio > 1 ? 'red' : ratio > 0.8 ? 'amber' : 'green'} />
      </div>
      {(m.projectedIncome > 0 || m.projectedExpense > 0) && (
        <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
          <span>Beklenen gelir: <Amount value={m.projectedIncome} tone={m.projectedIncome > 0 ? 'income' : 'neutral'} /></span>
          <span>Beklenen gider: <Amount value={m.projectedExpense} tone={m.projectedExpense > 0 ? 'expense' : 'neutral'} /></span>
        </div>
      )}
      <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-slate-500 dark:text-slate-400">{balance < 0 ? 'Toplam bakiye (borç / KMH)' : 'Toplam bakiye'}</span>
          <Amount value={balance} tone={balance < 0 ? 'expense' : 'neutral'} className="text-lg font-semibold" />
        </div>
        {balance < 0 && (overdraftLimit > 0 ? (
          <div className="mt-1.5">
            <ProgressBar value={used / overdraftLimit} tone={used > overdraftLimit ? 'red' : 'amber'} />
            <div className={`mt-1 text-xs tabular-nums ${used > overdraftLimit ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>
              KMH kullanımı {formatMoneyShort(used).replace(' ₺', '')} / {formatMoneyShort(overdraftLimit)}{used > overdraftLimit && ' · limit aşıldı'}
            </div>
          </div>
        ) : <div className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">Eksi bakiye (borç)</div>)}
        {cardDebt > 0 && (
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Kart borcu: <Amount value={cardDebt} tone="expense" /> (ekstre ödenince bakiyeden düşer)
          </div>
        )}
        <div className="mt-0.5 text-[11px] text-slate-400">Önceki aylardan devreden dahil, banka + nakit</div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    // Phone: one row per figure (amounts stay unclipped); wider screens: three tiles.
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-950/60 sm:p-3">
      <div className="flex items-baseline justify-between gap-2 sm:block">
        <div className="text-sm text-slate-500 dark:text-slate-400 sm:text-xs">{label}</div>
        <div className="text-xl font-semibold sm:mt-1">{value}</div>
      </div>
      {sub && <div className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  )
}

function Balances({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const accounts = snap.accounts.filter((a) => !a.archived)
  const rows = accounts.map((a) => ({ a, bal: accountBalance(a, snap, today) }))
  const cash = liquidBalance(snap, today).balance
  return (
    <div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map(({ a, bal }) => {
          const od = bal < 0 && a.kind !== 'credit_card' ? overdraftUsage(a, snap, today) : null
          return (
            <li key={a.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{a.name}</div>
                  <div className="text-xs text-slate-400">{KIND_LABEL[a.kind]}</div>
                </div>
                <Amount value={bal} className="font-medium" />
              </div>
              {od && (od.limit !== undefined ? (
                <div className="mt-1.5">
                  <ProgressBar value={od.used / od.limit} tone={od.over ? 'red' : 'amber'} />
                  <div className={`mt-1 text-xs tabular-nums ${od.over ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>
                    KMH kullanımı {formatMoneyShort(od.used).replace(' ₺', '')} / {formatMoneyShort(od.limit)}{od.over && ' · limit aşıldı'}
                  </div>
                </div>
              ) : <div className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">Eksi bakiye (borç)</div>)}
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
        <span className="text-slate-500">Nakit + banka (net)</span>
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
      {row('Krediler', d.loansRemaining)}
      {row('Kartlar', d.cardsCurrent)}
      {row('Gelecek taksitler', d.cardsFutureInstallments)}
      {row('KMH / eksi bakiye', d.overdraft)}
      {row('Elden borçlar', d.personalDebts)}
      {d.receivables > 0 && (
        <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
          <Link to="/planlar?tab=debts" className="text-slate-500 hover:text-indigo-600">Alacaklar</Link>
          <Amount value={d.receivables} tone="income" className="font-medium" />
        </div>
      )}
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
