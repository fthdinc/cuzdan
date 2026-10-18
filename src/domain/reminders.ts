// Reminders (hatırlatmalar): what needs attention soon, computed from the snapshot. Pure.
import { cardStatements } from './cards'
import { addDays, ymd } from './dates'
import { debtStatus } from './debts'
import { formatMoney } from './money'
import { occurrencesForPlan } from './plans'
import type { Account, ISODate, Reminder, ReminderSettings, ReminderSeverity, Snapshot } from './types'

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { kesimDaysBefore: 3, dueDaysBefore: 3 }

/** kesim_passed is shown this many days after the kesim (unless a due reminder replaces it). */
const KESIM_PASSED_DAYS = 7

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  const [y1, m1, d1] = ymd(from)
  const [y2, m2, d2] = ymd(to)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

/** '2026-10-21' -> '21 Ekim' (year added when it differs from today's). */
function day(d: ISODate, today: ISODate): string {
  const [y, m, dd] = ymd(d)
  return `${dd} ${MONTHS[m - 1]}${d.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`}`
}

/** 0 -> 'bugün', 1 -> 'yarın', n -> 'n gün sonra'. */
function inDays(n: number): string {
  return n === 0 ? 'bugün' : n === 1 ? 'yarın' : `${n} gün sonra`
}

const m = (k: number) => formatMoney(k)

/**
 * Next kesim of a card (the open statement's periodEnd, >= today) and the next due date that matters:
 * the latest closed statement's due date when it is unpaid and not past, otherwise the open statement's.
 */
export function nextCardDates(card: Account, snap: Snapshot, today: ISODate): { kesim: ISODate; due: ISODate } | null {
  const sts = cardStatements(card, snap, today)
  const open = sts.at(-1)
  if (!open) return null
  const closed = sts.filter((s) => s.status !== 'open').at(-1)
  const due = closed && closed.status !== 'paid' && closed.dueDate >= today ? closed.dueDate : open.dueDate
  return { kesim: open.periodEnd, due }
}

const RANK: Record<ReminderSeverity, number> = { danger: 0, warning: 1, info: 2 }
const rank = (r: Reminder) => (r.kind === 'income_expected' ? 3 : RANK[r.severity])

/**
 * Reminders for today, sorted by urgency (danger, warning, info, then income_expected) then date, then id.
 *
 * Credit cards (active ones; at most one reminder per statement):
 * - kesim_soon (info): the open statement's kesim is within kesimDaysBefore days (0 = today). amount = total so far.
 * - latest closed statement, when not paid (older ones are carried into it):
 *   - past due and paid < min: due_overdue (danger); past due and min paid: due_overdue (warning, id suffix ':min').
 *   - else due within dueDaysBefore days: due_soon (warning), amount = total - paid.
 *   - else kesim within the last 7 days: kesim_passed (info).
 * Loans / recurring expenses (active plans, any account): overdue -> payment_overdue (danger); autopay_pending ->
 * amount_needed (info); pending due within dueDaysBefore -> payment_soon (warning; info for autopay bills).
 * Recurring income: pending due today or overdue -> income_expected (info).
 * Personal debts with dueDate, not done: borrowed -> payment_overdue / payment_soon like plans; lent due today or
 * earlier -> income_expected.
 */
export function reminders(snap: Snapshot, today: ISODate, settings: ReminderSettings = DEFAULT_REMINDER_SETTINGS): Reminder[] {
  const out: Reminder[] = []

  for (const card of snap.accounts) {
    if (card.kind !== 'credit_card' || card.archived) continue
    const sts = cardStatements(card, snap, today)
    const open = sts.at(-1)
    if (open && open.status === 'open') {
      const n = daysBetween(today, open.periodEnd)
      if (n <= settings.kesimDaysBefore) {
        out.push({
          id: `kesim_soon:${card.id}:${open.periodEnd}`, kind: 'kesim_soon', severity: 'info', date: open.periodEnd,
          title: `${card.name} kesimi ${inDays(n)} (${day(open.periodEnd, today)})`,
          detail: open.total > 0 ? `Şu ana kadarki dönem borcu: ${m(open.total)}` : 'Bu dönem harcama yok',
          amount: open.total, target: { type: 'statement', card, statement: open },
        })
      }
    }
    const st = sts.filter((s) => s.status !== 'open').at(-1)
    if (!st || st.status === 'paid' || st.total - st.paid <= 0) continue
    const remaining = st.total - st.paid
    const target = { type: 'statement' as const, card, statement: st }
    const toDue = daysBetween(today, st.dueDate)
    if (toDue < 0) {
      if (st.status === 'overdue') {
        out.push({
          id: `due_overdue:${card.id}:${st.periodEnd}`, kind: 'due_overdue', severity: 'danger', date: st.dueDate,
          title: `${card.name} son ödeme geçti, asgari ödenmedi`,
          detail: `Son ödeme ${day(st.dueDate, today)}. Kalan borç ${m(remaining)}, asgari ${m(st.minPayment)}.`,
          amount: remaining, target,
        })
      } else {
        out.push({
          id: `due_overdue:${card.id}:${st.periodEnd}:min`, kind: 'due_overdue', severity: 'warning', date: st.dueDate,
          title: `${card.name} asgari ödendi, kalan ${m(remaining)} faiz işleyebilir`,
          detail: `Son ödeme ${day(st.dueDate, today)} geçti.`,
          amount: remaining, target,
        })
      }
    } else if (toDue <= settings.dueDaysBefore) {
      out.push({
        id: `due_soon:${card.id}:${st.periodEnd}`, kind: 'due_soon', severity: 'warning', date: st.dueDate,
        title: toDue <= 1 ? `${card.name} son ödeme günü ${inDays(toDue)}` : `${card.name} son ödemeye ${toDue} gün kaldı`,
        detail: st.paid >= st.minPayment && st.paid > 0
          ? `Asgari ödendi; kalan ${m(remaining)}. Son ödeme ${day(st.dueDate, today)}.`
          : `Ödenecek ${m(remaining)}, asgari ${m(st.minPayment)}. Son ödeme ${day(st.dueDate, today)}.`,
        amount: remaining, target,
      })
    } else if (daysBetween(st.periodEnd, today) <= KESIM_PASSED_DAYS) {
      out.push({
        id: `kesim_passed:${card.id}:${st.periodEnd}`, kind: 'kesim_passed', severity: 'info', date: st.periodEnd,
        title: `${card.name} hesap kesildi`,
        detail: `Dönem borcu ${m(st.total)}, asgari ${m(st.minPayment)}, son ödeme ${day(st.dueDate, today)}.`,
        amount: remaining, target,
      })
    }
  }

  const until = addDays(today, settings.dueDaysBefore)
  for (const plan of snap.plans) {
    if (plan.kind === 'card_installment') continue
    const income = plan.kind === 'recurring_income'
    const noun = plan.kind === 'loan' ? 'taksiti' : 'ödemesi'
    const autopay = plan.kind === 'recurring_expense' && !!plan.bill?.autopay
    for (const o of occurrencesForPlan(plan, snap, today, until)) {
      const base = { date: o.dueDate, amount: o.expected, target: { type: 'occurrence' as const, plan, occurrence: o } }
      const n = daysBetween(today, o.dueDate)
      if (income) {
        if (o.status === 'overdue' || (o.status === 'pending' && n === 0)) {
          out.push({
            ...base, id: `income_expected:${o.key}`, kind: 'income_expected', severity: 'info',
            title: n === 0 ? `${plan.name} bugün bekleniyor` : `${plan.name} bekleniyor`,
            detail: n === 0 ? m(o.expected) : `Vade ${day(o.dueDate, today)} · ${m(o.expected)}. Geldiyse "Alındı" de.`,
          })
        }
      } else if (o.status === 'overdue') {
        out.push({
          ...base, id: `payment_overdue:${o.key}`, kind: 'payment_overdue', severity: 'danger',
          title: `${plan.name} ${noun} gecikti`, detail: `Vade ${day(o.dueDate, today)} · ${m(o.expected)}`,
        })
      } else if (o.status === 'autopay_pending') {
        out.push({
          ...base, id: `amount_needed:${o.key}`, kind: 'amount_needed', severity: 'info',
          title: `${plan.name} otomatik ödendi, tutarı gir`, detail: `Vade ${day(o.dueDate, today)} · tahmini ${m(o.expected)}`,
        })
      } else if (o.status === 'pending') {
        out.push({
          ...base, id: `payment_soon:${o.key}`, kind: 'payment_soon', severity: autopay ? 'info' : 'warning',
          title: autopay ? `${plan.name} ${inDays(n)} otomatik ödenecek` : `${plan.name} ${noun} ${inDays(n)}`,
          detail: `${day(o.dueDate, today)} · ${plan.kind === 'recurring_expense' && plan.variable ? 'tahmini ' : ''}${m(o.expected)}`,
        })
      }
    }
  }

  for (const debt of snap.debts ?? []) {
    if (!debt.dueDate) continue
    const st = debtStatus(debt, snap, today)
    if (st.done) continue
    const n = daysBetween(today, debt.dueDate)
    const base = { date: debt.dueDate, amount: st.remaining, target: { type: 'debt' as const, debt } }
    const detail = `Vade ${day(debt.dueDate, today)} · kalan ${m(st.remaining)}`
    if (debt.direction === 'borrowed') {
      if (n < 0) {
        out.push({ ...base, id: `payment_overdue:debt:${debt.id}:${debt.dueDate}`, kind: 'payment_overdue', severity: 'danger', title: `Borç ödemesi (${debt.counterparty}) gecikti`, detail })
      } else if (n <= settings.dueDaysBefore) {
        out.push({ ...base, id: `payment_soon:debt:${debt.id}:${debt.dueDate}`, kind: 'payment_soon', severity: 'warning', title: `Borç ödemesi (${debt.counterparty}) ${inDays(n)}`, detail })
      }
    } else if (n <= 0) {
      out.push({
        ...base, id: `income_expected:debt:${debt.id}:${debt.dueDate}`, kind: 'income_expected', severity: 'info',
        title: `Alacak (${debt.counterparty}) vadesi ${n === 0 ? 'bugün' : 'geçti'}`, detail,
      })
    }
  }

  return out.sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}
