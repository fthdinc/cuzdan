// Bill (fatura) provider catalog and description matching. Pure.
import { fold } from './import/text'
import type { BillType } from './types'

// Key order is the display order (Faturalar groups, type grid in the form).
export const BILL_TYPE_LABEL: Record<BillType, string> = {
  rent: 'Kira',
  dues: 'Aidat',
  electricity: 'Elektrik',
  water: 'Su',
  gas: 'Doğalgaz',
  internet: 'İnternet',
  phone: 'Telefon',
  tv: 'TV / dijital',
  subscription: 'Abonelik',
  transport: 'Ulaşım',
  insurance: 'Sigorta',
  education: 'Eğitim',
  other: 'Diğer',
}

/** Default statement-matching keywords for a new bill of this type (before a provider is picked). */
export const BILL_TYPE_KEYWORDS: Partial<Record<BillType, string[]>> = {
  rent: ['kira'],
  insurance: ['sigorta', 'kasko', 'dask'],
  education: ['okul', 'kurs', 'öğrenim'],
  transport: ['akbil', 'istanbulkart', 'ankarakart', 'izmirim', 'kentkart', 'hgs', 'ogs', 'otopark aboneliği', 'toplu taşıma', 'metro kart'],
}

export interface BillProvider {
  name: string
  type: BillType
  keywords: string[] // matched as whole words, diacritic-insensitive
}

const p = (type: BillType, name: string, ...keywords: string[]): BillProvider => ({ name, type, keywords: [name, ...keywords] })

export const BILL_PROVIDERS: BillProvider[] = [
  // elektrik
  p('electricity', 'Enerjisa', 'enerjisa baskent', 'enerjisa toroslar', 'enerjisa ayedas'),
  p('electricity', 'CK Enerji', 'ck bogazici', 'bogazici elektrik', 'ck akdeniz', 'akdeniz elektrik', 'ck camlibel', 'camlibel elektrik'),
  p('electricity', 'Aydem', 'aydem elektrik'),
  p('electricity', 'Gediz Elektrik', 'gediz'),
  p('electricity', 'Uludağ Elektrik', 'uedas'),
  p('electricity', 'Osmangazi Elektrik', 'oedas'),
  p('electricity', 'Toroslar Elektrik', 'toroslar', 'toroslar edas'),
  p('electricity', 'Dicle Elektrik', 'dedas'),
  p('electricity', 'Vangölü Elektrik', 'vedas'),
  p('electricity', 'Sepaş', 'sepas enerji'),
  p('electricity', 'Kayseri Elektrik', 'kcetas'),
  p('electricity', 'Meram Elektrik', 'medas'),
  p('electricity', 'Yeşilırmak Elektrik', 'yedas'),
  p('electricity', 'Çoruh Elektrik', 'coruh edas'),
  p('electricity', 'Fırat Elektrik', 'fedas'),
  p('electricity', 'Trakya Elektrik', 'tredas'),
  p('electricity', 'Başkent Elektrik', 'baskent edas'),
  // doğalgaz
  p('gas', 'İGDAŞ', 'igdas'),
  p('gas', 'Başkentgaz', 'baskent gaz', 'baskent dogalgaz'),
  p('gas', 'İzmirgaz', 'izmir gaz'),
  p('gas', 'Bursagaz', 'bursa gaz'),
  p('gas', 'Aksa Doğalgaz', 'aksa gaz', 'aksa enerji'),
  p('gas', 'Palen', 'palen enerji'),
  p('gas', 'Kayserigaz', 'kayseri gaz'),
  p('gas', 'Esgaz', 'eskisehir gaz'),
  p('gas', 'Gazdaş', 'gazdas'),
  p('gas', 'Enerya', 'enerya gaz'),
  // su
  p('water', 'İSKİ', 'iski'),
  p('water', 'ASKİ', 'aski'),
  p('water', 'İZSU', 'izsu'),
  p('water', 'BUSKİ', 'buski'),
  p('water', 'MASKİ', 'maski'),
  p('water', 'KOSKİ', 'koski'),
  p('water', 'ASAT', 'asat'),
  p('water', 'Su idaresi', 'su idaresi', 'su ve kanalizasyon', 'su kanalizasyon'),
  // telefon / internet
  p('phone', 'Turkcell', 'turkcell fatura'),
  p('phone', 'Vodafone', 'vodafone fatura'),
  p('internet', 'Türk Telekom', 'turktelekom', 'turk telekomunikasyon'),
  p('internet', 'TTNET', 'tt net'),
  p('internet', 'Superonline', 'turkcell superonline'),
  p('internet', 'Türknet', 'turk net'),
  p('internet', 'Millenicom'),
  p('internet', 'Kablonet', 'turksat kablonet', 'turksat'),
  // TV / dijital
  p('tv', 'Digiturk', 'digiturk beinsports'),
  p('tv', 'D-Smart', 'd smart', 'dsmart'),
  p('tv', 'Tivibu'),
  p('tv', 'Netflix', 'netflix com'),
  p('tv', 'Disney+', 'disney', 'disney plus', 'disneyplus'),
  p('tv', 'Amazon Prime', 'prime video', 'amazon prime video'),
  p('tv', 'Exxen'),
  p('tv', 'BluTV', 'blu tv', 'max abonelik', 'max uyelik'),
  p('tv', 'HBO Max', 'hbomax'),
  p('subscription', 'Spotify'),
  p('subscription', 'YouTube Premium', 'youtubepremium', 'youtube music', 'youtubemusic'),
  p('subscription', 'Apple', 'apple com bill', 'itunes com bill'),
  p('subscription', 'Google One', 'google storage', 'google one'),
  p('subscription', 'iCloud', 'apple icloud', 'icloud depolama'),
  p('subscription', 'Claude', 'claude ai', 'anthropic'),
  p('subscription', 'ChatGPT', 'chatgpt plus', 'openai'),
  // sigorta
  p('insurance', 'Allianz', 'allianz sigorta'),
  p('insurance', 'Axa', 'axa sigorta'),
  p('insurance', 'Anadolu Sigorta'),
  p('insurance', 'Mapfre', 'mapfre sigorta'),
  p('insurance', 'HDI', 'hdi sigorta'),
  p('insurance', 'Sompo', 'sompo sigorta', 'sompo japan'),
  p('insurance', 'Türkiye Sigorta'),
  // aidat
  p('dues', 'Aidat', 'site yonetimi', 'apartman yonetimi', 'site aidat', 'aidat odemesi'),
]

/** Folded, punctuation -> space, padded with spaces: " enerjisa istanbul ". */
export function words(s: string): string {
  return ` ${fold(s).split(/[^a-z0-9]+/).filter(Boolean).join(' ')} `
}

/** True when one of `keywords` appears in `text` as whole words (diacritic-insensitive). */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  const t = words(text)
  return keywords.some((k) => {
    const w = words(k)
    return w.trim() !== '' && t.includes(w)
  })
}

/** "Enerjisa elektrik", "İSKİ su", "Netflix" (other types: provider only). */
export function billDefaultName(type: BillType, provider: string | undefined): string {
  const label = BILL_TYPE_LABEL[type]
  if (!provider) return type === 'other' ? '' : label
  if (type === 'rent') return `${label} (${provider})`
  if (!['electricity', 'water', 'gas', 'phone', 'internet'].includes(type) || words(provider).includes(words(label))) return provider
  return `${provider} ${label.toLocaleLowerCase('tr')}`
}

export function findProvider(name: string | undefined): BillProvider | undefined {
  if (!name) return undefined
  const f = fold(name).trim()
  return BILL_PROVIDERS.find((pr) => fold(pr.name) === f)
}

// Generic signals: a "fatura" word means a bill even when the provider is unknown.
const GENERIC = / (fatura[a-z]*|ftr) /
const TYPE_HINTS: [BillType, RegExp][] = [
  ['electricity', / elektrik /],
  ['gas', / dogal ?gaz /],
  ['water', / su /],
  ['internet', / internet /],
  ['phone', / (telefon|gsm|mobil) /],
  ['dues', / aidat /],
]

export interface DetectedBill {
  type: BillType
  provider?: string
  keywords: string[] // keywords a plan created from this row should match on
  autopay: boolean // description mentions an automatic payment order (talimat / otomatik)
}

/**
 * Detects a bill payment in a statement description: a catalog provider first, then rent ("kira" as a whole
 * word), insurance ("sigorta" / "kasko" / "dask"), then the generic "fatura" patterns (type guessed from hints
 * like "ELEKTRIK", keywords = the description without the generic words).
 */
export function detectBill(description: string): DetectedBill | null {
  const t = words(description)
  const autopay = / (talimat[a-z]*|otomatik|oto) /.test(t)
  const prov = BILL_PROVIDERS.find((pr) => matchesKeywords(description, pr.keywords))
  if (prov) return { type: prov.type, provider: prov.name, keywords: prov.keywords.map((k) => fold(k)), autopay }
  if (/ kira /.test(t)) return { type: 'rent', keywords: ['kira'], autopay }
  const ins = [...new Set(t.split(' ').filter((w) => /^(sigorta[a-z]*|kasko|dask)$/.test(w)).map((w) => (w.startsWith('sigorta') ? 'sigorta' : w)))]
  if (ins.length) return { type: 'insurance', keywords: ins, autopay }
  if (!GENERIC.test(t)) return null
  const type = TYPE_HINTS.find(([, re]) => re.test(t))?.[0] ?? 'other'
  const rest = t
    .split(' ')
    .filter((w) => w && !/^(fatura[a-z]*|ftr|odeme[a-z]*|otomatik|oto|talimat[a-z]*|tahsilat[a-z]*|no|nolu|abone[a-z]*|[0-9]+)$/.test(w))
    .slice(0, 3)
    .join(' ')
  return { type, keywords: rest ? [rest] : [], autopay }
}

/** Keywords used to match a bill plan: its own list, else its provider's catalog keywords, else a provider found in its name. */
export function billKeywords(plan: { name: string; bill?: { provider?: string; matchKeywords: string[] } }): string[] {
  if (plan.bill?.matchKeywords.length) return plan.bill.matchKeywords
  const prov = findProvider(plan.bill?.provider) ?? (plan.bill?.provider ? undefined : BILL_PROVIDERS.find((pr) => matchesKeywords(plan.name, pr.keywords)))
  return prov?.keywords ?? []
}
