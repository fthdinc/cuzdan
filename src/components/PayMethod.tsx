import type { Account } from '../domain'
import { activeAccounts, payMethodLabel } from '../lib/accounts'

export function CardIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M6.5 15h4" />
    </svg>
  )
}

/**
 * "Ödeme yöntemi" chip row: active bank/cash accounts and/or credit cards (`show`), plus a trailing "+ Kart ekle"
 * chip when onAddCard is given.
 */
export function PayMethodChips({ accounts, value, onChange, show = 'all', onAddCard, size = 'md' }: {
  accounts: Account[]; value: string; onChange: (id: string) => void
  show?: 'all' | 'liquid' | 'cards'; onAddCard?: () => void; size?: 'sm' | 'md'
}) {
  // Bank/cash first, then cards.
  const list = activeAccounts(accounts, (a) => show === 'all' || (show === 'cards') === (a.kind === 'credit_card'))
    .sort((a, b) => Number(a.kind === 'credit_card') - Number(b.kind === 'credit_card'))
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      {list.map((a) => {
        const on = a.id === value
        return (
          <button
            key={a.id} type="button" aria-pressed={on} onClick={() => onChange(a.id)}
            className={`inline-flex max-w-full items-center gap-1.5 rounded-full font-medium transition ${pad} ${
              on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {a.kind === 'credit_card' && <CardIcon />}
            <span className="truncate">{payMethodLabel(a, accounts)}</span>
          </button>
        )
      })}
      {onAddCard && (
        <button
          type="button" onClick={onAddCard}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-600 dark:text-slate-400"
        >
          + Kart ekle
        </button>
      )}
    </div>
  )
}
