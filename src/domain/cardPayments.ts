import type { Account, ID, Snapshot, Transaction } from './types'

const lower = (s: string) => s.toLocaleLowerCase('tr-TR')
const words = (s: string) => lower(s).split(/[\s,.;:!?()/'"-]+/).filter(Boolean)
// Words of card names that say nothing about which card it is.
const GENERIC = new Set(['kredi', 'kart', 'kartı', 'kartım', 'card', 'banka', 'bankası', 'hesap'])
const PHRASES = ['kart ödemesi', 'kartı ödemesi', 'kredi kartı', 'kart borcu', 'ekstre ödemesi']
const PAY_WORDS = new Set(['ödeme', 'ödemesi', 'borç', 'borcu', 'ekstre', 'ekstresi', 'kart', 'kartı'])

/** First card having a distinctive (non-generic) name word among the text's words, tr-TR case-insensitive. */
export function matchCard(text: string, cards: Account[]): Account | undefined {
  const w = new Set(words(text))
  return cards.find((c) => words(c.name).some((x) => !GENERIC.has(x) && w.has(x)))
}

/**
 * True when an expense with this description / category is really a credit card payment: category "Kredi kartı",
 * a phrase like "kart ödemesi" / "kredi kartı" / "ekstre ödemesi", or a card's distinctive name word together with a
 * payment word (ödeme, borç, ekstre, kart).
 */
export function looksLikeCardPayment(text: string, categoryId: ID | undefined, snap: Snapshot): boolean {
  const cat = categoryId ? snap.categories.find((c) => c.id === categoryId) : undefined
  if (cat && lower(cat.name) === 'kredi kartı') return true
  const w = words(text)
  if (!w.length) return false
  const padded = ` ${w.join(' ')} `
  if (PHRASES.some((p) => padded.includes(` ${p} `))) return true
  // A card name alone is not enough ("market axess" is spending on the card), it needs a payment word.
  const cards = snap.accounts.filter((a) => a.kind === 'credit_card')
  return !!matchCard(text, cards) && w.some((x) => PAY_WORDS.has(x))
}

/**
 * Expense tx that look like card payments (looksLikeCardPayment on note + category), on bank/cash or on the card itself
 * (card chosen as payment method: that raises the card's debt instead of lowering it). Counting them as expense double
 * counts the card's spending. Plan (occurrenceKey) and debt-linked tx are skipped.
 */
export function suspectedCardPayments(snap: Snapshot): Transaction[] {
  return snap.transactions.filter((t) =>
    t.kind === 'expense' && !t.occurrenceKey && !t.debtId && looksLikeCardPayment(t.note ?? '', t.categoryId, snap))
}

/**
 * Transfer accounts for turning a suspected card payment into a card payment. Expense on bank/cash: from it to the card
 * named in the note (else the first card). Expense on a card: from the first bank/cash account to that card.
 */
export function cardPaymentTransfer(tx: Transaction, snap: Snapshot): { accountId: ID; toAccountId: ID } | undefined {
  const active = snap.accounts.filter((a) => !a.archived)
  const cards = active.filter((a) => a.kind === 'credit_card')
  const onCard = cards.find((c) => c.id === tx.accountId)
  const from = onCard ? active.find((a) => a.kind !== 'credit_card')?.id : tx.accountId
  const to = onCard ?? matchCard(tx.note ?? '', cards) ?? cards[0]
  return from && to ? { accountId: from, toAccountId: to.id } : undefined
}
