import type { ID } from '../domain'

// Expense tx the user confirmed as real expenses ("Gider olarak kalsın"): not flagged as card payments again.
const KEY = 'cuzdan.cardPayment.dismissed'

export function readDismissedCardPayments(): ID[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as ID[] } catch { return [] }
}

export function dismissCardPayments(ids: ID[]): ID[] {
  const next = [...new Set([...readDismissedCardPayments(), ...ids])]
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next
}
