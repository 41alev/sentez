# Lisans operasyonu (satıcı için)

Bu belge Dream Plus'ı satan/kuran kişi içindir. Müşteriye verilmez. Kod
davranışı `server/lib/license.js` ve `server/scripts/license-generate.js`
dosyalarından doğrulanmıştır (26 Eylül 2026). Hukuki lisans metni ve
sözleşme ayrıca hazırlanmalıdır; bu belge teknik prosedürdür.

## Model

- İmzalı lisans dosyası (Ed25519) + satış sözleşmesi (K-15 kararı).
- `LICENSE_FILE` tanımlı değilse lisans kontrolü **kapalıdır**; sunucu her
  zamanki gibi açılır. Süresiz (ömür boyu) satışta dosya vermek isteğe
  bağlıdır.
- Lisans dosyası yalnızca açılışta doğrulanır. Geçersiz, süresi dolmuş,
  bozuk ya da bulunamayan dosyada sunucu **açılmaz** ve nedenini konsola
  yazar. Çalışan sunucu süre dolduğunda kendiliğinden kapanmaz; bir sonraki
  yeniden başlatmada açılmaz.
- Yönetim → Veri Sağlığı → Sistem durumu ekranı kalan günü gösterir
  (`GET /api/data-health/system` → `license.daysRemaining`).

## Anahtar yönetimi

- Özel anahtar yalnızca satıcıdadır: depo kökündeki `license-signing-key.pem`
  (`.gitignore` kapsamında) veya `LICENSE_PRIVATE_KEY` ortam değişkeni.
- Bu dosyayı **şifreli ve çevrimdışı iki ayrı yerde** yedekleyin. Kaybolursa
  mevcut müşterilerin lisansları çalışmaya devam eder ama yeni/yenileme
  lisansı üretilemez; yeni anahtar üretmek `server/lib/license.js` içindeki
  genel anahtarı değiştirmeyi ve **tüm müşterilere yeni sürüm + yeni lisans**
  dağıtmayı gerektirir.
- Müşteri paketinde özel anahtar bulunmaz; `scripts/package-release.js`
  paketi oluştururken bunu ayrıca denetler ve bulursa paketi reddeder.

## Yeni lisans

```bash
npm run license:generate -- --licensee "Örnek Metal A.Ş." --expires 2027-09-30 --out musteri-lisans.json
```

`--expires` verilmezse süresiz lisans üretilir. Çıktıdaki lisans numarasını
(`DPL-YYYY-XXXXXX`) müşteri kaydına ve faturaya yazın.

Müşteri sunucusunda:

1. Dosyayı `data/license.json` olarak kopyalayın.
2. `.env` dosyasına `LICENSE_FILE=data/license.json` ekleyin.
3. Servisi yeniden başlatın; konsolda "✓ Lisans geçerli" satırını görün.

## Yenileme (süreli lisans)

1. Bitişten en az 30 gün önce yeni bitiş tarihiyle yeni dosya üretin
   (aynı `--licensee`).
2. Müşteride `data/license.json` dosyasını yenisiyle değiştirin ve servisi
   yeniden başlatın. Veri, migration veya yedek etkilenmez.
3. Eski dosyayı satıcı arşivinde saklayın.

## Süre dolduysa

Sunucu açılmaz; veri kaybolmaz. Yeni lisans dosyası yerleştirilip servis
yeniden başlatıldığında aynı veriyle açılır. Yedek alma/geri yükleme
komutları (`npm run backup:full`, `npm run restore:full`) lisans kontrolü
yapmaz; müşteri verisine her durumda erişilebilir. Sözleşmede ödeme
gecikmesinde uygulanacak süre ve veri teslimi açıkça yazılmalıdır.

## Firma unvanı değişikliği / devir

Lisans alanları imzaya dahildir; `licensee` değişirse yeni dosya üretilir.
Eski lisans numarası arşivde "devredildi" notuyla tutulur.

## İptal

Teknik olarak iptal listesi yoktur: dosya yerinde kaldıkça ve süresi
dolmadıkça çalışır. İptal gerekiyorsa süreli lisans kullanın ve
yenilemeyin; hukuki süreç sözleşmeyle yürür.

## Doğrulama durumu

| Kontrol | Sonuç |
| --- | --- |
| `node test/run-all.js license` (imza, tahrif, süre, eksik dosya) | Geçti (26.09.2026 tam koşuda) |
| Müşteri sunucusunda gerçek yenileme | Doğrulanamadı (saha) |
