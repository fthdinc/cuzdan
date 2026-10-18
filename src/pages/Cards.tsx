import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  accountBalance, cardFutureInstallments, cardStatements, daysBetween, formatMoney, minPaymentRate, nextCardDates, todayISO,
  type Account, type Snapshot,
} from '../domain'
import { Amount, Empty, PageHeader, ProgressBar, Section } from '../components/ui'
import { StmtBadge } from '../components/Status'
import { usePay } from '../components/Pay'
import { fmtDate } from '../lib/format'
import { installmentProgress } from '../lib/plans'
import { buildIcs, downloadIcs } from '../lib/ics'
import { readReminderSettings } from '../lib/reminders'

export function CardsPage({ snap }: { snap: Snapshot }) {
  const cards = snap.accounts.filter((a) => a.kind === 'credit_card' && !a.archived)
  return (
    <div className="space-y-4">
      <PageHeader title="Kartlar" />
      {cards.length === 0 && <div className="card"><Empty>Kredi kartı yok. <Link to="/ayarlar" className="text-indigo-600">Ayarlar'dan ekleyin</Link></Empty></div>}
      {cards.map((c) => (
        <div key={c.id} className="space-y-3">
          <Section><CardOverview card={c} snap={snap} /></Section>
          <Section title="Ekstreler"><Statements card={c} snap={snap} /></Section>
        </div>
      ))}
    </div>
  )
}

function CardOverview({ card, snap }: { card: Account; snap: Snapshot }) {
  const today = todayISO()
  const debt = Math.max(0, -accountBalance(card, snap, today))
  const limit = card.card?.limit ?? 0
  const future = cardFutureInstallments(card, snap, today)
  const usage = limit ? (debt + future) / limit : 0
  const plans = snap.plans.flatMap((p) => (p.kind === 'card_installment' && p.accountId === card.id ? [p] : []))
  const withProgress = plans.map((p) => ({ p, pr: installmentProgress(p, snap, today) })).filter((x) => x.pr.remainingCount > 0)
  const next = nextCardDates(card, snap, today)
  const left = (d: string) => { const n = daysBetween(today, d); return n === 0 ? 'bugün' : n === 1 ? 'yarın' : `${n} gün` }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold">{card.name}</div>
          <div className="text-xs text-slate-500">
            Kesim her ayın {card.card?.statementDay}. günü · son ödeme {card.card?.dueDaysAfterStatement} gün sonra · asgari %{Math.round(minPaymentRate(card) * 100)}
          </div>
          {next && (
            <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Sonraki kesim: {fmtDate(next.kesim, today)} ({left(next.kesim)}) · Son ödeme: {fmtDate(next.due, today)}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to={`/ice-aktar?hesap=${card.id}`} className="btn btn-soft btn-sm">Ekstre içe aktar</Link>
            <button className="btn btn-soft btn-sm" onClick={() => downloadIcs(buildIcs(snap, today, readReminderSettings(), { cardId: card.id }), 'cuzdan-kart-hatirlatma.ics')}>Takvime ekle</button>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Güncel borç</div>
          <Amount value={debt} tone={debt > 0 ? 'expense' : 'neutral'} className="text-xl font-semibold" />
        </div>
      </div>
      {limit > 0 && <div>
        <ProgressBar value={usage} tone={usage > 0.9 ? 'red' : usage > 0.7 ? 'amber' : 'brand'} />
        <div className="mt-1.5 flex justify-between text-xs text-slate-500 tabular-nums">
          <span>Limit kullanımı %{Math.round(usage * 100)}</span>
          <span>Kullanılabilir {formatMoney(Math.max(0, limit - debt - future))} / {formatMoney(limit)}</span>
        </div>
      </div>}
      {future > 0 && (
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Gelecek taksitler</span>
            <Amount value={future} tone="expense" className="font-medium" />
          </div>
          <ul className="mt-2 space-y-1">
            {withProgress.map(({ p, pr }) => (
              <li key={p.id}>
                <Link to={`/planlar/${p.id}`} className="flex justify-between text-xs text-slate-500 hover:text-indigo-600">
                  <span>{p.name} · {pr.remainingCount} taksit kaldı</span>
                  <span className="tabular-nums">{formatMoney(pr.remainingAmount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Statements({ card, snap }: { card: Account; snap: Snapshot }) {
  const today = todayISO()
  const list = [...cardStatements(card, snap, today)].reverse()
  const { pay, sheet } = usePay(snap)
  if (!list.length) return <Empty>Ekstre yok</Empty>
  return (
    <>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {list.map((s) => (
          <li key={s.periodEnd} className="py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{fmtDate(s.periodEnd, today)} kesim</div>
                <div className="text-xs text-slate-500">{fmtDate(s.periodStart, today)} - {fmtDate(s.periodEnd, today)}</div>
              </div>
              <StmtBadge status={s.status} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <Cell label={s.status === 'open' ? 'Şu ana kadar' : 'Dönem borcu'}><Amount value={s.total} tone={s.total > 0 ? 'expense' : 'neutral'} className="font-semibold" /></Cell>
              <Cell label="Asgari">{formatMoney(s.minPayment)}</Cell>
              <Cell label="Son ödeme"><span className={s.status === 'overdue' ? 'text-rose-600 dark:text-rose-400' : ''}>{fmtDate(s.dueDate, today)}</span></Cell>
              <Cell label="Ödenen"><Amount value={s.paid} tone={s.paid > 0 ? 'income' : 'neutral'} /></Cell>
            </div>
            {(s.spending > 0 || s.installmentParts.length > 0) && (
              <div className="mt-1.5 text-[11px] text-slate-400 tabular-nums">
                Harcama {formatMoney(s.spending)}
                {s.installmentParts.length > 0 && ` · ${s.installmentParts.length} taksit ${formatMoney(s.installmentParts.reduce((a, p) => a + p.amount, 0))}`}
              </div>
            )}
            {s.status !== 'paid' && s.status !== 'open' && s.total > s.paid && (
              <button className="btn btn-pay btn-sm mt-2" onClick={() => pay({ type: 'statement', card, statement: s })}>Öde</button>
            )}
          </li>
        ))}
      </ul>
      {sheet}
    </>
  )
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-slate-400">{label}</div>
      <div className="tabular-nums">{children}</div>
    </div>
  )
}
