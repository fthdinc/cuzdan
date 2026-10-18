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

## Faturalar (v1.1)
Fatura bir hesap değildir; bir hesaptan (kart/banka) ödenen düzenli yükümlülüktür. Bu yüzden "Yeni hesap" içinde değil,
kendi ana sekmesinde ("Faturalar") yönetilir. Veri modeli olarak `recurring_expense` planının genişletilmiş halidir.

- **Alanlar**: tür (elektrik, su, doğalgaz, telefon, internet, TV/dijital, aidat, abonelik, diğer), kurum (Enerjisa, İGDAŞ, Turkcell...),
  abone/tesisat no (opsiyonel), ödeme hesabı, **otomatik ödeme talimatı** (var/yok), tipik son ödeme günü, ekstre eşleştirme anahtar kelimeleri.
- **Değişken tutar**: Tahmini tutar son 3 ayın ortalamasından otomatik hesaplanır. Planlanan giderlerde bu tahmin kullanılır.
- **Otomatik ödemeli faturalar**: Vadesi geçince "Gecikti" değil "Otomatik ödendi, tutar bekleniyor" olarak görünür (kırmızı değil, mavi/gri).
  Tutar iki yolla kesinleşir: (1) ekstre içe aktarılınca ilgili satır faturaya bağlanır, (2) tek dokunuşla tutar girilir (SMS'teki tutar).
  Tutar bilinmeden işlem otomatik yaratılmaz (yanlış bakiye riskini önlemek için).
- **Ekstreden ayrıştırma**: İçe aktarmada bilinen kurum anahtar kelimeleri (ENERJISA, IGDAS, ISKI, TURKCELL, VODAFONE, TURK TELEKOM,
  SUPERONLINE, DIGITURK, NETFLIX, SPOTIFY...) taranır. Mevcut faturayla eşleşen satır o ayın vadesine bağlanır ve vade "ödendi" olur.
  Eşleşmeyen fatura satırı için "Fatura olarak takip et" önerisi çıkar (tek tıkla fatura oluşturur).
- **Faturalar ekranı**: Bu ayın toplam fatura tutarı, ödenen/bekleyen sayısı; türe göre ikonlu liste; her faturada bu ayın durumu,
  tutarı ve geçen aya göre değişim (artış kırmızı, düşüş yeşil). Detayda son 12 ay tutar grafiği ve geçen yılın aynı ayı ile karşılaştırma.

## KMH, bakiye gidişatı, elden borç / alacak (v1.2)
- **KMH / eksi bakiye**: Banka hesabına opsiyonel KMH limiti (`overdraftLimit`) girilir. Banka/nakit bakiyesi eksiye düşerse
  hesap satırı kırmızıdır; limit varsa "KMH kullanımı X / Y ₺" ve kullanım çubuğu (limit aşılınca kırmızı), yoksa "Eksi bakiye (borç)".
  Eksi bakiyeler Toplam borç'ta "KMH / eksi bakiye" satırında borç sayılır. "Nakit + banka (net)" eksi olabilir.
- **Bakiye gidişatı (Özet)**: Bu ayın günlük likit bakiyesi (aktif banka + nakit toplamı). Bugünden önceki günler gerçekleşen
  gün sonu bakiyesi; bugün ve sonrası tahmin: ödenmemiş plan vadeleri (gelir +, gider -; kartla ödenenler hariç, onlar ekstreyle gelir),
  ödenmemiş kart ekstreleri (son ödeme gününde, likit paradan) ve vadesi gelen elden borçlar. Vadesi geçmiş kalemler bugüne uygulanır;
  vadesi geçmiş alacaklar tahsil edilmiş sayılmaz. Ay sonu tahmini, eksiye düşülen ilk gün ve en düşük bakiye (KMH limiti aşımı uyarısı)
  ile "Gelirinin %X'ini harcadın" çubuğu gösterilir.
- **Elden borç / alacak** (Planlar → Borç/Alacak): kişi, tutar, tarih, opsiyonel vade ve hesap. Hesap seçilirse para o hesaba girer
  (borç) / çıkar (alacak). Ödeme / tahsilat kısmi olabilir ve geri alınabilir. Borçla ilgili işlemler (`debtId`) bakiyeyi etkiler ama
  gelir/gider istatistiklerine girmez. Kalan elden borçlar Toplam borç'a dahildir; alacaklar ayrı (yeşil) gösterilir, toplama girmez.
  Silmek bağlı tüm işlemleri de siler. JSON yedeğe dahildir (`debts`; eski yedekler yine yüklenir).

## Kapsam dışı (sonraki sürümler)
- Bulut senkron, çoklu kullanıcı, faiz hesabı, bütçe hedefleri, bildirimler.

## Ödeme yöntemi ve kart ödemesi (v1.3)
- Gider girerken "Ödeme yöntemi" seçilir: nakit/banka hesapları veya kredi kartları (çipler, "+ Kart ekle" ile hızlı kart).
  Varsayılan: bu kategoride son kullanılan yöntem, yoksa son gider yöntemi, yoksa nakit/banka. Hızlı eklemede metinde kart adı
  geçerse ("120 market axess") o kart seçilir. Kartla yapılan harcama yapıldığı ay gider sayılır.
- Kart ödemesi gider değil, banka/nakitten karta transferdir. Kategori "Kredi kartı" ya da açıklama kart ödemesine benziyorsa
  ("kart ödemesi", "kredi kartı", "ekstre ödemesi", kart adı + ödeme/borç/ekstre/kart) form "Kart ödemesi" moduna geçer.
- Gider olarak girilmiş kart ödemeleri (banka/nakit hesabında, plan/borç işlemi olmayan) Özet'te uyarılır; "Kart ödemesine çevir"
  aynı tarih/tutar/notla transfere çevirir, "Gider olarak kalsın" uyarıyı o işlem için kapatır.
- Özet: Harcanan altında "Kartla / Nakit-banka" dağılımı; kart borcu varsa Toplam bakiye altında gösterilir. Kart limiti opsiyoneldir
  (bilinmiyorsa asgari oran %20).
- Özet ay kartı (v1.4): Bu ay gelir, Harcanan (alışverişler, kart dahil, yapıldığı ay), Hesaptan çıkan (banka/nakit giderleri +
  kart ödemeleri; banka/nakit arası transferler, düzeltmeler ve borçla ilgili işlemler hariç), Kalan = gelir - hesaptan çıkan.
  Çubuk: "Gelirinin %X'i hesabından çıktı". İşlemler'de kart ödemesi satırı "Kart ödemesi" başlığı ve kırmızı eksi tutarla gösterilir;
  "Seç" ile toplu ödeme yöntemi / kategori değişikliği ve silme yapılır.
