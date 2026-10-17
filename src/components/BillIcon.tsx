import type { BillType } from '../domain'

const PATH: Record<BillType, string> = {
  rent: 'M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5',
  electricity: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  water: 'M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z',
  gas: 'M12 3c1 3 5 5 5 10a5 5 0 01-10 0c0-3 2-4 2-6 1 1 2 2 2 4 1-2 1-5 1-8z',
  phone: 'M8 2h8a1 1 0 011 1v18a1 1 0 01-1 1H8a1 1 0 01-1-1V3a1 1 0 011-1zM11 18h2',
  internet: 'M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01',
  tv: 'M3 6h18v12H3zM8 21h8M12 18v3',
  dues: 'M4 21V5l8-3 8 3v16M2 21h20M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4',
  subscription: 'M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5',
  insurance: 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3zM9 12l2 2 4-4',
  education: 'M2 9l10-5 10 5-10 5L2 9zM6 11v5c3 2.5 9 2.5 12 0v-5M22 9v5',
  other: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6',
}

const TONE: Record<BillType, string> = {
  rent: 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300',
  electricity: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  water: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  gas: 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300',
  phone: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  internet: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
  tv: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  dues: 'bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300',
  subscription: 'bg-pink-100 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300',
  insurance: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  education: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300',
  other: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

/** Rounded tile with the bill type's icon. */
export function BillIcon({ type, size = 'md' }: { type: BillType; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl'
  return (
    <span className={`grid shrink-0 place-items-center ${box} ${TONE[type]}`}>
      <svg viewBox="0 0 24 24" className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={PATH[type]} />
      </svg>
    </span>
  )
}
