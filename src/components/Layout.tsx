import { NavLink, Outlet } from 'react-router-dom'
import { AppBadge } from './Reminders'

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

const NAV = [
  { to: '/', label: 'Özet', icon: icon('M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10') },
  { to: '/islemler', label: 'İşlemler', icon: icon('M4 6h16M4 12h16M4 18h10') },
  { to: '/faturalar', label: 'Faturalar', icon: icon('M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6M9 16h3') },
  { to: '/planlar', label: 'Planlar', icon: icon('M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z') },
  { to: '/kartlar', label: 'Kartlar', icon: icon('M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM3 10h18M7 15h3') },
  { to: '/ayarlar', label: 'Ayarlar', mobileHeader: true, icon: icon('M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z') },
]

export function Layout() {
  return (
    <div className="min-h-dvh md:flex">
      <AppBadge />
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-6 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="mb-8 flex items-center gap-2 px-3">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-600 text-sm font-bold text-white">₺</span>
          <span className="text-lg font-semibold tracking-tight">Cüzdan</span>
        </div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-8 md:pb-10 md:pt-8">
        {/* Mobile: the bottom bar holds 5 tabs; Ayarlar lives in this header. */}
        <div className="-mt-2 mb-2 flex items-center justify-between md:hidden">
          <span className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-xs font-bold text-white">₺</span>
            <span className="font-semibold tracking-tight">Cüzdan</span>
          </span>
          {NAV.filter((n) => n.mobileHeader).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              aria-label={n.label}
              className={({ isActive }) => `rounded-xl p-2 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
            >
              {n.icon}
            </NavLink>
          ))}
        </div>
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 md:hidden">
        {NAV.filter((n) => !n.mobileHeader).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'
              }`
            }
          >
            {n.icon}
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
