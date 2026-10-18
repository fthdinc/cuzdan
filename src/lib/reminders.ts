import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '../domain'

// Reminder settings and dismissed reminder ids, per device (localStorage). A dismissed reminder comes back when its id
// changes (new period / occurrence). CHANGED fires on window so the app badge can recount.
const SETTINGS_KEY = 'cuzdan.reminders.settings'
const DISMISSED_KEY = 'cuzdan.reminders.dismissed'
export const REMINDERS_CHANGED = 'cuzdan:reminders'

const clampDays = (v: unknown, def: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 30 ? v : def)

export function readReminderSettings(): ReminderSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<ReminderSettings>
    return {
      kesimDaysBefore: clampDays(s.kesimDaysBefore, DEFAULT_REMINDER_SETTINGS.kesimDaysBefore),
      dueDaysBefore: clampDays(s.dueDaysBefore, DEFAULT_REMINDER_SETTINGS.dueDaysBefore),
    }
  } catch {
    return DEFAULT_REMINDER_SETTINGS
  }
}

export function saveReminderSettings(s: ReminderSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
  window.dispatchEvent(new Event(REMINDERS_CHANGED))
}

export function readDismissedReminders(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[] } catch { return [] }
}

/** Adds `id`; ids no longer in `currentIds` are dropped so the list does not grow forever. */
export function dismissReminder(id: string, currentIds: string[]): string[] {
  const current = new Set(currentIds)
  const next = [...new Set([...readDismissedReminders().filter((x) => current.has(x)), id])]
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  window.dispatchEvent(new Event(REMINDERS_CHANGED))
  return next
}
