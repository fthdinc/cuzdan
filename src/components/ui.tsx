import { useEffect, type ReactNode } from 'react'
import { formatMoney, type Account, type Category, type Kurus } from '../domain'
import { ErrorBoundary } from './ErrorBoundary'
import { sortCategories } from '../lib/format'
import { activeAccounts } from '../lib/accounts'

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {action}
    </div>
  )
}

/** A titled card whose content is isolated by an ErrorBoundary. */
export function Section({ title, action, children, className = '' }: {
  title?: string; action?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`card p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">{title}</h2>}
          {action}
        </div>
      )}
      <ErrorBoundary>{children}</ErrorBoundary>
    </section>
  )
}

export function Loading() {
  return <div className="p-8 text-center text-sm text-slate-400">Yükleniyor...</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-sm text-slate-400">{children}</div>
}

type Tone = 'income' | 'expense' | 'neutral' | 'auto'

/** Money with color: income green, expense red, auto = by sign. */
export function Amount({ value, tone = 'auto', signed, className = '' }: {
  value: Kurus; tone?: Tone; signed?: boolean; className?: string
}) {
  const t = tone === 'auto' ? (value > 0 ? 'income' : value < 0 ? 'expense' : 'neutral') : tone
  const color =
    t === 'income' ? 'text-emerald-600 dark:text-emerald-400'
    : t === 'expense' ? 'text-rose-600 dark:text-rose-400'
    : ''
  return <span className={`tabular-nums whitespace-nowrap ${color} ${className}`}>{formatMoney(value, { signed })}</span>
}

export function ProgressBar({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'green' | 'amber' | 'red' }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  const bg = { brand: 'bg-indigo-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500' }[tone]
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
      <div className={`h-full rounded-full ${bg} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function MoneyInput({ value, onChange, placeholder = '0,00', autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean
}) {
  return (
    <input
      className="input tabular-nums"
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function AccountSelect({ accounts, value, onChange, filter, allowEmpty }: {
  accounts: Account[]; value: string; onChange: (id: string) => void
  filter?: (a: Account) => boolean; allowEmpty?: string
}) {
  const list = activeAccounts(accounts, filter)
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  )
}

export function CategorySelect({ categories, kind, value, onChange }: {
  categories: Category[]; kind: 'income' | 'expense'; value: string; onChange: (id: string) => void
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Kategorisiz</option>
      {sortCategories(categories.filter((c) => c.kind === kind)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  )
}

export function Segmented<T extends string>({ options, value, onChange, disabled }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean
}) {
  return (
    <div className={`flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800 ${disabled ? 'opacity-60' : ''}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium transition ${
            value === o.value ? 'bg-white shadow-sm dark:bg-slate-950' : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Bottom sheet on mobile, centered dialog on desktop. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-sm md:items-center" onClick={onClose}>
      <div
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl dark:bg-slate-900 md:max-w-lg md:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn btn-ghost -mr-2 px-2" onClick={onClose} aria-label="Kapat">✕</button>
        </div>
        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
    </div>
  )
}

export function FormError({ msg }: { msg: string | null }) {
  return msg ? <div className="text-sm text-rose-600 dark:text-rose-400">{msg}</div> : null
}

export function CategoryDot({ color }: { color?: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color ?? '#94a3b8' }} />
}
