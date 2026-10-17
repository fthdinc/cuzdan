import type { OccurrenceStatus, StatementStatus } from '../domain'

type Look = { label: string; cls: string; icon?: string }

const GREEN = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
const MUTED_GREEN = 'bg-emerald-50 text-emerald-600/70 dark:bg-emerald-950/30 dark:text-emerald-400/60'
const AMBER = 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
const RED = 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
const GRAY = 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'

export const OCC_LOOK: Record<OccurrenceStatus, Look> = {
  paid: { label: 'Ödendi', cls: GREEN, icon: '✓' },
  pending: { label: 'Bekliyor', cls: AMBER },
  overdue: { label: 'Gecikti', cls: RED, icon: '!' },
  skipped: { label: 'Atlandı', cls: GRAY },
  presettled: { label: 'Önceden ödenmiş', cls: MUTED_GREEN, icon: '✓' },
}

export const STMT_LOOK: Record<StatementStatus, Look> = {
  open: { label: 'Açık dönem', cls: AMBER },
  unpaid: { label: 'Ödenmedi', cls: AMBER },
  partial: { label: 'Kısmi ödendi', cls: AMBER },
  min_paid: { label: 'Asgari ödendi', cls: AMBER, icon: '✓' },
  paid: { label: 'Ödendi', cls: GREEN, icon: '✓' },
  overdue: { label: 'Gecikti', cls: RED, icon: '!' },
}

/** Left border accent per occurrence status, for list rows. */
export const OCC_BORDER: Record<OccurrenceStatus, string> = {
  paid: 'border-l-emerald-500',
  pending: 'border-l-amber-500',
  overdue: 'border-l-rose-500',
  skipped: 'border-l-slate-300 dark:border-l-slate-600',
  presettled: 'border-l-emerald-300 dark:border-l-emerald-800',
}

export function Badge({ look }: { look: Look }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${look.cls}`}>
      {look.icon && <span aria-hidden>{look.icon}</span>}
      {look.label}
    </span>
  )
}

export const OccBadge = ({ status }: { status: OccurrenceStatus }) => <Badge look={OCC_LOOK[status]} />
export const StmtBadge = ({ status }: { status: StatementStatus }) => <Badge look={STMT_LOOK[status]} />
