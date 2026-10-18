import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { monthLabel, shiftMonth } from '../lib/format'

const SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/**
 * Month switcher: ‹ title › with an optional line under the title. Tapping the title opens a month picker popover
 * (year ‹ › and 12 months); `current` (this calendar month) is outlined, months with `hasData` get a dot.
 */
export function MonthSwitcher({ month, onChange, current, hasData, children }: {
  month: string; onChange: (m: string) => void; current: string; hasData?: (m: string) => boolean; children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const title = useRef<HTMLButtonElement>(null)
  return (
    <div className="card relative flex items-center justify-between p-2">
      <button className="btn btn-ghost px-3" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Önceki ay">‹</button>
      <div className="text-center">
        <button ref={title} className="rounded-lg px-2 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open}>
          {monthLabel(month)} <span className="text-xs text-slate-400">▾</span>
        </button>
        {children}
      </div>
      <button className="btn btn-ghost px-3" onClick={() => onChange(shiftMonth(month, 1))} aria-label="Sonraki ay">›</button>
      {open && <MonthGrid toggle={title} month={month} current={current} hasData={hasData} onPick={(m) => { onChange(m); setOpen(false) }} onClose={() => setOpen(false)} />}
    </div>
  )
}

function MonthGrid({ toggle, month, current, hasData, onPick, onClose }: {
  toggle: RefObject<HTMLButtonElement | null>; month: string; current: string; hasData?: (m: string) => boolean; onPick: (m: string) => void; onClose: () => void
}) {
  const [year, setYear] = useState(Number(month.slice(0, 4)))
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  useEffect(() => {
    // Outside tap closes; the title button toggles by itself.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !toggle.current?.contains(t)) close.current()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [toggle])
  return (
    <div ref={ref} role="dialog" aria-label="Ay seç"
      className="absolute left-1/2 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between">
        <button className="btn btn-ghost px-3" onClick={() => setYear(year - 1)} aria-label="Önceki yıl">‹</button>
        <span className="font-semibold tabular-nums">{year}</span>
        <button className="btn btn-ghost px-3" onClick={() => setYear(year + 1)} aria-label="Sonraki yıl">›</button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {SHORT.map((label, i) => {
          const m = `${year}-${String(i + 1).padStart(2, '0')}`
          const sel = m === month
          return (
            <button key={m} onClick={() => onPick(m)} aria-current={sel ? 'date' : undefined}
              className={`relative rounded-xl py-2 text-sm font-medium transition ${
                sel ? 'bg-indigo-600 text-white'
                : m === current ? 'text-indigo-600 ring-1 ring-inset ring-indigo-400 hover:bg-slate-100 dark:text-indigo-300 dark:hover:bg-slate-800'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}>
              {label}
              {hasData?.(m) && <span className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${sel ? 'bg-white' : 'bg-slate-400'}`} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
