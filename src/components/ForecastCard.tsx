import { balanceForecast, todayISO, type Snapshot } from '../domain'
import { fmtDate, formatMoneyShort } from '../lib/format'

const W = 300
const H = 120

/** "Bakiye gidişatı": this month's liquid (bank + cash) balance, actual (solid) then projected (dashed). */
export function ForecastCard({ snap }: { snap: Snapshot }) {
  const today = todayISO()
  const month = today.slice(0, 7)
  const f = balanceForecast(snap, today, month)
  const n = f.days.length
  const values = f.days.map((d) => d.balance)
  const hi = Math.max(0, ...values)
  const lo = Math.min(0, ...values)
  const span = hi - lo || 1
  const x = (i: number) => (i / (n - 1)) * W
  const y = (v: number) => 6 + ((hi - v) / span) * (H - 12)
  const zeroY = y(0)
  const pts = f.days.map((d, i) => `${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`)
  const lastActual = f.days.findLastIndex((d) => !d.projected)
  const actualPath = lastActual >= 0 ? `M${pts.slice(0, lastActual + 1).join('L')}` : ''
  const projPath = lastActual < n - 1 ? `M${pts.slice(Math.max(0, lastActual)).join('L')}` : ''
  const area = `M${x(0)},${zeroY}L${pts.join('L')}L${x(n - 1)},${zeroY}Z`
  const todayIdx = f.days.findIndex((d) => d.date === today)

  const negative = f.firstNegativeDate
  const overLimit = f.overdraftLimit > 0 && -f.minBalance > f.overdraftLimit
  const color = (v: number) => (v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm text-slate-500 dark:text-slate-400">Ay sonu tahmini</span>
        <span className={`text-xl font-semibold tabular-nums ${color(f.endBalance)}`}>{formatMoneyShort(f.endBalance)}</span>
      </div>

      <div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-32 w-full overflow-visible" role="img"
          aria-label={`Bakiye gidişatı, ay sonu tahmini ${formatMoneyShort(f.endBalance)}`}>
          <defs>
            <clipPath id="fc-above"><rect x="0" y="0" width={W} height={zeroY} /></clipPath>
            <clipPath id="fc-below"><rect x="0" y={zeroY} width={W} height={H - zeroY} /></clipPath>
          </defs>
          <path d={area} clipPath="url(#fc-above)" className="fill-indigo-500/10 dark:fill-indigo-400/15" />
          <path d={area} clipPath="url(#fc-below)" className="fill-rose-500/25 dark:fill-rose-400/30" />
          <line x1="0" x2={W} y1={zeroY} y2={zeroY} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {todayIdx >= 0 && (
            <line x1={x(todayIdx)} x2={x(todayIdx)} y1="0" y2={H} className="stroke-slate-400 dark:stroke-slate-500" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          )}
          {actualPath && <path d={actualPath} fill="none" className="stroke-indigo-600 dark:stroke-indigo-400" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          {projPath && <path d={projPath} fill="none" className="stroke-indigo-600 dark:stroke-indigo-400" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div className="relative mt-1 h-4 text-[11px] text-slate-400 tabular-nums">
          <span className="absolute left-0">{fmtDate(f.days[0].date, today)}</span>
          {todayIdx > 3 && todayIdx < n - 4 && (
            <span className="absolute -translate-x-1/2 font-medium text-slate-500 dark:text-slate-400" style={{ left: `${(todayIdx / (n - 1)) * 100}%` }}>Bugün</span>
          )}
          <span className="absolute right-0">{fmtDate(f.days[n - 1].date, today)}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-indigo-600 dark:bg-indigo-400" />Gerçekleşen</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed border-indigo-600 dark:border-indigo-400" />Tahmin</span>
        </div>
      </div>

      {negative && (
        <div className={`rounded-xl p-3 text-sm ${overLimit ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>
          {negative <= today ? 'Bakiye eksiye düştü' : `${fmtDate(negative, today)}'de bakiye eksiye düşüyor`} (en düşük {formatMoneyShort(f.minBalance)})
          {' · '}{overLimit ? 'KMH limitini aşıyor' : 'KMH kullanılacak'}
        </div>
      )}
    </div>
  )
}
