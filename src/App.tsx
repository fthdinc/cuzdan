import { useState, type ReactNode } from 'react'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useSnapshot } from './db'
import type { Snapshot } from './domain'
import { Layout } from './components/Layout'
import { Loading } from './components/ui'
import { AccountFormSheet } from './components/AccountForm'
import { SummaryPage } from './pages/Summary'
import { TransactionsPage } from './pages/Transactions'
import { PlansPage } from './pages/Plans'
import { PlanDetailPage } from './pages/PlanDetail'
import { CardsPage } from './pages/Cards'
import { SettingsPage } from './pages/Settings'

/** Loads the snapshot and shows the first-run guide until an account exists (Ayarlar stays reachable). */
function WithSnapshot({ children }: { children: (snap: Snapshot) => ReactNode }) {
  const snap = useSnapshot()
  const { pathname } = useLocation()
  if (!snap) return <Loading />
  if (pathname !== '/ayarlar' && !snap.accounts.some((a) => !a.archived)) return <Welcome />
  return <>{children(snap)}</>
}

function Welcome() {
  const [open, setOpen] = useState(false)
  return (
    <div className="card mx-auto mt-8 max-w-md p-6 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white">₺</div>
      <h1 className="text-xl font-semibold">Cüzdan'a hoş geldin</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Başlamak için ilk hesabını ekle: banka hesabın, nakit cüzdanın ya da kredi kartın. Güncel bakiyeyi bir kez girmen yeterli.
      </p>
      <ol className="mx-auto mt-4 max-w-xs space-y-1 text-left text-sm text-slate-600 dark:text-slate-300">
        <li>1. Hesaplarını ekle</li>
        <li>2. Kredi, taksit ve faturalarını Planlar'a bir kez tanımla</li>
        <li>3. Harcamaları hızlı ekle çubuğuyla gir</li>
      </ol>
      <button className="btn btn-primary mt-6 w-full" onClick={() => setOpen(true)}>Hesap ekle</button>
      {open && <AccountFormSheet onClose={() => setOpen(false)} />}
    </div>
  )
}

export default function App() {
  const page = (render: (snap: Snapshot) => ReactNode) => <WithSnapshot>{render}</WithSnapshot>
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={page((s) => <SummaryPage snap={s} />)} />
          <Route path="islemler" element={page((s) => <TransactionsPage snap={s} />)} />
          <Route path="planlar" element={page((s) => <PlansPage snap={s} />)} />
          <Route path="planlar/:id" element={page((s) => <PlanDetailPage snap={s} />)} />
          <Route path="kartlar" element={page((s) => <CardsPage snap={s} />)} />
          <Route path="ayarlar" element={page((s) => <SettingsPage snap={s} />)} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
