import type { ReactNode } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { useSnapshot } from './db'
import type { Snapshot } from './domain'
import { Layout } from './components/Layout'
import { Loading } from './components/ui'
import { SummaryPage } from './pages/Summary'
import { TransactionsPage } from './pages/Transactions'
import { PlansPage } from './pages/Plans'
import { PlanDetailPage } from './pages/PlanDetail'
import { CardsPage } from './pages/Cards'
import { SettingsPage } from './pages/Settings'
import { ImportPage } from './pages/Import'
import { BillsPage } from './pages/Bills'
import { BillDetailPage } from './pages/BillDetail'

/** Loads the snapshot. No setup gate: a default account is created on first run (db.ts). */
function WithSnapshot({ children }: { children: (snap: Snapshot) => ReactNode }) {
  const snap = useSnapshot()
  if (!snap) return <Loading />
  return <>{children(snap)}</>
}

export default function App() {
  const page = (render: (snap: Snapshot) => ReactNode) => <WithSnapshot>{render}</WithSnapshot>
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={page((s) => <SummaryPage snap={s} />)} />
          <Route path="islemler" element={page((s) => <TransactionsPage snap={s} />)} />
          <Route path="faturalar" element={page((s) => <BillsPage snap={s} />)} />
          <Route path="faturalar/:id" element={page((s) => <BillDetailPage snap={s} />)} />
          <Route path="planlar" element={page((s) => <PlansPage snap={s} />)} />
          <Route path="planlar/:id" element={page((s) => <PlanDetailPage snap={s} />)} />
          <Route path="kartlar" element={page((s) => <CardsPage snap={s} />)} />
          <Route path="ayarlar" element={page((s) => <SettingsPage snap={s} />)} />
          <Route path="ice-aktar" element={page((s) => <ImportPage snap={s} />)} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
