import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { reminders, todayISO, type Reminder, type Snapshot } from '../domain'
import { useSnapshot } from '../db'
import { dismissReminder, readDismissedReminders, readReminderSettings, REMINDERS_CHANGED } from '../lib/reminders'
import { usePay } from './Pay'
import { Section } from './ui'

const VISIBLE = 3

const BORDER = {
  danger: 'border-l-rose-500',
  warning: 'border-l-amber-500',
  info: 'border-l-sky-500',
  income: 'border-l-emerald-500',
}

/** Özet: what needs attention (card kesim / due, overdue payments, ...). Hidden when there is nothing to show. */
export function RemindersCard({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const [settings] = useState(readReminderSettings)
  const [dismissed, setDismissed] = useState(readDismissedReminders)
  const [expanded, setExpanded] = useState(false)
  const { pay, sheet, busy } = usePay(snap)
  const all = reminders(snap, today, settings)
  const list = all.filter((r) => !dismissed.includes(r.id))
  if (!list.length) return <>{sheet}</>
  const shown = expanded ? list : list.slice(0, VISIBLE)
  const dismiss = (id: string) => setDismissed(dismissReminder(id, all.map((r) => r.id)))
  return (
    <Section title="Hatırlatmalar">
      <ul className="space-y-2">
        {shown.map((r) => (
          <ReminderRow key={r.id} r={r} busy={r.target.type === 'occurrence' && busy === r.target.occurrence.key} onPay={() => {
            const t = r.target
            if (t.type === 'statement') pay({ type: 'statement', card: t.card, statement: t.statement })
            else if (t.type === 'occurrence') pay({ type: 'occurrence', plan: t.plan, occurrence: t.occurrence })
          }} onDismiss={() => dismiss(r.id)} />
        ))}
      </ul>
      {list.length > VISIBLE && (
        <button className="btn btn-ghost btn-sm mt-2" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Daha az göster' : `+${list.length - VISIBLE} daha`}
        </button>
      )}
      {sheet}
    </Section>
  )
}

function ReminderRow({ r, busy, onPay, onDismiss }: { r: Reminder; busy: boolean; onPay: () => void; onDismiss: () => void }) {
  const t = r.target
  const income = r.kind === 'income_expected'
  const action = t.type === 'debt'
    ? <Link to="/planlar?tab=debts" className="btn btn-soft btn-sm">Aç</Link>
    : r.kind === 'kesim_soon'
      ? <Link to="/kartlar" className="btn btn-soft btn-sm">Kartı aç</Link>
      : r.kind === 'amount_needed'
        ? <button className="btn btn-soft btn-sm" disabled={busy} onClick={onPay}>Tutar gir</button>
        : <button className="btn btn-pay btn-sm" disabled={busy} onClick={onPay}>{income ? 'Alındı' : 'Öde'}</button>
  return (
    <li className={`flex items-start gap-2 rounded-xl border-l-4 bg-slate-50 py-2 pl-3 pr-1 dark:bg-slate-950/60 ${income ? BORDER.income : BORDER[r.severity]}`}>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium ${r.severity === 'danger' ? 'text-rose-700 dark:text-rose-300' : ''}`}>{r.title}</div>
        {r.detail && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{r.detail}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {action}
        <button className="px-1.5 py-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={onDismiss} aria-label="Hatırlatmayı kapat">✕</button>
      </div>
    </li>
  )
}

type BadgeNavigator = { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }

/**
 * Installed PWA icon badge: count of danger + warning reminders not dismissed (cleared at 0). Feature-detected;
 * recounts on data change and when reminders are dismissed or settings change.
 */
export function AppBadge() {
  const snap = useSnapshot()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const f = () => setTick((t) => t + 1)
    window.addEventListener(REMINDERS_CHANGED, f)
    return () => window.removeEventListener(REMINDERS_CHANGED, f)
  }, [])
  useEffect(() => {
    const nav = navigator as unknown as BadgeNavigator
    if (!snap || !nav.setAppBadge) return
    try {
      const dismissed = new Set(readDismissedReminders())
      const n = reminders(snap, todayISO(), readReminderSettings())
        .filter((r) => r.severity !== 'info' && !dismissed.has(r.id)).length
      void (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge?.())?.catch(() => {})
    } catch { /* badge is best effort */ }
  }, [snap, tick])
  return null
}
