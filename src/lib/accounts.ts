import type { Account } from '../domain'

/** Active (non-archived) accounts passing `filter`. */
export function activeAccounts(accounts: Account[], filter?: (a: Account) => boolean): Account[] {
  return accounts.filter((a) => !a.archived && (!filter || filter(a)))
}

/** `id` if it is an active account passing `filter`, otherwise the first such account (or ''). */
export function pickAccount(accounts: Account[], id: string, filter?: (a: Account) => boolean): string {
  const list = activeAccounts(accounts, filter)
  return list.some((a) => a.id === id) ? id : (list[0]?.id ?? '')
}

/** Bank / cash (money can be received into it). */
export const isLiquid = (a: Account) => a.kind !== 'credit_card'

/** Account choice is shown only when there is more than one option (accounts are optional; one default "Ana hesap"). */
export function needsAccountPicker(accounts: Account[], filter?: (a: Account) => boolean): boolean {
  return activeAccounts(accounts, filter).length > 1
}

/** Payment method label: the only bank/cash account is "Nakit / banka"; cards and other accounts by name. */
export function payMethodLabel(a: Account, accounts: Account[]): string {
  return isLiquid(a) && activeAccounts(accounts, isLiquid).length === 1 ? 'Nakit / banka' : a.name
}
