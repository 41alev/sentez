# Dream Plus — Geliştirici Rehberi

Bu belge, projeyi ilk kez devralan/kuran bir **yazılımcı** içindir: kurulum +
projeyi anlama + "şu an tam olarak nerede kaldık, ne yapmalıyım" tek yerde.
Son kullanıcı (depo/satış/kalite personeli) için [`KULLANIM-KILAVUZU.md`](KULLANIM-KILAVUZU.md),
saha kurulumu yapan teknisyen için [`KURULUM.md`](KURULUM.md) ve [`SAHA-KURULUM-KARTI.md`](SAHA-KURULUM-KARTI.md)
ayrı belgelerdir — onları burada tekrar etmiyoruz, gerektiğinde bağlantı veriyoruz.

**Önce şunu oku:** proje `CLAUDE.md` (kök dizinde) — AI/insan fark etmez, bu
projede kod yazan herkesin uyacağı mühendislik disiplinini tanımlar (okumadan
önce anlaşılmadan uygulama yapmayın, gerçek `data/` klasörüne dokunmayın,
"hazır/tamamlandı" iddiasını doğrulamadan yazmayın vb.).

---

## 1. Proje nedir

Tek-tesis (single-tenant) bir fabrika ERP'si: stok (parti/lot bazlı), üretim
(reçete + rota + kapasiteli çizelgeleme + MRP), satın alma (talep→teklif→
sipariş→teslim→varış maliyeti→fatura), satış (sipariş→sevkiyat→fatura→
kârlılık), kalite (muayene/NCR/DÖF/kalibrasyon/izlenebilirlik), CRM (fırsat
hunisi, destek talepleri, saha ziyaretleri), raporlama ve muhasebe dışa
aktarımı. Türkçe birincil dil.

**Yığın:** Node.js 22+/Express 5 API + `better-sqlite3` (tek dosya SQLite,
WAL) · masaüstü arayüz tamamen React (`frontend-react/*.jsx`, Vite ile
`public/dist/`e derlenir) · ayrı bir mobil/PWA depo terminali
(`public/mobile.html` + `mobile.js`) — **bu mobil kısım kaldırılma sürecinde,
bkz. §5**.

**Kapsam dışı bilinçli:** e-Fatura/e-Arşiv/e-İrsaliye (resmî GİB
entegrasyonu) YOK — bu ürünün satış modeli "her müşteriye ayrı, izole kurulum"
olduğu için resmî belge sorumluluğu kasıtlı olarak alınmıyor. Faturalama
yalnızca iç kayıt/raporlama amaçlıdır.

---

## 2. Hızlı kurulum (geliştirme ortamı)

```bash
npm ci                      # node_modules'ı kopyalamadıysan
cp .env.example .env        # JWT_SECRET'ı değiştir (rastgele bir değer yeterli, dev için)
npm run build                # frontend-react/ → public/dist/
DEMO_DATA=1 npm start         # örnek fabrika + 5 demo kullanıcı
```

`http://localhost:3000` — demo hesaplar (**yalnızca demo, üretimde asla
kullanmayın**):

| Kullanıcı | Şifre | Rol |
|---|---|---|
| `admin` | `Admin123!` | Yönetici |
| `mudur` | `Mudur123!` | Müdür |
| `operator` | `Operator123!` | Operatör |
| `kalite` | `Kalite123!` | Kalite |
| `viewer` | `Viewer123!` | Görüntüleyici |

Gerçek kurulum (demosuz, `npm run setup` ile firma/yönetici/depo oluşturma),
ortam değişkenleri, yedekleme, sürüm yükseltme, Docker ve lisanslama için:
[`docs/KURULUM.md`](KURULUM.md) — bunu burada tekrar yazmıyoruz.

**Node sürümü:** `package.json` `engines: ">=22"` diyor ama bu makinede
kurulu `node_modules` fiilen **Node 24 ABI'sine** göre native modül
(`better-sqlite3`) bundluyor — N-API tabanlı olduğu için Node sürümünden
bağımsız çalışır (yalnızca işletim sistemi + mimari önemli, bkz. N-07).
Farklı bir OS/mimariye taşırsan `npm ci` ile yeniden kur.

---

## 3. Proje yapısı ve mimari kurallar

Ayrıntılı klasör haritası ve API özeti için [`README.md`](../README.md)
("Proje yapısı", "API özeti" bölümleri). Burada yalnızca **kod yazarken
ihlal edilirse veri bozan** kuralları listeliyoruz:

- **Stok yazma tekeli:** `stock_lots`, `movements`, `items.qty_cache`
  yalnızca `server/services/stock.js` üzerinden değiştirilir. Başka bir
  yerden doğrudan `UPDATE stock_lots` yazarsan defter/önbellek tutarsız
  kalır — bunu test harness'ında ben de bir kez yapıp yanlış sonuç aldım
  (bkz. `test/faz0-verify/README.md`).
- **Transaction sınırı:** Servis fonksiyonları çağıranın açtığı transaction
  içinde çalışır (`db.tx(...)` / `db.txImmediate(...)`). Çok adımlı bir
  işlemi (ör. "5 bileşen tüket + 1 mamul üret") ayrı transaction'lara
  bölme — ya tamamı olmalı ya hiçbiri.
- **Tarihsel kur:** `exchange_rates` tarih bazlı. Bugünün kuruyla geçmiş
  bir kaydı değerleme — `server/lib/core.js`'teki `toBase`/`fxRate`'i kullan.
- **Kısmi güncelleme (`PUT`) deseni — DİKKAT:** Çoğu route
  `COALESCE(?, mevcut_deger)` kalıbıyla güncelleniyor: gönderilmeyen alan
  korunur ama **`''`/`null` gönderilen alan da bazen temizlenemiyor**
  (bkz. TAM-LISTE F18, V-listesindeki COALESCE notları). Yeni bir `PUT`
  route'u yazarken hangi alanların gerçekten "temizlenebilir" olması
  gerektiğini düşün, körü körüne kopyalama.
- **Sayı/boolean/tarih doğrulaması (26.09.2026'dan beri merkezi):**
  `server/middleware/validate.js`, `z.coerce.number()`/`z.coerce.boolean()`
  alanlarını parse'tan önce katı biçimde denetler — `''`, `null`, `false`,
  `[]` artık 0 olmaz, `'false'` true olmaz (422). Tarih alanları için
  `localDate` / `optionalDate` kullan (takvimde olmayan gün ve 1900–2199
  dışı reddedilir). Yeni şemada `z.string()` ile tarih alma.
- **Veritabanı kısıtı = son savunma hattı:** FK/UNIQUE/CHECK/tetikleyici
  ihlalleri merkezi hata işleyicide 409/422'ye çevrilir
  (`sqliteConstraintResponse`, `server/lib/core.js`). Bu, route'ta açık
  404/422 doğrulaması yazmanın yerini tutmaz; kullanıcıya doğru mesajı
  route verir.
- **Para ve ödeme:** tahsilat/ödeme yalnız `server/services/invoice-payments.js`
  üzerinden yazılır; tetikleyiciler fazla ödemeyi ve ödeme kaydının
  değiştirilmesini engeller. Mutabakatı yapılmamış eski alış faturası
  (`allocation_state='legacy'`) onaylanamaz ve ödenemez.
- **KVKK anonimleştirme** artık tek transaction'da ilişkili kopyaları da
  maskeliyor ve anonim kaydın API ile yeniden doldurulmasını engelliyor
  (T12, 23.09.2026). Hukuki uygunluk iddia edilmiyor.
- **MRP zaman fazlıdır** (T09): arz tarihine göre netlenir; açık üretim
  emirleri kendi reçete snapshot'ını (`production_order_components`)
  kullanır. Ürün reçetesini değiştirmek eski emri etkilemez.
- **Kapasite çizelgesi saat aralığı tabanlıdır** (T10): vardiya saatleri,
  mola, tatil, paralel hat (`capacity_units`) dikkate alınır; aynı hatta
  iki iş çakışmaz.

---

## 4. Test etme

```bash
npm run test:all        # tüm paketler (Faz 0 kötü senaryo takımı dahil), her biri izole geçici DB'de
npm test                # yalnız e2e
npm run test:security   # kimlik doğrulama, enjeksiyon, XSS, sır sızıntısı
npm run test:e2e-browser  # Playwright/Chromium (önce: npx playwright install chromium)
npm run release         # müşteri kurulum paketi → release/ (bkz. scripts/package-release.js)
```

Testler **gerçek `data/` klasörüne asla dokunmaz** — her paket
`test/helpers/sandbox.js` ile OS geçici dizininde kendi DB'sini kurar. Yeni
bir test paketi eklerken bu deseni kullan, canlı sunucuya bağlanma.

### Faz 0 doğrulama takımı (`test/faz0-verify/`)

20 Eylül 2026'da devir belgesinin "düzeltildi" iddialarını bağımsız olarak
sınamak için yazıldı. 26 Eylül 2026'da tüm kontroller yeşile döndü ve takım
`node test/run-all.js faz0-verify` olarak ana pakete (CI'a) bağlandı. Tek
dosya da çalıştırılabilir:

```bash
node test/faz0-verify/b4c-ops.js   # ör. MRP/planlama/veri-sağlığı/muhasebe/rapor
```

Ayrıntı: [`test/faz0-verify/README.md`](../test/faz0-verify/README.md).

---

## 5. Şu an tam olarak neredeyiz

**Tek doğru kaynak:** [`PROJECT_STATUS.md`](../PROJECT_STATUS.md) — en üstteki
tarihli bölüm günceldir; eski bölümler tarihsel kayıttır. Kod ve git geçmişi
iddiaların kanıtıdır.

**26 Eylül 2026 itibarıyla kodda kapananlar:** T01–T16 ve T18'in kod/test
kısmı (NCR lot, tam yedek, proxy/IP, birleştirme, import, alış faturası
mutabakatı + ödeme defteri, sayım, sayfalama + sunucu taraflı arama, zaman
fazlı MRP, çakışmasız kapasite, kısmi tahsilat, KVKK, kalite imzası, webhook
outbox, sayı/tarih doğrulaması, erişilebilirlik ve çift gönderim). Faz 0
takımı 0 FAIL.

**Hâlâ sahada doğrulanması gerekenler (kodla kapatılamaz):** temiz Windows
bilgisayara kurulum ve servis olarak yeniden başlatma, gerçek TLS/alan adı,
gerçek off-site yedekten geri dönüş, müşteri verisiyle pilot ve kabul
tutanağı. Bunlar `PROJECT_STATUS.md` içinde "Doğrulanamadı" olarak durur.

**Kapsam kararı:** Ürün yalnızca **masaüstü web** olarak devam ediyor; mobil
el terminalinin kaldırılma durumu için `PROJECT_STATUS.md`'ye bakın.

**Ürün kararları:** K-01…K-15 için koordinatörün geri alınabilir varsayılan
kararları `PROJECT_STATUS.md` 26 Eylül bölümünde tablo halinde. Müşteri
farklı karar verirse ilgili davranış oradan izlenebilir.

---

## 6. Nasıl devam edilir (çalışma disiplini)

1. Değişiklik yapmadan önce ilgili dosyayı oku, çağıranlarını bul, ilgili
   testi bul (`CLAUDE.md` §12).
2. Küçük, kapsamı belli bir iş yap; ilgisiz refactor/yeniden adlandırma
   yapma (`CLAUDE.md` §14).
3. Gerçek `data/` klasörüne asla elle dokunma; her zaman izole sandbox'ta
   dene (`npm run test:*` veya `test/faz0-verify/` deseni).
4. Bir şeyi düzelttiğini iddia etmeden önce gerçekten test et — "yeşil test"
   tek başına kanıt değildir (bu projede 19 Eylül denetiminde 25 hata
   green test'lerin ARKASINDA bulundu). Adversarial/kötü senaryo ekle.
5. İşin sonunda `git status`/`git diff`'i gözden geçir, `PROJECT_STATUS.md`'yi
   gerçek sonuçla güncelle, ilgili maddeyi TAM-LISTE'de kapat/güncelle.
6. `git commit`/`push` yalnızca açıkça istenirse.

---

## 7. Sırlar ve güvenlik — kopyalarken/dağıtırken dikkat

- **`.env`** — `JWT_SECRET`, SMTP şifresi vb. içerir, asla commit etme
  (zaten `.gitignore`'da), üretimde uzun/rastgele bir `JWT_SECRET` üret.
- **`license-signing-key.pem`** — bununla herkes geçerli lisans dosyası
  üretebilir (N-14). Proje kökünde duruyor, `.gitignore`'da ama fiziksel
  olarak dikkatli taşı, asla paylaşma.
- **`data/`** — gerçek/demo veritabanı. Sunucu çalışırken düz dosya kopyası
  ALMA (WAL tutarsız kalır) — önce durdur, sonra kopyala veya `npm run backup`
  kullan.

---

## 8. Belge haritası (`docs/`)

| Dosya | Kime, ne için |
|---|---|
| **Bu dosya** | Yazılımcı: kurulum + mimari + "şu an neredeyiz" |
| `KURULUM.md` | Kurulum yapan kişi: gerçek kurulum, ortam değişkenleri, yedek, upgrade, Docker, lisans |
| `LISANS-OPERASYONU.md` | Satıcı: lisans üretme, yenileme, süre dolumu, anahtar yönetimi |
| `KULLANIM-KILAVUZU.md` | Son kullanıcı: rol bazlı günlük kullanım |
| `PROJECT_STATUS.md` (kökte) | Güncel durum (en üst bölüm) ve kısa geçmiş; eski günlük `docs/PROJECT_STATUS-ARSIV-2026-09.md` |
| `TAM-LISTE-2026-09-20.md` | Tüm bilinen eksik/hata/karar/özellik listesi (F/S/N/V/K/D kodları), önerilen çalışma sırası |
| `DEVIR-VE-KALAN-ISLER-2026-09-20.md` | 20 Eylül devir notu (bu belgeden önceki durum) |
| `analiz-2026-09-19/` | 19 Eylül bağımsız denetiminin orijinal raporu ve kanıtları (F01-F25, S01-S20 kaynağı) |
| `KVKK-DEGERLENDIRME.md` | KVKK m.7/m.11 değerlendirmesi, açık kalan hukuki/teknik maddeler |
| `YOL-HARITASI.md`, `SATISA-HAZIRLIK.md` | Eski durum notları — TAM-LISTE bunları özetleyip birleştirdi, güncel karar için önce TAM-LISTE'ye bak |
| `SAHA-KURULUM-KARTI.md`, `SAHA-KURULUM-COK-BASIT.md` | Teknik olmayan saha kurulumu — henüz temiz makinede denenmedi (D-16) |
| `test/faz0-verify/README.md` | Doğrulama test takımının ne kanıtladığı |
