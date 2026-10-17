import { describe, expect, it } from 'vitest'
import { decodeEbcdic, detectInstallment, fold, looksLikeEbcdic, parseCellAmount, parseMeta, parseStatementText } from './index'

const TODAY = '2026-10-17'
const lines = (s: string) => s.split('\n')
const brief = (r: ReturnType<typeof parseStatementText>) => r.rows.map((x) => [x.date, x.amount, x.direction])

describe('fold', () => {
  it('folds Turkish case and diacritics 1:1', () => {
    expect(fold('İADE ÖDEME Şubat ığdır')).toBe('iade odeme subat igdir')
    expect(fold('IADE')).toBe('iade')
    expect(fold('ÇĞÜ').length).toBe(3)
  })
})

describe('parseCellAmount', () => {
  it('handles Turkish, English, signs and markers', () => {
    expect(parseCellAmount('1.234,56')?.value).toBe(123456)
    expect(parseCellAmount('-1.234,56 TL')?.value).toBe(-123456)
    expect(parseCellAmount('1,234.56')?.value).toBe(123456)
    expect(parseCellAmount('1234,5')?.value).toBe(123450)
    expect(parseCellAmount('(12,00)')?.value).toBe(-1200)
    expect(parseCellAmount('12,00-')?.value).toBe(-1200)
    expect(parseCellAmount('125,00 B')).toEqual({ value: 12500, marker: 'B' })
    expect(parseCellAmount('₺ 45')?.value).toBe(4500)
    expect(parseCellAmount('1.250')?.value).toBe(125000)
    expect(parseCellAmount('abc')).toBeNull()
  })
})

describe('detectInstallment', () => {
  it.each([
    ['TEKNOSA 3/6', { current: 3, total: 6 }],
    ['TEKNOSA (3/6)', { current: 3, total: 6 }],
    ['TEKNOSA 3/6 TAKSİT', { current: 3, total: 6 }],
    ['TEKNOSA TAKSIT 3/6', { current: 3, total: 6 }],
    ['TEKNOSA TAKSİT: 2 / 9', { current: 2, total: 9 }],
    ['TEKNOSA 3. TAKSİT / 6', { current: 3, total: 6 }],
    ['MAGAZA (1.200,00 TL) 6/4.taksit', { current: 4, total: 6 }],
    ['MAGAZA 3/1. taksit', { current: 1, total: 3 }],
  ])('%s', (s, exp) => expect(detectInstallment(s)).toEqual(exp))
  it('rejects non-installments', () => {
    expect(detectInstallment('24/7 MARKET')).toBeNull()
    expect(detectInstallment('MIGROS SANAL')).toBeNull()
    expect(detectInstallment('A 1/1')).toBeNull()
  })
})

describe('EBCDIC (AFP) text', () => {
  const enc = (s: string) => {
    const map: Record<string, number> = { ' ': 0x40, '.': 0x4b, ',': 0x6b, '/': 0x61, '(': 0x4d, ')': 0x5d, '-': 0x60 }
    return [...s].map((c) => {
      if (map[c]) return String.fromCharCode(map[c])
      if (/\d/.test(c)) return String.fromCharCode(0xf0 + Number(c))
      const up = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(c)
      const lo = 'abcdefghijklmnopqrstuvwxyz'.indexOf(c)
      const base = (i: number, a: number, j: number, s0: number) => (i < 9 ? a + i : i < 18 ? j + i - 9 : s0 + i - 18)
      if (up >= 0) return String.fromCharCode(base(up, 0xc1, 0xd1, 0xe2))
      return String.fromCharCode(base(lo, 0x81, 0x91, 0xa2))
    }).join('')
  }
  it('detects and decodes', () => {
    const raw = enc('12/09/2026 MARKET Alisveris 1,234.56')
    expect(looksLikeEbcdic(raw)).toBe(true)
    expect(decodeEbcdic(raw)).toBe('12/09/2026 MARKET Alisveris 1,234.56')
    expect(looksLikeEbcdic('12/09/2026 MARKET Alışveriş 1.234,56 and some more plain text')).toBe(false)
  })
})

// Bank layout 1: Turkish amounts, puan column, taksit text, foreign amount, wrapped description, summaries.
const CARD_A = `
ÖRNEK BANK KREDİ KARTI HESAP ÖZETİ
Hesap Kesim Tarihi: 10.10.2026 Son Ödeme Tarihi: 20.10.2026
Dönem Borcu: 12.480,35 TL Asgari Ödeme Tutarı: 2.496,07 TL
Kart Limiti: 40.000,00 TL Kullanılabilir Limit: 27.519,65 TL
İşlem Tarihi Açıklama Tutar (TL) Puan
Önceki Dönem Borcu 9.000,00
10.09.2026 DEVREDEN BAKİYE 9.000,00
12.09.2026 ÖDEMENİZ İÇİN TEŞEKKÜRLER -9.000,00
14.09.2026 MIGROS KADIKOY ISTANBUL 1.250,40 12,50
15.09.2026 ELEKTRONIK MAGAZA TAKSİT 2/6 1.500,00 0,00
18.09.2026 AMAZON WEB SERVICES 412,35 4,12
SEATTLE USD 12,00
20.09.2026 UZUN ADLI BIR ISYERI TICARET
LIMITED SIRKETI ANKARA 640,00 6,40
22.09.2026 GIYIM MAGAZASI IADE -350,00
Sayfa 1/2
İşlem Tarihi Açıklama Tutar (TL) Puan
01.10.2026 KAFE ANKARA 85,00 0,85
Toplam 12.480,35
`

describe('parseStatementText: card layout with puan column', () => {
  const r = parseStatementText(lines(CARD_A), { kind: 'card', today: TODAY })
  it('metadata', () => {
    expect(r.meta).toEqual({ statementDate: '2026-10-10', dueDate: '2026-10-20', totalDebt: 1248035, minPayment: 249607, limit: 4000000 })
  })
  it('rows, directions and summaries', () => {
    expect(brief(r)).toEqual([
      ['2026-09-12', 900000, 'credit'],
      ['2026-09-14', 125040, 'debit'],
      ['2026-09-15', 150000, 'debit'],
      ['2026-09-18', 41235, 'debit'],
      ['2026-09-20', 64000, 'debit'],
      ['2026-09-22', 35000, 'credit'],
      ['2026-10-01', 8500, 'debit'],
    ])
  })
  it('installment, foreign amount and wrapped description', () => {
    expect(r.rows[2].installment).toEqual({ current: 2, total: 6 })
    expect(r.rows[3].foreign).toEqual({ currency: 'USD', amount: 1200 })
    expect(r.rows[4].description).toBe('UZUN ADLI BIR ISYERI TICARET LIMITED SIRKETI ANKARA')
    expect(r.rows[5].description).toBe('GIYIM MAGAZASI IADE')
  })
})

// Bank layout 2 (AFP-style): English amounts, "(-)" payments, total/current taksit, remaining "x2" column,
// labels with values printed before them, a following "next statement" box, prose between rows.
const CARD_B = `
Dönem Borcu   9,876.54 TL
20/10/2026   Son Ödeme Tarihi
En Az Ödeme Tutarı   1,975.31 TL
Hesap Kesim Tarihi   10/10/2026
Bir Sonraki Hesap Kesim Tarihi   10/11/2026
Bir Sonraki Son Ödeme Tarihi   20/11/2026
Kart Limiti   60,000.00 TL
Kullanılabilir Kart Limiti   45,000.00 TL
İşlem Tarihi   Dönem İçi İşlemler   Borç Tutar (TL)   Kalan Borç / Taksit
Önceki Dönem Hesap Özeti Bakiyesi   10,000.00
14/09/2026 OTOMATİK Ödemeniz için Teşekkürler   5,000.00(-)
15/07/2026 ONLINE MAGAZA (3,000.00 TL)  6/3.taksit   500.00   500.00x3
20/09/2026 ONLINE MAGAZA (1,000.00 TL)  3/1.taksit   333.34   333.33x2
21/09/2026 ELEKTRIK DAGITIM   123456-Fatura Otomatik Ödeme Talimatınız   1,234.56
22/09/2026 KASAP ET URUNLERI  ISTANBUL TR   2,500.00   0.25
Sağlık, mutluluk ve keyifli günler dileğiyle...
10/10/2026 Toplam Dönem Faizi   308.64
Toplam   9,876.54
Genel Toplam   9,876.54
`

describe('parseStatementText: AFP-style card layout', () => {
  const r = parseStatementText(lines(CARD_B), { kind: 'card', today: TODAY })
  it('metadata (value before label, next-statement box ignored)', () => {
    expect(r.meta).toEqual({ statementDate: '2026-10-10', dueDate: '2026-10-20', totalDebt: 987654, minPayment: 197531, limit: 6000000 })
  })
  it('rows', () => {
    expect(r.rows.map((x) => [x.date, x.amount, x.direction, x.installment])).toEqual([
      ['2026-09-14', 500000, 'credit', undefined],
      ['2026-07-15', 50000, 'debit', { current: 3, total: 6 }],
      ['2026-09-20', 33334, 'debit', { current: 1, total: 3 }],
      ['2026-09-21', 123456, 'debit', undefined], // "ödeme talimatı" is a bill charged to the card
      ['2026-09-22', 250000, 'debit', undefined],
      ['2026-10-10', 30864, 'debit', undefined], // interest row kept despite "Toplam"
    ])
  })
  it('installment purchase total from the description; prose not appended', () => {
    expect(r.rows[1].installmentTotal).toBe(300000)
    expect(r.rows[2].installmentTotal).toBe(100000)
    expect(r.rows[4].description).toBe('KASAP ET URUNLERI ISTANBUL TR')
  })
  it('debits add up to the statement', () => {
    const debit = r.rows.filter((x) => x.direction === 'debit').reduce((s, x) => s + x.amount, 0)
    const credit = r.rows.filter((x) => x.direction === 'credit').reduce((s, x) => s + x.amount, 0)
    expect(1000000 - credit + debit).toBe(r.meta.totalDebt)
  })
})

// Bank layout 3: Turkish month names, no years, B/A markers, keywords only for unmarked rows.
const CARD_C = `
HESAP ÖZETİ   Ekstre Tarihi 05 Ocak 2026   Son Odeme Tarihi 15 Ocak 2026
Donem Borcu 3.210,00 TL   Asgari Odeme 642,00 TL
28 Ara ECZANE SAGLIK 210,00 B
02 Oca KITAPCI 1.500,00 B
03 Oca ODEME - INTERNET 2.000,00 A
04 Oca MARKET ZINCIRI 3.500,00 B
`

describe('parseStatementText: month names and B/A markers', () => {
  const r = parseStatementText(lines(CARD_C), { kind: 'card', today: TODAY })
  it('resolves years against the statement date', () => {
    expect(brief(r)).toEqual([
      ['2025-12-28', 21000, 'debit'],
      ['2026-01-02', 150000, 'debit'],
      ['2026-01-03', 200000, 'credit'],
      ['2026-01-04', 350000, 'debit'],
    ])
    expect(r.meta).toMatchObject({ statementDate: '2026-01-05', dueDate: '2026-01-15', totalDebt: 321000, minPayment: 64200 })
  })
  it('long month names with year', () => {
    const x = parseStatementText(['15 Ekim 2026 KIRTASIYE 45,00'], { kind: 'card' })
    expect(brief(x)).toEqual([['2026-10-15', 4500, 'debit']])
  })
})

describe('parseStatementText: card with keywords only', () => {
  it('payments and refunds by keyword when nothing is signed', () => {
    const r = parseStatementText(lines(`
01.10.2026 HESAPTAN ODEME 1.000,00
02.10.2026 MARKET 100,00
03.10.2026 MAGAZA İADE 50,00
04.10.2026 SU FATURASI OTOMATIK ODEME TALIMATI 80,00`), { kind: 'card' })
    expect(r.rows.map((x) => x.direction)).toEqual(['credit', 'debit', 'credit', 'debit'])
  })
})

// Bank account layouts.
const BANK_ASC = `
Tarih Açıklama Tutar Bakiye
01.09.2026 DEVIR 10.000,00
02.09.26 ISYERI A.S. MAAS ODEMESI 45.000,00 55.000,00
03.09.26 KIRA HAVALE GIDEN 15.000,00 40.000,00
05.09.26 ATM PARA CEKME 2.000,00 38.000,00
06.09.26 FAST GELEN AHMET Y. 500,00 38.500,00
`
const BANK_DESC = `
06/09/2026 FAST GELEN AHMET Y. 500,00 38.500,00
05/09/2026 ATM PARA CEKME 2.000,00 38.000,00
03/09/2026 KIRA HAVALE 15.000,00 40.000,00
02/09/2026 MAAS 45.000,00 55.000,00
01/09/2026 ACILIS 10.000,00 10.000,00
`

describe('parseStatementText: bank accounts', () => {
  it('direction from running balance (ascending, 2-digit years, devir row dropped)', () => {
    const r = parseStatementText(lines(BANK_ASC), { kind: 'bank' })
    expect(brief(r)).toEqual([
      ['2026-09-02', 4500000, 'credit'],
      ['2026-09-03', 1500000, 'debit'],
      ['2026-09-05', 200000, 'debit'],
      ['2026-09-06', 50000, 'credit'],
    ])
    expect(r.rows[0].balance).toBe(5500000)
  })
  it('direction from running balance (descending)', () => {
    const r = parseStatementText(lines(BANK_DESC), { kind: 'bank' })
    expect(r.rows.slice(0, 4).map((x) => x.direction)).toEqual(['credit', 'debit', 'debit', 'credit'])
  })
  it('"-" marks outflows; unsigned rows are inflows', () => {
    const r = parseStatementText(lines(`
10-09-2026 KART ODEMESI -3.000,00 TL
11-09-2026 EFT GELEN 1.000,00 TL
12-09-2026 FATURA ODEME -250,50 TL`), { kind: 'bank' })
    expect(brief(r)).toEqual([['2026-09-10', 300000, 'debit'], ['2026-09-11', 100000, 'credit'], ['2026-09-12', 25050, 'debit']])
  })
  it('borç / alacak columns with zeros', () => {
    const r = parseStatementText(lines(`
10.09.2026 10.09.2026 MARKET 150,00 0,00 4.850,00
11.09.2026 11.09.2026 HAVALE GELEN 0,00 2.000,00 6.850,00`), { kind: 'bank' })
    expect(brief(r)).toEqual([['2026-09-10', 15000, 'debit'], ['2026-09-11', 200000, 'credit']])
  })
  it('time after date and trailing sign', () => {
    const r = parseStatementText(['10.09.2026 14:32 POS MARKET 150,00- 4.850,00'], { kind: 'bank' })
    expect(brief(r)).toEqual([['2026-09-10', 15000, 'debit']])
  })
})

describe('parseMeta', () => {
  it('two-row label/value table, previous-period labels ignored', () => {
    expect(parseMeta(lines(`
Önceki Dönem Borcu 1.000,00
Hesap Kesim Tarihi   Son Ödeme Tarihi   Dönem Borcu   Asgari Ödeme Tutarı
08.10.2026   18.10.2026   7.500,00   1.500,00`))).toEqual({ statementDate: '2026-10-08', dueDate: '2026-10-18', totalDebt: 750000, minPayment: 150000 })
  })
  it('ignores lines without labels', () => {
    expect(parseMeta(['Merhaba', '01.01.2026 MARKET 10,00'])).toEqual({})
  })
})

describe('parseStatementText: robustness', () => {
  it('ignores headers, page numbers, card numbers and empty input', () => {
    expect(parseStatementText([]).rows).toEqual([])
    expect(parseStatementText(['5555 44** **** 1234', 'Sayfa 2 / 3', '1/3', 'Tarih Açıklama Tutar']).rows).toEqual([])
  })
  it('a date line without amount is not a row', () => {
    expect(parseStatementText(['12.09.2026 BILGILENDIRME METNI']).rows).toEqual([])
  })
  it('TL prefix / ₺ suffix and installment [total, part] amounts', () => {
    const r = parseStatementText(['12.09.2026 BEYAZ ESYA 3/6 TAKSIT 9.000,00 ₺ 1.500,00 ₺', '13.09.2026 KAFE TL 45,00'], { kind: 'card' })
    expect(r.rows.map((x) => [x.amount, x.installmentTotal])).toEqual([[150000, 900000], [4500, undefined]])
  })
})

describe('parseStatementText: wrap guards', () => {
  it('a dated note followed by a total line is not merged into a row', () => {
    expect(parseStatementText(['12.09.2026 BILGILENDIRME METNI', 'Toplam 1.234,56']).rows).toEqual([])
  })
})
