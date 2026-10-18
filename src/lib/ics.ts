// Calendar export (RFC 5545 .ics): the reminder that works while the app is closed. buildIcs is pure.
import {
  addDays, addMonths, cardStatements, dateInMonth, debtStatus, formatMoney, monthIndex, occurrencesForPlan,
  type ID, type ISODate, type ReminderSettings, type Snapshot,
} from '../domain'

interface CalEvent {
  uid: string
  date: ISODate // all-day
  summary: string
  description?: string
  rrule?: string
  alarmDaysBefore: number // 0 = only the alarm on the day
}

/** Statement / bill occurrences listed ahead (cards' due dates and open-ended recurring plans). */
const AHEAD = 12

/** TEXT value escaping (RFC 5545 3.3.11). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Folds a content line at 75 octets (UTF-8), never splitting a character; continuation lines start with a space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    const max = out.length === 0 ? 75 : 74 // continuation lines spend one octet on the leading space
    if (bytes + n > max) {
      out.push(cur)
      cur = ''
      bytes = 0
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

const icsDate = (d: ISODate) => d.replace(/-/g, '')

/**
 * Monthly kesim rule for statement day d, matching the engine's clamp to month end (dateInMonth):
 * d <= 28: BYMONTHDAY=d. d = 31: BYMONTHDAY=-1 (last day). d = 29/30: BYMONTHDAY=28..d with BYSETPOS=-1, i.e. the
 * largest of those days that exists in the month (30 in April, 28/29 in February).
 */
export function kesimRule(d: number): string {
  if (d <= 28) return `FREQ=MONTHLY;BYMONTHDAY=${d}`
  if (d >= 31) return 'FREQ=MONTHLY;BYMONTHDAY=-1'
  const days = Array.from({ length: d - 27 }, (_, i) => 28 + i).join(',')
  return `FREQ=MONTHLY;BYMONTHDAY=${days};BYSETPOS=-1`
}

/**
 * All-day alarm trigger relative to the event start (00:00 local): N days before at 09:00 = -(N-1)D15H.
 */
function beforeTrigger(n: number): string {
  return n === 1 ? '-PT15H' : `-P${n - 1}DT15H`
}

function events(snap: Snapshot, today: ISODate, settings: ReminderSettings, cardId?: ID): CalEvent[] {
  const out: CalEvent[] = []
  const m = formatMoney
  for (const card of snap.accounts) {
    if (card.kind !== 'credit_card' || card.archived || !card.card) continue
    if (cardId && card.id !== cardId) continue
    const sts = cardStatements(card, snap, today)
    const open = sts.at(-1)
    if (!open) continue
    const { statementDay, dueDaysAfterStatement } = card.card
    out.push({
      uid: `kesim-${card.id}@cuzdan`, date: open.periodEnd, rrule: kesimRule(statementDay),
      summary: `${card.name} hesap kesimi`, description: `Kredi kartı hesap kesim günü. Son ödeme kesimden ${dueDaysAfterStatement} gün sonra.`,
      alarmDaysBefore: settings.kesimDaysBefore,
    })
    const closed = sts.filter((s) => s.status !== 'open').at(-1)
    if (closed && closed.status !== 'paid' && closed.dueDate >= today) {
      out.push({
        uid: `due-${card.id}-${closed.periodEnd}@cuzdan`, date: closed.dueDate, summary: `${card.name} son ödeme`,
        description: `Dönem borcu ${m(closed.total)}, asgari ${m(closed.minPayment)}.`, alarmDaysBefore: settings.dueDaysBefore,
      })
    }
    // Due = kesim + N days is not a fixed day of month, so each of the next statements gets its own event.
    const mi = monthIndex(open.periodEnd)
    for (let i = 0; i < AHEAD; i++) {
      const periodEnd = dateInMonth(mi + i, statementDay)
      out.push({
        uid: `due-${card.id}-${periodEnd}@cuzdan`, date: addDays(periodEnd, dueDaysAfterStatement), summary: `${card.name} son ödeme`,
        description: `${periodEnd.split('-').reverse().join('.')} kesimli ekstrenin son ödeme günü.`, alarmDaysBefore: settings.dueDaysBefore,
      })
    }
  }
  if (cardId) return out

  for (const plan of snap.plans) {
    if (plan.kind !== 'loan' && plan.kind !== 'recurring_expense') continue
    const until = plan.kind === 'loan' ? '9999-12-31' : addMonths(today, 13)
    const list = occurrencesForPlan(plan, snap, today, until).filter((o) => o.status === 'pending' && o.dueDate >= today)
    for (const o of plan.kind === 'loan' ? list : list.slice(0, AHEAD)) {
      const autopay = plan.kind === 'recurring_expense' && !!plan.bill?.autopay
      out.push({
        uid: `occ-${o.key}@cuzdan`, date: o.dueDate,
        summary: plan.kind === 'loan' ? `${plan.name} taksiti` : autopay ? `${plan.name} (otomatik ödeme)` : plan.name,
        description: plan.kind === 'loan'
          ? `Taksit ${o.index + 1}/${plan.totalInstallments}: ${m(o.expected)}`
          : `${plan.variable ? 'Tahmini tutar' : 'Tutar'}: ${m(o.expected)}`,
        alarmDaysBefore: settings.dueDaysBefore,
      })
    }
  }
  for (const debt of snap.debts ?? []) {
    if (!debt.dueDate || debt.dueDate < today) continue
    const st = debtStatus(debt, snap, today)
    if (st.done) continue
    out.push({
      uid: `debt-${debt.id}@cuzdan`, date: debt.dueDate,
      summary: debt.direction === 'borrowed' ? `Borç ödemesi: ${debt.counterparty}` : `Alacak vadesi: ${debt.counterparty}`,
      description: `Kalan ${m(st.remaining)}`, alarmDaysBefore: settings.dueDaysBefore,
    })
  }
  return out
}

/**
 * RFC 5545 calendar with all-day events (VALUE=DATE) for card kesim (monthly RRULE), the next card due dates, remaining
 * loan installments, the next bill / recurring expense occurrences and personal debt due dates. Each event has a display
 * alarm N days before at 09:00 (N from settings; none when 0) and one at 09:00 on the day. UIDs are stable per item, so
 * re-importing updates instead of duplicating in calendars that honor UID. cardId limits the file to one card.
 * CRLF line endings, lines folded at 75 octets.
 */
export function buildIcs(snap: Snapshot, today: ISODate, settings: ReminderSettings, opts: { cardId?: ID } = {}): string {
  const stamp = `${icsDate(today)}T000000Z`
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cuzdan//Hatirlatmalar//TR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Cüzdan']
  for (const e of events(snap, today, settings, opts.cardId)) {
    const alarm = (trigger: string) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.summary)}`, trigger, 'END:VALARM']
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(e.date, 1))}`,
      ...(e.rrule ? [`RRULE:${e.rrule}`] : []),
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      'TRANSP:TRANSPARENT',
      ...(e.alarmDaysBefore > 0 ? alarm(`TRIGGER;RELATED=START:${beforeTrigger(e.alarmDaysBefore)}`) : []),
      ...alarm('TRIGGER;RELATED=START:PT9H'),
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/** Saves the calendar as a file; on phones this usually opens "add to calendar". */
export function downloadIcs(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
