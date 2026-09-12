# PROJECT_STATUS.md

## 2026-09-12 (devam 4) — Rekabet eksiklerini kapatma turu: Aşama 1 (muhasebe köprüsü)

Kullanıcıya rakip ürünlere (Logo/Netsis/Mikro, Odoo/SAP B1) karşı geride
kalınan 8 alan konusunda dürüst bir değerlendirme sunuldu; kullanıcı hepsini
eklemek istedi. Gerçekçi sıralama netleştirildi (bkz.
`C:\Users\ilker\.claude\plans\peppy-puzzling-plum.md`): muhasebe köprüsü
**genel** formatta (belirli bir programa özel değil), e-Fatura gerçek
entegratör testi entegratör hesabı olmadığı için **ertelendi**, arayüz
modernizasyonu **React** ile başlatılacak.

**Aşama 1 — Genel muhasebe dışa aktarım köprüsü (TAMAMLANDI, `af46eca`).**
`account_code_mappings` tablosu (tekdüzen hesap planı varsayılanları: 600
Yurtiçi Satışlar, 391 Hesaplanan KDV, 120 Alıcılar, 191 İndirilecek KDV,
320 Satıcılar, 153 Ticari Mallar — hangi programa geçilirse geçilsin
yalnızca bu kodlar güncellenir). `services/accounting-export.js`: satış
faturalarından (zaten subtotal/vat_total tutuyor) ve alış faturalarından
(yalnızca KDV hariç net tutar tutuyor — KDV oranı bağlı PO kalemlerinin
`items.vat_rate`'inden ağırlıklı ortalama olarak türetiliyor, açıkça
belgelenmiş bir varsayım) çift taraflı (borç=alacak) yevmiye satırları
üretir; borç≠alacak olursa sessizce yanlış sonuç yerine açıkça hata verir.

Yönetim > Muhasebe Aktarımı sekmesi: tarih aralığı, önizleme, CSV indirme,
hesap kodu eşleme editörü. Tarayıcıda uçtan uca doğrulandı (borç=alacak
dengesi canlı olarak teyit edildi — bu oturumda `computer` aracının
tıklama/ekran görüntüsü kararsızdı, doğrudan DOM/JS incelemesiyle
doğrulandı).

`test/accounting-export.js` (22 test) + `test/ui-smoke.js` güncellendi
(admin sekme sayısı 10→11). Doğrulama: `tsc` temiz, `eslint` 0 hata,
`node test/run-all.js` **1068/1068**.

**Sırada — Aşama 2:** Arayüz modernizasyonu, React'e kademeli
(strangler-fig) geçiş, Faz 1: Vite kurulumu + Panel (Dashboard) ekranının
React'e taşınması. Detaylar plan dosyasında.

---

## 2026-09-12 (devam 3) — Çok şirketlilik altyapı hazırlığı: Aşama A + B (tamamlandı)

**Kullanıcının nihai hedefi:** bu ürünü ayrı ayrı fabrikalara/şirketlere
satmak — altyapı hazır olsun, ama şimdi devreye alınmasın. Bir keşif ajanı
mevcut durumu çıkardı: `company_id` yalnızca 65 tablodan 7'sinde vardı
(hepsi nullable, indekssiz), hiçbir sorguda filtre olarak kullanılmıyordu,
canlı API rotaları (`POST /users`, `/warehouses`, `/suppliers`,
`/customers`, `/items`) bu alanı hiç yazmıyordu (yeni kayıtlar `NULL`
alıyordu), `companies` tablosuna her erişim sabit `WHERE id = 1`, ve
auth/JWT'de şirket kavramı sıfırdı. Ayrıca kullanıcı adı/ürün kodu gibi
bazı alanlar global (şirketler arası) benzersiz — gerçek izolasyona engel.

Kullanıcı "şema + daha derin hazırlık" kapsamını onayladı. İş, SQLite'ta
risk profili farklı olan **iki aşamaya** bölündü (`
C:\Users\ilker\.claude\plans\peppy-puzzling-plum.md`):

**Aşama A — şema tamamlama, katkısal (TAMAMLANDI, `5c1a34f`).**
`server/migrations/006_multitenancy_prep.js`: eksik ~56 işlemsel tabloya
`company_id INTEGER NOT NULL DEFAULT 1` + indeks eklendi; zaten var olan
6 ana veri tablosundaki NULL değerler 1'e dolduruldu. `server/lib/tenant.js`
(yeni, atıl `companyIdOf(req)`), `server/middleware/auth.js` (JWT/`req.user`'a
atıl `companyId`), 5 route'ta INSERT düzeltmesi (artık `company_id` yazıyor).

**Geliştirme sırasında bulunan 2 gerçek sorun (planlanandan farklıydı):**
1. SQLite `ALTER TABLE ADD COLUMN`, `REFERENCES` + `NOT NULL DEFAULT`
   kombinasyonuna izin vermiyor — yabancı anahtar bu yeni sütunlar için
   eklenemedi (atıl sütun için şimdilik kritik değil, gerçek aktivasyonda
   yeniden ele alınacak).
2. `document_templates.company_id`'deki NULL'lar **kasıtlı bir iş kuralı**
   ("tüm firmalar için geçerli varsayılan şablon" — 005_templates.js'in
   kendi yorumunda zaten yazıyordu). İlk denemede bunu da 1'e doldurmayı
   planlamıştım; hem semantiği bozardı (varsayılan şablonları company 1'e
   özel yapardı) hem de gerçek bir yabancı anahtar hatası verdi (migration
   sırasında `companies` tablosu henüz boş — seed her zaman migration'lardan
   SONRA çalışır). Bu tablo backfill'den açıkça hariç tutuldu.

**Doğrulama:** `test/multitenancy.js` (yeni, 141 test) — şema bütünlüğü,
5 canlı rotanın gerçekten `company_id` yazdığı, JWT claim'i. `npx tsc
--noEmit` temiz, `npx eslint .` 0 hata, `node test/run-all.js`
**1038/1038** (897 + yeni multitenancy 141) — davranış değişmedi.

**Aşama B — şirket bazlı benzersizlik (TAMAMLANDI, `58ae7b6`).** Kullanıcı
onayladıktan sonra `server/migrations/007_scoped_uniqueness.js`:
`users.username`, `work_centers.code`, `shifts.code` için SQLite'ın resmi
tablo yeniden oluşturma yöntemiyle (create-copy-drop-rename)
`UNIQUE(username)` → `UNIQUE(company_id, username)` (aynısı diğer ikisi
için de).

**Geliştirme sırasında bulunan 2 gerçek sorun:**
1. SQLite, başka tabloların yabancı anahtarla başvurduğu bir tabloyu
   (`DROP TABLE users`) `foreign_keys=ON` iken silmeye izin vermiyor.
   Resmi çözüm `PRAGMA foreign_keys=OFF`'u transaction DIŞINDA çalıştırmak
   — ama `migrate.js` her migration'ı otomatik transaction'a sarıyordu.
   `server/migrate.js`'e küçük, geriye dönük uyumlu bir bayrak eklendi
   (`disableForeignKeys`) — bu bayrağı taşımayan mevcut 7 migration'ın
   davranışı hiç değişmedi.
2. Aşama A'dakiyle aynı sınıftan bir sorun: `company_id`'ye
   `REFERENCES companies(id)` eklemek migration'lar `companies` tablosu
   henüz boşken çalıştığı için (seed migration'lardan SONRA çalışır)
   `foreign_key_check`'i her seferinde başarısız kılıyordu — kaldırıldı,
   yalnızca `NOT NULL DEFAULT 1` bırakıldı.

**Doğrulama — asıl kanıt:** `test/multitenancy.js`'e eklenen testler
`companies` tablosuna doğrudan SQL ile (arayüz yok, kasıtlı) ikinci bir
test firması ekleyip AYNI kullanıcı adının/iş merkezi kodunun/vardiya
kodunun farklı şirkette ÇAKIŞMADAN eklenebildiğini, aynı şirket içinde
hâlâ reddedildiğini kanıtlıyor — dormant bir kolon değil, gerçekten
çalışan bir izolasyon yapısı. 141→148 test, toplam **1045/1045**.

**Kapsam dışı (kullanıcıyla konuşulup ertelendi):** `settings`/
`number_sequences` şirket bazlı hale getirme, `/companies` CRUD, şirket
değiştirme arayüzü, gerçek sorgu filtrelemesi — bunlar gerçek aktivasyona
çok daha yakın adımlar, gerçek bir ikinci müşteri onboard edilecekken ele
alınmalı.

---

## 2026-09-12 (devam 2) — İkinci tur: off-site yedek + Dependabot + ESLint

4 aşamalık sertleştirme turunun ardından, kalan operasyonel/araç boşlukları
sırayla kapatıldı (her biri ayrı commit, öncesinde `node test/run-all.js`
ile doğrulandı):

**Off-site yedek senkronizasyon kancası (`be22e7e`).** Yerel yedek sunucuyla
aynı diskte duruyordu (disk arızası/yangın/hırsızlıkta işe yaramaz — bu zaten
`docs/KURULUM.md`'de belirtiliyordu ama hiçbir araç yoktu). Yeni
`BACKUP_OFFSITE_CMD` ortam değişkeni, her başarılı yerel yedekten sonra
kullanıcının seçtiği bir komutu (rclone/rsync/robocopy) çalıştırır.
Başarısızlık — e-posta bildirimlerinde daha önce bulunan "sessizce yutulan
hata" dersi tekrarlanmasın diye — açıkça loglanır, ana yedeği bozmaz.
5 yeni test (`test/backup-restore.js` 32→37). Ayrıca `npm run demo`
(`server/scripts/demo.js`) eklendi — `DEMO_DATA=1 npm start` Windows'ta
çalışmıyordu, platform bağımsız bir başlatıcı yazıldı.

**Dependabot (`58306bf`).** Haftalık npm + github-actions bağımlılık
taraması — `npm audit` yalnızca push anında çalıştığı için yeni bir CVE
bir sonraki push'a kadar fark edilmiyordu.

**ESLint (`958fcd2`).** Dar kapsamlı, yalnızca gerçek hata yakalayan kurallar
(üslup zorlanmadı). Bu geçişte **3 gerçek hata bulundu**: `public/js/i18n.js`
içinde `dueDate` anahtarı iki farklı anlamla (RFQ teklif tarihi / üretim
termini) tanımlanmıştı — JS'te son tanım kazandığı için RFQ ekranı sessizce
yanlış etiket gösteriyordu; çakışan anahtar `orderDueDate` olarak ayrıldı.
Ayrıca birkaç dosyada hiç okunmadan ezilen "ölü" değişken ilklendirmeleri
temizlendi. `npm run lint` CI'a eklendi.

**Toplam doğrulama:** `npx tsc --noEmit` temiz · `npx eslint .` → 0 hata,
53 zararsız uyarı (kasıtlı: dosyalar arası paylaşılan global değişkenler,
ESLint'in izleyemediği bir mimari örüntü) · `node test/run-all.js`
**897/897** (872 + `dates` 20 + backup +5).

**Tartışılıp ertelenen (kod değişikliği yapılmadı):**
- **API versiyonlama:** Tüm uç noktalar `/api/...` altında, sürüm öneki yok.
  Frontend+backend her zaman birlikte dağıtıldığı için şu an pratik bir sorun
  değil; üçüncü bir sistem bu API'ye bağımlı olursa yeniden ele alınmalı.
- **Hız sınırlayıcı tek-sunucu varsayımı:** `express-rate-limit` bellek içi
  sayaç tutuyor — çoklu uygulama örneği (yük dengeleyici arkasında)
  çalıştırılırsa etkisiz kalır. Şu anki tek-tesis modeliyle sorun değil.

---

## 2026-09-12 (devam) — Sertleştirme (hardening) turu: 4 aşama tamamlandı

Bağımsız doğrulama turunun ardından kullanıcı "gerçekten kusursuza yakın" bir
proje istedi ve teknik kararları tarafımıza bıraktı. `C:\Users\ilker\.claude\plans\peppy-puzzling-plum.md`
planına göre 4 aşama uygulandı; her aşama kendi git commit'i olarak kaydedildi
ve her commit'ten önce tam test paketi (`node test/run-all.js`) çalıştırılıp
doğrulandı.

**Aşama 1 — Test izolasyonu + CI (`6225305`).** `test/run-all.js` yazıldı:
sunucu gerektiren her paket için `data/` sıfırlanır, taze migration+seed ile
sunucu ayağa kaldırılır, YALNIZCA o paket çalıştırılır, sonra kapatılır.
Öncesinde paketler zincirlenerek çalıştırıldığında paylaşılan durum sahte
hatalar üretiyordu (bkz. bir önceki bölüm). `package.json`'un eksik `test:all`
script'i bunu çağıracak şekilde güncellendi. `.github/workflows/ci.yml`
eklendi — ubuntu+windows, node 20+22 matrisi (Windows matrisi kasıtlı: bugün
bulunan Windows'a özgü EBUSY hatası CI hiç Windows'ta çalışmadığı için
kaçmıştı). **Not:** CI dosyası eklendi ama bu oturumda uzak bir GitHub deposu
yok, dolayısıyla gerçek bir Actions çalıştırması bu ortamda görülemedi —
kullanıcı push ettiğinde ilk kez çalışacak.

**Aşama 2+3 — Tip güvenliği ağı + UTC/yerel saat hata sınıfının kapatılması
(`bf568ed`, birleştirildi çünkü aynı fonksiyonlara dokunuyorlardı).**

- `tsconfig.json` (checkJs+noEmit, **build adımı yok** — mevcut build'siz
  frontend mimarisi korundu), `typescript` devDependency, `npm run typecheck`
  CI'a eklendi.
- `server/types/better-sqlite3-shim.d.ts`: better-sqlite3'ün resmi tipleri
  `.get()/.all()` için `unknown` döndürüyor; ham SQL'e dayalı bu kod
  tabanında bu, yüzlerce sorgu için ayrı satır şekli tanımlamayı
  zorunlu kılardı. Bilinçli olarak gevşek bir beyan yazıldı (`any`); asıl
  tip denetimi `server/db.js`, `server/lib/core.js` ve
  `server/services/*.js`'deki dokümante edilmiş fonksiyon imzalarında.
  Kalan ~65 dosya `// @ts-nocheck` ile işaretli — kapsam zamanla genişleyebilir.
- **`server/services/mrp.js`'de `capacity.js` ile BİREBİR AYNI hata bulundu**
  (tarih string'i UTC üretilip yerel saat olarak geri okunuyordu). MRP'de bu,
  sonsuz döngü değil ama BOM seviyeleri arasında **birikerek büyüyen** bir
  hataydı (her seviyede bir gün erken bırakma tarihi). `server/lib/dates.js`
  yazıldı (tek paylaşılan kaynak: `toLocalDateStr/today/addDays/isoWeekday/
  daysBetween`); `capacity.js` ve `mrp.js` kendi kopyalarını silip oradan
  import ediyor. `test/dates.js` (20 test) eklendi — asıl hatanın kendisini
  regrese eden bir test dahil.
- Aynı örüntünün daha hafif izleri şurada da bulunup düzeltildi: e-Belge
  `issueDate` (resmî belge), tedarikçi zamanında-teslimat metriği, kapasite
  panosu varsayılan aralığı, tarihsel kur lookup, ve ~10 dosyada "bugün"ün
  UTC'den hesaplanması (çoğu kendi kendini düzelten, gece yarısı sonrası
  ~3 saatlik dar bir pencerede etkili — ayrıntı git log'da).

**Aşama 4 — Correlation/Request ID (`b1d2836`).** `server/index.js`'e
istek başına `req.id` (gelen `X-Request-Id` korunur, yoksa üretilir),
yanıt header'ına ve tüm hata yanıtlarıyla log satırlarına eklendi.

**Toplam doğrulama:** `npx tsc --noEmit` temiz · `node test/run-all.js`
**892/892** (872 + yeni `test/dates.js`) · her commit öncesi ayrı ayrı
çalıştırılıp doğrulandı, davranış hiçbir yerde değişmedi.

**Ertelenen/yapılmayan (gerekçeli, plan dosyasında tam detay):**
PostgreSQL'e geçiş, frontend'i gerçek TypeScript+bundler'a taşımak,
Jest/Vitest'e tam göç, OpenAPI şeması, çok şirketlilik (multi-tenant —
kullanıcıyla mutabık kalınarak bu turdan sonraya bırakıldı).

---

## 2026-09-12 — Bağımsız doğrulama turu + 2 gerçek hata düzeltildi

Bu proje daha önce hiç gerçek bir ortamda kurulup çalıştırılmamıştı (geliştirme
tamamen kod üretimiyle yapılmış, "872 kontrol geçti" iddiası doğrulanmamıştı).
Bu oturumda **sıfırdan gerçek bir Windows makinesinde kuruldu, çalıştırıldı ve
16 test paketinin tamamı birbirinden izole biçimde bağımsız olarak tekrar
çalıştırıldı.**

**Ortam kurulumu (makinede hiçbiri yoktu):** Node.js 24 LTS, Git, Python 3.12,
Visual Studio Build Tools (C++ derleyici — `better-sqlite3` native modülünü
derlemek için gerekli). npm 11'in yeni `allow-scripts` güvenlik kapısı
`better-sqlite3`'ün kurulum betiğini otomatik engelledi; `npm approve-scripts
better-sqlite3` ile elle onaylandı (paket npm'deki gerçek, yaygın kullanılan
`better-sqlite3@13.0.3` — tedarik zinciri riski değerlendirilip onaylandı).

**Metodoloji notu — test paketleri zincirlenerek çalıştırılamaz:** Paketler
paylaşılan tek bir sunucu/veritabanı durumu üzerinde çalışır ve durum
değiştirir. Tüm paketleri arka arkaya tek oturumda çalıştırmak 3 pakette
(`data-health`, `planning`, `ui-smoke`) gerçek olmayan başarısızlıklar
üretti: `import` testinin bıraktığı 1000 satırlık kalıcı test verisi,
`e2e`'nin tükettiği tek karantina/muayene kaydı, `security`'nin tetiklediği
giriş kilidi. Her paket `rm -rf data` + taze `migrate+seed` sonrası **izole**
çalıştırıldığında bu 3 paket de tam geçti. Bu bir uygulama hatası değil —
`README.md`'nin zaten belirttiği "temiz sonuç için `rm -rf data` sonrası
çalıştırın" uyarısının paket başına geçerli olduğunun doğrulanmasıdır.

**Bulunan ve düzeltilen 2 gerçek hata:**

1. **Kritik — sonlu kapasiteli çizelgeleme UTC+3 gibi UTC-doğusu saat
   dilimlerinde tamamen çalışmıyordu** (`server/services/capacity.js`).
   `toDateStr()` UTC tabanlı (`toISOString()`) bir tarih string'i üretiyor,
   ama aynı string dosyanın başka yerlerinde yerel saat olarak geri parse
   ediliyordu (`new Date(dateStr + 'T00:00:00')`). Pozitif UTC ofsetli saat
   dilimlerinde bu, `findSlot()`'un gün ilerletme döngüsünde sabit bir
   noktada takılmasına yol açıyordu: fonksiyon "ertesi güne geçtim" sanıp
   aslında AYNI günü sonsuz kez üretiyor, 180 günlük ufkun tamamını hiç
   ilerlemeden tüketip "kapasite bulunamadı" hatası veriyordu — iş merkezi,
   vardiya, tatil durumu fark etmeksizin **her zaman, %100 tekrarlanabilir**.
   Türkiye (UTC+3) bu sistemin hedef pazarı olduğundan, canlıda **hiçbir
   üretim emri asla çizelgelenemezdi**. `toDateStr()` yerel tarih
   bileşenleriyle üretecek şekilde düzeltildi. Doğrulama: `test/planning.js`
   düzeltmeden önce ilk çizelgeleme denemesinde her zaman başarısız
   oluyordu; düzeltmeden sonra 78/78 geçiyor.

2. **Windows'a özgü — başarısız bir yükseltmeden sonra otomatik yedeğe geri
   dönüş Windows'ta başarısız oluyordu** (`server/scripts/upgrade.js`).
   `backup.js` modülü kendi üst seviyesinde `require('../db')` ile bir
   SQLite bağlantısı açıp hiç kapatmıyordu; migration başarısız olup
   `restore.restore()` veritabanı dosyasını `.pre-restore-*` olarak yeniden
   adlandırmaya çalıştığında, bu kapatılmamış bağlantı dosyayı hâlâ açık
   tuttuğu için Windows `EBUSY: resource busy or locked` hatasıyla
   rename'i reddediyordu (POSIX'te açık bir tanıtıcıyla dosya yeniden
   adlandırılabildiği için Linux/Mac'te bu hiç ortaya çıkmamış olabilir).
   Sonuç: PROJECT_STATUS'un "geri dönüş gerçekten test edildi" iddiası
   doğruydu ama yalnızca POSIX'te; Windows'ta tam da dokümantasyonun
   "en tehlikeli durum" dediği senaryoda (yarıda patlayan migration) otomatik
   kurtarma **kendisi de başarısız oluyordu**. Yedek alma adımından hemen
   sonra ve geri dönüşten hemen önce bu bağlantı artık açıkça kapatılıyor.
   Doğrulama: `test/setup-upgrade.js` düzeltmeden önce Windows'ta bu adımda
   her zaman başarısız oluyordu; düzeltmeden sonra 46/46 geçiyor.

**16 paketin tam, izole, bağımsız doğrulama sonucu (bugün, temiz veritabanı,
Windows 11):**

| Paket | Sonuç |
|---|---|
| e2e | 77/77 |
| contract | 58/58 |
| import | 82/82 |
| templates | 50/50 |
| mobile | 57/57 |
| data-health | 60/60 |
| einvoice | 72/72 |
| planning | 78/78 (düzeltme sonrası) |
| ui-smoke | 101/101 |
| security | 57/57 |
| load | 19/19 |
| visual | 34/34 |
| backup | 32/32 |
| email | 28/28 |
| barcode | 21/21 |
| setup-upgrade | 46/46 (düzeltme sonrası) |
| **Toplam** | **872/872** |

`npm audit --omit=dev` → 0 zafiyet (bugün yeniden çalıştırıldı, doğrulandı).

**Kapatılmamış boşluk — sürüm kontrolü yok:** `C:\Erp` bir git deposu değil;
`depo-takip-app` içinde `.git` yok. `.gitignore` mevcut olduğuna göre bir git
deposu planlanmıştı ama hiç `git init` yapılmamış. Kullanıcı istemeden hiçbir
commit/init işlemi yapılmadı (CLAUDE.md §61). Şu anki dosya durumu, buradaki
düzeltmeler dahil, sürüm kontrolüne alınana kadar tek kopya ve korumasızdır.

**Sonraki önerilen adım:** `git init` + ilk commit (kullanıcı onayı bekliyor),
ardından yol haritasında listelenen olası ileri adımlardan biri (çok
şirketlilik, barkod etiket yazdırma, vb.) veya kullanıcının belirttiği başka
bir özellik.

---

Önceki güncelleme: **yol haritası tamamlandı** (madde 5 kasıtlı olarak atlandı) — 872 kontrol geçiyor

Kalan işler kod yazarak kapatılamaz; `docs/YOL-HARITASI.md` sonundaki
"yalnızca sahada çözülebilecekler" listesinde duruyor.

**Kapsam kararı:** e-Fatura/e-İrsaliye ve muhasebe entegrasyonu kapsam dışıdır (resmî belge
sorumluluğu alınmak istenmiyor). e-Belge modülü kodda duruyor ama varsayılan olarak KAPALI.
Kalan yol haritası `docs/YOL-HARITASI.md` içinde.

## Projenin amacı
Basit bir depo takip sayfasından başlayıp, fabrika seviyesinde tam kapsamlı bir ERP sistemine dönüştürmek.
Node.js + Express + SQLite (better-sqlite3) backend, çok modüllü vanilla JS frontend.
Kapsam: lot bazlı stok, karantina, üretim (BOM + gerçek maliyet), satın alma (talep/RFQ/onay/kısmi teslim/landed cost),
satış (sipariş/sevkiyat/kârlılık), kalite (muayene/NCR/CAPA/kalibrasyon/izlenebilirlik), raporlar, yönetim, denetim kaydı.

## Tamamlanan görevler

### Backend — TAMAMLANDI, 77/77 test geçti
- `server/db.js` — better-sqlite3, WAL, foreign_keys ON, `tx()` / `txImmediate()` transaction helper
- `server/migrate.js` — migration runner (schema_migrations tablosu)
- `server/migrations/001_initial_schema.js` — **53 tablo + 40 indeks**
- `server/lib/core.js` — AppError, uuid, nextNumber, logAudit (eski/yeni değer), diff, getSetting/setSetting, fxRate (tarihsel), toBase, paginate
- `server/middleware/auth.js` — JWT + sessions ile sunucu tarafı iptal, PERMISSIONS matrisi
- `server/middleware/validate.js` — zod doğrulama, `req.valid` + `req.body` alias
- `server/index.js` — pino log, rate limit, güvenlik header, CORS, /health, merkezi hata yakalama, graceful shutdown
- `server/seed.js` — kapsamlı fabrika senaryosu (5 kullanıcı, 4 depo, 5 tedarikçi, 3 müşteri, 9 ürün, çok seviyeli BOM, karantina lotu, ölü stok, 3 satın alma siparişi, kısmi teslim, landed cost, muayene, kapalı NCR+CAPA, 3 cihaz, tamamlanmış üretim + genealogy, satış siparişi + sevkiyat)
- `server/scripts/backup.js` — SQLite online backup API + rotasyon + scheduler
- Servisler: `stock.js` (FEFO/FIFO, lot bölme, genealogy, recallTrace), `costing.js` (landed cost dağıtımı), `notifications.js`, `traceability.js`
- Route'lar: auth, items, stock, production, purchasing, sales, quality, reports, admin, documents, notifications
- `test/e2e.js` — 77 test, hepsi geçti

### Frontend — TAMAMLANDI
- `public/index.html` — login + sidebar (10 view) + bildirim paneli + modal host
- `public/css/style.css` — tam stil sistemi
- `public/js/i18n.js` — tam TR/EN sözlük
- `public/js/api.js` — tüm endpoint'leri kapsayan istemci
- `public/js/ui.js` — paylaşılan yardımcılar (format, modal, tablo, form, chart, print, CSV, can())
- `public/js/views/dashboard.js` — KPI'lar, 3 grafik, kritik listeler
- `public/js/views/items.js` — liste/filtre, barkod tarama, ürün formu + BOM editörü, stok giriş, ürün kartı
- `public/js/views/lots.js` — lot listesi, durum değiştirme, transfer, izlenebilirlik + geri çağırma + yazdırma
- `public/js/views/counts.js` — sayım listesi, fark hesaplama, onay
- `public/js/views/production.js` — üretim emirleri, requirements önizleme, tamamlama, detay
- `public/js/views/purchasing.js` — 5 sekme (orders/suppliers/requests/rfqs/invoices)
- `public/js/views/sales.js` — 5 sekme; sevkiyatta FEFO otomatik/elle lot seçimi, kasa ölçüleri, kârlılık analizi
- `public/js/views/quality.js` — 6 sekme; muayenede limitlere göre otomatik uygun/uygunsuz, e-imza, NCR kararı, DÖF etkinlik kontrolü
- `public/js/views/reports.js` — 9 rapor sekmesi, hepsi CSV dışa aktarımlı
- `public/js/views/admin.js` — kullanıcı/depo/kur/kurallar/denetim kaydı/ayarlar
- `public/js/app.js` — router, login, dil, rol kapısı, bildirim paneli, badge yenileme

### Dağıtım — TAMAMLANDI
- `Dockerfile`, `docker-compose.yml`, `nginx.conf` (TLS bloğu hazır, yorumlu)
- `.env.example`, `.gitignore`, `.dockerignore`
- `README.md` — modüller, yetki matrisi, güvenlik, API özeti, mimari notlar
- `package.json` scripts düzeltildi (`npm test` artık gerçek e2e paketini çalıştırıyor)

## Devam eden görev
Yok — proje tamamlandı.

## Excel veri aktarımı (yol haritası madde 1) — TAMAMLANDI

- `004_import.js` — import_batches, import_rows + kayıtlarda parti işareti (geri alma için)
- `services/import.js` — 7 tip şeması, esnek sütun eşleştirme, TR/EN sayı ve tarih
  ayrıştırma, satır bazlı doğrulama, referans kontrolü
- `services/import-commit.js` — tip bazlı yazıcılar, tek transaction, geri alma, şablon üretimi
- `routes/import.js` + Yönetim > Veri Aktarımı sekmesi
- `test/import.js` → 82/82 (1000 satırlık dosya dahil)

**Bulunan gerçek hata:** Sistemin ürettiği şablonun başlıkları eşleştirme listesinde yoktu;
kullanıcıya verdiği şablonu geri kabul etmiyordu. Düzeltildi, her tip için gidiş-dönüş testi eklendi.

**Bağımlılık notu:** npm'deki `xlsx` paketi terk edilmiş ve düzeltilemeyen yüksek önemli
açıkları var; `exceljs` kullanıldı. Onun eski `uuid` bağımlılığı da `overrides` ile
yamalı sürüme zorlandı. Sonuç: 0 zafiyet.

## Belge şablonları (yol haritası madde 2) — TAMAMLANDI

- `005_templates.js` — document_templates tablosu + firma logosu/antet alanları,
  8 belge tipi için varsayılan şablon
- `routes/templates.js` — şablon okuma/yazma, logo yükleme, firma kimliği, sıfırlama
- `ui.js` — yazdırma motoru şablon farkında: logo, antet, vurgu rengi, kâğıt boyutu,
  alan görünürlüğü, imza kutuları. İki imza destekli (eski çağrılar çalışmaya devam eder).
- Yönetim > Belge Şablonları sekmesi: düzenleyici + kaydetmeden önce önizleme yazdırma
- `test/templates.js` → 50/50

Küçük bulgu: migration sırasında `companies` tablosu henüz boş olduğu için
`company_id` yabancı anahtarı düşüyordu. Varsayılan şablonlar firmadan bağımsız
olduğu için bağ gevşetildi (NULL = tüm firmalar için geçerli varsayılan).

**Doğrulanamayan:** Basılan belgenin görünümü bu ortamda kontrol edilemez —
yazıcı ve tarayıcı gerekir. Ayarların doğru saklandığı ve motora aktarıldığı test
edildi; gerçek çıktı bir kez gözle kontrol edilmelidir.

## El terminali (yol haritası madde 3) — TAMAMLANDI

- `routes/mobile.js` — `resolve` (okutulan kodu çözer: ürün/parti/belge/raf),
  `tasks` (bekleyen işler), `pick-list` (FEFO + raf önerisi), `issue-list`, `sync` (toplu)
- `public/mobile.html` + `css/mobile.css` + `js/mobile.js` — ayrı, hafif terminal arayüzü
- Beş akış: mal kabul, toplama, sayım, malzeme çıkışı, yer değiştirme
- Çevrimdışı kuyruk (localStorage), USB okuyucu + kamera + elle giriş
- `test/mobile.js` → 57/57

Bulunan hatalar: `stock_counts.date` ve `stock_lots.location` sütunları yok
(raf ürün kartında). Sorgular gerçek şemaya göre düzeltildi.

**Doğrulanamayan:** Gerçek el terminalinde denenmedi — cihaz yok.

## Veri sağlığı denetimi (yol haritası madde 4) — TAMAMLANDI

- `services/data-health.js` — 22 kontrol: stok tutarlılığı, reçete mantığı,
  tekrarlayan kayıtlar, belge tutarlılığı, tanımsız alanlar. Sağlık puanı 0-100.
- `routes/data-health.js` — rapor, tek kontrol (sayfalı), otomatik düzeltme,
  kayıt birleştirme (önizlemeli), toplu güncelleme
- Yönetim > Veri Sağlığı sekmesi
- `test/data-health.js` → 60/60 (veri kasıtlı bozulup tespit doğrulanıyor)

Düzeltme dürüstlüğü: yalnızca doğru sonucu kesin bilinen bulgular otomatik
düzeltilir. Eksi stok, tekrarlayan barkod, döngüsel reçete gibi doğru değeri
yalnızca işi bilen birinin belirleyebileceği bulgular açıkça reddedilir.

**Bulunan gerçek hata:** `/items/:id` silinmiş ürünü de döndürüyordu; liste onu
gizlerken tekil sorgunun göstermesi tutarsızlıktı. Düzeltildi.

## Kurulum ve yükseltme (yol haritası madde 6) — TAMAMLANDI

**Bulunan ciddi hata:** Boş veritabanıyla başlatılan her kurulum demo verisini
otomatik yüklüyordu — sahte firma, sahte müşteriler ve şifresi README'de yazan
beş kullanıcı. Artık demo verisi yalnızca `DEMO_DATA=1` ile gelir; üretimde boş
veritabanı bulunursa sunucu başlamaz ve kuruluma yönlendirir.

- `scripts/setup.js` — gerçek kurulum (firma, yönetici, depo, kur). Etkileşimli
  veya parametreli; şifre ekrana basılmaz, kural uygulamayla aynı.
- `scripts/upgrade.js` — yedek al ve doğrula → uygula → doğrula → başarısızsa
  **yedeğe geri dön**. `--dry-run` destekli.
- Yükseltme öncesi yedek etiketli saklanır, rotasyonda silinmez.
- `GET /data-health/system` — sürüm, migration durumu, son yedek yaşı
- `docs/KURULUM.md`

Geri dönüş gerçekten test edildi: yarıda patlayan bir migration yazılıp
veritabanının eski haline döndüğü doğrulandı.

## Sıradaki görevler
Yok. Olası ileri adımlar (kullanıcı isterse):
- Çok şirketli (multi-tenant) kullanım
- E-fatura / GİB entegrasyonu
- Mobil uygulama veya PWA offline desteği
- Barkod etiket yazdırma (Zebra/ZPL)

## Değiştirilen dosyalar
Tüm proje sıfırdan bu oturumda oluşturuldu (yukarıdaki listeler).

## Önemli teknik kararlar
- **Stok modeli:** Tüm miktarlar `stock_lots` tablosunda. `items.qty_cache` sadece türetilmiş önbellek.
  Sadece `status='available'` lotlar tüketilebilir/sevk edilebilir. Her değişiklik `movements` tablosuna yazılır.
- **Lot durumları:** available / quarantine / blocked / rejected / consumed
- **Maliyet:** hareketli ortalama veya FIFO; landed cost lot birim maliyetine dağıtılır;
  tarihsel kur `exchange_rates` tablosunda (geçmiş alımlar kendi tarihindeki kurla değerlenir)
- **Roller:** admin / manager / operator / quality / viewer
- **Transaction sınırı:** Servis fonksiyonları çağıran tarafından açılan transaction içinde çalışır.
- Tek dosyalık HTML terk edildi; gerçek backend + çok dosyalı frontend.

## Karşılaşılan hatalar
1. `validate` middleware `req.body`'ye yazıyordu ama route'lar `req.valid` okuyordu.
2. `admin.js` içinde warehouses INSERT'te hatalı `.replace()` zinciri.
3. `seed.js` — production_orders, henüz oluşturulmamış output lot'a FK veriyordu → FOREIGN KEY constraint failed.
4. `seed.js` — inspection_lines INSERT'inde hatalı `.replace()` zinciri.

## Çözülen hatalar
Yukarıdaki 4 hatanın hepsi çözüldü. Sunucu temiz açılıyor, migration + seed sorunsuz, 77/77 test geçiyor.

## Sözleşme doğrulama turu (frontend ↔ backend alan adları)
Frontend hiç tarayıcıda çalıştırılmadığı için, görünümlerin okuduğu alan adları gerçek API
yanıtlarıyla karşılaştırıldı. Bulunan ve düzeltilen 6 sessiz hata:

1. **Sayım listesi hiç görünmüyordu** — backend düz dizi dönüyordu, frontend sayfalama zarfı bekliyordu.
   Backend zarfa çevrildi, `lineCount` eklendi.
2. **Sayım fark değeri hep ₺0** — satırlarda `unitCost` gönderilmiyordu. Backend'e eklendi.
3. **Sipariş listesinde tedarikçi adı boştu** — API `supplier` gönderiyor, frontend `supplierName` okuyordu.
   Ayrıca `approvedByName` → `approvedBy`.
4. **Tedarikçi detay penceresi boştu** — snake_case ve olmayan `recentOrders` okunuyordu;
   gerçek yanıt camelCase + `priceHistory` + `performance`. Pencere yeniden yazıldı.
5. **Muayene sonuçları kaydedilmiyordu** — frontend satır sonucunu `passed: bool` gönderiyordu,
   backend `result: 'pass'|'fail'|'na'` bekliyor. Ayrıca gerçekte hep otomatik NCR açıldığı için
   yanıltıcı olan "NCR aç" onay kutusu bilgi notuna çevrildi.
6. **Ürün kartında duruma göre stok hep sıfırdı** — backend dizi dönüyordu, arayüz nesne bekliyordu.
   Backend dört kovanın hepsini içeren nesneye çevrildi. Ayrıca ürün listesine `quarantineQty`/`blockedQty` eklendi.

Bunların tekrar sessizce oluşmaması için `test/contract.js` yazıldı (58 test):
her uç noktanın döndürdüğü alan adlarının arayüzün okuduklarıyla eşleştiğini doğrular.

## Arayüz doğrulama turu (jsdom)
Arayüz hiç tarayıcıda çalıştırılmamıştı — en büyük doğrulama boşluğu buydu.
`test/ui-smoke.js` yazıldı: index.html jsdom'a yüklenir, scriptler gerçek `<script>` etiketleriyle
enjekte edilir, gerçek sunucuya karşı giriş yapılır, 10 ekran ve 31 sekme gezilir, 19 diyalog açılır,
dil değiştirilir ve tüm gezinti boyunca yakalanmamış JS hatası denetlenir. **88/88 geçti, sıfır JS hatası.**

Test kurgusunda iki nokta ayarlandı (uygulama hatası değil):
- `window.eval` her dosyayı ayrı kapsamda çalıştırıyordu; gerçek `<script>` enjeksiyonuna geçildi.
- Sekmeli modüller son seçili sekmeyi hatırlıyor (kasıtlı davranış); test doğru sekmeyi seçecek şekilde yazıldı.

## Eksik madde listesi — ilerleme

**1. Görsel kontrol — TAMAMLANDI (ölçülebilir kısmı).**
`test/visual-audit.js` yazıldı: WCAG 2.1 kontrast oranları, dokunma hedefi boyutları,
yazı boyutu alt sınırı, duyarlı kırılma noktaları, erişilebilirlik işaretleri.
İlk çalıştırmada 2 hata + 8 uyarı çıktı, hepsi düzeltildi:
- Hata metni 4.03:1 idi (AA sınırı 4.5) → `--danger` açıldı `#EE7C72`
- Soluk metin 3.05:1 idi → `--text-faint` açıldı `#9199A0`
- Kenarlıklar görünmüyordu → `--border` açıldı, form alanları için ayrı `--border-input` (3:1) eklendi
- 10/10.5px yazılar 11px'e çıkarıldı
- İkon butonlar 27→32px, dokunmatik cihazlarda `pointer:coarse` ile 44px
- `prefers-reduced-motion` desteği eklendi; adsız ikon butonlara `aria-label` verildi
Sonuç: 34/34, sıfır uyarı. **Hâlâ yapılamayan:** hizalama, boşluk dengesi, genel görsel
bütünlük — bunlar gerçek tarayıcıda insan gözüyle bakılmalı.

**2. e-Fatura / e-İrsaliye — TAMAMLANDI (entegratör testi hariç).**
- `002_einvoice.js` — e_documents, e_document_log, e_document_series, customer_invoice_lines
  tabloları; firma/müşteri vergi alanları; kalem bazlı KDV
- `lib/ubl.js` — UBL-TR 1.2 üreticisi (Invoice + DespatchAdvice), birim/ülke kodu dönüşümü,
  gönderim öncesi tutarlılık doğrulaması
- `services/einvoice.js` — entegratörden bağımsız adaptör katmanı (`local` ve `http`),
  belge numarası serisi, gönderim/durum/iptal akışı, belge bazlı geçmiş
- `routes/edocs.js` — üretim, gönderim, durum sorgu, XML indirme, iptal, ayarlar
- `sales.js` faturaya kalem + KDV desteği; yeni `GET /sales/invoices/:id`
- Arayüz: Satış'ta "e-Belgeler" sekmesi, faturalar tablosunda e-Belge sütunu ve
  oluşturma butonu; Yönetim'de "e-Belge Ayarları" sekmesi
- `test/einvoice.js` → 70/70 geçti

**Kritik uyarı:** Üretilen XML hiçbir gerçek entegratöre veya GİB test ortamına karşı
denenmedi. Canlıya almadan önce seçilen entegratörün şema doğrulamasından geçirilmelidir.

**3. Yedekten geri dönüş — TAMAMLANDI.**
- `server/scripts/restore.js` — yedek doğrulama (SQLite başlığı, integrity_check, yabancı anahtar
  tutarlılığı, migration kaydı, çekirdek tablo dolu mu), güvenlik kopyası, başarısızlıkta otomatik geri alma
- `test/backup-restore.js` → 32/32. Gerçek prova: veri silindi, geri yüklendi, stok değeri
  kuruşuna kadar aynı çıktı; yedek sonrası eklenen kayıt beklendiği gibi gelmedi; bozuk ve boş
  yedekler reddedildi; rotasyon doğrulandı.

**4. SMTP ve barkod — TAMAMLANDI.**
- `test/email.js` → 28/28. Süreç içinde gerçek bir SMTP sunucusu açılıp mesajın teslim edildiği
  gönderen/alıcı/konu/gövde düzeyinde doğrulandı; MIME kodlu Türkçe başlık çözülerek kontrol edildi.
- **Bulunan gerçek kusur:** e-posta hataları sessizce yutuluyordu — uyarılar gitmese kimse fark
  etmezdi. Artık sebep kaydediliyor, `GET /notifications/mail-status` ve `POST /notifications/test-mail`
  eklendi, zaman aşımı sınırlandı.
- `UI.onBarcodeScan` — USB okuyucu desteği (tuş aralığından insan yazışından ayırt eder).
  `test/barcode.js` → 21/21. Kamera bu ortamda test edilemez; yedek yollar ve mesajlar doğrulandı.

**5. MRP / kapasite / iş merkezi / vardiya — TAMAMLANDI.**
- `003_planning.js` — work_centers, shifts, work_center_shifts, calendar_exceptions, routings,
  production_operations, mrp_runs, mrp_suggestions, shift_logs + ürün planlama parametreleri
- `services/capacity.js` — vardiya bazlı kapasite, sonlu kapasiteli çizelgeleme, OEE
- `services/mrp.js` — seviye hesabı, döngüsel reçete tespiti, netleme, parti büyüklüğü,
  tedarik süresi kaydırması, öneriyi belgeye dönüştürme
- `routes/planning.js` + `views/planning.js` (5 sekme)
- `test/planning.js` → 78/78

**6. Yük testi, güvenlik taraması, kullanıcı dokümanı — TAMAMLANDI.**
- `test/load.js` → 19/19. **533 istek/sn okuma, p95 37 ms, 430 yazma/sn, sıfır kayıp güncelleme.**
  60 eşzamanlı stok girişi sonrası toplam tam doğru; belge numaralarında yarış yok.
- `npm audit` → nodemailer 6.x'te yüksek önemli zafiyetler bulundu, 10.x'e yükseltildi.
  **Şu an sıfır zafiyet.**
- `test/security.js` → 57/57. **Bulunan gerçek eksikler:** `X-Powered-By` sürüm sızdırıyordu
  (kapatıldı), serbest metin alanlarında uzunluk sınırı yoktu (eklendi), CSP tanımlı değildi (eklendi).
- XSS için statik tarama terk edildi (dört kez yanlış pozitif üretti: JS'teki `<` karşılaştırmasını
  HTML sandı, iç içe şablonları böldü). Yerine davranışsal test kondu: payload'lar gerçek render
  fonksiyonlarından geçirilip DOM'da element oluşup oluşmadığına bakılıyor.
- `docs/KULLANIM-KILAVUZU.md` — role göre yazılmış son kullanıcı kılavuzu (12 bölüm).

**Paket doğrulamasında bulunan son kusur (düzeltildi):** Giriş hız sınırı TÜM girişleri sayıyordu.
Tek bir internet çıkışı arkasındaki bir fabrikada sabah mesai başında 10. çalışandan sonrası
giremezdi — saldırgan değil, personel engellenirdi. Artık yalnızca BAŞARISIZ denemeler sayılıyor
(`skipSuccessfulRequests`). Doğrulandı: 15 ardışık başarılı giriş sorunsuz geçiyor, 5 başarısız
denemeden sonra engelleniyor.

## Test durumu — hepsi temiz veritabanında geçti

| Paket | Sonuç |
|---|---|
| `npm test` (e2e) | 77/77 |
| `npm run test:contract` | 58/58 |
| `npm run test:import` | 82/82 |
| `npm run test:templates` | 50/50 |
| `npm run test:mobile` | 57/57 |
| `npm run test:health` | 60/60 |
| `npm run test:setup` | 46/46 |
| `npm run test:einvoice` | 72/72 (modül varsayılan kapalı) |
| `npm run test:planning` | 78/78 |
| `npm run test:ui` | 101/101 |
| `npm run test:security` | 57/57 (0 açık, 0 uyarı) |
| `npm run test:load` | 19/19 |
| `npm run test:visual` | 34/34 (0 uyarı) |
| `npm run test:backup` | 32/32 |
| `npm run test:email` | 28/28 |
| `npm run test:barcode` | 21/21 |
| **Toplam** | **872 kontrol** |

`npm audit --omit=dev` → 0 zafiyet.

## Çözülmemiş sorunlar
Bilinen yok.

Not: Testler aynı veritabanı üzerinde ikinci kez çalıştırılırsa 3 test başarısız görünür
(karantina lotu serbest bırakılmış, sipariş onaylanmış, muayene kapatılmış olur).
Bu bir hata değil — testler durum değiştiren gerçek işlemler yapıyor. Temiz test için `rm -rf data` sonrası çalıştırın.

## En son hangi noktada kalındı
Proje tamamlandı. ZIP paketi sıfırdan açılıp kurularak doğrulandı:
migration + seed sorunsuz, `/health` yanıt veriyor, 77/77 test geçiyor, tüm statik dosyalar 200 dönüyor.

## Bir sonraki yapılması gereken işlem
Yok. Teslim edildi: `/mnt/user-data/outputs/depo-takip-erp.zip` (node_modules hariç).

### Hâlâ kapatılamayan boşluklar (dürüst liste)

Bunlar bu ortamda kapatılamaz; kasıtlı olarak açık bırakılmıştır.

- **Görsel estetik yargısı.** Kontrast, dokunma hedefi ve kırılma noktaları ölçüldü ve düzeltildi;
  ancak hizalama, boşluk dengesi ve genel görsel bütünlük ölçülemez — gerçek tarayıcıda insan
  gözüyle bakılmalı.
- **e-Belge entegratör doğrulaması.** Üretilen UBL-TR XML'i hiçbir gerçek entegratöre veya GİB
  test ortamına gönderilmedi (kimlik bilgisi ve dış ağ erişimi yok). Canlıya almadan önce seçilen
  entegratörün şema doğrulamasından geçirilmesi **şart**.
- **Kamerayla barkod okuma.** Ortamda kamera yok. USB okuyucu yolu tam test edildi; kameralı okuma
  Chrome/Edge'de BarcodeDetector ile çalışır, Safari ve Firefox desteklemez.
- **Bağımsız sızma testi.** Uygulama katmanı denetlendi; ağ, işletim sistemi, TLS yapılandırması
  ve fiziksel erişim kapsam dışı.
- **Gerçek kullanıcıyla saha denemesi yapılmadı.** Kılavuz yazıldı ama kimse üzerinde denenmedi.

## Çalıştırma
```
npm install
npm start        # http://localhost:3000
node test/e2e.js # sunucu ayaktayken
```
Demo: admin/Admin123! · mudur/Mudur123! · operator/Operator123! · kalite/Kalite123! · viewer/Viewer123!
