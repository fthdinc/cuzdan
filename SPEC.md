# Cüzdan - Kişisel Finans Takip Uygulaması (v1 Spesifikasyon)

## Kararlar
- Platform: Web + PWA (telefona kurulabilir), mobil öncelikli arayüz.
- Veri: Cihazda yerel (IndexedDB / Dexie). JSON dışa/içe aktarma ile yedek. Sunucu yok.
- Tek kullanıcı.
- Kredi kartı: ekstre döngüsü (kesim günü, son ödeme günü, dönem borcu, asgari ödeme, taksit dağıtımı).
- Para birimi: TRY. Tutarlar kuruş (integer) olarak saklanır. Tarihler `YYYY-MM-DD` string.

## Temel kavramlar
1. **Hesap (Account)**: Nakit, banka hesabı, kredi kartı. Açılış bakiyesi bir kez girilir (kartta güncel borç).
2. **İşlem (Transaction)**: Gelir, gider, transfer (kart ödemesi dahil), düzeltme. Manuel girilir.
3. **Plan (düzenli akış)**: Bir kez tanımlanır, gelecekteki tüm vadeleri yazılım üretir.
   - `loan` Kredi: taksit tutarı, toplam taksit, kalan taksit, sonraki ödeme tarihi. Opsiyonel: anapara + faiz ile taksit hesabı.
   - `card_installment` Kartla taksitli alışveriş: toplam tutar, taksit sayısı, alışveriş tarihi. Parçalar ekstrelere dağıtılır.
   - `recurring_expense` Fatura/abonelik/kira: tutar (sabit veya tahmini), periyot, gün.
   - `recurring_income` Maaş vb.
4. **Vade (Occurrence)**: Plandan hesaplanan tekil ödeme. Saklanmaz, hesaplanır. Durum: ödendi / bekliyor / gecikti / atlandı / önceden ödenmiş.
   Ödeme yapılınca `occurrenceKey` taşıyan bir İşlem oluşur. İşlem silinirse vade tekrar "bekliyor" olur.
5. **Ekstre (CardStatement)**: Kesim tarihindeki kart borcu = açılış borcu + harcamalar + faturalanan taksit parçaları - ödemeler.
   Asgari ödeme: limit < 50.000 TL ise %20, değilse %40 (kart bazında değiştirilebilir). Faiz v1'de hesaplanmaz.

## Renk kuralları
- Gelir / pozitif: yeşil. Gider / negatif: kırmızı.
- Ödendi / tamamlandı: yeşil + tik. Bekliyor: amber. Gecikti: kırmızı. Atlandı: gri.

## Manuel girişi dinamik tutmak (öneriler, v1'e dahil)
1. **Hızlı ekle çubuğu**: `120 market`, `+45000 maaş`, `350,50 benzin dün` gibi tek satır yazım. Tutar, yön, kategori ve tarih otomatik ayrıştırılır.
2. **Tek dokunuşla ödeme**: "Yaklaşan ödemeler" listesinde "Ödendi" butonu. Sabit tutarda direkt, değişken faturada tutar sorulur.
3. **Bir kez gir, gerisi otomatik**: Kredi, taksit, fatura bir kez tanımlanır. Kalan borç, kalan taksit, ilerleme çubuğu, sonraki vade otomatik.
4. **Bakiye düzeltme (mutabakat)**: Banka uygulamasındaki gerçek bakiyeyi gir, fark "düzeltme" işlemi olarak eklenir.
5. **Akıllı varsayılanlar**: Son kullanılan hesap ve kategori, nota göre kategori önerisi.

## v1 Ekranları
- **Özet**: Bu ay gelir/gider/net, hesap bakiyeleri, toplam borç, yaklaşan 30 gün ödemeleri (tek dokunuşla öde), gecikenler.
- **İşlemler**: Ay bazında liste, filtre, ekle/düzenle/sil, hızlı ekle.
- **Planlar**: Krediler, taksitler, faturalar, gelirler. İlerleme, kalan tutar, vade listesi (ödendi/bekliyor renkleri).
- **Kartlar**: Kart başına ekstre listesi, dönem borcu, asgari, son ödeme, ödeme durumu, kalan taksitler.
- **Ayarlar**: Kategoriler, hesaplar, JSON yedek al/yükle.

## Kapsam dışı (sonraki sürümler)
- Bulut senkron, çoklu kullanıcı, CSV/ekstre içe aktarma, faiz hesabı, bütçe hedefleri, grafik raporlar, bildirimler.
