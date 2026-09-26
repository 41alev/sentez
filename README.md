# Dream Plus

> Güncel satış ve teslim kapıları:
> [`docs/SATISA-HAZIRLIK-SON-DURUM-2026-09-26.md`](docs/SATISA-HAZIRLIK-SON-DURUM-2026-09-26.md).

Fabrika ölçeğinde depo, üretim, satın alma, satış ve kalite yönetimi. Node.js + Express + SQLite backend,
masaüstü tarayıcı için React ekranları. Türkçe/İngilizce arayüz. (Mobil/PWA el terminali
26 Eylül 2026'da kapsamdan çıkarıldı; USB barkod okuyucu masaüstünde klavye gibi çalışır.)

---

## Hızlı başlangıç

```bash
npm ci
cp .env.example .env      # JWT_SECRET'i mutlaka değiştirin
npm run build
npm run setup             # Firma ve kendi yönetici hesabınızı oluşturun
npm start                 # http://localhost:3000
```

Windows PowerShell'de kopyalama için `Copy-Item .env.example .env` kullanın.
Kurulum gerçek müşteri verisi için boştur; demo otomatik yüklenmez.
Yalnızca ayrı bir deneme klasöründe `npm run demo` ile örnek fabrika kurulabilir.
Aşağıdaki hesaplar yalnız demo verisine aittir:

| Kullanıcı | Şifre | Yetki |
|---|---|---|
| `admin` | `Admin123!` | Yönetici |
| `mudur` | `Mudur123!` | Müdür |
| `operator` | `Operator123!` | Operatör |
| `kalite` | `Kalite123!` | Kalite |
| `viewer` | `Viewer123!` | Görüntüleyici |

**Demo verisini ve bu hesapları müşteri kurulumuna taşımayın.**

Testler:

```bash
# Her npm test komutu gerektiğinde kendi izole sunucusunu açar:
npm test                # 77 — iş kuralları, yetki matrisi, uçtan uca akışlar
npm run test:contract   # 58 — API alan adları arayüzün okuduklarıyla eşleşiyor mu
npm run test:planning   # 78 — kapasite, çizelgeleme, MRP, OEE
npm run test:ui         # 113 — arayüz gerçek bir DOM'da çalıştırılır
npm run test:security   # 69 — kimlik doğrulama, enjeksiyon, XSS, sır sızıntısı
npm run test:load       # 19 — yanıt süreleri ve eşzamanlı yazma doğruluğu

# Sunucu gerektirmez:
npm run test:visual     # 34 — WCAG kontrast, dokunma hedefi, duyarlı tasarım
npm run test:backup     # 32 — yedek alma ve gerçek geri yükleme provası
npm run test:email      # 28 — süreç içi SMTP sunucusuna gerçek teslimat
npm run test:barcode    # 21 — USB okuyucu algılama ve kamera yedeği
```

Tam koşu: `npm run test:all`; tarayıcı testleri: `npm run test:e2e-browser`
(önce `npx playwright install chromium`). Her paket farklı bir soruyu cevaplar:

| Paket | Neyi kanıtlar | Yakaladığı hata türü |
|---|---|---|
| `e2e` | Backend doğru **çalışıyor** | Yanlış hesap, eksik yetki kontrolü, bozuk akış |
| `contract` | Arayüz doğru **alanları okuyor** | Hata vermeden sessizce boş kalan sütun |
| `ui` | Arayüz gerçekten **çalışıyor** | Ölü buton, açılmayan diyalog, çalışma anı hatası |
| `visual` | Arayüz **okunabilir** | Yetersiz kontrast, parmakla basılamayan buton |
| `security` | Uygulama **kötüye kullanılamıyor** | Yetki atlama, enjeksiyon, sır sızıntısı |
| `load` | Yük altında **doğru kalıyor** | Kayıp güncelleme, yarış durumu, kuyruk gecikmesi |
| `backup` | Felaketten **geri dönülebiliyor** | Alınamayan veya geri yüklenemeyen yedek |

Testler durum değiştiren gerçek işlemleri kendilerine ait OS geçici dizinlerinde
yapar. Çalışma verisini silmeyin. Tek bir paket için
`node test/run-all.js release-hardening` kullanın. Eski test dosyalarını doğrudan
canlı sunucuya bağlayarak çalıştırmayın. Playwright ayrı 3301 portunu kullanır;
gerekirse `PLAYWRIGHT_PORT` ile değiştirilebilir ve mevcut sunucu yeniden kullanılmaz.

---

## Modüller

### Stok — lot bazlı
Bütün miktarlar parti (lot) seviyesinde tutulur; `items.qty_cache` sadece türetilmiş bir önbellektir.
Her hareket `movements` tablosuna yazılır, dolayısıyla hiçbir miktar değişikliği izsiz kalmaz.

- Lot durumları: **kullanılabilir · karantina · bloke · red · tükendi**. Yalnızca *kullanılabilir* lotlar tüketilir veya sevk edilir.
- Kısmi durum değişikliği lotu böler; her parça kendi geçmişini korur.
- Depolar arası transfer lot kimliğini ve maliyetini korur.
- Son kullanma tarihi takibi; raf ömrü tanımlıysa giriş tarihinden otomatik hesaplanır.
- Barkod okuma: USB okuyucu veya (destekleyen tarayıcılarda) kamera.
- Fiziksel sayım: sistem/sayılan karşılaştırması, fark değeri, onaylandığında stoğa işlenir.

### Üretim
- Çok seviyeli reçete (BOM), bileşen başına fire yüzdesi.
- Üretim öncesi malzeme yeterlilik kontrolü; yetersizse hangi malzemeden ne kadar eksik olduğu döner.
- Tüketim FEFO ile gerçek lotlardan yapılır → **soy ağacı (genealogy)** oluşur.
- Gerçek maliyet: malzeme (tüketilen lotların gerçek maliyeti) + işçilik + genel gider → birim maliyet.
- Fire ve yeniden işleme miktarları, verim yüzdesi.

### Satın alma
Talep → teklif (RFQ) → karşılaştırma → sipariş → onay → kısmi teslim → varış maliyeti → fatura.

- **Onay kuralları:** tutar eşiğine göre müdür veya yönetici onayı zorunlu hale gelir.
- **Kısmi teslim alma:** her teslimatta ayrı irsaliye, ayrı lot; kalan miktar takip edilir.
- **Varış maliyeti (landed cost):** navlun, gümrük, sigorta, elleçleme; değere veya miktara göre lot maliyetine dağıtılır.
- **3'lü eşleştirme:** fatura ↔ sipariş ↔ teslim alınan miktar, teslim satırı bazında miktar tahsisi.
- **Fatura onayı ve ödeme:** yalnız onaylı fatura ödenir; kısmi ödemeler defterde tutulur, fazla ödeme
  veritabanı kuralıyla engellenir. Eşleşmesi bilinmeyen eski faturalar önce tek seferlik mutabakattan geçer.
- Muayene gerektiren ürünler teslim alındığında doğrudan karantinaya düşer.
- Tedarikçi fiyat geçmişi otomatik birikir.

### Satış
- Müşteri kartı, kredi limiti kontrolü (limit aşılıyorsa sipariş engellenir).
- Sevkiyatta parti seçimi elle yapılabilir veya **FEFO** ile otomatik atanır.
- Kasa ölçüleri ve ağırlıkları, yazdırılabilir sevk irsaliyesi.
- **Kârlılık:** ciro sipariş fiyatından, maliyet gerçekten çıkan lotların maliyetinden hesaplanır — standart maliyet tahmini değil.
- **Tahsilat:** faturaya kısmi veya tam tahsilat girilir; iade faturası ve tahsilatlar faturayı otomatik kapatır.

### Kalite
- Muayene planları: ürün ve muayene tipine göre ölçülecek özellikler, alt/üst limitler, AQL.
- Muayene sonucu girilirken ölçüm limitlere göre otomatik uygun/uygunsuz işaretlenir; elektronik imza kaydedilir.
- Kabul edilen karantina lotu otomatik serbest bırakılır; red durumunda uygunsuzluk (NCR) açılabilir.
- **NCR:** kaynak, önem derecesi, etkilenen miktar, karar (olduğu gibi kullan / yeniden işle / iade / hurda).
- **DÖF (CAPA):** kök neden, aksiyon planı, sorumlu, termin, etkinlik kontrolü olmadan kapatılamaz.
- **Kalibrasyon:** cihaz kartı, periyot, sertifika, yaklaşan kalibrasyon uyarısı.
- **İzlenebilirlik:** geriye (ne girdi), ileriye (nereye gitti) ve **geri çağırma raporu** — bir hammadde partisinden etkilenen tüm müşteriler.

### Raporlar
Stok değerleme · trendler · ölü stok ve yaşlandırma · devir hızı ve stokta kalma süresi · ABC analizi ·
sipariş önerileri (sipariş noktası = günlük tüketim × tedarik süresi + emniyet stoğu, yoldakiler düşülür) ·
tedarikçi performansı (zamanında teslim %50 + kalite %50) · kalite KPI'ları · üretim maliyetleri.
Hepsi CSV olarak dışa aktarılabilir.

### Üretim Planlama (MRP · Kapasite · Vardiya)
- **İş merkezleri:** Üretimin yapıldığı yer. Kapasitesi vardiyadan gelir; vardiya atanmamış bir
  merkez hiç çalışmıyor sayılır.
- **Kapasite** = vardiya süresi − mola × paralel istasyon × (1 − planlı duruş) × verimlilik.
  Tatiller ve planlı duruşlar takvimden düşülür.
- **Rota:** Reçete *ne* gerektiğini söyler, rota *nasıl* yapıldığını. Hazırlık süresi parti başına,
  işlem süresi birim başına harcanır; bekleme süresi kapasite tüketmez ama termini uzatır.
- **Sonlu kapasiteli çizelgeleme:** Operasyonlar iş merkezinin boş kapasitesine oturur, doluysa
  kayar. Sonsuz kapasite varsayan bir plan "her şey zamanında biter" der ve işe yaramaz.
- **MRP:** `net = brüt + emniyet stoğu − eldeki − yoldaki`. Reçete seviye seviye açılır; mamul
  ihtiyacı bileşen ihtiyacına dönüşür. Bırakma tarihi = ihtiyaç tarihi − tedarik süresi; geçmişse
  öneri gecikmiş işaretlenir. **MRP yalnızca hesaplar** — hiçbir belge otomatik açılmaz.
- **OEE** = Kullanılabilirlik × Performans × Kalite. Üçü ayrı ayrı gösterilir, çünkü tek bir
  yüzde kaybın nerede olduğunu söylemez.

### Yönetim
Kullanıcılar ve yetki matrisi · depolar · tarihsel döviz kurları · onay ve bildirim kuralları ·
denetim kaydı · sistem ayarları · yedekleme.

> **Not:** e-Fatura/e-Arşiv/e-İrsaliye (resmî GİB entegrasyonu) bilinçli olarak sistemde YOK —
> resmî belge sorumluluğu ve buna bağlı sürekli mevzuat takibi bu ürünün kapsamı dışında
> tutuluyor. Faturalama yalnızca kayıt/raporlama amaçlıdır.

---

## Yetki matrisi

| | admin | manager | operator | quality | viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| Görüntüleme, raporlar | ✓ | ✓ | ✓ | ✓ | ✓ |
| Stok girişi, üretim, sipariş oluşturma | ✓ | ✓ | ✓ | — | — |
| Sayım yapma | ✓ | ✓ | ✓ | ✓ | — |
| Kalite (muayene, NCR, DÖF, kalibrasyon) | ✓ | ✓ | — | ✓ | — |
| Lot durumu değiştirme | ✓ | ✓ | ✓ | ✓ | — |
| Onay (sipariş, sayım, talep) | ✓ | ✓ | — | — | — |
| Kayıt silme | ✓ | ✓ | — | — | — |
| Kullanıcı yönetimi, sistem ayarları | ✓ | kısmi | — | — | — |

Rol değişikliği veya şifre sıfırlama, o kullanıcının açık oturumlarını **anında** sonlandırır.

---

## Güvenlik

- Şifreler bcrypt ile saklanır (12 tur).
- JWT + sunucu tarafı oturum tablosu: çıkış yapıldığında veya kullanıcı pasifleştirildiğinde token anında geçersizleşir.
- Giriş için hız sınırlaması (15 dakikada 10 deneme), genel API için dakikada 300 istek.
- Başarısız giriş denemelerinden sonra hesap kilitlenir; yönetici kilidi açar.
- Tüm girdiler zod ile doğrulanır; hatalar alan bazında döner.
- Dosya yüklemede MIME türü beyaz listesi, 20 MB sınırı, disk üzerinde rastgele isim, path traversal koruması.
- Güvenlik başlıkları, yapılandırılabilir CORS, opsiyonel HSTS.
- **Denetim kaydı silinemez** ve her değişikliğin eski/yeni değerini tutar.

### Üretime almadan önce
1. `JWT_SECRET` değerini uzun ve rastgele yapın: `openssl rand -hex 48`
2. Tüm demo hesapların şifrelerini değiştirin veya hesapları pasifleştirin.
3. `CORS_ORIGINS` değerini gerçek alan adınızla sınırlayın.
4. TLS kullanın (`nginx.conf` içindeki HTTPS bloğu hazır), `FORCE_HTTPS=1` yapın.
5. `data/` klasörünü kalıcı ve yedeklenen bir diske alın.
6. Yedeklerin gerçekten geri yüklenebildiğini bir kez test edin.

---

## Dağıtım

### Docker
```bash
export JWT_SECRET=$(openssl rand -hex 48)
docker compose up -d --build
```
Veritabanı `depo-data` isimli kalıcı volume'da tutulur. Nginx 80/443'ü dinler, uygulama sadece localhost'a bağlanır.

### Doğrudan sunucuda
```bash
npm ci --omit=dev
NODE_ENV=production JWT_SECRET=... node server/index.js
```
systemd, pm2 veya benzeri bir süreç yöneticisi ile çalıştırın.

### Yedekleme ve geri yükleme
Sunucu 24 saatte bir veritabanı ve yüklenmiş belgelerden tam bir `.bundle`
dizini oluşturur; son 14 rutin paketi saklar. SQLite anlık görüntüsü online
backup API'siyle alınır. Manifest, dosya boyutları ve SHA-256 karmaları geri
yükleme öncesi doğrulanır. Uzak yedekleme bu dizini tüm içeriğiyle kopyalamalıdır.

```bash
npm run backup                                           # elle tam yedek
npm run backup:full -- --verify data/backups/<paket>.bundle
# Önce sunucuyu durdurun; sonra doğrulanan paketi geri yükleyin:
npm run restore:full -- data/backups/<paket>.bundle
```

Geri yükleme SQLite bütünlüğünü, yabancı anahtarları, belge referanslarını ve
paket karmalarını denetler. Mevcut veritabanı ve belgeler `.pre-restore-<zaman>`
olarak saklanır; yer değiştirme yarıda kalırsa eski çift geri alınır. Eski yalnız
SQLite yedekleri için `npm run restore -- <dosya.sqlite>` hâlâ vardır; bu komut
yüklenmiş belgeleri geri getirmez.

**Sunucuyu durdurmadan geri yükleme yapmayın.** Bakım kilidi ve dolu WAL kontrolü
çalışan veritabanına geri yüklemeyi engeller.

`npm run test:backup` izole geçici dizinde veritabanı ve belge geri yüklemesini,
bozuk paket reddini ve yarıda kesilen geri yüklemede eski verinin korunmasını sınar.
Müşteri ortamında ayrıca ayrı makinede gerçek geri yükleme provası gerekir.

---

## API özeti

Tüm uç noktalar `/api` altında, `Authorization: Bearer <token>` ister.

| Alan | Uç noktalar |
|---|---|
| Kimlik | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `POST /auth/change-password` · `GET /auth/sessions` |
| Ürün | `GET/POST /items` · `GET/PUT/DELETE /items/:id` · `GET /items/barcode/:code` |
| Stok | `GET /stock/lots` · `GET /stock/movements` · `POST /stock/move` · `POST /stock/lot-status` · `POST /stock/transfer` |
| Sayım | `GET/POST /stock/counts` · `GET /stock/counts/:id` · `PUT /stock/counts/:id/lines` · `POST /stock/counts/:id/approve` |
| Üretim | `GET/POST /production` · `GET /production/:id` · `GET /production/:id/requirements` · `POST /production/:id/complete` |
| Satın alma | `/purchasing/suppliers` · `/purchasing/requests` · `/purchasing/rfqs` · `/purchasing/orders` · `/purchasing/orders/:id/receipts` · `/purchasing/receipts/:id/landed-costs` · `/purchasing/invoices` · `/purchasing/invoices/:id/reconcile` · `/purchasing/invoices/:id/approve` · `/purchasing/invoices/:id/payments` |
| Satış | `/sales/customers` · `/sales/orders` · `/sales/shipments` · `/sales/invoices` · `/sales/invoices/:id/payments` · `GET /sales/profitability` |
| Kalite | `/quality/plans` · `/quality/inspections` · `/quality/ncrs` · `/quality/capas` · `/quality/equipment` · `/quality/trace/backward/:lotId` · `/quality/trace/forward/:lotId` · `/quality/recall/:lotId` |
| Rapor | `/reports/summary` · `/trends` · `/dead-stock` · `/turnover` · `/abc` · `/reorder-suggestions` · `/supplier-performance` · `/quality-kpis` · `/production-costs` · `/valuation` |
| Yönetim | `/users` · `/warehouses` · `/settings` (yönetici/müdür) · `/settings/public` · `/exchange-rates` · `/approval-rules` · `/notification-rules` · `/audit` |
| Planlama | `/planning/work-centers` · `/shifts` · `/routings/:itemId` · `/capacity` · `/schedule/:orderId` · `/operations` · `/shift-logs` · `/oee` · `/mrp/run` · `/mrp/suggestions` |
| Diğer | `/documents` · `/notifications` · `/notifications/mail-status` · `GET /health` (kimlik istemez) |

---

## Mimari notlar

- **Şema geçişleri:** `server/migrations/` içindeki dosyalar sırayla, her biri kendi transaction'ında uygulanır;
  uygulananlar `schema_migrations` tablosunda tutulur. Sunucu her açılışta bekleyen geçişleri uygular.
- **Transaction sınırı:** Servis fonksiyonları çağıranın açtığı transaction içinde çalışır. Böylece
  "5 bileşen tüket + 1 mamul üret" gibi çok adımlı işlemler ya tamamen olur ya hiç olmaz.
- **Tarihsel kur:** `exchange_rates` tablosu tarih bazlıdır. Geçmiş bir alım, bugünkü kurla değil kendi
  tarihindeki kurla değerlenir; aksi halde geçmiş maliyetler her gün değişirdi.
- **Maliyet yöntemi:** ürün bazında hareketli ortalama veya FIFO. Varış maliyetleri lot birim maliyetine dağıtılır.
- **Stok yazma tekeli:** `stock_lots`, `movements` ve `items.qty_cache` yalnızca `services/stock.js` üzerinden
  değiştirilir; bu sayede her miktar değişimi hareket kaydı bırakır ve önbellek tutarlı kalır.

## Kurulum

Sıfırdan kurulum, ortam ayarları, yedekleme, sürüm yükseltme ve sorun giderme:
[`docs/KURULUM.md`](docs/KURULUM.md). Müşteriye götürülecek paket `npm run release`
ile `release/` altında üretilir; sır, müşteri verisi, test ve iç notlar pakete girmez
(bkz. `scripts/package-release.js`). Lisans işlemleri: [`docs/LISANS-OPERASYONU.md`](docs/LISANS-OPERASYONU.md).

```bash
npm install --omit=dev
cp .env.example .env      # JWT_SECRET'ı değiştirin
npm run setup             # firma, yönetici hesabı, depo
npm start
```

Demo verisiyle denemek için: `DEMO_DATA=1 npm start`
(örnek firma + beş demo kullanıcı — **üretimde kullanmayın**)

## Kullanım kılavuzu

Son kullanıcılar için role göre yazılmış kılavuz: [`docs/KULLANIM-KILAVUZU.md`](docs/KULLANIM-KILAVUZU.md)
Depo görevlisinden yöneticiye kadar her rolün günlük işleri, sık karşılaşılan durumlar ve hata
mesajlarının ne anlama geldiği orada anlatılır.

## Geliştirici rehberi

Projeyi devralan/kuran bir yazılımcı için kurulum + mimari kuralları +
"şu an tam olarak nerede kaldık" tek belgede:
[`docs/GELISTIRICI-REHBERI.md`](docs/GELISTIRICI-REHBERI.md)

## Proje yapısı

```
server/
  index.js              sunucu, middleware, route bağlama, hata yönetimi
  db.js                 SQLite bağlantısı, transaction yardımcıları
  migrate.js            geçiş çalıştırıcı
  migrations/           şema (53 tablo, 40 indeks)
  lib/core.js           hata tipi, belge no, denetim kaydı, kur, sayfalama
  middleware/           kimlik doğrulama + yetki, zod doğrulama
  services/             stock · costing · traceability · notifications
  routes/               11 modül
  scripts/backup.js     yedekleme
  seed.js               örnek fabrika verisi
public/
  index.html, css/, js/{api,ui,i18n,app}.js
  dist/                 derlenmiş React paketleri: vendor-react.js (paylaşılan
                         React) + ekran başına bir view-*.js (13 ekran, ekran
                         bazlı kod bölme — bkz. scripts/build-frontend.js)
frontend-react/         React kaynağı (Vite ile public/dist/'e derlenir — bkz. scripts/build-frontend.js)
test/e2e.js             77 uçtan uca test
```
