import { useState, type ReactNode } from 'react'
import { billInfo, type BillType, type Snapshot } from '../domain'
import { Section } from './ui'
import { AccountFormSheet } from './AccountForm'
import { PlanFormSheet } from './PlanForms'
import { BillFormSheet } from './BillForm'
import { DebtFormSheet } from './Debts'
import { IncomeFormSheet } from './IncomeForm'

const DISMISS_KEY = 'cuzdan.setup.dismissed'
const SKIP_KEY = 'cuzdan.setup.skipped'
const FIXED: BillType[] = ['rent', 'dues', 'insurance', 'education']

type StepId = 'accounts' | 'income' | 'loans' | 'fixed' | 'bills' | 'installments' | 'debts'
type Status = 'done' | 'skipped' | 'todo'

function readSkipped(): StepId[] {
  try { return JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]') as StepId[] } catch { return [] }
}
function readDismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

/** "Kurulum" card on Özet: what to define once (income, loans, rent, bills, installments), each opening its form here. */
export function SetupChecklist({ snap }: { snap: Snapshot }) {
  const [skipped, setSkipped] = useState(readSkipped)
  const [dismissed, setDismissed] = useState(readDismissed)
  const [open, setOpen] = useState<StepId | null>(null)
  const [expanded, setExpanded] = useState(false)

  const accounts = snap.accounts.filter((a) => !a.archived)
  const bills = snap.plans.filter((p) => p.kind === 'recurring_expense')
  const has = (kind: string) => snap.plans.some((p) => p.kind === kind)
  const hasIncome = has('recurring_income') || snap.transactions.some((t) => t.kind === 'income' && !t.debtId)
  // optional: shown, but not needed for completion / progress (accounts are optional, a default one exists).
  const steps: { id: StepId; label: string; sub: string; done: boolean; action: string; optional?: boolean }[] = [
    { id: 'income', label: 'Gelirlerini ekle', sub: 'Maaş, kira geliri vb. Her ay gelenleri "Her ay tekrarlanıyor" ile işaretle', done: hasIncome, action: 'Gelir ekle' },
    { id: 'loans', label: 'Krediler', sub: 'İhtiyaç, konut, taşıt kredisi', done: has('loan'), action: 'Ekle' },
    { id: 'fixed', label: 'Kira ve sabit giderler', sub: 'Kira, aidat, sigorta, okul', done: bills.some((p) => p.kind === 'recurring_expense' && FIXED.includes(billInfo(p).type)), action: 'Ekle' },
    { id: 'bills', label: 'Faturalar', sub: 'Elektrik, su, doğalgaz, internet, telefon', done: bills.some((p) => p.kind === 'recurring_expense' && !FIXED.includes(billInfo(p).type)), action: 'Ekle' },
    ...(accounts.some((a) => a.kind === 'credit_card')
      ? [{ id: 'installments' as const, label: 'Kartla taksitli alışverişler', sub: 'Devam eden taksitler', done: has('card_installment'), action: 'Ekle' }]
      : []),
    { id: 'debts', label: 'Elden borç / alacak', sub: 'Arkadaş, aile: aldığın veya verdiğin borçlar', done: (snap.debts?.length ?? 0) > 0, action: 'Ekle' },
    { id: 'accounts', label: 'Banka hesapları ve kredi kartları (opsiyonel)', sub: 'Birden fazla hesabı veya kartı ayrı takip etmek için', done: accounts.length > 1, action: 'Ekle', optional: true },
  ]
  const required = steps.filter((s) => !s.optional)
  const status = (s: (typeof steps)[number]): Status => (s.done ? 'done' : skipped.includes(s.id) ? 'skipped' : 'todo')
  const resolved = required.filter((s) => status(s) !== 'todo').length
  if (dismissed || required.every((s) => s.done)) return null

  const skip = (id: StepId) => {
    const next = [...skipped, id]
    setSkipped(next)
    try { localStorage.setItem(SKIP_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }
  const dismiss = () => {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }
  const close = () => setOpen(null)
  const collapsed = resolved === required.length && !expanded
  const progress = `${resolved}/${required.length} tamamlandı`

  let sheet: ReactNode = null
  if (open === 'accounts') sheet = <AccountFormSheet onClose={close} />
  else if (open === 'income') sheet = <IncomeFormSheet snap={snap} onClose={close} />
  else if (open === 'loans') sheet = <PlanFormSheet snap={snap} kind="loan" onClose={close} />
  else if (open === 'installments') sheet = <PlanFormSheet snap={snap} kind="card_installment" onClose={close} />
  else if (open === 'fixed') sheet = <BillFormSheet snap={snap} initialType="rent" onClose={close} />
  else if (open === 'bills') sheet = <BillFormSheet snap={snap} onClose={close} />
  else if (open === 'debts') sheet = <DebtFormSheet snap={snap} onClose={close} />

  const header = (
    <span className="flex items-center gap-2">
      <span className="text-xs text-slate-400">{progress}</span>
      <button className="btn btn-ghost btn-sm -mr-2 px-2" onClick={dismiss} aria-label="Kurulumu kapat">✕</button>
    </span>
  )

  if (collapsed) {
    return (
      <Section className="py-2">
        <div className="flex items-center justify-between gap-2">
          <button className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => setExpanded(true)}>
            <span className="font-semibold text-slate-500 dark:text-slate-400">Kurulum</span>
            <span className="text-slate-400"> · {required.length - required.filter((s) => s.done).length} adım atlandı</span>
          </button>
          {header}
        </div>
      </Section>
    )
  }

  return (
    <Section title="Kurulum" action={header}>
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(resolved / required.length) * 100}%` }} />
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {steps.map((s) => {
          const st = status(s)
          return (
            <li key={s.id} className="flex items-center gap-3 py-2">
              <StatusDot status={st} />
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium ${st === 'skipped' ? 'text-slate-400' : ''}`}>{s.label}</div>
                <div className="truncate text-xs text-slate-400">{st === 'skipped' ? 'Yok olarak işaretlendi' : s.sub}</div>
              </div>
              {st === 'todo' && !s.optional && <button className="btn btn-ghost btn-sm" onClick={() => skip(s.id)}>Yok</button>}
              <button className={`btn btn-sm ${st === 'todo' && !s.optional ? 'btn-primary' : 'btn-soft'}`} onClick={() => setOpen(s.id)}>{s.action}</button>
            </li>
          )
        })}
      </ul>
      {sheet}
    </Section>
  )
}

function StatusDot({ status }: { status: Status }) {
  if (status === 'done') return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500 text-xs font-bold text-white" aria-label="Tamamlandı">✓</span>
  if (status === 'skipped') return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-200 text-xs text-slate-500 dark:bg-slate-800" aria-label="Atlandı">–</span>
  return <span className="h-6 w-6 shrink-0 rounded-full border-2 border-slate-300 dark:border-slate-600" aria-label="Bekliyor" />
}
