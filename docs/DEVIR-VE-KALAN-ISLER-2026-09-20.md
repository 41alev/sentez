# Dream Plus — devir ve kalan işler

20 Eylül 2026. Kullanıcının isteğiyle mevcut çalışma kapatıldı; yeni geliştirmeye geçilmeyecek. Bu belge, başka bir yazılımcının incelemesi ve sonraki çalışmanın aynı noktadan devam etmesi içindir.

## 1. Teslim edilen durum

- Proje: `C:\Erp\project`, mevcut dal `main`.
- `933cf79`: Stok, sevkiyat, mobil, yetki, finans, maliyet ve test izolasyonu düzeltmeleri.
- `55f1d87`: Bakım kilidi, açılış kontrolleri, bakım testleri ve ilk teknik inceleme dosyaları.
- `99cc70e`: Son doğrulama ve yerel çalıştırma kaydı.
- 018–022 veritabanı geçişleri mevcut yerel kuruluma uygulandı. Müşteri/saha dağıtımı yapılmadı.
- Son tam koşu: **36 test paketi**, **35 Chromium testi** başarılı. Tip kontrolü başarılı. Lint: **0 hata, 29 uyarı**. Son arayüz derlemesi başarılı; bundan sonraki bakım değişiklikleri arayüzü değiştirmedi.
- Son küçük CLI ve kilit yolu değişikliklerinden sonra bakım, yedekten dönüş ve kurulum/yükseltme testleri ayrıca tekrar çalıştırıldı ve geçti.
- Bu sonuçlar ürünün bütünüyle satışa hazır olduğunu kanıtlamaz. Aşağıdaki açıklar ve saha kabulü tamamlanmalıdır.
- `.claude/` ve `CLAUDE.md` mevcut kullanıcı dosyalarıdır; bu çalışma kapsamında oluşturulmadı/değiştirilmedi ve commit edilmedi. `.env`, gerçek veri, özel anahtarlar ve `node_modules` Git'e eklenmedi. Derlenmiş `public/dist` yerel projede mevcut; kaynak koddan yeniden üretilebilir.

## 2. Tamamlanan başlıca düzeltmeler

| Alan | Uygulanan değişiklik |
|---|---|
| Stok ve sevkiyat | Yanlış ürün/depo/parti tüketimi, fazla sevk ve işlem ortasında kısmi yazma engellendi. Hazırlanan sevkiyatın iptali stok/maliyeti geri alıp belgeyi koruyor. |
| Sayım ve kalite | Onaylı sayımın değiştirilmesi ve negatif miktarlar engellendi. Sayım sonrası hareket varsa onay duruyor. Kabul/ret miktarı karar ve parti miktarıyla tutarlı olmak zorunda. |
| İzlenebilirlik | Yeni bölünmüş partiler ve iptal iadeleri kaynak partilerine bağlanıyor; geri çağırmada izleniyor. |
| Mobil | Tekrarlanan istemci işlemleri kalıcı kimlikle ayıklanıyor. Kuyruk kullanıcıya bağlı; yalnız onaylanan kayıtlar siliniyor. Çıkış oturumu iptal ediyor. |
| Yetki ve güncelleme | Zorunlu şifre değişimi API'de uygulanıyor. Satın alma onay rolü denetleniyor. Kullanıcı güncellemesi atomik. Gönderilmeyen alanlar varsayılanlarla ezilmiyor. |
| Finans | İade faturası müşteri borcunu azaltıyor ve ters muhasebe kaydı üretiyor. Geçerli tarihsel kur yoksa işlem duruyor. Yeni satın alma satırlarında kur sabitleniyor. |
| Faturalama | Yeni faturalar sevkiyat satırlarından miktar tahsis ediyor. Kısmi fatura kalan sevki kapatmıyor; aynı miktar yeniden faturalanamıyor. |
| Ek maliyet | Yeni masraf tek kez uygulanıyor; ilk maliyet ağırlıkları ve parti bölünmeleri korunuyor. Her tahsis kaydediliyor. |
| Bakım | Çalışan sunucuda restore/upgrade ortak kilitle engelleniyor; `--force` bu kilidi aşamıyor. Dolu WAL ile restore duruyor. JWT/lisans kontrolü DB açılmadan yapılıyor. |
| Test ve paket | Testler ayrı geçici veritabanlarında. Docker kopyalama kapsamı daraltıldı. JS/CSS ve service worker önbelleği için bazı düzeltmeler yapıldı. |

## 3. Devralan kişinin ilk yapacağı kontroller

1. `git status` ve yukarıdaki commit'leri kontrol edin. Kullanıcıya ait dosyaları silmeyin veya topluca geri almayın.
2. Önce bu belgeyi, sonra `SATISA-HAZIRLIK.md` ve ilk inceleme raporunu okuyun. Eski günlükteki “tamamlandı/bilinen sorun yok” ifadeleri güncel satış onayı değildir.
3. Gerçek veriyi test verisi olarak kullanmayın. `data` klasörünü silmeyin. İnceleme için ayrı kopya hazırlayın.
4. Mevcut sürümü değiştirmeden testleri çalıştırın: `node test/run-all.js`, `npm run build`, `npx playwright test`, `npm run typecheck`, `npm run lint`.
5. Her aşağıdaki işi ayrı değişiklik ve regresyon testiyle ele alın. Tamamlanma ölçütünü karşılamadan bulguyu kapatmayın.

## 4. Kalan işler — uygulama sırası

### Adım 1 — Tam yedekleme ve güvenli geri yükleme (S04; S05/S06 devamı)

**Yapılacak:** Otomatik yedek şu anda SQLite dosyasını alıyor; yüklenen belgeleri de içeren tutarlı paket, dosya envanteri ve bütünlük özeti ekleyin. Geri yükleme DB ve dosyaları birlikte geri getirsin; başarısızlıkta ikisi de önceki duruma dönebilsin. Saklama/rotasyon ve uzak kopyalama tüm paketi kapsasın. Manuel olarak alınmış DB+uploads yedekleri, ürünün otomatik yedek özelliğinin tamamlandığı anlamına gelmez.

**Ayrıca:** JWT/lisansın önce kontrol edilmesi düzeltildi; ancak sunucu hâlâ açılışta otomatik migration çalıştırıyor. Üretim geçişini doğrulanmış yedek alan bakım/upgrade yoluna bağlayın. Yeni sürüm açılmadan eski verinin arşivlenmesi ve geri dönüş koşullarını tanımlayın. Eski 017 geçişinin kaldırdığı e-belge tablolarını eski müşteri verisinde ayrıca değerlendirin.

**Dosyalar:** `server/scripts/backup.js`, `restore.js`, `upgrade.js`, `server/index.js`, `server/lib/maintenance-lock.js`, `test/backup-restore.js`.

**Kabul:** Yedek al → kayıt ve dosya değiştir → ayrı ortamda geri yükle → DB ilişkileri ve dosya içerikleri aynı olsun. Eksik/bozuk dosyalı paket yazma başlamadan reddedilsin. Kesinti ve başarısız geri dönüş denensin. Çalışan sunucu koruması korunmalı.

### Adım 2 — Eski mali kayıtların mutabakatı ve geç gelen maliyet (F07/F20/F24, S12)

**Yapılacak:** Yeni işlemlerde tekrar maliyet/fatura ve kur değişimi sorunları düzeltildi. Eski faturaların sevkiyat tahsisleri, eski karışık döviz satırları ve eski ek maliyetler için önizlemeli, denetim kayıtlı mutabakat aracı oluşturun. Belirsiz bağlantıları tahmin etmeyin. Tüketilmiş/üretilmiş/sevk edilmiş mallara sonradan gelen masrafın stok, üretim maliyeti ve satılan mal maliyeti etkisini tasarlayıp uygulayın.

**Mevcut sınırlama:** Güvenilir bağlantı yoksa veya ek masraf tüketilmiş mallara uygulanacaksa işlem 409 ile duruyor. Bu güvenli duruş, eksiksiz mutabakat özelliği değildir. Son yerel kopya kontrolünde **1 tarihsel ek maliyet** mutabakat bekliyordu; **eksik satır kuru 0** idi. Devir sonrası veri değişmişse yeniden sayın.

**Dosyalar:** `server/services/costing.js`, `invoice-allocation.js`, `stock.js`, `server/routes/purchasing.js`, `sales.js`, migration 020–022.

**Kabul:** Kısmen tüketilmiş ve çok kez bölünmüş partilerde masraf toplamı bir kez dağıtılsın; stok + üretim + satılan mal maliyeti mutabık olsun. İki eşzamanlı fatura aynı miktarı kullanamasın. Mutabakat tekrar çalıştırılınca ek etki üretmesin.

### Adım 3 — Alış faturası satırları ve üçlü eşleştirme (S13)

**Yapılacak:** Sipariş, teslimat ve alış faturası satırlarını miktarla ilişkilendirin. Seçilen irsaliyenin doğru siparişe ait olduğunu doğrulayın. Net/vergi/brüt, kur ve vergi oranını belgeye sabitleyin. Önceden faturalanan teslimat miktarını düşürün.

**Dosyalar:** `server/routes/purchasing.js`, `server/services/accounting-export.js`, `frontend-react/PurchasingView.jsx`.

**Kabul:** İki kısmi teslimat ayrı faturalansın; başka siparişin irsaliyesi reddedilsin; ürünün vergi oranı değiştiğinde eski fatura/muhasebe aktarımı değişmesin.

### Adım 4 — Stok politikası ve tarihsel parti bağlantıları (F08/F09/F16, S12)

**Yapılacak:** Son kullanma tarihi geçmiş partinin sevk/üretim/planlama davranışını belirleyip ortak serviste uygulayın. Yetkili istisna gerekiyorsa gerekçe ve denetim izi zorunlu olsun. Bölünmüş partiden tedarikçi iadesinin doğru satın alma satırını etkilemesini tamamlayın. Eski parti soy ağacını yalnız kanıtlanabilir ilişkilerle bağlayın. Fiziksel FEFO/FIFO seçimi ile muhasebe maliyet yöntemini ayrı tanımlayın.

**Kabul:** Süresi geçmiş, karantinadaki ve bölünmüş partilerde stok/COGS/ortalama maliyet tutarlı olsun. İade doğru sipariş satırını etkilesin. Geri çağırma gerçek müşterileri bulsun; tarihsel belirsizlik açık görünsün.

### Adım 5 — Kapasite planlaması ve malzeme ihtiyaçları (F19, S11)

**Yapılacak:** Kapasiteyi günlük toplam yerine gerçek vardiya, mola ve zaman aralıklarıyla planlayın. Aynı kaynakta çakışmaları engelleyin. MRP'de arz ve talep tarihlerini, gecikmiş teslimatı, emniyet stoğunu ve emre sabitlenmiş reçeteyi kullanın. Döngülü reçetede öneri üretimini durdurun.

**Dosyalar:** `server/services/capacity.js`, `mrp.js`, `frontend-react/PlanningView.jsx`.

**Kabul:** Yarın gereken malzeme gelecek ayki alımla karşılanmış sayılmasın. Vardiya/mola/gece yarısı ve çok günlük iş testleri geçsin. Reçete değişikliği mevcut üretim emrinin ihtiyacını değiştirmesin.

### Adım 6 — İçe aktarma ve veri birleştirme (F25, S14/S15/S16)

**Yapılacak:** Excel metin sayılarında dil/ondalık ayracı açık seçilsin; belirsiz `1.234` sessizce başka büyüklüğe dönüşmesin. Her çok yazmalı içe aktarma/geri alma satırı atomik olsun. Güncellemenin geri alınması için eski değerleri saklayın veya desteklenmeyen işlemi açıkça bildirin. Veri birleştirmede tüm FK ve mantıksal ilişkileri, özellikle yeni tahsis tablolarını, kapsayın; reçete miktarını koruyun.

**Dosyalar:** `server/services/import*.js`, `server/routes/data-health.js`, ortak doğrulama kodu.

**Kabul:** İkinci SQL başarısızsa ilk yazma da geri alınsın. İşlem raporu gerçek yazma sayısını göstersin. Bağlı fatura/lot/destek/ziyaret bulunan kayıtların birleşmesinde veri ve reçete ihtiyacı kaybolmasın.

### Adım 7 — Kişisel veri ve kalite onayı (F21, S10)

**Yapılacak:** Anonimleştirmeyi yalnız ana kartta değil kopya ad/iletişim alanları ve denetim kayıtları dahil envanterle değerlendirin; saklama zorunluluğu olan kayıtlar için iş kuralını belirleyin. Kalite onayında istenen şifre gerçekten doğrulansın; ölçümler, kabul/ret ve tek zaman damgası içerik özetine dahil edilsin. Mevcut özelliği doğrulanmış hukuki elektronik imza gibi sunmayın.

**Kabul:** Ana kart anonimleştirildiğinde kapsam içindeki kopyalarda kimlik bilgisi kalmasın. Onay sonrası ölçüm değişikliği doğrulamada yakalansın. Yanlış parola ile onay yapılamasın.

### Adım 8 — Güvenilir dış sistem bildirimleri (S07/S08)

**Yapılacak:** Webhook olayını iş verisiyle aynı transaction'da kalıcı kuyruğa yazın. Sabit olay kimliği, teslimat sahiplenme süresi, tekrar deneme ve başarısız olay inceleme akışı ekleyin. HTTP(S), hedef/DNS/yönlendirme kontrollerini tanımlayın; izinli fabrika içi entegrasyonlarla dış internet politikasını ayırın.

**Dosyalar:** `server/lib/webhooks.js`, `server/routes/webhooks.js`, olay üreten iş servisleri.

**Kabul:** Commit sonrası, HTTP öncesi ve HTTP sonrası çökmede olay kaybolmasın. Alıcı sabit kimlikle yineleneni ayıklayabilsin. İzin verilmeyen hedef/yönlendirme reddedilsin.

### Adım 9 — Girdi doğrulaması ve arayüz davranışları (S16/S17)

**Yapılacak:** Ortak gerçek tarih/saat, sayı, boolean ve kimlik doğrulamaları; uygun DB kısıtları. Kritik finans/miktar/onay formlarında kontrollü bileşenler, çift gönderim kilidi ve geç gelen istek yanıtı koruması. Tip kapsamını `@ts-nocheck` alanlarından başlayarak kademeli genişletin. 29 lint uyarısını inceleyin.

**Kabul:** `99:99`, geçersiz gün, `"false"`, sınır dışı miktar kontrollü 4xx üretsin. Hızlı çift tıklama iki belge yaratmasın. Sekme değişince eski yanıt yeni ekranı bozmasın. Klavye ve hata odağı testleri geçsin.

### Adım 10 — Veri hacmi ve sürüm önbelleği (S18/S19)

**Yapılacak:** Liste/detay sorgularını ayırın, tekrarlı alt sorguları azaltın, gerçek sayfalama ve rapor sınırları ekleyin. Çok yıllı temsili veriyle süre/bellek ölçün. Derlenmiş dosyaları sürüme bağlayın; açık sekme ve PWA güncellemesi bekleyen mobil kuyruğu korusun.

**Kabul:** Yalnız ilk 25/200 değil bütün kayıtlara erişilsin. Ölçülen yük sonuçları teslim edilsin. Eski istemci yeni sunucuya sessizce yanlış işlem göndermesin; çevrimdışı kuyruk güncellemede kaybolmasın.

### Adım 11 — Temiz kurulum ve paket teslimi (S01/S20)

**Yapılacak:** Demo ve müşteri paketlerini ayrı üretin. Müşteri paketinde demo verisi/parolası, özel anahtar ve mevcut `.env` bulunmasın. Windows otomatik başlangıç servisi, HTTPS, günlük/backup izleme ve yükseltme/geri dönüş kılavuzu hazırlayıp temiz makinede deneyin. Docker dağıtımı desteklenecekse gerçek imajı oluşturup içeriğini ve kalıcı depolamayı denetleyin.

**Mevcut sınır:** Windows servisi kurulmadı; terminalden başlatılan süreç kalıcı servis garantisi vermez. Docker imajı bu ortamda çalıştırılarak doğrulanmadı. e-Belge modülü 017 ile kaldırılmıştır; ürün kapsamına tekrar alınacaksa ayrı geliştirme/entegratör işi olarak ele alınmalıdır, mevcut entegrasyon hazırmış gibi sunulmamalıdır.

**Kabul:** Bilgisayarı yeniden başlatınca uygulama açılsın. Temiz müşteri kurulumu güvenli ilk yöneticiyle çalışsın. Aynı paket yükseltme ve geri dönüş denemesini geçsin. Teknik bilgisi sınırlı bir kişi kılavuzla kurabilsin.

### Adım 12 — Pilot ve satışa çıkış kabulü

**Yapılacak:** Temsili bir işletmede satın alma → kabul/kalite → üretim → sevk → satış faturası → iade → rapor zincirini gerçek rollerle deneyin. Fiziksel barkod/kamera, çevrimdışı mobil, yedekten dönüş ve güncelleme denemesi yapın. Açık bulgulara test kanıtı ve sorumlu ekleyin; düzeltmeleri sürümleyin.

**Kabul:** Kritik veri kaybı/yetki/mükerrer işlem bulgusu açık kalmasın. Eski kayıt mutabakatı tamamlanmış veya açık kapsam kararıyla yönetilmiş olsun. Kurulum, yedek, geri dönüş ve pilot sonuçları kayıtlı olsun. Ancak bu aşamadan sonra satışa hazır sürüm onayı verilsin; keyfi yüzde veya garanti kullanılmasın.

## 5. Yedekler, kanıtlar ve devam noktası

- Yerel son güncelleme öncesi DB+uploads yedeği: `C:\Erp\backups\pre-financial-final-2026-09-20T01-22-33-424Z`.
- Ayrı kopyada geçiş provası: `C:\Erp\backups\pre-financial-2026-09-20T01-21-37-701Z`.
- Son test kayıtları: `C:\Erp\dream-plus-release-verification\server-maintenance.log`, `browser-maintenance.log`, `maintenance-targeted.log`, `lint-maintenance.log`.
- İlk inceleme: `docs/analiz-2026-09-19/TEKNIK-ANALIZ.md`; öncelik/kanıt listesi `GELISTIRME-IS-LISTESI.csv`. Bunlar düzeltme öncesi fotoğraftır; güncel durumla birlikte okunmalıdır.
- Devam edildiğinde ilk geliştirme işi **Adım 1: dosyaları kapsayan otomatik tam yedek ve güvenli geri yükleme** olmalıdır. Bu devir hazırlanırken bu işe başlanmadı.
- Kod değişikliği tamamlanıp test edilmeden mevcut veritabanına yeni migration uygulamayın. Eski sürüme yalnız kodu geri alarak dönmeyin; veri etkisini ve geçiş sonrası işlemleri ayrıca değerlendirin.
