// Generates samples/ornek-kart-ekstresi.pdf: a fake (made-up) credit card statement for testing the importer.
// Usage: node scripts/make-sample-pdf.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
const page = doc.addPage([595, 842])
let y = 800
const text = (s, x, f = font, size = 9) => page.drawText(s, { x, y, size, font: f })
const right = (s, xRight, f = font, size = 9) => text(s, xRight - f.widthOfTextAtSize(s, size), f, size)

text('ORNEK BANK A.S. KREDI KARTI HESAP OZETI', 40, bold, 12); y -= 24
text('Kart No: 5555 12** **** 0001', 40); y -= 14
text('Hesap Kesim Tarihi:', 40); text('10.10.2026', 150); text('Son Odeme Tarihi:', 300); text('20.10.2026', 400); y -= 14
text('Donem Borcu:', 40); text('7.135,40 TL', 150); text('Asgari Odeme Tutari:', 300); text('1.427,08 TL', 400); y -= 14
text('Kart Limiti:', 40); text('30.000,00 TL', 150); y -= 26

text('Islem Tarihi', 40, bold); text('Aciklama', 110, bold); right('Tutar (TL)', 470, bold); right('Puan', 540, bold); y -= 16
const rows = [
  ['Onceki Donem Borcu', '', '6.000,00', ''],
  ['12.09.2026', 'ODEMENIZ ICIN TESEKKURLER', '-6.000,00', ''],
  ['14.09.2026', 'MIGROS KADIKOY ISTANBUL', '1.250,40', '12,50'],
  ['15.09.2026', 'ELEKTRONIK MAGAZA 2/6 TAKSIT', '1.500,00', '0,00'],
  ['18.09.2026', 'AMAZON WEB SERVICES USD 12,00', '412,35', '4,12'],
  ['20.09.2026', 'UZUN ADLI BIR ISYERI TICARET', '640,00', '6,40'],
  ['', 'LIMITED SIRKETI ANKARA', '', ''],
  ['22.09.2026', 'GIYIM MAGAZASI IADE', '-350,00', ''],
  ['01.10.2026', 'ECZANE SAGLIK', '182,65', '1,83'],
  ['05.10.2026', 'KAFE ANKARA', '3.500,00', '35,00'],
]
for (const [d, desc, amt, puan] of rows) {
  if (d) text(d, 40)
  text(desc, d ? 110 : (desc.startsWith('Onceki') ? 40 : 110))
  if (amt) right(amt, 470)
  if (puan) right(puan, 540)
  y -= 14
}
y -= 6
text('Toplam', 110, bold); right('7.135,40', 470, bold); y -= 30
text('Bu belge test amaclidir, gercek bir hesap ozeti degildir.', 40, font, 8); y -= 12
text('Sayfa 1 / 1', 40, font, 8)

mkdirSync('samples', { recursive: true })
writeFileSync('samples/ornek-kart-ekstresi.pdf', await doc.save())
console.log('samples/ornek-kart-ekstresi.pdf')
