import type { Kurus } from './types'

/**
 * Turkish money input -> kuruş. Accepts an optional leading sign and an optional ₺ / spaces.
 * "1.250,50" (dot thousands, comma decimal), "350,5", "45000", "1.250" (= 1250 TL),
 * "1250.50" / "1250.5" (a single dot followed by 1-2 digits is a decimal point).
 */
export function parseMoney(input: string): Kurus | null {
  let s = input.replace(/[\s₺]/g, '')
  let sign = 1
  if (s.startsWith('-') || s.startsWith('+')) {
    if (s[0] === '-') sign = -1
    s = s.slice(1)
  }
  let intPart: string
  let frac = ''
  const decComma = /^([\d.]+),(\d{1,2})$/.exec(s)
  const decDot = /^(\d+)\.(\d{1,2})$/.exec(s)
  if (decComma) [, intPart, frac] = decComma
  else if (decDot) [, intPart, frac] = decDot
  else intPart = s
  if (!/^(\d+|\d{1,3}(\.\d{3})+)$/.test(intPart)) return null
  const kurus = Number(intPart.replace(/\./g, '')) * 100 + Number(frac.padEnd(2, '0'))
  return sign * kurus
}

/** 125050 -> "1.250,50 ₺". Negative values always get '-'; signed=true adds '+' to positive values. */
export function formatMoney(k: Kurus, opts?: { signed?: boolean }): string {
  const abs = Math.abs(k)
  const lira = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const kurus = String(abs % 100).padStart(2, '0')
  const sign = k < 0 ? '-' : k > 0 && opts?.signed ? '+' : ''
  return `${sign}${lira},${kurus} ₺`
}
