# Dream Plus — teknik inceleme ve geliştirme teslim planı

**İnceleme tarihi:** 19 Eylül 2026  
**Proje:** `C:\Erp\project`  
**Kaynak sürümü:** `78b188f1175217bd9f2b95494d4b6aa0ade57293` — uygulama sürümü `2.0.0`  
**Amaç:** Projeyi devralacak yazılımcının hataları, eksik iş kurallarını, teknik borcu ve teslim koşullarını bilerek çalışması.  
**İş modeli:** Her müşteriye ayrı kurulan, tek firma/tesis odaklı ERP. Çok kiracılı SaaS ve resmî e-Belge entegrasyonu mevcut kapsamın dışındadır.

## 1. Yönetici değerlendirmesi

**Bu proje yeniden yazılması gereken boş bir prototip değildir. Ancak mevcut haliyle “kod tarafında eksik yok, yalnızca sahaya çıkılacak” değerlendirmesi doğru değildir.** Geniş modül kapsamı, çalışan ekranları ve güçlü bir başlangıç test altyapısı vardır. Buna karşılık temel stok, sayım, sevkiyat, maliyet, iade, onay ve güncelleme davranışlarında veri bütünlüğünü bozan açıklar bulunmuştur.

Mevcut otomasyonun tamamının geçmesi bu kusurları ortadan kaldırmıyor. İncelemede mevcut **31 bağımsız/sunucu test paketi** ve **33 Chromium testi** geçti. Bunlara ek olarak hazırlanan **25 tanı senaryosu**, rapordaki F01–F25 davranışlarını ayrı geçici veritabanında yeniden üretti. Bunlar 25 bağımsız kök neden anlamına gelmez: örneğin F12 ile F22 aynı iade işaretinin farklı hesaplara etkileridir. F09 ve F25 gibi bazıları ayrıca açık bir işletme politikası gerektirir.

En belirgin sonuçlar:

| İşlem | Olması gereken | İncelemede gerçekleşen |
|---|---|---|
| Yalnızca ürün adını güncelleme | Diğer alanlar korunmalı | Fiyat 123 → 0; ürün tipi mamul → hammadde; reçete 1 satır → 0 |
| A ürünü için B ürününün lotunu gönderme | Reddedilmeli | Başarılı; B lotu azalıyor, B stok önbelleği değişmiyor |
| Sevkiyatı silme | Kontrollü iptal/ters hareket | Sevkiyat siliniyor, düşülen stok geri gelmiyor |
| 10 adet için 100 + 50 TL ek maliyet | Birim maliyet 10 → 25 TL | Birim maliyet 10 → 20 → 35 TL |
| Aynı mobil işlem kimliğini yeniden gönderme | Tek stok hareketi | İki ayrı lot ve toplam 14 adet giriş |
| Sayım sürerken 5 adet sevk etme | Sevkiyat etkisi korunmalı | Sayım onayı stok miktarını eski seviyesine yükseltiyor |
| 100 TL borca 40 TL iade | Bakiye 60 TL | Bakiye 140 TL |
| Yönetici onayı gerektiren satın alma | Müdür onaylayamamalı | Müdür hesabıyla HTTP 200 |
| 08:00–16:00 vardiyasına iki iş | Çakışmayan uygun saatler | İkisi de aynı gün 00:00'da başlıyor |
| İki satırlı siparişte yalnızca bir satırı fazla teslim alma | Diğer satır açık kalmalı | Sipariş tamamen teslim alındı sayılıyor |

**Teslim önerisi:** Önce veri bütünlüğü ve güvenlik düzeltmeleri, ardından regresyonlar, temiz kurulum/geri dönüş provası ve sınırlı pilot. Yeni modül eklemekten önce bu kapılar kapatılmalıdır. Kod değişikliği bu inceleme kapsamında yapılmadı; rapor ve kanıt dosyaları üretildi.

## 2. Kapsam, yöntem ve kanıt sınırları

Git tarafından izlenen **199 dosya** envantere alındı. Bunların **196'sı metin**, üçü görseldir. Metinlerde toplam **44.297 fiziksel satır** vardır; bu sayıya yorumlar, boş satırlar, dokümanlar, kilit dosyası ve testler dahildir. Test dışındaki JS/JSX/TS dosyaları **116 dosya / 24.584 satırdır**. Kaynak envanteri ve SHA-256 özetleri `DOSYA-ENVANTERI.csv` içindedir.

| Alan | Dosya | Fiziksel satır | İnceleme biçimi |
|---|---:|---:|---|
| `server` | 75 | 14.519 | Route/servis/veri şeması taraması; kritik işlemlerde ayrıntılı kod ve davranış incelemesi |
| `frontend-react` | 29 | 6.814 | 13 ekran ve giriş dosyası; API, yetki, DOM ve yaşam döngüsü örüntüleri |
| `public` | 17 | 3.880 | Masaüstü kabuğu, ortak JS, mobil, PWA, CSS ve varlık envanteri |
| `test` | 53 | 8.100 | Test kapsamı ve çalıştırma güvenliği; mevcut paketlerin yürütülmesi |
| `docs` | 6 | 1.860 | Kurulum/kullanım/yol haritası ile kodun karşılaştırılması |
| `.github` | 2 | 94 | CI ve bağımlılık otomasyonu |
| `scripts` | 1 | 100 | Ön yüz derleme yöntemi |
| Kök dosyalar | 16 | 8.930 | Paket, Docker, nginx, lint/typecheck, README ve durum geçmişi |

196 metin dosyasının tamamı otomatik tam metin yapısal taramadan geçti. Kritik modüller ayrıca satır ve iş akışı düzeyinde incelendi. Bu çalışma, **44.297 satırın her biri için ayrı bir insan incelemesi veya bütün olası davranışların doğruluk ispatı değildir**. Dosya envanterindeki “full text structural scan” ifadesi de yalnızca bu taramayı anlatır; tek başına ayrıntılı semantik inceleme anlamına gelmez. Özellikle her ekranın bütün alan kombinasyonları, her doküman satırının güncelliği ve tüm migration yükseltme kombinasyonları tek tek doğrulanmış değildir.

Hariç tutulanlar: `node_modules` kaynaklarının elle denetimi, `.git` içeriği, mevcut müşteri/demo verisinin kayıt bazlı denetimi, `.env` değerleri ve özel anahtar içeriği, kullanıcıya ait izlenmeyen `.claude/`, gerçek donanım ve canlı sunucu. Bağımlılıklar paket/lockfile ve `npm audit --omit=dev` düzeyinde ele alındı. Özel anahtarın yalnızca mevcut olduğu ve Docker hariç tutma kurallarında bulunmadığı kontrol edildi; içeriği rapora alınmadı.

**Kanıt sınıfları:** D = davranışsal yeniden üretim; S = kaynak kodundan doğrulanan durum/risk; K = işletme kararı veya saha doğrulaması gereken öneri. Aynı başlık birden fazla sınıf taşıyabilir. Öncelikler: **P0** dağıtım/veri kaybı açısından hemen kontrol altına al; **P1** güvenilir canlı kullanım öncesinde düzelt; **P2** bakım/performans/işlev tamamlanması; **P3** sonraki iyileştirme.

## 3. Güncel doğrulama sonuçları

Testler `C:\Erp\dream-plus-audit-20260919` içindeki ayrı kaynak kopyasında çalıştırıldı. Orijinal projenin `data`, `.env` ve özel anahtarı kopyalanmadı. Kurulu bağımlılıklar bir dizin bağlantısıyla kullanıldı; bu nedenle bu koşu **sıfırdan `npm ci` kurulumunun doğrulanması değildir**. Çalışma ortamı Windows, Node `v24.19.0`, npm `11.17.0` idi; CI ise Node 22 tanımlıyor.

| Kontrol | Güncel sonuç | Kanıt |
|---|---|---|
| `npm run build` | Başarılı; 1 vendor + 13 ekran paketi | `kanitlar/build.log` |
| `npm run typecheck` | Çıkış 0; kapsam sınırlaması aşağıda | `kanitlar/typecheck.log` |
| `npm run lint` | 0 hata, 28 uyarı | `kanitlar/lint.log` |
| `node test/run-all.js` | 31/31 paket geçti | `kanitlar/server-tests.log` |
| `npx playwright test` | Chromium 33/33 geçti, 34,3 saniye | `kanitlar/browser-tests-retry.log` |
| `npm audit --omit=dev --json` | Raporlanan üretim bağımlılığı açığı 0 | `kanitlar/npm-audit.json` |
| Ek tanı koşusu | F01–F25 gözlemleri üretildi | `kanitlar/reproductions.json` |

İlk Playwright denemesi tarayıcı yürütülebilir dosyası olmadığı için çalışamadı. `npx playwright install chromium` sonrasında tekrar koşuldu ve 33 test geçti. İlk hata uygulama kusuru olarak sayılmadı. Firefox/WebKit, Docker imaj derlemesi, temiz bağımlılık kurulumu, internetten erişilen üretim ortamı ve gerçek cihazlar bu çalışmada doğrulanmadı.

`npm audit` sonucunun sıfır olması, uygulamanın kendi iş kurallarını veya tüm saldırı yüzeyini doğrulamaz. Typecheck geçişi de 116 test dışı JS/JSX/TS dosyasının **99'unda `@ts-nocheck`** bulunduğundan güçlü bir genel tip güvenliği kanıtı değildir. `tsconfig.json:10` strict kapalı; SQL sonuçları `server/types/better-sqlite3-shim.d.ts:19` çevresinde `any` kabul ediliyor.

## 4. Mimari ve korunması gereken parçalar

### 4.1 Mevcut yapı

Tarayıcı masaüstünde klasik JS kabuğu (`public/js/app.js`, `api.js`, `ui.js`) ile React ekranları birlikte çalışıyor. `scripts/build-frontend.js` her ekranı ayrı IIFE paketi olarak derliyor; React ortak global paketten geliyor. Bu geçiş React'in yaşam döngüsünü kullanıyor, ancak ekranların önemli kısmı HTML metni üretip `dangerouslySetInnerHTML` ve doğrudan DOM olay bağlama yöntemiyle çalışıyor. “Tamamen React” tanımı teknik olarak bu ayrıntıyı gizliyor.

Mobil terminal ayrı vanilla JS/PWA uygulaması. Kabuk dosyaları service worker ile, bekleyen işlemler IndexedDB ile saklanıyor. API yanıtları çevrimdışı veri kataloğu olarak genel biçimde önbelleklenmiyor. Bu nedenle “çevrimdışı destek”, tüm depo işlerinin ağsız yapılabildiği anlamına gelmez.

Sunucu Express 5 modüler monoliti. Route dosyalarının çoğunda HTTP, doğrulama, SQL, iş kuralı, audit ve serileştirme birlikte. Stok, maliyet, MRP, kapasite, bildirim, içe aktarım gibi alanlarda servisler ayrılmış. Özellikle CRM'den satış siparişi yaratmanın `services/sales-orders.js` üzerinden ortaklaştırılması doğru yönde bir örnek.

Veritabanı tek SQLite dosyası; WAL, yabancı anahtarlar ve `busy_timeout=5000` etkin. Çok adımlı stok işlemlerinde `txImmediate` kullanılması güçlü bir temel. Şema 17 migration üzerinden geliyor. `company_id` hazırlığı bulunmasına rağmen sistem tam çok şirketli değil; ayrı müşteri kurulumları için bu tek başına bir eksik değildir.

### 4.2 Güçlü yönler

- Stok lot seviyesinde tutuluyor; hareket günlüğü ve miktar önbelleği mevcut.
- Üretimde gerçek tüketim kayıtları ve lot maliyeti taşınıyor.
- Parametreli SQL, Zod doğrulaması, sunucu tarafı yazma yetkileri yaygın.
- JWT yanında sunucuda oturum iptali var; pasif kullanıcılar engelleniyor.
- Şema migration'ları işlem sınırları içinde çalışıyor.
- SQLite online backup API kullanılıyor; yedek doğrulama ve yükseltme geri dönüş testleri var.
- Testler yalnızca mock değil: HTTP, veritabanı, DOM ve gerçek Chromium akışları içeriyor.
- Pivot motoru kullanıcıya serbest SQL vermiyor; veri kaynağı/boyut/ölçü izin listeleri var.
- Hatalara istek kimliği eklenmiş; merkezî hata işleyici ve yapılandırılmış logger var.
- Genel arama, içe aktarım önizlemesi, belge şablonları, ZPL etiket, CRM ve destek işlevleri gerçek kod içeriyor.

**Mimari öneri:** Mevcut monoliti koruyun. Mikroservis veya tüm projeyi başka bir çatıya taşıma bu bulguların çözümü değildir. İlk hedef, aynı işi yapan masaüstü/mobil/aktarım yollarını ortak uygulama servislerine bağlamak ve iş kurallarını tek yerde uygulamaktır.

## 5. Yeniden üretilen bulgular — F01–F25

Her F kaydının ham sonucu `kanitlar/reproductions.json` içindedir. `kanitlar/reproduce.cjs` mevcut kusurları gözlemleyen tanı betiğidir; beklenen doğru davranışı assert eden kalıcı regresyon testlerinin yerine geçmez. Kaynak yolları proje köküne göredir; satırlar belirtilen commit içindir.

### F01 — Sevkiyatta ürün ile lot eşleşmesi doğrulanmıyor

**P1 / D — stok, maliyet ve izlenebilirlik.** Kaynak: `server/routes/sales.js:225`, `server/services/stock.js:272`.

A ürün kimliğiyle B ürününe ait kullanılabilir lot gönderildi. HTTP 201 döndü; B lotu 100'den 98'e düştü. Hareket ve sevkiyat A üzerinden yazıldığı için B ürününün `qty_cache` değeri 121,5 olarak kaldı. Açık lot kontrolü durum ve miktara bakıyor; `lot.item_id === item.id` kontrolü yok. `consume` servisi de bu değişmezi korumuyor. İstek depo belirtse bile açık lotun o depoya ait olması doğrulanmıyor.

**Yapılacak:** Ürün, lot, depo, durum, son kullanma politikası ve pozitif miktar kontrollerini ortak tüketim servisinde uygula. Route kontrolü ek savunma olsun. Hata halinde bütün sevkiyat işlemini geri al.

**Kabul testi:** Yanlış ürün lotu ve yanlış depo lotu 4xx; hiçbir lot/hareket/sipariş/önbellek değişmemeli. Doğru lotla başarılı sevkiyatta hareket ürünü ile lot ürünü eşit olmalı.

### F02 — Sevkiyat silme stok ve sipariş etkisini geri almıyor

**P1 / D.** Kaynak: `server/routes/sales.js:279`.

100 adet lot üzerinden 3 adet sevkiyat yaratılıp silindi. Silme 204; lot hâlâ 97. Hareket kaydı silinen sevkiyat kimliğini göstermeye devam ediyor. Siparişin sevk edilen miktarı ve COGS da ters işlemle düzeltilmiyor. Bu durum sadece ekrandan kayıt temizleme değildir; envanterin dayanağı kayboluyor.

**Yapılacak:** Fiziksel silmeyi muhasebeleşmiş stok hareketinde kaldır. Hazırlık/çıkış durumunu netleştir; kontrollü iptal belgesi, ters stok hareketi ve sipariş/COGS geri alma işlemini tek transaction içinde uygula. Faturaya bağlı veya teslim edilmiş kayıtta ayrı iade süreci kullan.

**Kabul testi:** İzin verilen iptal sonrası stok ilk değere, sipariş miktarı ve maliyetleri doğru değere dönmeli; önceki belge ve iptal bağlantısı görülebilmeli. İkinci iptal aynı etkiyi tekrar uygulamamalı.

### F03 — İptal edilmiş sipariş sevk edilebiliyor; fazla sevk engellenmiyor

**P1 / D.** Kaynak: `server/routes/sales.js:204`, `:240`.

1 adetlik sipariş iptal edildi; sonra 4 adet sevkiyat oluşturuldu. HTTP 201; sipariş `shipped`, satır `qty=1`, `shipped_qty=4`. Siparişin sevke uygun durumu, satırın kalan miktarı ve müşteri ilişkisi yeterince doğrulanmıyor. Aynı ürün siparişte birden fazla satırdaysa ilk eşleşen satırın seçilmesi de ayrı tutarsızlık riski.

**Yapılacak:** Sevkiyat satırlarını `salesOrderLineId` ile bağla; uygun durum geçişlerini, müşteri/depo ilişkilerini ve satır bazlı toleransı tanımla. Siparişte olmayan ürünü sessizce ekleme.

**Kabul testi:** İptal/faturalanmış kapalı durumlarda politika dışı sevkiyat reddi; kalan miktarı aşan satırda 409/422; yinelenen ürün satırlarında doğru satır güncellenmesi.

### F04 — Mobil senkronizasyonda tekrar işlemesini önleyen kayıt yok

**P1 / D.** Kaynak: `server/routes/mobile.js:290`, `public/js/mobile.js:82`.

Aynı `clientId` ile 7 adet stok girişi iki kez gönderildi. İki çağrı başarılı; iki farklı lot oluştu. Bağlantı sunucuda işlem tamamlandıktan sonra koparsa terminal yeniden gönderim yaparak gerçek stoğu çoğaltabilir. İstemcide kimlik alanının bulunması sunucuda idempotency sağlamıyor.

**Yapılacak:** Kullanıcı/cihaz/kurulum kapsamında benzersiz işlem kimliği, payload hash ve kaydedilmiş yanıt tablosu oluştur. İş kaydı ile idempotency sonucu aynı transaction içinde saklansın. Aynı kimlik/farklı içerik reddedilsin. Doğrudan çevrimiçi işlemlerde sabit `direct` yerine gerçek benzersiz kimlik kullanılsın.

**Kabul testi:** Aynı istek 10 kez gelse tek hareket; cevap kaybı, yeniden başlatma ve eşzamanlı iki gönderimde tek etki.

### F05 — Mobil sayım kapalı kaydı ve negatif miktarı kabul ediyor

**P1 / D.** Kaynak: `server/routes/mobile.js:332` çevresi.

Onaylanmış sayım satırı mobil senkronizasyonla `countedQty=-9` olarak değiştirildi; sonuç başarılı. Satırın ait olduğu sayımın durumu, miktarın geçerliliği ve etkilenen kayıt sayısı kontrol edilmiyor. Masaüstündeki iş kuralları mobil yolda atlanıyor.

**Yapılacak:** Mobil sayımı masaüstüyle aynı servise bağla. Satırın varlığı/üst sayım ilişkisi, açık durum, sonlu ve negatif olmayan miktar, sürüm kontrolü ve audit zorunlu olsun.

**Kabul testi:** Onaylanmış/iptal sayım değişmez; negatif/NaN/geçersiz satır reddedilir; var olmayan satıra başarı dönmez; yetkili kalite rolü açık sayım kaydedebilir.

### F06 — Sayım onayı aradaki stok hareketlerini yok sayıyor

**P1 / D.** Kaynak: `server/routes/stock.js:257`, özellikle `newQty: l.counted_qty`.

Sayım anında 93 olan lot için 93 girildi. Onaydan önce 5 sevk edildi ve stok 88 oldu. Onay stoğu yeniden 93 yaptı. Snapshot farkı yerine geçmiş fiziksel miktar güncel lota doğrudan yazılıyor. Ayrıca tükendi durumuna geçen lota pozitif miktar yazıldığında durumun yeniden kullanılabilir hale dönmemesi riski var.

**Yapılacak:** İki tasarımdan birini işletmeyle seç: sayım kapsamındaki hareketleri kilitlemek veya sayım kesim zamanı + hareket defteri üzerinden farkı uygulamak. Sadece `current + difference` değişikliği yapmadan fiziksel sayım zamanı ve transfer/split senaryolarını çöz.

**Kabul testi:** Sayım sırasında giriş, çıkış, transfer, lot bölünmesi ve ikinci sayım ile miktar korunmalı; uyuşmazlıkta kullanıcıya kontrollü conflict dönmeli.

### F07 — Ek maliyet ekledikçe eski maliyetler yeniden dağıtılıyor

**P1 / D.** Kaynak: `server/routes/purchasing.js:584`, `server/services/costing.js:9`.

10 adet × 10 TL lota önce 100 TL navlun, sonra 50 TL elleçleme eklendi. Doğru son maliyet 25 TL iken 35 TL oldu. Her yeni kayıt sonrası tüm `landed_costs` tekrar okunuyor ve `unit_cost` üzerine yeniden ekleniyor. Kısmen tüketilmiş lotların geçmiş COGS ve bölünmüş parçalarına nasıl yansıyacağı da tanımlı değil.

**Yapılacak:** Masraf başına uygulanmış dağıtım kaydı ve benzersizlik; değişmez başlangıç maliyeti + toplam geçerli dağıtım veya yalnızca yeni farkı uygulayan model. Sonradan masraf düzeltmesi/iptali ve tüketilmiş pay için ayrı maliyet düzeltmesi tasarla.

**Kabul testi:** 100+50 masraf sonucu 25; aynı iş tekrar çalışınca değişmez; toplam dağıtım 150; kısmi tüketim ve lot bölünmesinde değer mutabakatı.

### F08 — Tedarikçiye iadede seçilen lot yerine başka lot tüketiliyor

**P1 / D.** Kaynak: `server/routes/purchasing.js:668`, `:684` çevresi.

10 adet reddedilmiş lotun 3 adedi iade edildi. İade belgesi oluşturuldu; seçilen lot yine 10 kaldı. `issueStock` ürün/depo üzerinden FEFO ile başka kullanılabilir lotu tüketti. `allowPartial:true` nedeniyle kullanılabilir stok yoksa tam miktarlı iade belgesine karşın eksik/sıfır gerçek çıkış da mümkün.

**Yapılacak:** İade tam seçilen lota uygulanmalı; reddedilmiş/karantina lotundan fiziksel çıkış ayrı izinli işlem olmalı. Tedarikçi/lot/alım ilişkisini doğrula. İade miktarı, stok çıkışı ve alım satırı düzeltmesi aynı transaction'da olmalı.

**Kabul testi:** Seçilen red lotu 10 → 7; diğer lotlar değişmez. Kısmi sessiz çıkış yok. Başka tedarikçinin lotu reddedilir.

### F09 — Süresi geçmiş lot sevk edilebiliyor

**P1 veya P2 / D+K.** Kaynak: `server/services/stock.js:98`, `server/routes/sales.js:225`.

Son kullanma tarihi `2001-01-01` olan kullanılabilir lot 201 ile sevk edildi. FEFO yalnızca sıralıyor, tarih eşiği uygulamıyor. Ürünün hedef sektörü miadı zorunlu olarak engelliyorsa bu P1'dir; metal gibi bazı alanlarda tarih uyarı niteliğinde olabilir. Bugünkü kod bu ayrımı açık bir politikaya bağlamıyor.

**Yapılacak:** “Engelle / yetkili istisna / yalnızca uyar” politikası ürün veya tesis düzeyinde tanımlansın. Otomatik ve manuel lot seçimi aynı kontrolü kullansın.

**Kabul testi:** Dün/bugün/yarın tarih sınırları, boş tarih, kalite onaylı istisna ve üretim tüketimi ayrı sınansın; raporlama ve MRP kullanılabilirliği aynı politikayı izlesin.

### F10 — Muayene sonucu ile stok serbest bırakma miktarı ayrışıyor

**P1 / D.** Kaynak: `server/routes/quality.js:161–215`.

10 adet karantina lotunda `result=accepted`, `acceptedQty=1`, `rejectedQty=9` gönderildi. API başarılı ve kayıtta 1/9 görünmesine karşın 10 adedin tamamı kullanılabilir oldu; NCR açılmadı. Sonuç, kabul/red miktarları ve ölçüm satırları arasında değişmez yok.

**Yapılacak:** Kabul + red + bekleyen miktar lot miktarıyla tutarlı olsun. `accepted`, `rejected`, `conditional` anlamlarını servis düzeyinde tanımla; ölçüm planının zorunlu alanları ve uygunsuz sonucu varsa serbest bırakma politikası uygula.

**Kabul testi:** Çelişkili durum/miktar 422; 1 kabul/9 red durumunda yalnızca 1 kullanılabilir, 9 doğru lot bağlantısıyla red ve NCR altında kalmalı.

### F11 — İlk girişte şifre değişimi API'de zorunlu değil

**P1 / D.** Kaynak: `server/middleware/auth.js:64`, `public/js/app.js:107` çevresi.

`mustChangePassword=true` kullanıcıyla giriş yapıldı; şifre değiştirmeden `/stock/move` 200 döndü. Middleware bayrağı yalnızca taşıyor; iş uçlarına erişimi kesmiyor. Masaüstü modalı güvenlik sınırı değil; mobilde aynı yönlendirme de yok.

**Yapılacak:** Zorunlu şifre değişimi oturumunda yalnızca `/auth/me`, `/auth/change-password`, `/auth/logout` gibi açık izin listesine erişilsin. Masaüstü ve mobil kullanıcı akışı aynı hata kodunu işlesin.

**Kabul testi:** Şifre sıfırlama sonrası bütün iş uçları 403 + anlaşılır kod; başarılı değişimden sonra normal erişim; diğer oturumlar iptal.

### F12 — İade faturası müşteri borcunu artırıyor

**P1 / D.** Kaynak: `server/routes/sales.js:44`, `server/services/sales-orders.js:30`.

100 TL borca karşı 40 TL `iade` kaydı açıldığında açık bakiye 140 TL oldu. Pozitif `amount` tüm `issued` kayıtları için toplanıyor, iade yönü hesaba katılmıyor. Kredi limiti kontrolü de bu sorgu yaklaşımından etkileniyor.

**Yapılacak:** Bakiye hesaplamasını tek servise al; belge türü ve hareket yönünü açık sakla. Orijinal faturaya göre iade edilebilir miktar/tutar sınırı, çoklu iade ve ödenmiş fatura iadesi tanımlansın. Stok iadesi mali iadeden ayrı ama ilişkili izlensin.

**Kabul testi:** 100−40=60; toplam iade asıl tutarı aşamaz; farklı müşteri/farklı para birimi ilişkileri açık kurallarla yönetilir.

### F13 — Onay kuralındaki gerekli rol uygulanmıyor

**P1 / D.** Kaynak: `server/routes/purchasing.js:317`, `:440`.

`requiredRole=admin`, eşik 1 TL kuralıyla oluşturulan 50 TL sipariş müdür hesabından onaylandı. Kural varlığı onay gerektiriyor ama onay aşamasında kuralın rolü okunmuyor; yalnızca genel izin ve kişisel tutar limiti kontrol ediliyor.

**Yapılacak:** Ortak onay politika servisi; belge tutarı, gereken rol, kişisel limit, hazırlayan/onaylayan ayrımı ve kural sürümü birlikte değerlendirilsin. Limit 0'ın “limitsiz” mi “yetkisiz” mi olduğu açıkça belgelenmeli.

**Kabul testi:** Admin gerektiren sipariş müdüre 403; eşik altı/üstü ve kişisel limit sınırlarında tablo bazlı test; onay sonrası tutar değişiyorsa tekrar onay.

### F14 — Başarısız kullanıcı güncellemesi kısmen uygulanıyor

**P1 / D.** Kaynak: `server/routes/admin.js:63`.

Operatöre aynı istekte `role=manager` ve geçersiz kısa parola gönderildi. Yanıt 400 olmasına rağmen rol manager olarak kaldı. Alan doğrulama ve yazmalar sırayla yapılıyor; tüm isteği kapsayan transaction yok.

**Yapılacak:** Bütün gövdeyi önce doğrula, yetki/son admin kurallarını kontrol et, sonra kullanıcı/oturum/audit yazmalarını tek transaction'da uygula. Negatif onay limiti ve yanlış veri tiplerini reddet.

**Kabul testi:** İsteğin herhangi bir alanı geçersizse rol, parola, aktiflik, oturumlar ve audit değişmemeli. Geçerli birleşik işlem tümüyle uygulanmalı.

### F15 — Eksik tarihsel kur yerine bugünkü kur veya 1 kullanılıyor

**P1 / D.** Kaynak: `server/lib/core.js:69`.

`fxRate('USD','1990-01-01')` mevcut en yeni kur olan 34,5'i; bulunmayan para birimi 1'i döndürdü. Kaynak yorumundaki “geçmiş değerleme korunur” güvencesi bu fallback için doğru değil.

**Yapılacak:** Belge tarihine uygun kur yoksa mali belgeyi anlamlı hata ile durdur. Özel kur gerekiyorsa yetkili, gerekçeli ve belge üstünde sabitlenen giriş yolu sun. Gelecek kuru geçmişe taşıma.

**Kabul testi:** Eksik kurla mali kayıt yok; geçerli tarihsel kur aynen sabitlenir; geçmiş kur düzenlemesi kayıtlı belgeleri kendiliğinden değiştirmez.

### F16 — Bölünmüş lotların ileri izlenebilirliği kopuyor

**P1 / D.** Kaynak: `server/services/stock.js:154`, `:191`; `server/services/traceability.js:52`.

12 adet lotun 5'i başka depoya bölündü; yeni parçadan 2 sevk edildi. Kaynak lot için geri çağırma raporu sıfır sevkiyat döndürdü. Yeni UUID ile oluşan parça için açık ebeveyn/çocuk lot ilişkisi yok; ileri izleme yalnızca tam lot kimliği üzerinden tüketim/sevkiyat arıyor.

**Yapılacak:** Lot kökenini `root_lot_id`/`parent_lot_id` veya ayrı lot dönüşüm tablosuyla taşı. Kısmi durum değişimi ve transfer aynı iz zincirine dahil olsun. Aynı lot numarasını otomatik birleştirmek tek başına güvenilir çözüm değildir.

**Kabul testi:** Kaynak lot → bölme → transfer → üretim → sevkiyat zincirinin tüm müşteri ve kalan miktarları geri çağırma raporunda eksiksiz bulunmalı.

### F17 — Sayım kaydedildikten sonra arayüzde düzenlenebilir, API'de kapalı

**P1 / D.** Kaynak: `server/routes/stock.js:241`, `frontend-react/CountsView.jsx:75`, `:136–149`.

İlk satır kaydı sayımı `counted` yapıyor. İkinci kayıt “Sayım kapalı” 400 dönüyor. Ön yüz `open` ve `counted` için giriş alanları gösteriyor; onay düğmesi dolu alanları tekrar kaydetmeye çalıştığından daha önce kaydedilmiş sayımın onay akışı da bu hataya takılabilir.

**Yapılacak:** Taslak kaydetme, sayımı tamamlama ve onay işlemlerini net ayır. `counted` düzenlemesi izinliyse sunucu da kabul etsin; değilse arayüz salt okunur olsun ve onay öncesi tekrar yazmasın. Eksik satırla onay politikası da açık olsun.

**Kabul testi:** Aç → kısmi kaydet → devam et → tamamla → başka kullanıcı onayla akışı hem masaüstü hem mobilde çalışmalı.

### F18 — Kısmi güncellemede oluşturma varsayılanları veri siliyor

**P1 / D — yatay etkili.** Kaynak: `server/routes/items.js:125–165`, `:231`; ayrıca `.partial()` kullanan satın alma, CRM, müşteri, planlama ve destek şemaları.

Mamul, fiyat 123, minimum stok 12 ve tek bileşenli ürün için yalnızca yeni isim gönderildi. Kurulu Zod sürümünde `.partial()` içindeki oluşturma varsayılanları da sonuç nesnesine geldi. Ürün tipi `raw`, fiyat ve minimum 0, reçete boş oldu. “Sadece gönderilen alanları değiştir” varsayımı geçersiz.

**Yapılacak:** Create ve update şemalarını defaultsuz ortak alan tanımlarından ayrı üret. Gönderilmedi, null, boş liste ve sıfır durumlarını bilinçli ayır. Kod tabanındaki tüm `.partial()` kullanımlarını denetle; formun bütün alanları göndermesi API kusurunu gidermez.

**Kabul testi:** Tek alanlık PUT/PATCH diğer bütün alanları bit düzeyinde korumalı; açık `bom:[]` reçeteyi temizleyebilmeli; varsayılanlı sayısal/enum/list alanlarının hepsi test edilmeli. Ürün, müşteri, tedarikçi, fırsat, iş merkezi ve destek için ayrı regresyon.

### F19 — Kapasite planı gerçek saat çakışmalarını engellemiyor

**P1 / D.** Kaynak: `server/services/capacity.js:116–151`.

08:00–16:00 vardiyası olan tek kapasiteli merkezde 60 dakikalık iş için başlangıç 00:00 döndü. İlk operasyon kaydedildikten sonra aynı başlangıç isteğiyle ikinci iş de 00:00 döndü. Günlük toplam boş dakika hesaplanıyor; dolu saat aralıkları ve vardiya başlangıcı yerleştirmede kullanılmıyor. Çok gün süren operasyon yükü de yalnızca başladığı güne toplandığından sonraki günler yanlış boş görünebilir.

**Yapılacak:** Gerçek vardiya aralıkları, molalar, kapasite istasyonları ve operasyon çakışmalarıyla slot üret. Çok güne dağılan kapasiteyi segmentlerle sakla. Yeniden planlamada işin kendi eski rezervasyonunu hariç tut.

**Kabul testi:** İki iş 08:00–09:00 ve 09:00–10:00 gibi çakışmasız yerleşir; gece vardiyası, mola, tatil, iki paralel istasyon ve 2 günlük operasyon doğru yük üretir.

### F20 — Satın alma kuru belgeye kilitlense de mal kabulde yeniden hesaplanıyor

**P1 / D.** Kaynak: `server/routes/purchasing.js:395`, `:518`.

USD kuru 34,5 iken 10 USD birim fiyatlı sipariş açıldı. Aynı tarih kuru 44,5 olarak değiştirildi. Mal kabul lot maliyeti 345 yerine 445 TL oldu. Sipariş başlığındaki kilitli kur kullanılmıyor. Satır para birimi de değişebildiğinden yalnızca başlığa dönmek karma dövizli siparişi çözmez.

**Yapılacak:** Sipariş satırında kur ve baz birim fiyatı sabitle; kabul, rapor, 3'lü eşleştirme ve pivot aynı sabit değerleri kullansın. Fatura kur farkını ayrı işlem olarak modelle.

**Kabul testi:** Kur tablosu sonradan değişse bile sipariş/lot baz değeri sabit; farklı dövizli satırlar doğru normalize edilir.

### F21 — “Anonimleştirme” kopya kimlik bilgilerini bırakıyor

**P1/P2 / D+K.** Kaynak: `server/lib/kvkk.js:14–60`.

Müşteri kartı anonimleştirildiğinde `sales_orders.customer_name` eski adla kaldı; anonimleştirme audit kaydı da eski adı tekrar `detail` alanına yazdı. CRM, destek, serbest metinler, dışa aktarımlar ve yedekler için kapsam ayrıca tanımlanmalı. Bu rapor hukuki uygunluk hükmü vermiyor; teknik olarak “geri döndürülemez anonimleştirme” adının mevcut davranışı fazla geniş anlattığını saptıyor.

**Yapılacak:** Kişisel veri haritası ve saklama gerekçesi alan bazında çıkarılsın. Zorunlu saklanan ticari kayıtlar ile anonimleştirilmesi kararlaştırılan kopyalar ayrı politika taşısın. Audit'e eski kişisel veriyi tekrar yazma; yedekten dönüş sonrası silme politikası uygulansın.

**Kabul testi:** Silinmesi seçilen kimlik alanları tüm ilişkili kaynaklarda aranarak yokluğu doğrulanmalı; saklananlar gerekçesi ve yetkisiyle açıkça belgelenmeli.

### F22 — Muhasebe aktarımı iade faturasını normal satış gibi yazıyor

**P1 / D.** Kaynak: `server/services/accounting-export.js:68–90`.

40 TL iade için 120 hesabına 40 borç, 600 hesabına 40 alacak üretildi. Kod `invoice_type` yönünü ayırmıyor. Borç/alacak toplamı yine eşit olduğundan mevcut denge kontrolü bu hatayı yakalamıyor.

**Yapılacak:** Satış, iade ve desteklenen diğer kayıt türleri için işaret/hesap eşleme politikası; aktarılmış belge kimliği ve sürüm takibi. Muhasebe programıyla dosya/API aktarım kabul testi yap. Bu işlev genel veri köprüsüdür; resmî e-Fatura modülü geri eklenmemelidir.

**Kabul testi:** Aynı faturanın tam iadesi net bakiyeyi sıfırlar; kısmi iade doğru ters yönlü satırları üretir; ikinci aktarımın çift kayıt yaratması önlenir veya açıkça yönetilir.

### F23 — Bir satırdaki fazla teslim diğer satırdaki eksiği kapatıyor

**P1 / D.** Kaynak: `server/routes/purchasing.js:539`.

İki satır için 10'ar adet sipariş verildi. İlk satırda izinli toleransla 20 alındı; ikincide hiç teslim yok. `SUM(qty-received_qty)=0` olduğu için sipariş `received` oldu. İkinci satırın sonraki kabulü artık durum kontrolünden engellenebilir.

**Yapılacak:** Tamamlanma her satırın kalan miktarı üzerinden değerlendirilsin; `EXISTS` ile eksik satır kontrolü veya pozitif kalanların toplamı kullanılsın. Fazla teslim toleransı ayrı izlensin.

**Kabul testi:** 20/10 ve 0/10 siparişi `partially_received`; ikinci satır tamamlandıktan sonra `received`. Aynı mantık görev listesi ve MRP'ye yansısın.

### F24 — Aynı sevk miktarı tekrar faturalanabiliyor

**P1 / D.** Kaynak: `server/routes/sales.js:320–386`.

Aynı sipariş için kalemleri otomatik türeten faturalama iki kez çağrıldı. İkisi de 201 ve 48 TL; farklı fatura kimlikleri. Henüz faturalanmamış sevk miktarı/ilişkisi izlenmiyor; toplam `shipped_qty` tekrar kullanılıyor.

**Yapılacak:** Fatura satırı → sevkiyat/sipariş satırı tahsisi ve faturalanmış miktar alanı/defteri; idempotency; müşteri, döviz ve sevkiyat ilişkisi kontrolü. Tamamlanma durumunu ilk kısmi faturayla gereksiz kapatma.

**Kabul testi:** Aynı sevk ikinci kez faturalanmaz; kısmi sevk → kısmi fatura → kalan sevk → kalan fatura akışı doğru; iade miktarı ilk bağlantıya kadar izlenebilir.

### F25 — Excel metin sayısında sessiz 1.000 kat büyüme riski

**P1/P2 / D+K.** Kaynak: `server/services/import.js:202–220`.

Metin hücresi `1,234`, 1234 olarak ayrıştırılıyor. Türkçe üç ondalıklı 1,234 kg girdisi için beklenen 1.234'tür. Dosyanın sayısal hücreleri bu metin dalından geçmez; sorun özellikle CSV'den kopyalanmış veya metin biçimli Excel verisindedir. İki yerel sayı biçimini tahminle birlikte destekleme belirsizliği yaratıyor.

**Yapılacak:** İçe aktarımda sayı yereli seçimi veya belirsiz hücre için bloklayan önizleme uyarısı. Kullanıcı orijinal değer, ayrıştırılmış değer, birim ve toplamı görmeli.

**Kabul testi:** Türkçe ve İngilizce yerellerde `1,234`, `1.234`, `1.234,56`, `1,234.56`, eksi ve bilimsel gösterim açık politikaya göre; belirsizlik sessiz tahmin edilmemeli.

## 6. Kaynak incelemesinden ek bulgular — S01–S20

Bu bölümdeki riskler kaynak üzerinden saptandı; hepsi için ayrı hata enjeksiyonu yapılmadı. Çalışma zamanı saldırısı/üretim arızası olmuş gibi yorumlanmamalıdır.

### S01 — Docker bağlamı özel lisans imzalama anahtarını içerebilir

**P0 / S.** `.dockerignore:1`, `Dockerfile:33`, `.gitignore:18` çevresi. Yerel proje kökünde `license-signing-key.pem` mevcut. `.gitignore` bunu dışlıyor fakat `.dockerignore` dışlamıyor; `COPY . .` son imaja alabilir. `.env.local`, `certs` ve başka özel anahtarlar için de genel kural yok. **Mevcut imajın sızdırıldığı kanıtlanmadı; bu klasörden yapılan build yolu riskli.**

Görev: İmajda yalnız gerekli kaynakları açık listeyle kopyala; özel anahtar/ortam dosyası/yerel veri/rapor klasörünü hariç tut. Yayınlanmış imaj varsa dosya envanterini incele; gerçekten anahtar bulunursa anahtar değişimi ve lisans geçişini planla. Kabul: final image ve build context secret scan; private key hiçbir katmanda yok.

### S02 — Testler gerçek proje verisini silebilir

**P0 / S.** `test/run-all.js:22–45`, `test/e2e-browser/reset-and-start.js:12`, `README.md:58` çevresi. Sabit proje `data` dizini recursive siliniyor; test ortamı koruması yok. Bu nedenle testler ayrı kopyada çalıştırıldı.

Görev: Her koşuya OS geçici dizini, explicit `DATA_DIR/DB_PATH`, test sunucusu portu, sahiplik işareti ve silme öncesi sınır doğrulaması. Test komutu normal/üretim verisine işaret ederse durmalı. Kabul: Gerçek `data` içine sentinel bırakıp bütün test koşusundan sonra aynı hash ile korunduğunu doğrula.

### S03 — Mobil kuyruk başarısız ve arada eklenen işlemleri kaybedebilir

**P1 / S.** `public/js/mobile.js:109–139`, `public/js/mobile-db.js:52`. Snapshot gönderildikten sonra `MobileDB.clear()` bütün kuyruğu siliyor. Yanıtlanan başarısız işlemler de siliniyor; gönderim sürerken eklenen yeni kayıtlar da temizlenebilir. 200'den fazla işlem tek istekle gidiyor, sunucu reddediyor; parçalama yok. `flushQueue` için tek gönderim kilidi yok. İş kuralı hatası `new Error` ile status taşımadan atıldığı için `submit` bunu ağ hatası gibi yeniden kuyruğa alabiliyor.

Görev: Kayıt bazlı ack silme, başarısız kayıtları neden/payload ile tutma, 200 veya daha küçük batch, tek gönderici kilidi, kalıcı retry durumu. Kuyruğu kullanıcıya bağla; hesap değişiminde başka kullanıcının işlemleri yürütülmesin. Kabul: Gönderim sırasında yeni kayıt, kısmi hata, 201 kayıt, bağlantı kopması, hesap değişimi ve aynı anda iki flush.

### S04 — Yedek yalnızca SQLite; doküman dosyaları dahil değil

**P1 / S.** `server/scripts/backup.js:52`, `server/routes/documents.js:20`. Doküman metadata'sı DB'de, içerik uploads dizininde. Mevcut otomatik yedek yalnızca `.sqlite` üretiyor. Yeni makineye yalnız DB geri dönerse dosya kayıtları görünür ama indirme başarısız olabilir. Backup/restore testinin geçmesi tam felaket kurtarma anlamına gelmiyor.

Görev: DB + uploads + sürüm/config manifesti + checksum; sırların ayrı güvenli kurtarılması; şifreli saha dışı kopya. Kabul: Boş makineye dönüşte seçilmiş belge ve logolar dahil hash doğrulaması; işletmenin belirlediği RPO/RTO ölçülsün.

### S05 — Restore çalışan sunucuyu kesin engellemiyor

**P1 / S.** `server/scripts/restore.js:104–151`. WAL varlığına göre yalnız uyarı veriliyor; işleme devam ediliyor. Ana DB taşınırken WAL/SHM siliniyor. Aktif bağlantı/işlem varsa güvenli geri dönüş varsayımı bozulabilir; bunu canlı veriyle denemedim. Upgrade'in WAL sezgisinin de servis kilidi yerine geçmediği unutulmamalı.

Görev: Servis durdurma ve doğrulanmış tek sahipli bakım kilidi; bütün veritabanı bileşenlerini tutarlı koruma; başarısızlık enjeksiyonlu rollback. Kabul: Açık sunucuda restore başlamaz; kopya hatasında DB ve bekleyen WAL verisi korunur.

### S06 — Sunucu başlangıcı güvenli upgrade yolunu atlayarak migration yapıyor

**P1 / S.** `server/index.js:39`, `server/scripts/upgrade.js`. Otomatik migration, JWT/lisans/boş kullanıcı kontrollerinden de önce çalışıyor. Backup ve doğrulama sağlayan upgrade komutunun kullanımı zorunlu değil. `017` geçmiş e-Belge tablolarını düşüren migration; kapsam dışı modülün kaldırılması bilinçli olsa da eski kurulumdaki veri korunumu ayrıca yönetilmeli.

Görev: Üretimde migration politikası açık olsun: bakım/upgrade komutu, önce doğrulanmış yedek, sonra şema geçişi; açılışta bekleyen migration varsa kontrollü duruş. Kabul: Eski sürüm fixture'larından yükseltme, kesinti ve geri dönüş; veri kaybı yaratan migration öncesinde arşiv kararı.

### S07 — Webhook teslimatında çökme aralığında olay kaybolabilir

**P1/P2 / S.** `server/lib/webhooks.js:61–142`. İş transaction'ı bittikten sonra HTTP başlıyor; teslimat kaydı HTTP tamamlanınca yazılıyor. Bu arada process kapanırsa olayın kalıcı izi olmayabilir. Retry zamanı gönderimden önce NULL yapılıyor; yeni kayıt oluşmadan çökmede deneme de kaybolabilir. Her denemede yeni timestamp var, kalıcı event ID taşınmıyor.

Görev: İş kaydıyla aynı transaction'da outbox; kararlı event ID; lease/claim, bounded concurrency ve retry/dead-letter. Kabul: Commit sonrası/HTTP öncesi/HTTP sonrası restart; olay kaybolmaz, tüketici event ID ile yineleneni ayıklar.

### S08 — Webhook hedefi için ağ çıkışı politikası yok

**P2 / S+K.** `server/routes/webhooks.js:47`, `server/lib/webhooks.js:74`. URL biçimi doğrulanıyor; şema/hedef IP/redirect allowlist yok. Yalnız admin yapabiliyor; anonim internet kullanıcısına açık SSRF gibi sunulmamalı. Yerel fabrikada özel IP entegrasyonu geçerli ihtiyaç olabilir.

Görev: HTTP(S) şema listesi, izinli entegrasyon hedefleri, DNS/redirect doğrulaması ve ağ egress kuralı; dış internet ve yerel ağ politikasını ayrı tanımla. Kabul: İzin verilmeyen loopback/link-local/hedef ve yönlendirme reddi; izinli yerel entegrasyon çalışır.

### S09 — Mobil çıkış sunucudaki oturumu iptal etmiyor

**P2 / S.** `public/js/mobile.js:850`, `server/routes/auth.js:63`. Mobil logout yalnız localStorage temizliyor; `/auth/logout` çağırmıyor. Aynı token sunucu tarafında süresi dolana kadar geçerli kalabilir. Genel tarayıcı token saklaması localStorage; bu, XSS etkisini artırır fakat bu incelemede çalışan token çalma istismarı gösterilmedi.

Görev: Çevrimiçi çıkışta revocation; çevrimdışı çıkışta yerel durum ve kuyruk sahipliğini güvenli yönet. Oturum yönetimini ortaklaştır; HttpOnly cookie tasarımı seçilirse CSRF ve mobil davranışını birlikte çöz. Kabul: Çıkış sonrası eski token 401; kullanıcı değişimi kuyruğu devretmez.

### S10 — Kalite “imza” alanı içerik bütünlüğünü ispatlamıyor

**P2 / S.** `server/routes/quality.js:153`, `:178`. `signaturePassword` şemada var ama doğrulanmıyor. Hash ölçüm satırlarının/kabul-red miktarlarının tamamını kapsamıyor; saklanan `signed_at` ile aynı sabit zaman değişkeni de kullanılmıyor. Bunu hukuki elektronik imza veya kapsamlı kurcalama kanıtı saymayın.

Görev: Özellik adı “kullanıcı onayı” olarak netleştirilsin veya yeniden kimlik doğrulama + kanonik içerik hash'i + doğrulama yolu + değişmez kayıt tasarlansın. Kabul: Onaylanan ölçüm sonradan değişirse tespit; yanlış onay parolası reddi; hukuki nitelik ayrıca karara bağlansın.

### S11 — MRP zaman dilimli tedarik uygunluğunu yeterince hesaplamıyor

**P1/P2 / S.** `server/services/mrp.js:98–143`. Açık alım ve üretim miktarları ihtiyaç tarihine yetişip yetişmediğine bakılmadan mevcut arz gibi düşülüyor. Emniyet stoğu, bağımsız/bağımlı talebi olmayan ürünlerde `demand[i.id]` filtresinden dolayı planlanmayabilir. Açık üretim için emir bileşen snapshot'ı yerine güncel reçete kullanılıyor. Döngü tespiti sonuçta dönüyor; hatalı reçetede öneri üretimi kesin durdurulmuyor.

Görev: Tarih kovaları, gecikmiş arz uyarısı, safety-stock bağımsız tetikleme, emre sabitlenmiş BOM ve baştan döngü engeli. Kabul: Yarın gereken malzeme gelecek ayki PO ile karşılanmış sayılmaz; talep yok/alt safety stock öneri verir; BOM değişimi açık emrin ihtiyacını değiştirmez.

### S12 — Ortalama maliyet seçimi ile rapor/çıkış maliyeti politikası tutarlı değil

**P1/P2 / S+K.** `server/services/stock.js:49`, `:126`, `:154`; `server/services/costing.js:51`; `server/routes/reports.js:16`. Kartta moving_average/FIFO seçiliyor; tüketim ve stok değeri çoğunlukla gerçek lot maliyetinden hesaplanıyor. Karantinadan serbest bırakmada ortalama güncellenmiyor. Çıkış sonrası kart ortalaması ile kalan lotların ağırlıklı ortalaması ayrışabiliyor. Bu durum iş modeli seçimi gerektirir; FEFO fiziksel seçim yöntemi ile maliyet yöntemini birbirine karıştırmayın.

Görev: Fiziksel lot seçimi, finansal değerleme ve kart gösterimini ayrı tanımla; tek otoriter hesaplama servisi. Kabul: Farklı maliyetli iki giriş → çıkış → kalite serbest bırakma → masraf dağıtımı zincirinde hareket/COGS/değerleme mutabakatı.

### S13 — Alış faturası ve vergi aktarımı belge snapshot'ına dayanmıyor

**P1/P2 / S.** `server/routes/purchasing.js:615–645`, `server/services/accounting-export.js:40`. 3'lü eşleştirme seçilen irsaliye yerine PO'nun toplam alınan tutarına bakıyor; başka PO'ya ait `receiptId` ilişkisi doğrulanmıyor. Satır dövizleri başlık kuru ile topluca çevrilebiliyor. Alış KDV'si eski faturanın kendi satırından değil güncel ürün kartından türetiliyor.

Görev: Alış fatura satırları, net/vergi/brüt ayrımı, irsaliye satırı tahsisi, kilitli kur/vergi oranı ve daha önce faturalanmış miktar. Kabul: İki kısmi teslimin ayrı faturaları; karışık döviz/vergi; ürün kartı değişince geçmiş dışa aktarım değişmez.

### S14 — Veri birleştirme ilişki listesi eksik; reçete toplamı korunmuyor

**P1 / S.** `server/routes/data-health.js:48–173`. Merge planları yeni CRM/destek/ziyaret ve bazı stok ilişkilerini kapsamıyor. Kullanılmış müşteri/tedarikçi silmede FK hatası doğabilir. Ürün reçetelerinde duplicate temizliği yorumda “miktarlar toplanmalı” diyor ama kod yalnız fazla satırları siliyor; benzersiz kısıt varsa güncelleme bu adıma ulaşmadan da başarısız olabilir.

Görev: Tüm FK ve mantıksal referansları şemadan çıkar; birleşme uyumluluğu (birim, ürün tipi, reçete, vergi, döviz) önizlemesi; miktar ve tarihsel snapshot politikası. Kabul: Bağlı destek/ziyaret/fatura/lot/üretim olan kayıtlarda kontrollü birleşme; hiçbir referans kaybolmaz, BOM ihtiyacı korunur.

### S15 — Import/revert satır içi kısmi değişiklik bırakabilir

**P1/P2 / S.** `server/services/import-commit.js:222–245`, `:277–332`. Dış transaction var fakat satır hataları içeride yakalanıyor. Örneğin revert önce hareket/BOM satırını silip sonra ana kayıt FK nedeniyle silinemezse catch sonrası ilk silmeler commit olabilir. “Başarısız satır”ın hiçbir etkisi olmaması garanti edilmiyor.

Görev: Her çok yazmalı satır için nested transaction/savepoint; batch politikası “tümü veya hiçbiri” mi “satır bazlı” mı açık tanımlansın. Update geri alma için eski snapshot saklanmadığı mevcut sınırlaması kullanıcıya açık gösterilsin. Kabul: İkinci SQL'de zorlanmış hata ilk SQL'i de geri alır; rapor sayıları gerçek yazmalarla aynı.

### S16 — Girdi doğrulaması ve veritabanı değişmezleri eşit uygulanmıyor

**P2 / S.** `server/middleware/validate.js:39`, `server/routes/admin.js:199`, `server/migrations/001_initial_schema.js:166`, çeşitli route'lar. Bazı tarihler serbest metin, bazıları yalnız regex; `99:99` vardiya saati regex'ten geçebilir. Bazı boolean sorgular `z.coerce.boolean()` ile `"false"` metnini true kabul eder. Pek çok miktar alanında DB CHECK alt sınırı yok. Bazı ayar güncellemeleri Zod'suz.

Görev: Date-only, saat, para, miktar, ID ve boolean ortak sözleşmeleri; gerçek takvim doğrulaması; sayfalama tamsayı/sınır kontrolü; alan uzunluğu/array limiti. Negatif değer anlamlı olan hareket farkını yanlışlıkla engellemeden tablo bazlı CHECK tasarla. Kabul: Hatalı girdiler 4xx; 500 veya sessiz normalleşme yok.

### S17 — Ön yüz React geçişi ve tip denetimi tamamlanmış sayılmamalı

**P2 / S.** `frontend-react/DashboardView.jsx:1–18`, `ReportsView.jsx:29`, `AdminView.jsx`, `tsconfig.json:10`. HTML string ve global DOM seçicileri bakım maliyetini artırıyor; async sekme yanıtı eski sekmenin gövdesini sonradan yazabilir. Ortak `UI`/`Api` global bağımlılığı ve `@ts-nocheck` bu sorunları derlemede yakalamıyor. Salt `dangerouslySetInnerHTML` varlığına dayanarak XSS bulundu denmiyor; bir çok alanda `esc` kullanılıyor.

Görev: Önce miktar/finans/onay formlarını gerçek JSX ve kontrollü bileşenlere geçir; ortak tablo/modal/form sözleşmesi; request cancellation/sequence; hata-yükleme-boş durumları; çift gönderim kilidi. Tipleri önce domain giriş/çıkışlarında sıkılaştır. Kabul: Geç yanıt ekranı bozmaz; aynı tıklama iki belge yaratmaz; klavye ve hata odağı testleri.

### S18 — Performans ve liste erişim sınırları büyüyen veriye göre eksik

**P2 / S.** `server/routes/items.js:17–36`, `sales.js:95`, `production.js:16`, `crm.js:58`, `frontend-react/CountsView.jsx:34`. Liste serileştiricilerinde satır başına sorgular var. SQLite aynı process'te olduğundan ağ N+1 maliyeti yoktur ama senkron sorgu sayısı/event loop yükü artar. Bazı listeler ilk 200/25 kaydı alıyor ve gerçek sayfa gezintisi sağlamıyor. Pivot/rapor sorgularında tarih/satır sınırları yeterince kontrollü değil.

Görev: Toplu alt kayıt sorguları, liste/detay DTO ayrımı, gerçek server pagination; kritik sorgulara EXPLAIN ve temsili veri yükü; ihtiyaca göre worker/async rapor. Kabul: En az beklenen müşteri veri hacminde p95/RAM/DB büyüklüğü ölçümü; bütün eski kayıtlara erişim. Eski düşük hacimli load testi fabrikadaki çok yıllı kullanımı kanıtlamaz.

### S19 — Sürüm dağıtımı ve PWA önbelleği kod sürümüne bağlı değil

**P2 / S.** `scripts/build-frontend.js:52`, `public/js/app.js:26`, `public/sw.js:17`, `nginx.conf:39`. Paket isimleri hash içermiyor, nginx JS/CSS'yi 7 gün cache'liyor; PWA cache sürümü sabit `v1` ve elle artırılıyor. Yeni backend ile eski istemci sürümü aynı anda kullanılabilir. Service worker aktivasyonunda aynı origin'deki kendi öneki dışındaki cache'ler de silinebiliyor.

Görev: İçerik hash'li varlıklar/manifest veya sürüm parametresi, uygulama sürümü bildirimi, güncelleme akışı; sadece kendi cache önekini temizle. Kabul: Açık sekme/PWA eski sürümden yeni sürüme kontrollü geçer; bekleyen offline kuyruk kaybolmaz; eski endpoint sözleşmesiyle sessiz işlem yok.

### S20 — Dokümantasyon ve işletim güvenceleri gerçeği fazla geniş anlatıyor

**P2 / S+K.** `README.md:3–25`, `PROJECT_STATUS.md` ilk özet; `server/index.js:167`; `package.json` dev scripti. README otomatik demo yüklenir ve bağımlılıksız frontend derken kod açık demo izni ve derlenmiş React istiyor. İlk hızlı başlangıç temiz kurulum için build/setup adımlarını atlıyor. Genel API sınırı IP başına 300/dakika; çok kullanıcılı ortak NAT altında saha yükü ölçülmeli. `npm run dev` POSIX ortam değişkeni sözdizimi kullanıyor ve Windows npm cmd kabuğunda taşınabilir değil.

Görev: Tek güncel kurulum kaynağı, demo/müşteri yolları, açık sürüm kabul listesi; otomatik paket üretimi ve artifact manifesti. Kullanıcı/oturum temelli uygun rate limit, giriş için IP korumasını koruma; ölçülen eşikler. Yedek, disk doluluğu, webhook retry ve scheduler hataları için kalıcı durum/uyarı. Kabul: Temiz Windows makinede yeni yazılımcı rehberle kurar; beklenen eşzamanlı kullanıcıda 429 baskısı yok; yükseltme/geri dönüş ve destek paketi anlaşılır.

## 7. Modül bazlı tamamlama haritası

| Modül / ana dosyalar | Mevcut kapsam | Tamamlama odağı |
|---|---|---|
| Kimlik ve yönetim — `auth.js`, `admin.js`, `AdminView.jsx` | Roller, kullanıcı, oturum, limit, ayar, audit | F11/F13/F14/F18; ortak izin matrisi, güncelleme atomikliği, şifre politikası |
| Ürün ve BOM — `items.js`, `ItemsView.jsx` | Kart, reçete, maliyet alanları, lot görünümü | F18; seri takip alanlarının uçtan uca uygulanması; dolaylı BOM döngüsü; birim dönüşümü kararı |
| Lot ve stok — `services/stock.js`, `routes/stock.js`, `LotsView.jsx` | Giriş/çıkış, durum, transfer, FEFO | F01/F09/F16; ortak invariants; split kökeni, maliyet tutarlılığı |
| Sayım — `CountsView.jsx`, `routes/stock.js` | Snapshot, satır kaydı, onay | F05/F06/F17; kesim zamanı, çatışma ve eksik sayım politikası |
| Satın alma — `purchasing.js`, `PurchasingView.jsx` | Talep, RFQ, PO, onay, kabul, masraf, fatura, iade | F07/F08/F13/F20/F23, S13; satır bazlı tamamlanma ve mali ilişki |
| Satış — `sales.js`, `SalesView.jsx` | Müşteri, sipariş, sevk, fatura, tahsil edildi, kârlılık | F01/F02/F03/F12/F24; iptal/iade/fatura tahsisi; kısmi tahsilat/ödeme defteri kararı |
| Üretim — `production.js`, `ProductionView.jsx` | BOM snapshot, tüketim, çıktı lotu, fire, maliyet | Stok düzeltmelerini ortak kullan; sıfır sağlam üretim, yeniden işleme tüketimi, operasyon kapanış bağlantısı |
| Planlama — `mrp.js`, `capacity.js`, `PlanningView.jsx` | MRP önerisi, rota, vardiya, çizelge, yaklaşık OEE | F19/S11; gerçek zaman aralıkları, tarihli netleme, operasyon ve üretim durumlarının senkronizasyonu |
| Kalite — `quality.js`, `QualityView.jsx` | Plan, muayene, NCR, CAPA, kalibrasyon, recall | F10/F16/S10; onay/ölçüm/miktar bütünlüğü, yeniden açma ve etkinlik doğrulama politikası |
| CRM — `crm.js`, `CrmView.jsx`, `sales-orders.js` | Fırsat/huni, kazanma/kaybetme, siparişe dönüşüm | F18; para birimini fırsata sabitle; dönüşümde fırsat+SO bağlantısı aynı transaction; kapanmış fırsat düzeltme kararı |
| Destek — `support.js`, `SupportView.jsx` | Talep, yorum, çözüm, NCR'ye dönüşüm | F18/S14; müşteri-sipariş-lot ilişkisini doğrula; çözülmeden kapatma politikası; SLA ve yeniden açma isteğe bağlı |
| Ziyaret — `visits.js`, CRM içi ekran | Ziyaret/konum/takip tarihi | Müşteri-fırsat eşleşmesi; düzenleme sahipliği iş kararı; serbest tarih ve gizlilik kapsamı |
| Rapor/pivot — `reports.js`, `pivot.js`, `ReportsView.jsx` | Değerleme, ABC, yaşlandırma, KPI, özel rapor | F12/F20/F22; tarih/saat dilimi, negatif/pozitif hareket semantiği, para birimi ve tarih snapshot'ı |
| Muhasebe köprüsü — `accounting-export.js`, `accounting.js` | Hesap kodu eşleme ve borç/alacak satırları | F22/S13; gerçek fatura satırı ve vergi snapshot'ı; aktarım tekrar denetimi |
| İçe aktarım — `import.js`, `import-commit.js`, yönetim ekranı | Şablon, preview, commit, kısmi revert | F25/S15; locale, satır savepoint, eksiksiz güncelleme/revert kanıtı |
| Veri sağlığı — `data-health.js` route+servis | Kontroller, bazı otomatik düzeltmeler, merge | S14; iş değişmezleri sağlık kuralları, hatalı veriyi düzeltmeden önce önizleme/yedek |
| Doküman/şablon — `documents.js`, `templates.js`, `ui.js` | Dosya, revizyon, logo, yazdırma | S04; içerik imzası/MIME kontrolü, yetim dosya temizliği, DB+dosya işlem tutarlılığı |
| Mobil — `mobile.js`, `mobile-db.js`, `sw.js` | Barkod, görev, sayım, kuyruk | F04/F05, S03/S09/S19; sahada bağlantı kaybı ve kullanıcı değişimi |
| Bildirim/webhook — ilgili servis/route'lar | In-app, SMTP, HMAC, retry | S07/S08; kullanıcı bazlı okundu durumu kararı, kalıcı durum ve giden olay defteri |
| Kurulum/lisans/yedek — scripts, Docker, nginx | Setup, upgrade, restore, imzalı opsiyonel lisans | S01/S02/S04/S05/S06/S20; tekrar üretilebilir temiz paket ve pilot |

### Ürün kapsamı için açık kararlar

Şunlar mevcut kullanıcı ihtiyacı kesinleştirilmeden “zorunlu eksik modül” diye ücretlendirilmemeli: çok şirketlilik/SaaS, e-Fatura/e-Arşiv, bordro/İK, tam genel muhasebe, üretim makinesi telemetrisi, gelişmiş APS, SSO/MFA, müşteri portalı. Mevcut kaynakta e-Belge'nin kaldırılması bilinçli bir kapsam kararıdır.

Buna karşılık şu iş kuralları yazılı karara bağlanmalı: miadı dolan ürünü kullanma yetkisi; tek ürünün çok ölçü birimiyle alınıp satılması; seri numarası zorunluluğu; müşteri ve tedarikçi iadelerinin fiziksel/mali adımları; kısmi ödeme; fazla sevk toleransı; negatif stok; sayım kilidi; onayda dört göz ilkesi; saha saklama/yedek hedefleri.

## 8. Geliştirici için uygulama taslağı

### 8.1 İş kurallarının tek sahibi

HTTP route'ları doğrulama, kullanıcı bağlamı ve yanıt üretimiyle sınırlandırılmalı. `StockService`, `ShipmentService`, `CountService`, `InvoiceService`, `ApprovalPolicy`, `CostingService` gibi mevcut yapıyla uyumlu modüler servislerde işlemler toplanmalı. Masaüstü, mobil, içe aktarım ve gelecekteki entegrasyonlar aynı servisleri çağırmalı. Yeni soyutlama yalnız gerçek tekrar veya değişmez ihtiyacına karşılık gelmeli.

Her komutun aynı transaction'ında uygun olanlar birlikte yazılmalı: ana belge, satırlar, stok hareketi, türetilmiş miktar, audit, idempotency sonucu ve outbox olayı. Ağ çağrısı transaction içinde yapılmamalı; kalıcı outbox daha sonra göndermeli.

### 8.2 Önerilen veri modeli değişiklikleri

| İhtiyaç | Önerilen yapı | Göçte dikkat |
|---|---|---|
| Yeniden gönderim | İşlem kimliği + kapsam + payload hash + saklanan yanıt | Eski işlemler için sahte kimlik üretip geçmişi yeniden oynatma |
| Lot bölme | Lot ilişki tablosu / root-parent kimliği | Eski bölünmüş lotlar yalnız kaynak/numarayla kesin eşleştirilemez; belirsizleri işaretle |
| Sevkiyat iptali | Durum + reversal belge/hareket referansı | Geçmiş silinmiş sevkiyatı otomatik tahminle geri yaratma |
| Faturalama | Fatura satırı ile sevkiyat/sipariş satırı tahsisi | Eski toplam tutarlı kayıtlar kısmi tahsis için manuel uzlaştırma gerektirebilir |
| Kur/maliyet | Satır fx snapshot, baz fiyat, masraf dağıtım defteri | Yanlış geçmiş maliyeti sessizce yeniden hesaplama; düzeltme dönemi belirle |
| Sayım | Kesim zamanı, satır sürümü, fark ve onay durumu | Onaylanmış tutarsız sayımlar için ayrı düzeltme raporu |
| Güvenilir olay | Outbox, event ID, durum, deneme, next retry, lease | Eski teslimatları çift göndermeden dönüşüm |
| Para/miktar | Açık ölçekli tamsayı veya doğrulanmış decimal yaklaşımı | SQLite `NUMERIC` etiketi tek başına JS floating-point sorununu çözmez |

Parada yuvarlama politikası açık olmalı: tutar ve birim fiyat aynı hassasiyete zorlanmamalı; döviz kuru ve kg/metre gibi miktarlar için ayrı ölçekler belirlenmeli. Mevcut `Number`/`REAL` ve dağınık `toFixed(2)` kullanımı merkezi hesaplama testleriyle değiştirilmeli. Bu rapor bütün mali sapmaların floating-point kaynaklı olduğunu söylemiyor; gösterilen ana maliyet hatası tekrar dağıtımdır.

### 8.3 Geçmiş verinin düzeltilmesi

Kodun düzelmesi eski yanlış veriyi düzeltmez. Canlı kullanılmış kurulum varsa önce salt okunur mutabakat raporu üretin: lot-movement-item eşleşmesi, qty_cache karşılaştırması, silinen belgeye hareket, siparişten fazla sevk, tekrar faturalama, iade işaretleri, masraf dağıtım toplamı, sayım değişiklikleri. Her düzeltme için önce/sonra, gerekçe, onaylayan ve geri dönüş kopyası saklansın. Rapor hatasından çıkarım yapıp bütün stokları otomatik güncellemeyin.

## 9. Öncelikli iş paketleri ve bağımlılıklar

Eforlar planlama tahminidir; sözleşmesel süre değildir. Bir geliştiricinin kodu devralması, mevcut verinin temizliği ve gerçek cihaz erişimi sonucu değiştirir. Yeni özellikler, tam muhasebe ve hukuki çalışma bu tahminlerde yoktur. Kalemler örtüştüğünden aşağıdaki aralıklar doğrudan toplanmamalıdır.

| Paket | Öncelik | İçerik / bulgular | Çıktı | Yaklaşık kişi-gün |
|---|---|---|---|---:|
| A — Güvenli çalışma/dağıtım | P0 | S01, S02 | Secret-free paket, test veri izolasyonu | 1–3 |
| B — Güncelleme ve yetki | P1 | F11, F13, F14, F18 | Defaultsuz update şemaları, atomik kullanıcı, doğru onay | 4–8 |
| C — Stok ve sevkiyat | P1 | F01–F03, F08–F10, F16 | Ortak stok değişmezleri, ters belge, lot zinciri | 8–14 |
| D — Sayım ve mobil | P1 | F04–F06, F17; S03, S09 | Idempotent sync, dayanıklı kuyruk, tutarlı sayım | 7–12 |
| E — Mali kayıtlar | P1 | F07, F12, F15, F20, F22–F24; S12–S13 | Kur/maliyet snapshot, fatura/iade tahsisi, mutabakat | 10–18 |
| F — Planlama | P1/P2 | F19; S11 | Gerçek slot planı ve tarihli MRP | 6–12 |
| G — Veri/entegrasyon/operasyon | P1/P2 | F21/F25; S04–S08, S14–S16 | Güvenli restore, tam backup, outbox, import/merge | 8–15 |
| H — Ön yüz ve saha teslimi | P2 | S17–S20 | Kritik JSX dönüşümü, pagination, sürüm/cache, rehber | 6–12 |

**Önerilen sıra:** A → B → C ve E'nin ortak veri modeli → D → E'nin tamamlanması → F/G → H ve pilot. Bir geliştiriciyle güvenilir kapanış için ilk çalışma bütçesi yaklaşık **50–90 kişi-gün** düşünülüp A/B sonunda yeniden tahmin edilmelidir. Tam React yeniden yazımı, kapsam büyümesi ve geçmiş üretim verisi düzeltmeleri buna eklenebilir. İşletme pilotunun takvim süresi geliştirme kişi-gününden ayrıdır.

Her paket küçük, gözden geçirilebilir değişikliklerle teslim edilmeli. Kabul testi bulunmayan “düzeltildi” maddesi kapatılmamalı. İşlerin günlük takibi için `GELISTIRME-IS-LISTESI.csv` kullanılabilir.

## 10. Projeyi bitmiş sayma koşulları

1. P0 kayıtlarının tamamı kapalı; dağıtım paketinde veri, ortam sırrı veya private key yok.
2. P1 bulguları düzeltilmiş; her biri beklenen doğru davranışı assert eden testle korunuyor. “Risk kabulü” gerekiyorsa ürün sahibi yazılı gerekçeyi biliyor.
3. Mevcut 31 paket ve 33 tarayıcı testi hâlâ geçiyor; yeni testler yanlarına eklenmiş. Tek tek bug tanı betiğinin başarılı çalışması yeterli değil.
4. Temiz Windows kurulumunda `npm ci`, build, setup, servis başlatma, ilk parola, HTTPS erişimi ve yedek gerçek kullanıcıyla doğrulanmış.
5. Docker dağıtılacaksa ayrıca gerçek imaj build/başlatma, boş volume kurulumu, healthcheck, non-root izinleri ve imaj içeriği doğrulanmış.
6. Eski veritabanı sürümünden yükseltme; bilinçli yarıda hata ve geri dönüş; DB + dokümanların boş makineye dönüşü başarılı.
7. Gerçek terminalde barkod/kamera/yazıcı, zayıf Wi-Fi, yanıt kaybı, offline tekrar, 200 üzeri kuyruk ve kullanıcı değişimi denenmiş.
8. Her kritik iş akışı en az iki role karşı; yetkisiz API çağrısı ve geçersiz durum geçişiyle sınanmış.
9. Raporlar, stok hareketleri ve mali kayıtlar seçilmiş pilot dönemde işletmenin mevcut yöntemiyle mutabık.
10. Kurulum kılavuzu, sürüm notu, destek/geri dönüş yöntemi, bilinen sınırlamalar ve kullanıcı eğitimi teslim edilmiş.

### Önerilen uçtan uca kabul senaryoları

| No | Senaryo | Kritik doğrulama |
|---|---|---|
| U01 | Sipariş → onay → iki kısmi kabul → kalite → ek maliyet → alış faturası | Miktar, kur, maliyet, vergi ve belge bağlantısı |
| U02 | Satış → iki lot → kısmi sevk → iptal → yeniden sevk → kısmi fatura | Stok/COGS/faturalanmış miktar; çift istek |
| U03 | Satış faturası → kısmi iade → tam iade → muhasebe aktarımı | Bakiye ve kayıt yönleri |
| U04 | Sayım aç → arada giriş/çıkış → mobil kayıt → düzelt → onay | Kesim zamanı, conflict, kapalı sayım |
| U05 | Hammadde lotu → böl/transfer → üretim → sevk → geri çağır | Bütün alt lotlar ve müşteriler |
| U06 | Çevrimdışı 250 işlem → kısmi hata → cevap kaybı → tekrar giriş | Hiçbir işlem kaybolmaz veya iki kez uygulanmaz |
| U07 | Eksik/gelecekte gelen stok → MRP → kapasite planı → üretim | İhtiyaç ve gerçek vardiya saatleri |
| U08 | Kullanıcı reset → şifre değiştir → limitli onay → logout | API düzeyinde kurallar ve oturum iptali |
| U09 | 3 ondalıklı Excel → preview → commit hata → revert | Locale ve satır atomikliği |
| U10 | Yedek → makine kaybı → temiz dönüş → belge indir → eski kuyruk | Tam veri kurtarma ve tekrar işlemi engelleme |

## 11. Güvenli yeniden üretim ve geliştirici teslimi

**Normal çalışma klasöründe mevcut `npm run test:all` veya Playwright komutunu çalıştırmayın:** mevcut sürüm `data` dizinini siliyor. Önce S02 uygulanmalı veya bu incelemedeki gibi data/.env/private key içermeyen ayrı bir kaynak kopyası kullanılmalı. Bağlantı kurulacak test sunucusunun başka canlı sistem olmadığını doğrulayın.

F01–F25 tanı betiğini çalıştırmak için ayrı kaynak kopyasında `audit-results` klasörü oluşturun, bu paketteki `kanitlar/reproduce.cjs` dosyasını oraya kopyalayın. Bağımlılıklar kurulu olduğunda `node audit-results/reproduce.cjs` çalıştırın. Betik kendi OS geçici `DATA_DIR/DB_PATH` dizinini oluşturur, demo seed'i yalnız oraya yükler, rasgele loopback portunda API açar, gözlemleri `audit-results/reproductions.json` içine yazar. Geçici kanıt DB'sini otomatik silmez. Betik özel anahtar, gerçek `.env` veya gerçek veri gerektirmez. Çıktı kimlikleri her koşuda değişir; beklenen sayısal bulgular rapordadır.

Dosyalar:

- `TEKNIK-ANALIZ.md`: geliştirici için ana teknik rapor.
- `TEKNIK-ANALIZ.html`: tarayıcıda okunabilen ve yazdırılabilen sürüm.
- `GELISTIRME-IS-LISTESI.csv`: F01–F25 ve S01–S20 için öncelikli iş listesi.
- `DOSYA-ENVANTERI.csv`: 199 dosyanın satır/byte/tarama bilgisi ve SHA-256 özeti.
- `API-ENVANTERI.csv`: 234 route bildiriminin dosya, satır, HTTP metodu ve yerel yolu. Yerel yollar router mount prefix'i ile birleştirilmelidir; bu dosya OpenAPI'nin yerine geçmez.
- `kanitlar/`: test logları, bağımlılık kontrolü, sayısal tanı sonuçları ve yeniden üretim kodu.

Geliştiriciye gönderilecek iş talebi: **“Bu raporu mevcut kaynak commit'iyle karşılaştır. Önce A/B paketlerini kapat; her davranışsal bulguya kalıcı regresyon yaz. Sonra stok/sevkiyat/sayım/maliyet/iade iş kurallarını ortak servislerde düzelt. Veritabanı değişikliklerini migration ve geri dönüş planıyla teslim et. İlgisiz çatı değişimi yapma. Her teslimde kapatılan bulgu kimliklerini, test kanıtını, göç adımlarını ve kalan riskleri raporla.”**

Bu incelemenin sonucu bir satışa hazır olma sertifikası değildir. Kullanılabilir bir ürün temeli ve somut bir tamamlama planı vardır; açıklar kapatılmadan yalnız yeşil test ekranına dayanarak genel üretim onayı verilmemelidir.
