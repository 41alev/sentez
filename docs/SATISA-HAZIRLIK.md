# Dream Plus — satışa hazırlık uygulama kaydı

## 20 Eylül 2026 — mali kayıt geliştirmeleri

Son doğrulama: 35 test paketi ve 35 Chromium testi geçti; derleme ve tip kontrolü başarılı; lint 0 hata/29 uyarı. 020–022 geçişleri yedek kopyada denendikten sonra yerel kuruluma uygulandı. Sunucu `http://localhost:3000` adresinde güncel kodla çalışıyor; sağlık ve veritabanı bütünlüğü başarılı, bekleyen migration yok. Durdurulmuş sunucu yedeği: `C:\Erp\backups\pre-financial-final-2026-09-20T01-22-33-424Z`. Mevcut veride 1 tarihsel ek maliyet mutabakat bekliyor; eksik satın alma satırı kuru yok.

- F20: Sipariş satırı bazında kur anlık değeri saklanıyor. USD/EUR karışık sipariş ve kısmi teslimatlar, kur tablosu sonradan değiştirilse bile aynı maliyeti kullanıyor. Eski, farklı para birimli satırlarda güvenilir kur bulunamazsa mal kabul duruyor; geçmiş veri mutabakatı açık.
- F24: Fatura satırları sevkiyat satırlarından miktar tahsis ediyor. Kısmi fatura kalan sevkiyatı kapatmıyor; aynı miktar sipariş/sevkiyat üzerinden veya eşzamanlı istekle tekrar faturalanamıyor. Arayüz yalnız faturalanmamış sevki KDV dahil önizliyor. Önceden kesilmiş bağlantısız faturaların tahsis mutabakatı açık; otomatik tahmin edilmiyor.
- F07: Ek masraflar tek sefer uygulanıyor; dağıtımın ağırlıkları ilk mal kabul maliyetinden hesaplanıyor ve bölünmüş partilere yayılıyor. Tahsisler ayrı tabloda saklanıyor. Tüketilmiş mallara sonradan gelen maliyetin muhasebeleştirilmesi ve tarihsel ek maliyetlerin mutabakatı henüz tamamlanmadı; bu durumlarda işlem 409 ile durduruluyor.
- Yeni migration dosyaları: 020 (satır kuru), 021 (fatura-sevkiyat tahsisi), 022 (ek maliyet tahsisi). Bu bölüm aşağıdaki 19 Eylül iş listesindeki ilgili maddelerin güncel durumudur; kalan aşamalar tamamlanmış sayılmaz.


19 Eylül 2026. Bu belge, aynı tarihli `analiz-2026-09-19/TEKNIK-ANALIZ.md` incelemesinin ardından yapılan düzeltmeleri izler. İlk inceleme tarihsel kanıttır; aşağıdaki durumlar onun yerine geçecek bir yeni denetim değildir.

## Teslim durumu

**Son güncelleme:** Kullanıcının çalıştırma talebi üzerine mevcut yerel kurulum 19 Eylül 2026 tarihinde yedeklenip güncellendi. Yedek: `C:\Erp\backups\pre-update-2026-09-19T20-19-02-134Z`. 018/019 önce kopyada, sonra yerel uygulamada başarıyla uygulandı. Veritabanı bütünlüğü `ok`, yabancı anahtar hatası 0, bekleyen migration 0. Uygulama `http://localhost:3000` adresinde başlatıldı. Aşağıdaki dağıtım yapılmadığına ilişkin ifadeler bu çalıştırma öncesi kayıttır; dış müşteri/saha dağıtımı yapılmadı.

Ürün geliştirme ve doğrulama aşamasındadır. Satışa hazır olarak onaylanmamıştır. Değişiklikler çalışma ağacındadır; müşteri veritabanına dağıtılmamıştır. Gerçek veriler üzerinde test, sıfırlama veya migration çalıştırılmamıştır.

## Uygulanan düzeltmeler ve kabul ölçütleri

| Bulgu | Uygulama / doğrulanan davranış | Kanıt |
|---|---|---|
| F01 | Ürün, depo, stok durumu ve miktar kontrolü; çok satırlı işlemde hata varsa bütün tüketim geri alınır | `test/stock-integrity.js` |
| F02 | Hazırlanan sevkiyat iptali belgeyi korur; stok, sipariş sevk miktarı ve maliyet geri alınır; tekrar iptal ek hareket yaratmaz | `test/stock-integrity.js` |
| F03 | İptal edilmiş siparişten sevk ve kümülatif fazla sevk engellenir; sipariş satırı kimliği saklanır | `test/stock-integrity.js` |
| F04 | Mobil işlem kimliği ve normalize içerik özeti veritabanında saklanır; yeniden deneme ve süreç değişimi tek stok etkisi üretir | `test/stock-integrity.js`, `test/e2e-browser/mobile-queue.spec.js` |
| F05, F17 | Negatif ve kapanmış sayım değişiklikleri reddedilir; onay öncesi kaydedilmiş sayım düzeltilebilir | `test/stock-integrity.js` |
| F06 | Sayım başlangıcından sonra hareket gören stokta onay engellenir; yeni sayım gerekir | `test/stock-integrity.js` |
| F08 | Tedarikçiye iade seçilen reddedilmiş/karantinadaki partiden yapılır | `test/stock-integrity.js`; bölünmüş partinin satın alma satırına etkisi ayrıca tamamlanmalı |
| F10 | Kabul/ret toplamı ve karar tutarlılığı denetlenir; kısmi ret ayrı partiye ve doğru uygunsuzluk kaydına bağlanır | `test/stock-integrity.js` |
| F11 | Zorunlu şifre değişikliği sunucuda uygulanır; mobil terminal değişiklik ekranını açar | `test/release-hardening.js`, `test/e2e-browser/password-change.spec.js` |
| F12, F22 | İade faturası borcu azaltır, muhasebede ters yönlü kayıt üretir; üst tutar ve orijinal fatura kontrol edilir | `test/finance-integrity.js` |
| F13 | Satın alma onay kuralının gerektirdiği rol denetlenir | `test/release-hardening.js` |
| F14 | Kullanıcı güncellemesi yazmadan önce doğrulanır ve atomik uygulanır | `test/release-hardening.js` |
| F15 | İstenen tarihte geçerli kur yoksa işlem hata verir; sessiz 1 veya başka tarih kuru kullanılmaz | `test/finance-integrity.js` |
| F16 | Yeni parti bölmeleri/transferleri ve sevkiyat iptali iadeleri kaynak partiye bağlanır; izleme ve geri çağırma bu bağlantıyı izler | `test/stock-integrity.js`; eski bağlantılar otomatik tahmin edilmez |
| F18 | Kısmi güncellemede gönderilmeyen alanlar şema varsayılanlarıyla ezilmez | `test/release-hardening.js` |
| F23 | Bir satırdaki fazla teslimat diğer satırdaki eksik teslimatı gizleyip siparişi kapatamaz | `test/stock-integrity.js` |
| S01 | Docker kopyalama kapsamı izin listesine indirildi; veri, ortam ve özel anahtarlar dışarıda | Yapılandırma incelendi; Docker kurulu olmadığı için imaj denemesi bekliyor |
| S02 | Her sunucu testi sahiplik işaretli ayrı geçici veritabanı kullanır; temizleme müşteri klasörüne erişmez | `test/sandbox-safety.js`, bütün test koşucusu |
| S03, S09 | Mobil kuyruk kullanıcıya bağlıdır; yalnız onaylanan kayıtlar silinir; kayıp yanıt ve kullanıcı değişimi korunur; çıkış oturumu iptal eder | İki yeni Playwright dosyası; sahada cihaz denemesi bekliyor |
| S19 | JS/CSS önbellek yenilemesi ve service worker önbellek kapsamı düzeltildi | Derleme; gerçek ters proxy kurulumu bekliyor |

## Kalan öncelikli işler

1. F07: Ek satın alma maliyetinin tekrar uygulanmasını engelleyen tahsis kaydı; tüketilmiş ve bölünmüş partiler için geçmiş maliyet mutabakatı.
2. F24: Kısmi sevkiyat/faturalama bağlarını koruyarak aynı miktarın tekrar faturalanmasını engelleme.
3. F20: Satın alma satırındaki kurun işlem anında sabitlenmesi ve tarihsel kayıt geçişi.
4. F19: Kapasite planlamasında gerçek vardiya aralıkları ve çakışmalar.
5. F09: Son kullanma tarihi politikasının stok çıkışı, üretim ve planlamada tutarlı uygulanması.
6. F21, F25: Anonimleştirme kapsamı ve içe aktarma sayı biçimi belirsizliği.
7. S04–S08: Dosyaları kapsayan yedekleme/geri yükleme, çalışan sunucuda geri yükleme engeli, açılış doğrulaması, güvenilir webhook teslimatı ve hedef adres politikası.
8. S10–S18: Kalite onayının doğrulanabilir içeriği, MRP tarihleri, maliyet tutarlılığı, satın alma faturası anlık değerleri, birleştirme ilişkileri, içe aktarma atomikliği, giriş kontrolleri, tip kapsamı ve sayfalama.
9. S20: Kurulum, güncelleme, geri dönüş ve operasyon kılavuzlarının gerçek temiz makinede denenmesi; demo ve müşteri paketlerinin yeniden üretilip ayrı ayrı denetlenmesi.

Tam ayrıntı ve eski hata üretim adımları teknik incelemede korunmaktadır. Bu listedeki açık maddeler kapatılmadan sadece testlerin yeşil olması satış onayı değildir.

## Veritabanı geçişi ve geri dönüş

- `018_mobile_idempotency`: Mobil işlem sonuçları için yeni tablo; mevcut stok kayıtlarını değiştirmez.
- `019_shipment_cancellation_and_lot_lineage`: Parti ebeveyni, sevkiyat iptal bilgisi ve sipariş satırı bağlantıları ekler. Eski sevkiyat bağlantısı yalnız tek bir eşleşme varsa doldurulur. Eski parti bölünmelerinin kökeni tahmin edilmez.
- Eski, belirsiz sipariş satırına sahip sevkiyatlarda güvenli iptal için kayıt mutabakatı gerekebilir. Faturalanmış veya yola çıkmış sevkiyat iptal yerine uygun iade sürecine alınmalıdır.
- Müşteri geçişinden önce servis durdurulmalı, SQLite ve yüklenen dosyalar tutarlı yedeklenmeli, yedekten ayrı dizinde geri yükleme denenmelidir. Önce kopya ortamda migration ve iş akışı kontrolleri yapılmalıdır.
- Kod geri almak, yeni işlemlerin veri etkilerini geri almaz. Yedekten dönüş gerekiyorsa geçişten sonraki işlemler ayrıca mutabakat ister. Bu oturumda müşteri geçişi veya geri yükleme tatbikatı yapılmadı.

## Doğrulama komutları

19 Eylül 2026, son birleşik koşu: 35 test paketi geçti; Chromium üzerinde 35 Playwright testi geçti (45,4 saniye). `npm run build` ve `npm run typecheck` başarılı. `npm run lint`: 0 hata, 30 uyarı. `git diff --check` hata vermedi. Test paketleri geçici veritabanlarında 018/019 geçişlerini de çalıştırdı.

Yerel koşu kayıtları: `C:\Erp\dream-plus-release-verification\server-current.log`, `browser-current.log`, `build.log`. Bu sonuçlar gerçek müşteri dağıtımı veya dış entegratör kabulü anlamına gelmez.

`node test/run-all.js`, `npm run build`, `npx playwright test`, `npm run typecheck`, `npm run lint`.

Testler kendi geçici verilerini oluşturur. Müşteri `data` klasörünü silmek test hazırlığı değildir. Test dosyalarını çalışan müşteri sunucusuna yönlendirmeyin.

Gerçek entegratör/e-belge onayı, TLS/servis kurulumu, yedekten dönüş tatbikatı, fiziksel barkod/kamera ve müşteriyle uçtan uca saha kabulü ayrıca doğrulanmalıdır.
