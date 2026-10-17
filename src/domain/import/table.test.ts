import { describe, expect, it } from 'vitest'
import { groupTextItems, guessMapping, parseCsv, parseTable, type Cell } from './index'

describe('parseCsv', () => {
  it('semicolon, quotes, escaped quotes, CRLF, newline in quotes', () => {
    expect(parseCsv('﻿Tarih;Açıklama;Tutar\r\n01.10.2026;"MARKET; ŞUBE ""A""";-1.250,50\r\n02.10.2026;"ÇOK\nSATIR";10,00\r\n'))
      .toEqual([['Tarih', 'Açıklama', 'Tutar'], ['01.10.2026', 'MARKET; ŞUBE "A"', '-1.250,50'], ['02.10.2026', 'ÇOK\nSATIR', '10,00']])
  })
  it('comma and tab delimiters, blank lines dropped', () => {
    expect(parseCsv('a,b,c\n\n1,"2,5",3')).toEqual([['a', 'b', 'c'], ['1', '2,5', '3']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

// Card export with title rows above the header, Date cells and numeric amounts (as read-excel-file returns).
const CARD_XLSX: Cell[][] = [
  ['Kredi Kartı Hesap Özeti', null, null, null],
  ['Hesap Kesim Tarihi', new Date(Date.UTC(2026, 9, 10)), 'Son Ödeme Tarihi', '20.10.2026'],
  ['Dönem Borcu', '4.250,00 TL', null, null],
  [null, null, null, null],
  ['İşlem Tarihi', 'Açıklama', 'Bonus', 'Tutar (TL)'],
  [new Date(Date.UTC(2026, 8, 12)), 'ÖDEMENİZ İÇİN TEŞEKKÜRLER', 0, -3000],
  [new Date(Date.UTC(2026, 8, 14)), 'MIGROS ATASEHIR', 2.5, 250.4],
  [new Date(Date.UTC(2026, 8, 15)), 'TEKNOLOJI MAGAZASI 2/4 TAKSIT', 0, 1000],
  [46290, 'Excel seri tarihli satır', 0, '99,60'],
  [null, 'Toplam', null, 4250],
]

describe('guessMapping + parseTable', () => {
  it('finds the header row and Turkish columns', () => {
    expect(guessMapping(CARD_XLSX)).toEqual({ headerRow: 4, date: 0, description: 1, amount: 3, balance: undefined })
  })
  it('parses a card export (negative = payment)', () => {
    const r = parseTable(CARD_XLSX, guessMapping(CARD_XLSX)!, { kind: 'card' })
    expect(r.rows.map((x) => [x.date, x.description, x.amount, x.direction])).toEqual([
      ['2026-09-12', 'ÖDEMENİZ İÇİN TEŞEKKÜRLER', 300000, 'credit'],
      ['2026-09-14', 'MIGROS ATASEHIR', 25040, 'debit'],
      ['2026-09-15', 'TEKNOLOJI MAGAZASI 2/4 TAKSIT', 100000, 'debit'],
      ['2026-09-25', 'Excel seri tarihli satır', 9960, 'debit'],
    ])
    expect(r.rows[2].installment).toEqual({ current: 2, total: 4 })
    expect(r.meta).toMatchObject({ statementDate: '2026-10-10', dueDate: '2026-10-20', totalDebt: 425000 })
  })

  const BANK_CSV = parseCsv(`Tarih;Valör;Açıklama;Borç;Alacak;Bakiye
01/09/2026;01/09/2026;MAAŞ ÖDEMESİ;;45.000,00;55.000,00
03/09/2026;03/09/2026;KİRA;15.000,00;;40.000,00
04/09/2026;04/09/2026;DEVREDEN BAKİYE;;;40.000,00
05/09/2026;05/09/2026;MARKET ALIŞVERİŞİ;1.250,50;0,00;38.749,50`)

  it('bank CSV with borç / alacak / bakiye columns', () => {
    const m = guessMapping(BANK_CSV)!
    expect(m).toEqual({ headerRow: 0, date: 0, description: 2, debit: 3, credit: 4, balance: 5 })
    const r = parseTable(BANK_CSV, m, { kind: 'bank' })
    expect(r.rows.map((x) => [x.date, x.amount, x.direction, x.balance])).toEqual([
      ['2026-09-01', 4500000, 'credit', 5500000],
      ['2026-09-03', 1500000, 'debit', 4000000],
      ['2026-09-05', 125050, 'debit', 3874950],
    ])
  })

  it('bank export with a single signed amount column', () => {
    const rows = parseCsv(`İşlem Tarihi,Açıklama,Tutar,Bakiye
2026-09-01,EFT GELEN,"1,000.00","5,000.00"
2026-09-02,POS SATIS,"-250.00","4,750.00"`)
    const r = parseTable(rows, guessMapping(rows)!, { kind: 'bank' })
    expect(r.rows.map((x) => [x.date, x.amount, x.direction])).toEqual([['2026-09-01', 100000, 'credit'], ['2026-09-02', 25000, 'debit']])
  })

  it('guesses columns without a header row', () => {
    const rows: Cell[][] = [
      ['01.09.2026', 'MARKET ALISVERISI UZUN ACIKLAMA', '120,00', '1.000,00'],
      ['02.09.2026', 'ECZANE', '80,00', '920,00'],
      ['03.09.2026', 'KAFE', '30,00', '890,00'],
    ]
    expect(guessMapping(rows)).toEqual({ headerRow: -1, date: 0, description: 1, amount: 2, balance: 3 })
  })

  it('returns null for unrelated tables', () => {
    expect(guessMapping([['a', 'b'], ['c', 'd']])).toBeNull()
  })
})

describe('groupTextItems', () => {
  const it8 = (str: string, x: number, y: number, width: number) => ({ str, x, y, width, height: 8 })
  it('groups by baseline with tolerance, orders by x, joins by gap', () => {
    const lines = groupTextItems([
      it8('125,00', 400, 699, 30), // amount slightly below the description baseline
      it8('12.09.2026', 40, 700, 45),
      it8('MIG', 100, 700, 15),
      it8('ROS', 115.2, 700, 15), // touching glyph run -> same word
      it8(' ', 131, 700, 2), // whitespace items are ignored
      it8('KADIKOY', 134, 700, 35),
      it8('Sayfa 1', 40, 650, 30),
    ])
    expect(lines).toEqual(['12.09.2026   MIGROS KADIKOY   125,00', 'Sayfa 1'])
  })
})
