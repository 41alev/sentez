# PROJECT_STATUS.md

## 2026-09-14 (devam 27) — Onay limiti + içe aktarım "hata ver" modu testleri; webhook/import "eksik" iddiası düzeltmesi

Kullanıcı, kendi listelediği 7 kalemi ("Yazdırma çıktılarının gerçek
içeriği, Mobil çevrimdışı kuyruk, Webhook otomatik yeniden deneme, Onay
limiti sınır durumu, Veri Aktarımı'nda çakışan kayıt senaryosu, Eşzamanlı
kullanıcı senaryoları, Tarayıcı uyumluluğu") ve ayrıca rol taramasının
tam kapsamlı olmasını istedi. Bu oturumda önce her kalem tek tek
incelendi (kod okuma + mevcut test dosyalarının gerçekten neyi
kapsadığının doğrulanması):

- **Webhook otomatik yeniden deneme:** ÖNCEDEN "eksik" diye
  raporlanmıştı — bu YANLIŞTI. `test/webhooks.js` bunu zaten tam olarak
  kanıtlıyor: `WEBHOOK_RETRY_BASE_MS` kısaltılarak (run-all.js
  `SUITE_ENV_OVERRIDES`) `nextRetryAt` geçmişe düşürülüyor,
  `POST /api/webhooks/process-retry-queue` (admin-only) tetikleniyor,
  GERÇEK ikinci bir teslimat denemesi yapıldığı ve `retryCount`'un
  arttığı doğrulanıyor. Kod değişikliği YOK — yalnızca yanlış
  değerlendirme düzeltildi.
- **Veri Aktarımı çakışan kayıt senaryosu:** `test/import.js` zaten
  `'skip'` ve `'update'` modlarını gerçek Excel dosyalarıyla test
  ediyordu. Yalnızca üçüncü mod (kodda gerçek adı `'error'` değil
  `'fail'` — `server/services/import-commit.js`) test edilmiyordu. Bu
  modda tekrar eden satır TÜM PARTİYİ düşürmez, yalnızca o satır
  `commit()` içindeki try/catch'te (import-commit.js:224-236) "failed"
  olarak işaretlenir, mevcut kayıt dokunulmadan kalır. `test/import.js`'e
  4 yeni assertion eklendi: önizleme kabul ediliyor → commit'te
  `failed:1` → hata mesajı "zaten var" içeriyor → mevcut kayıt
  değişmemiş.
- **Onay limiti sınır durumu:** `test/approval-limit.js` DAHA ÖNCE
  oluşturulmuştu ama var olmayan bir `./helpers` modülünü `require`
  ediyordu (bu projede sunucu seviyesi testler paylaşımlı helper
  KULLANMAZ — o desen yalnızca `test/e2e-browser/` Playwright testlerine
  özgü) — hiç çalışmıyordu ve `run-all.js`'e kayıtlı değildi. Dosya
  `test/e2e.js`'nin gerçek deseniyle (kendi `api()`/`ok()`/`login()`,
  kendi IIFE, `process.exit`) yeniden yazıldı, `SERVER_SUITES`'e eklendi.
  Canlı çalıştırmada bir varsayım hatası bulundu: `POST
  /orders/:id/approve` yalnızca `{ok:true}` döner, güncellenmiş
  siparişi DEĞİL — test bunu yanlış varsaymıştı; düzeltildi (onay
  sonrası ayrı `GET` ile `approvalStatus` doğrulanıyor). Test artık asıl
  senaryoyu kanıtlıyor: approval_rules eşiği (₺100.000→Müdür) sağlansa
  bile Müdür'ün KİŞİSEL `approval_limit`'i (seed ₺250.000) aşılan bir
  ₺300.000 siparişte onay 403 ile reddediliyor, admin ise kişisel limit
  kontrolüne tabi olmadan onaylayabiliyor.

**Hâlâ tamamen açık kalemler (bu oturumda BAŞLANMADI, ayrı iş
gerektiriyor):** Yazdırma çıktılarının gerçek içeriği (window.open
popup'ı tarayıcı aracının sandbox'ında engelleniyor — bir intercept
tekniği gerekiyor), Mobil çevrimdışı kuyruk (navigator.onLine override +
IndexedDB/MobileDB doğrulaması), Eşzamanlı kullanıcı senaryoları (iki
paralel oturum/sekme ile aynı kayda yarış durumu), Tarayıcı uyumluluğu
(mevcut araç seti yalnızca Chromium — gerçek çoklu tarayıcı testi
yapılamıyor, yalnızca zarif bozulma kod yolları doğrulanabilir), ve
tamamen tüketici bir rol×satır-aksiyon taraması (5 rol × her modülün her
buton/satır-aksiyonu).

**Doğrulama:** `npm run typecheck` temiz, `npm run lint` 0 hata (yalnızca
önceden var olan uyarılar, değiştirilen dosyalarda yok). `node
test/run-all.js` → 30/30 sunucu paketi + tüm standalone paketler geçti
(yeni `approval-limit` paketi dahil, `import` paketi 87/87). `npx
playwright test` → 22/22 geçti (değişmedi).

**Dosyalar:** `test/approval-limit.js` (yeniden yazıldı), `test/import.js`
(4 yeni assertion), `test/run-all.js` (`approval-limit` `SERVER_SUITES`'e
eklendi).

## 2026-09-14 (devam 26) — Tam yetki matrisi taraması: 2 gerçek bulgu daha (toplam 10)

Kullanıcının "tara" talimatıyla, `frontend-react/*.jsx`'teki TÜM `can(...)`
çağrıları (ItemsView, LotsView, CountsView, ProductionView, PurchasingView,
SalesView, QualityView, CrmView, SupportView, PlanningView, AdminView,
ReportsView) tek tek `server/middleware/auth.js`'teki granüler
`PERMISSIONS` matrisi ve ilgili route'ların gerçek
`requirePermission`/`requireRole` gereksinimleriyle karşılaştırıldı.

**Dokuzuncu bulgu** (gerçek, canlıda doğrulanmış — "görünür ama kırık"
sınıfı): `SalesView.jsx`'teki sevkiyat silme ikonu `can('delete')` ile
kapılıydı (frontend `can()` matrisinde admin+manager). Ama
`server/routes/sales.js:279`'daki `DELETE /shipments/:id`
`requireRole('admin')` ile GERÇEK admin dışında herkesi (manager dahil)
reddediyor. Aynı dosyada, 230 satır aşağıda, müşteri silme butonu zaten
doğru şekilde `can('admin')` kullanıyordu — sevkiyat silme bu deseni
takip etmemişti. Müdür bu butona tıklayınca doğrudan `fetch()` ile canlı
kanıtlanan 403 alıyordu. Düzeltme: buton da `can('admin')`'e geçirildi
(aynı dosyadaki kendi tutarlı deseniyle hizalandı).

**Onuncu bulgu** (gerçek, canlıda doğrulanmış — "gizli ama izinli"
sınıfı, `count.write` bulgusuyla AYNI KÖK NEDEN): `server/routes/
documents.js:15`'teki belge/eki yükleme `WRITE`si
`requireRole('admin','manager','operator','quality')` içeriyor — yani
Kalite bir ürüne sertifika/test raporu ekleyebilmeli. Ama
`ItemsView.jsx`'teki "Doküman Yükle" butonu genel `can('write')` ile
kapılıydı (frontend matrisinde quality hiç yok). Kalite kullanıcısı bu
özelliği masaüstünden hiç kullanamıyordu. Düzeltme: `can()`'e backend'in
bu spesifik `WRITE` listesini yansıtan ayrı bir `'docs'` yetkisi eklendi
(admin/manager/operator/quality'de var) — `count`'ta izlenen desenin
aynısı.

Diğer tüm karşılaştırmalar TEMİZ çıktı: `PlanningView.jsx`'in
`can('approve')`/`can('write')` ayrımı `planning.js`'in `MANAGER`/`WRITE`
sabitleriyle birebir; `PurchasingView.jsx`'in RFQ/fatura/onay/kalem
butonları `purchase.write`/`purchase.approve`'la birebir; `CrmView.jsx`'in
ziyaret silme butonu `visits.js`'in `MANAGER`'ıyla birebir;
`SalesView.jsx`'in e-Belge gönder/sorgula butonları `edocs.js`'in
`MANAGER`/`WRITE` ayrımıyla birebir; `AdminView.jsx`'teki Webhook'lar ve
Muhasebe Aktarımı butonlarının `can()` koruması eksik görünüyor ama
pratikte zararsız — Yönetim sekmesinin kendisi zaten yalnızca admin/
manager'a açık ve her iki route da tam o ikisine izin veriyor
(`ADMIN`-only webhook listesi zaten manager'ı da GET aşamasında
engelliyor, muhasebe eşlemesi `MANAGER`).

`test/e2e-browser/permission-matrix.spec.js` (yeni): Müdür'ün sevkiyat
silme butonunu GÖRMEDİĞİNİ ve Kalite'nin "Doküman Yükle" butonunu
GÖRDÜĞÜNÜ (ama "Düzenle"yi görmediğini) kanıtlıyor.

**Doğrulama:** `npm run typecheck`/`lint` temiz. `npx playwright test` →
22/22 geçti (2 yeni test dahil). `node test/run-all.js` → 29/29 suite
geçti.

**Bu oturumdaki toplam bulgu sayısı: 10** — 6'sı ana işlevsel tur
(izlenebilirlik, teklif karşılaştırma, fatura eşleştirme, satış sevkiyatı
tam çökmesi, denetim kaydı "null" sızıntısı, mobil mal kabul+sayım tam
çökmesi), 4'ü rol bazlı yetki matrisi taraması (Yönetim sekmesi
görünürlüğü, Kalite sayım erişimi, Müdür sevkiyat silme, Kalite belge
yükleme). Hepsi gerçek verilerle canlı doğrulandı, kalıcı regresyon
testleriyle korunuyor.

## 2026-09-14 (devam 25) — Rol bazlı tur: kullanıcı "sadece admin ile mi test ettin?" diye sordu — haklıydı, 2 bulgu daha

Kullanıcı önceki turun tamamının (neredeyse) yalnızca `admin` (ve Depo
Terminali'nde `operator`) ile yapıldığını fark edip sordu. Doğruydu —
Müdür, Kalite ve Görüntüleyici rolleriyle canlı hiçbir şey denenmemişti.
Bu eksik kapatıldı: önce `server/middleware/auth.js`'teki backend
PERMISSIONS matrisi ile `public/js/ui.js`'teki frontend `can()` matrisi
karşılaştırıldı (birebir örtüşmüyorlar — backend granüler
`stock.write`/`purchase.approve`/`count.write` gibi izinler kullanırken
frontend `write`/`delete`/`approve`/`quality`/`admin` gibi genel
bayraklara indirgiyor), sonra dört rolle de (`viewer`, `kalite`, `mudur`,
tekrar `admin`) canlı gezinip hem UI'ı hem doğrudan `fetch()` ile API'yi
denendi.

**Görüntüleyici:** Tüm modüllerde yazma butonları doğru gizli; doğrudan
API'ye (ürün oluştur, sipariş oluştur, kullanıcı oluştur, sayım aç vb.)
saldırı denemesi hepsinde 403/401 ile reddedildi. Temiz.

**Müdür:** Satın alma onay akışı (₺100.000 üstü PO onaylama) doğru
çalıştı; Yönetim'de yetkisi olmayan bölümler (Kullanıcılar, Onay
Kuralları, KVKK, Webhook'lar) doğru şekilde "yetkiniz yok" ile
karşılandı. Temiz.

**Yedinci bulgu** (kozmetik, güvenlik etkisi yok — içerik zaten
sunucu tarafında korunuyor): `public/js/app.js:47`'deki "Admin tab is
meaningless for roles that cannot see anything in it" mantığı Yönetim
sekmesini yalnızca `viewer` ve `operator` için gizliyordu — **`quality`
unutulmuştu**. Kalite rolünün backend'de (`PERMISSIONS.quality`) hiç
admin yetkisi yokken tıklanabilir bir Yönetim sekmesi görüp içeride
yalnızca "Bu bölüm yalnızca yöneticilere açıktır" ile karşılaşması
sağlanmıştı. `quality` listeye eklendi.
`test/e2e-browser/login.spec.js`'e "kalite rolünde Yönetim sekmesi
gizli" testi eklendi.

**Sekizinci bulgu** (gerçek, canlıda doğrulanmış işlevsel bug):
Backend `PERMISSIONS.quality` (`server/middleware/auth.js`) açıkça
`count.write` içeriyor — yani Kalite rolü fiziksel sayım
oluşturup kaydedebilmeli. Ama frontend `can()` matrisinde `quality: 
['quality']` idi — `'write'` hiç yoktu. `frontend-react/CountsView.jsx`
hem "Yeni Sayım" (satır 173) hem "Sayımı Kaydet" (satır 108) butonlarını
genel `can('write')` ile kapatıyordu. Sonuç: **Kalite kullanıcısı
masaüstünden ne yeni bir sayım açabiliyordu ne de saydığı miktarları
kaydedebiliyordu** — backend'in açıkça izin verdiği bir işlev UI'da
tamamen erişilemezdi (sayım ekranına girip rakamları yazabiliyordu ama
"Kaydet" butonu hiç görünmediği için girdiği her şey kaybolurdu).
Doğrudan `POST /api/stock/counts` çağrısıyla backend'in gerçekten izin
verdiği canlı olarak kanıtlandıktan sonra düzeltildi: `can()`'e
backend'in `count.write`/`count.approve` ayrımını yansıtan ayrı bir
`'count'` yetkisi eklendi (operator/manager/admin/quality'de var,
"Onayla" hâlâ yalnızca `can('approve')` ile admin/manager'a kısıtlı —
`count.approve` backend'de de yalnızca onlarda). İki buton da
`can('count')`'a geçirildi. `test/e2e-browser/counts-quality-role.spec.js`
(yeni): kalite kullanıcısının gerçekten yeni bir sayım açıp bir satırı
kaydedebildiğini VE "Onayla" butonunun ona hiç görünmediğini kanıtlıyor.

**Doğrulama:** `npm run typecheck`/`lint` temiz. `npx playwright test` →
20/20 geçti (2 yeni test dahil). `node test/run-all.js` → 29/29 suite
geçti (bir çalıştırmada "barcode" paketi geçici bir ortam çakışmasıyla
başarısız oldu, tek başına VE tekrar tam pakette 21/21 geçerek flake
olduğu doğrulandı — kod değişikliğiyle ilgisi yok).

**Önemli ders:** Önceki "tüm ekranlar test edildi" iddiası eksikti —
yalnızca EN GENİŞ yetkili rolle (admin) test etmek, dar yetkili bir
rolün ("quality" gibi) backend'in izin verdiği ama frontend'in
unuttuğu bir özelliği hiç kullanamamasını YAKALAYAMAZ. Rol matrisi olan
her uygulamada exhaustive tur, en az bir kez HER rolle (özellikle en
kısıtlı VE en özelleşmiş roller) yapılmalı.

## 2026-09-14 (devam 24) — ALTINCI BULGU (kritik): Depo Terminali'nde "Sayım" da GERÇEKTE HİÇBİR ZAMAN ÇALIŞMIYORDU

Mal Kabul düzeltmesinin hemen ardından, aynı şüpheyle ("aynı dosyada başka
alan-adı/şema uyuşmazlığı olabilir mi?") `server/routes/mobile.js`'teki
diğer `/mobile/sync` işleyicileri ('move', 'transfer', 'count_line') kod
incelemesiyle kontrol edildi. 'move' ve 'transfer' doğruydu (alan adları
`stock.receiveLot()`/`stock.transferLot()` ile birebir eşleşiyor, ayrıca
'move' zaten `test/mobile.js`'te gerçek bir API çağrısıyla test ediliyor).
Ama **'count_line' işleyicisinde ikinci bir gerçek, canlıda doğrulanmış
çökme bulundu**: `UPDATE stock_count_lines SET counted_qty = ?,
counted_at = ? ...` çalıştırıyordu — ama `stock_count_lines` tablosunda
(`001_initial_schema.js`) **`counted_at` diye bir sütun hiç yok**. Depo
Terminali'nde bir sayım satırı okutulup miktar onaylandığında istek HER
ZAMAN "no such column: counted_at" hatasıyla başarısız oluyordu — depo
operatörlerinin en sık kullanacağı ikinci işlem (fiziksel sayım) da mal
kabul kadar tamamen kırıktı. Masaüstünün kendi `PUT /counts/:id/lines`
(`server/routes/stock.js:248`) rotası doğru sütunları (`counted_qty`,
`difference = counted_qty - system_qty`) kullanıyordu — yalnızca mobil
senkronizasyon ucu bozuktu, ve `test/mobile.js` bu işlem tipini hiç
test etmiyordu.

Düzeltme: `count_line` işleyicisi artık masaüstüyle aynı deseni kullanıyor
(`counted_qty` VE `difference` güncelleniyor, `counted_at` hiç
yazılmıyor). `test/e2e-browser/mobile-count.spec.js` (yeni): masaüstünden
taze bir sayım açılıp Depo Terminali'nde bir satır sayılıyor, sunucunun
`{failed:0, succeeded:1}` döndürdüğü kanıtlanıyor (eskiden HER ZAMAN
`failed:1` dönüyordu).

Ayrıca canlı olarak Yer Değiştirme (parti taşıma), Toplama (yerel
işaretleme — sevkiyat masaüstünden oluşturuluyor, tasarım gereği sunucuya
yazmıyor) ve Malzeme Çıkışı (salt görüntüleme — malzemeler üretim
tamamlanınca otomatik düşülüyor, tasarım gereği ayrı bir onay adımı yok)
akışları da denendi; üçünde de sorun bulunmadı.

**Doğrulama:** `npm run typecheck`/`lint` temiz. `npx playwright test` →
18/18 geçti (2 yeni test dahil). `node test/run-all.js` → 29/29 suite
geçti. Gerçek tarayıcıda (mobil görünüm) önce bozuk hali ("no such
column: counted_at"), sonra düzeltilmiş hali (`succeeded:1`) doğrulandı.

**Depo Terminali'nin tüm akışları artık tam test edildi** — bu, ürünün
tüm ekranlarının/modüllerinin sistematik turunu tamamlıyor. Bu turda
toplam **6 gerçek, canlıda doğrulanmış hata** bulunup düzeltildi (RFQ
karşılaştırma, fatura 3'lü eşleştirme render, satış sevkiyatı tam çökme,
denetim kaydı "null" sızıntısı, mobil mal kabul tam çökme, mobil sayım
tam çökme) — hepsi gerçek verilerle uçtan uca doğrulandı ve kalıcı
regresyon testleriyle korunuyor.

## 2026-09-14 (devam 23) — BEŞİNCİ BULGU (kritik): Depo Terminali'nde "Mal Kabul" GERÇEKTE HİÇBİR ZAMAN ÇALIŞMIYORDU + Yönetim tamamlandı

Yönetim'in kalan sekmeleri (Ayarlar, Veri Aktarımı — şablon indirme, Belge
Şablonları — firma kimliği/düzen/varsayılana dön, Veri Sağlığı — denetim
çalıştır + KAYIT BİRLEŞTİR gerçek bir kayıtla uçtan uca test edildi,
Muhasebe Aktarımı, Webhook'lar — oluştur/test et (gerçek dış URL'e HTTP
POST)/başarısız teslimat+otomatik yeniden deneme/elle yeniden dene/sil)
tamamlandı. Ardından tur son büyük parçaya, Depo Terminali'ne (mobile.html)
geçti.

**Beşinci ve bu turun EN CİDDİ ikinci bulgusu**: gerçek bir telefon/el
terminali senaryosunda "Mal Kabul" (satın alma siparişi teslim alma)
akışı denendi — kalem seçilip miktar onaylandığında sunucu **HER ZAMAN
422 "Expected number, received nan"** hatasıyla reddediyordu. Kök neden:
`public/js/mobile.js`'teki `receive()` fonksiyonu
`POST /purchasing/orders/:id/receipts` çağrısına
`lines: [{ itemId: i.itemId, ... }]` gönderiyordu — ama sunucu
(`server/routes/purchasing.js:478`, zod şeması) `poItemId` (sipariş
KALEMİNİN kendi satır id'si, sayısal) bekliyor; `itemId` (ürünün kendi
UUID id'si) tamamen farklı bir alan ve `z.coerce.number()` bir UUID'yi
`NaN`'a çeviriyor. **Masaüstü arayüzdeki (`PurchasingView.jsx`) AYNI
işlem doğru `poItemId: Number(inp.dataset.id)` gönderiyordu** — yalnızca
mobil terminal ucu bozuktu. `test/mobile.js` (jsdom) yalnızca görev
listesinin (`GET /mobile/tasks`) yüklendiğini kontrol ediyordu, gerçek
"ONAYLA" tıklamasını hiç denemiyordu; `test/e2e-browser/mobile.spec.js`
de yalnızca giriş/barkod/kamera akışını test ediyordu — bu yüzden depo
operatörlerinin en sık kullanacağı işlem (mal kabul) hiçbir testte hiç
denenmemişti.

Ayrıca test sırasında önemli bir ek gözlem: mobile.html gerçek bir
service worker (PWA) ile önbelleğe alınıyor — düzeltmeden sonra bile
tarayıcı önbellekteki ESKİ `mobile.js`'i çalıştırmaya devam etti,
service worker + cache elle temizlenip sayfa yeniden yüklendikten sonra
düzeltme etkili oldu. Bu, gerçek kullanıcı cihazlarında bir düzeltmenin
service worker'ın kendi güncelleme döngüsü tamamlanana kadar
gecikebileceği anlamına gelir — kod tarafında bir hata değil, PWA'nın
doğal bir özelliği, ancak dağıtım sürecinde akılda tutulmalı.

`receive()` artık `poItemId: i.id` gönderiyor (`i.id` = `serializePO()`'nun
döndürdüğü po_items satır id'si).
`test/e2e-browser/mobile-receiving.spec.js` (yeni): seed'deki SA-2026-003
siparişinin Hidrolik Yağ 15L kalemi gerçekten teslim alınıp sunucunun
201 döndürdüğünü VE başarı toast'ının göründüğünü kanıtlıyor.

**Doğrulama:** `npm run typecheck`/`lint` temiz. `npx playwright test` →
17/17 geçti (yeni test dahil). `node test/run-all.js` → 29/29 suite geçti.
Gerçek tarayıcıda (mobil görünüm) önce bozuk hali (422, sheet kapanmıyor),
sonra düzeltilmiş hali (201, "... teslim alındı" toast'ı, sonraki
sipariş listesinden kalem düşüyor) doğrulandı.

**Bu turun geri kalanı devam ediyor** — Depo Terminali'nin diğer akışları
(Toplama, Sayım, Malzeme Çıkışı, Yer Değiştirme, barkod/kamera okuma,
çevrimdışı kuyruk) sırayla test edilecek.

## 2026-09-14 (devam 22) — Satış, Kalite, CRM, Destek, Planlama, Raporlar, Yönetim (kısmi) tam test edildi — 1 küçük bulgu daha

Sevkiyat çökmesi düzeltildikten sonra tur devam etti: Satış modülünün kalan
5 sekmesi (Sevkiyatlar — durum ilerletme/yazdırma, Müşteriler CRUD,
Faturalar — Fatura Gir/Tahsil Et, e-Belgeler — oluştur/gönder/durum sorgula,
Kârlılık — 3 gruplama + CSV), Kalite'nin kalan 5 sekmesi (Uygunsuzluklar
elle+otomatik NCR, DÖF/CAPA aç/kapat, Cihaz/Kalibrasyon, Muayene Planları,
İzlenebilirlik — Lots'taki paylaşılan bileşen sayesinde zaten düzeltilmiş),
Fırsatlar/CRM (Huni zaten Playwright'ta kapsanıyor; Fırsatlar liste view +
Ziyaretler yeni test edildi), Destek (talep oluştur/yorum/uygunsuzluğa
dönüştür), Planlama'nın 5 sekmesi (MRP çalıştır+belgeye dönüştür, Kapasite
detay, İş Merkezleri/Vardiya/Tatil CRUD, Rotalar, Vardiya&OEE kaydı) ve
Raporlar'ın 10 sekmesinin TÜMÜ (Özel Rapor'un kaydet/çalıştır/sil dahil)
tek tek gerçek verilerle denendi.

**Dördüncü bulgu** (küçük, kozmetik — önceki turdaki "ham enum sızması"
sınıfıyla aynı): Yönetim > Denetim Kaydı ekranında başarısız bir giriş
denemesi satırının KULLANICI sütununda literal **"null"** metni
görünüyordu. Kök neden: `public/js/ui.js`'teki `roleLabel(r)` fonksiyonu
`({...}[r] || r)` deseniyle yazılmıştı — denetim kaydında "system" aktörünün
(başarısız giriş denemesi gibi kimliksiz olaylar) rolü gerçekten `null`
olduğunda, `undefined || null` ifadesi `null`'ı olduğu gibi döndürüyor,
şablon string'i JS'in `null`'ı `"null"` metnine çevirmesiyle ekrana o
şekilde basıyordu. `roleLabel` artık `r` boşsa `'—'` döndürüyor.
`test/e2e-browser/admin-audit-log.spec.js` (yeni): kasıtlı yanlış şifreyle
giriş denenip Denetim Kaydı'ndaki ilgili satırın "null" içermediğini
kanıtlıyor.

Ayrıca test sırasında birkaç kez KENDİ otomasyon hatam bulundu (uygulama
hatası DEĞİL, ileride benzer testler için not): (1) Destek talebi formunda
müşteri seçilince gizlenen "Müşteri adı (kayıtlı değilse)" alanına
yazdığım için "Konu" alanına açıklama metni gitmiş göründü — doğru
alanlarla tekrarlanınca doğru çalıştığı kanıtlandı; (2) Depolar formunda
ilk alanın "Depo Adı", ikincisinin "Kod" olduğunu (tablo sütun sırasının
TERSİ) fark etmeden doldurdum — düzenle ile düzeltildi, uygulama girileni
doğru kaydetmişti.

**Doğrulama:** `npm run typecheck`/`lint` temiz. `npx playwright test` →
16/16 geçti (yeni test dahil). `node test/run-all.js` → 29/29 suite geçti.

**Bu turun geri kalanı devam ediyor** — Yönetim'in kalan sekmeleri (Ayarlar,
Veri Aktarımı, Belge Şablonları — logo yükleme dahil, Veri Sağlığı —
kayıt birleştirme dahil, Muhasebe Aktarımı, Webhook'lar — tam CRUD+test+
yeniden deneme dahil) ve Depo Terminali (gerçek barkod tabanlı mobil
akışlar) test edilecek.

## 2026-09-14 (devam 21) — EN CİDDİ BULGU: "Yeni Sevkiyat" TAMAMEN ÇÖKÜYORDU (500), hiçbir sevkiyat asla kaydedilemiyordu

Satın Alma modülü tamamen test edildikten sonra Satış modülüne geçildi.
"Yeni Satış Siparişi" ile yeni bir sipariş oluşturuldu, ardından üzerinde
"Yeni Sevkiyat" denendi — **`POST /api/sales/shipments` HER SEFERİNDE 500
Internal Server Error döndü**, hem FEFO otomatik lot seçimiyle hem de elle
seçilen bir lotla. Bu, bir depo/ERP sisteminde en temel operasyonlardan
biri olan "müşteriye mal sevk et" işleminin **hiçbir zaman
çalışmadığı** anlamına geliyordu.

Sunucu loglarını yakalamak için demo sunucusu stdout/stderr dosyaya
yönlendirilerek yeniden başlatıldı (Windows'ta Start-Process'in pino'nun
async log yazımını process sonlanana kadar diske yazmayabildiği fark
edildi — süreç durdurulup log dosyası öyle okundu). Gerçek hata:

```
TypeError: stock.allocate is not a function
    at server/routes/sales.js:232
```

`server/routes/sales.js`'teki `POST /shipments` handler'ı
`stock.allocate(itemId, qty, warehouseId, 'FEFO')` VE
`stock.consume(picks, {...})` çağırıyordu — ama `server/services/stock.js`
bu iki fonksiyonu **HİÇBİR ZAMAN EXPORT ETMEMİŞTİ** (`module.exports`
listesinde `allocate`/`consume` hiç yoktu, yalnızca `pickLotsFEFO` ve
`issueStock` vardı — farklı imzalarla). Bu, hem FEFO otomatik yolu (`picks
= stock.allocate(...)`) HEM DE elle lot seçilen yolu (ikisi de sonunda
aynı `stock.consume(picks, ...)` satırından geçiyor) etkiliyordu — yani
**tek bir istisna olmadan her sevkiyat oluşturma denemesi çöküyordu**.
`test/e2e.js`'deki mevcut test yalnızca seed verisindeki (sunucu açılışında
elle SQL ile eklenen) sevkiyatları `GET` ile okuyordu, gerçek bir `POST`
hiç denenmemişti — bu yüzden bu tam kapsamlı çökme hiçbir CI/test
koşusunda hiç yakalanmamıştı.

Düzeltme: `server/services/stock.js`'e eksik `allocate()` (mevcut
`pickLotsFEFO`'yu sarıp yetersiz stokta `AppError` fırlatan, sonucu
`{lotId, lotNo, qty, unitCost}` şekline döken) ve `consume()` (verilen
lot listesini gerçekten düşüren, `recordMovement` ile hareket kaydeden,
`recalcItemQty` ile önbelleği güncelleyen) fonksiyonları eklendi — ikisi
de mevcut yapı taşlarını (`pickLotsFEFO`, `recordMovement`,
`recalcItemQty`) kullanıyor, `sales.js`'e hiç dokunulmadı.

`test/e2e.js`'e gerçek bir `POST /api/sales/shipments` çağrısı eklendi:
hem FEFO otomatik lot seçimiyle hem elle seçilen bir lotla sevkiyat
oluşturulup 201 döndüğü VE stoğun gerçekten düştüğü doğrulanıyor.

**Doğrulama:** `npm run typecheck`/`lint` temiz. `npx playwright test` →
15/15 geçti. `node test/run-all.js` → 29/29 suite geçti (yeni e2e
assertion'ları dahil). Gerçek tarayıcıda önce bozuk hali (500 hatası,
sipariş "0/3" kalıyor), sonra düzeltilmiş hali (sipariş "Sevk edildi"ye
geçiyor, stok gerçekten düşüyor) hem FEFO hem elle lot senaryosunda
doğrulandı.

**Bu turun geri kalanı devam ediyor** — Satış modülünün diğer sekmeleri
(Sevkiyatlar, Müşteriler, Faturalar, e-Belgeler, Kârlılık), Kalite (6
sekme), CRM/Fırsatlar, Destek, Planlama (5 sekme), Raporlar (10 sekme),
Yönetim (11 sekme) ve Depo Terminali'nin her düğmesi/diyaloğu sırayla
test edilecek.

## 2026-09-14 (devam 20) — ÜÇÜNCÜ BULGU: Fatura 3'lü eşleştirme tablosunda tedarikçi adı ve fark notu hiç görünmüyordu

Aynı turda, Teklifler sekmesindeki düzeltmeden hemen sonra Faturalar
sekmesi test edildi. "Fatura Gir" ile SafeGuard GmbH'ye ait bir siparişe
kasıtlı olarak uyuşmayan bir tutar (999.999 ₺) girilip 3'lü eşleştirmenin
farkı doğru yakaladığı doğrulandı ("Fark var" rozeti çıktı) — ANCAK
**"Tedarikçi Adı" sütunu "—" gösterdi** ve fark açıklaması sütunu tamamen
**boştu**, oysa API `supplier: "SafeGuard GmbH"` ve
`discrepancyNote: "Fatura 999999.00 TL, teslim alınan 0.00 TL"` alanlarını
doğru döndürüyordu (network log ile doğrulandı).

Kök neden, yine aynı sınıf: `GET /api/purchasing/invoices`
(`server/routes/purchasing.js`) yanıtı SADECE camelCase alanlar içeriyor
(`supplier`, `discrepancyNote`, `matchStatus`, `invoiceNo`, `invoiceDate`)
— hiçbir snake_case karşılığı yok. Ama `frontend-react/PurchasingView.jsx`
`renderInvoices()` tedarikçi adını `r.supplier_name || r.supplierName`,
fark notunu `r.discrepancy_note` ile okuyordu — ikisi de gerçek `supplier`/
`discrepancyNote` alanlarıyla hiç eşleşmiyordu. (Durum rozeti doğru
çalışıyordu çünkü `match_status || matchStatus` her iki olası adı da
kapsıyordu — bu yüzden hata daha önce fark edilmemişti, tablo "çalışıyor
gibi" görünüyordu.) Tüm sütunlar gerçek API alan adlarına (`invoiceNo`,
`supplier`, `invoiceDate`, `matchStatus`, `discrepancyNote`) göre
düzeltildi.

`test/e2e-browser/purchasing-invoices.spec.js` (yeni): gerçek bir fatura
girilip satırın "SafeGuard GmbH" VE "teslim alınan..." fark metnini
gerçekten içerdiğini kanıtlıyor.

**Doğrulama:** `npm run typecheck`/`lint`/`build` temiz. `npx playwright
test` → 15/15 geçti (yeni test dahil). `node test/run-all.js` → 29/29
suite geçti. Gerçek tarayıcıda önce bozuk hali ("—" ve boş fark sütunu),
sonra düzeltilmiş hali ekran/DOM içeriğiyle doğrulandı.

**Bu turun geri kalanı devam ediyor** — Satış (6 sekme), Kalite (6 sekme),
CRM/Fırsatlar, Destek, Planlama (5 sekme), Raporlar (10 sekme), Yönetim
(11 sekme) ve Depo Terminali'nin her düğmesi/diyaloğu sırayla test
edilecek.

## 2026-09-14 (devam 19) — İKİNCİ KRİTİK BULGU: Teklif karşılaştırma raporu hiç çalışmıyordu

Aynı sistematik "her butonu dene" turunda, Satın Alma > Tedarikçiler
sekmesinin tam CRUD döngüsü (oluştur/düzenle/sil — hepsi doğru çalışıyor)
doğrulandıktan sonra Talepler sekmesi test edildi (Yeni Talep — çoklu kalem
—, Onayla, Reddet — hepsi doğru çalışıyor). Ardından Teklifler (RFQ)
sekmesinde **aynı hata sınıfının ikinci örneği** bulundu:

`GET /api/purchasing/rfqs/:id/compare` (`server/routes/purchasing.js`)
satır bazlı iç içe bir yapı döner: `{ rfqNo, lines: [{ itemName,
quotes: [{supplier, unitPrice, ...}], best }] }` — düz bir
"comparison"/"quotes"/"data" alanı hiç yok. Ama
`frontend-react/PurchasingView.jsx`'teki `compareDialog()` tam olarak bu üç
hiç var olmayan alanı okumaya çalışıyordu (`cmp.comparison || cmp.quotes ||
cmp.data || []`) — sonuç: "Teklifleri Karşılaştır" diyaloğu, seed verisinde
**3 gerçek teklifi olan bir RFQ için bile** her zaman "Kayıt bulunamadı"
gösteriyordu. Doğrudan `Invoke-RestMethod`/network-log ile API'nin gerçek
veriyi (3 tedarikçi, fiyat, teslim süresi, en iyi fiyat) döndürdüğü
kanıtlandıktan sonra `compareDialog()` gerçek `lines[].quotes[]` yapısını
düzleştirip doğru render edecek şekilde yeniden yazıldı.

Ayrıca fark edilen küçük bir tutarsızlık da düzeltildi: `server/seed.js`
RFQ seed kaydına elle `'TKL-2026-001'` yazılmış, ama gerçek numaralandırma
mantığı (`nextNumber('rfq', 'TEK')`) her zaman `TEK-` öneki üretiyor —
seed verisi artık gerçek koddan üretilecek numarayla tutarlı
(`TEK-2026-001`).

`test/e2e-browser/purchasing-compare-quotes.spec.js` (yeni): TEK-2026-001
RFQ'sunun karşılaştırma modalının gerçekten 3 tedarikçi adını, doğru
fiyatı VE "En iyi fiyat" rozetini içerdiğini, "Kayıt bulunamadı"
içermediğini kanıtlıyor.

**Doğrulama:** `npm run typecheck`/`lint`/`build` temiz. `npx playwright
test` → 14/14 geçti (yeni test dahil). `node test/run-all.js` → 29/29
suite geçti. Gerçek tarayıcıda önce bozuk hali ("Kayıt bulunamadı"),
sonra düzeltilmiş hali (3 satır + en iyi fiyat rozeti) ekran görüntüsüyle
doğrulandı.

**Bu turun geri kalanı devam ediyor** — Satın Alma > Faturalar sekmesi ve
Satış, Kalite, CRM, Destek, Planlama, Raporlar, Yönetim, Depo Terminali
modüllerinin her düğmesi/diyaloğu sırayla test edilecek.

## 2026-09-14 (devam 18) — KRİTİK: İzlenebilirlik/geri çağırma raporu hiç çalışmıyordu (`f9144ce`)

Kullanıcı "çok daha uzun, sistematik bir tur yap — test etmediğin en ufak
bir buton/özellik kalmasın" dedi. Bu turda bulunan **oturumun en ciddi
hatası**: Partiler/Lotlar ekranındaki İzlenebilirlik diyaloğu — kalite/geri
çağırma soruşturmaları için kritik bir özellik — **gerçekte hiçbir zaman
doğru çalışmamış**.

`server/services/traceability.js` düz (flat) nesneler dönüyor
(`itemName`/`lotNo`/`usedIn`/`shippedTo` hep KÖKTE), ama
`frontend-react/LotsView.jsx` bunları hiç var olmayan alan adlarıyla
(`.lot`, `usedInProduction`, `shipments`, `customerName`, `children`)
okumaya çalışıyordu. Sonuç: başlık HER ZAMAN boş ("—"), ileriye izleme HER
ZAMAN "kayıt yok", geri çağırma raporunda etkilenen müşterinin adı/sevkiyat
no'su/tarihi/varış noktası HER ZAMAN "—" gösteriyordu — gerçek veri olsa
bile. Bu, özellik yalnızca geçmişi olmayan partilerle test edildiğinde
"çalışıyor gibi" göründüğü için hiç fark edilmemişti (boş durumlar makul
görünüyordu).

Gerçek, üretilmiş VE sevk edilmiş bir parti (seed'deki `PARTI-SET-0901`)
ile canlı test edilip tüm alan adı uyuşmazlıkları düzeltildi. Bu sınıf bir
hatayı (veri var ama render edilmiyor) yalnızca gerçek DOM içeriğini
kontrol eden bir test yakalayabildiği için `test/e2e-browser/
lots-traceability.spec.js` (yeni) eklendi — modalın gerçekten "Elektrik
Bağlantı Seti", "SVK-2026-001", "Anadolu Makine A.Ş." içerdiğini VE "kayıt
yok" içermediğini kanıtlıyor.

**Doğrulama:** `npm run typecheck`/`lint`/`build` temiz. `npx playwright
test` → 13/13 geçti (yeni test dahil). `node test/run-all.js` → 28/28
suite geçti. Gerçek tarayıcıda önce bozuk hali (ekran görüntüsüyle),
sonra düzeltilmiş hali ayrıca doğrulandı.

**Bu turun geri kalanı devam ediyor** — Ürünler modülü (oluştur/düzenle/
BOM/stok girişi/etiket/silme-engeli/barkod) tam test edildi, Partiler/
Lotlar devam ediyor; Sayım, Üretim, Satın Alma, Satış, Kalite, CRM,
Destek, Planlama, Raporlar, Yönetim ve Depo Terminali'nin her düğmesi/
diyaloğu sırayla test edilecek.

## 2026-09-14 (devam 17) — Kapsamlı UI denetimi: kırık bir endpoint + 15 yerde ham/yanlış metin (`37a3623`)

Kullanıcı "programın tüm sayfalarını ve butonları test et, boşluğa giden
veya yanlış ilan yapan sayfa ya da buton olmasın" dedi. Önce mevcut
otomatik testler (`test/ui-smoke.js` 100 test, Playwright
`test/e2e-browser` 12 test) baseline olarak çalıştırıldı, ikisi de tam
geçti. Ardından uygulamanın **tüm ekranları** (Panel, Ürünler, Partiler,
Sayım, Üretim, Satın Alma [5 sekme], Satış [6 sekme], Kalite [6 sekme],
Fırsatlar, Destek, Planlama [5 sekme], Raporlar [10 sekme], Yönetim
[11 sekme], Depo Terminali) gerçek bir tarayıcıda tek tek gezildi — her
ekranın içerik getirip getirmediği, ana diyalogların açılıp açılmadığı ve
konsolda hata olup olmadığı kontrol edildi.

**1. Kırık bir endpoint (gerçek işlevsel hata).** "Yeni Üretim Emri"
diyaloğundaki canlı bileşen önizlemesi (`GET /production/
requirements-preview`) sunucuda **hiç yoktu** — Express bunu `/:id`
rotasına düşürüp "Üretim emri bulunamadı" hatası dönüyordu. Kullanıcı her
yeni üretim emri oluştururken reçetenin ihtiyaç duyacağı bileşenleri ve
stok yeterliliğini **hiç görmeden** kaydediyordu. `server/routes/
production.js`'e gerçek route eklendi (mevcut `resolveComponents()`/
`stock.availableQty()` kullanılarak, `/:id`'den ÖNCE tanımlanarak — route
sırası kritik). `test/e2e.js`'teki daha önce hiç assert edilmeyen
(eslint'in işaretlediği kullanılmayan `reqs` değişkeni) çağrıya gerçek
doğrulama eklendi.

**2. Ham/yanlış metin gösteren 15+ yer.** Aynı "enum değeri hiç tercüme
edilmeden ekrana basılıyor" hata sınıfı tekrar tekrar bulundu: Satın
Alma > Talepler/Teklifler durum sütunları, Veri Sağlığı kayıt birleştirme
seçici, Satış > Faturalar durum sütunu, Kalite > Uygunsuzluklar "KAYNAK"
sütunu (liste+detay), Kalite > DÖF/CAPA detay modalı, Sayım detay modalı
(bonus bulgu: `modal()`'ın `sub` alanı `esc()`lendiği için oraya HTML
badge koymak sessizce bozuk render üretirdi — düzeltme rozeti gövdeye
taşıdı), Raporlar > Kalite KPI + Özel Rapor "Hareket tipi" filtresi,
Planlama > Tatil durum sütunu, Yönetim > Onay/Bildirim Kuralları
(BELGE+KANAL), Muhasebe Aktarımı KALEM sütunu, Denetim Kaydı KAYIT
sütunu+filtresi. Her biri kendi dosyasında, aynı kod tabanının zaten
kullandığı `xStatusBadge()` deseniyle düzeltildi.

**En ciddi bulgu — gerçek bir "yanlış ilan":** Webhook'lar sekmesindeki
açıklama metni "Otomatik yeniden deneme yoktur" diyordu. Bu metin
webhook'lara otomatik yeniden deneme kuyruğu eklenmeden ÖNCE (Aşama 5)
yazılmıştı; özellik daha sonra (devam 6 turunda) eklendiğinde bu metin
hiç güncellenmemişti. Bir kullanıcı bu yanlış bilgiye güvenip webhook
başarısızlıklarını gereksiz yere elle takip etmeye devam edebilirdi.
Artık gerçek davranışı (üstel artan aralıklarla en fazla 5 otomatik
deneme) doğru anlatıyor.

**3. Denetim Kaydı ekranında 21 EKSİK çeviri anahtarı.** Bir alt-agent
kullanılarak `server/`'daki TÜM `logAudit()` çağrıları (119 farklı
anahtar) `i18n.js` ile karşılaştırıldı. CRM (fırsat), Webhook, Saha
Ziyareti, Destek Talebi, Muhasebe Aktarımı, Kayıtlı Rapor ve başarısız
giriş denemesi özellikleri eklenirken hiç i18n girişi eklenmemiş —
Denetim Kaydı'nda bu işlemler `auditOpportunityConvert` gibi **çeviri
anahtarının kendisi** olarak görünüyordu. 21 eksik anahtar eklendi, ayrıca
sunucu tarafıyla ismi uyuşmayan 4 anahtar düzeltildi (`auditCountCreate`→
`auditCountOpen`, `auditReturnAdd`→`auditSupplierReturn`,
`auditCalibrationAdd`→`auditCalibration`, `auditPasswordChange`→
`auditPasswordChanged`) — hepsi hem TR hem EN için.

**Bilinçli olarak dokunulmayan (gerçek bir hata değil):** Webhook "Yeni
Webhook" diyaloğundaki olay adları (`purchase_order.created` vb.) kasıtlı
olarak ham/teknik bırakıldı — bu, GitHub/Stripe tarzı entegrasyon
özellikleri için standart pratik, geliştirici kendi alıcı kodunda TAM BU
dizeyi eşleştirmek zorunda.

**Doğrulama:** `npm run typecheck`/`lint`/`build` temiz. `node
test/run-all.js` → 28/28 suite geçti. `npx playwright test` → 12/12
geçti. Her düzeltme gerçek tarayıcıda önce hatalı haliyle görülüp, kod
değişikliğinden sonra sunucu yeniden başlatılarak düzeldiği ekran
görüntüsü/metinle kanıtlandı — yalnızca kod okunarak değil.

## 2026-09-14 (devam 16) — SRI eklendi + kırık Chart.js sürümü bulundu ve düzeltildi (`99526d8`)

Kullanıcı ısrarla "başka yapabileceğin güvenlik testi kaldı mı" diye
sormaya devam etti. Bu turda **iki farklı, gerçek sorun** bulundu:

**1. CDN kaynaklarında Subresource Integrity (SRI) yoktu.** `index.html`
(Chart.js) ve `api-docs.html` (Swagger UI CSS+JS) — CDN'den yüklenen 3
dosyanın hiçbirinde `integrity` özniteliği yoktu. CDN bir gün tehlikeye
girerse tarayıcı hiçbir kontrol yapmadan enjekte edilen kodu çalıştırırdı.
Her üç dosya için gerçek içerik indirilip SHA-384 hash'i hesaplandı,
`integrity`+`crossorigin` eklendi. Google Fonts linkine bilinçli olarak
eklenmedi — Google'ın fontlar API'si tarayıcıya göre farklı CSS döndürüyor,
SRI ile yapısal olarak uyumsuz (Google'ın kendi önerisi).

**2. Bu kontrol sırasında GERÇEK, güvenlikle ilgisiz ama ciddi bir
fonksiyonel hata ortaya çıktı:** `index.html`'deki Chart.js sürümü
(**4.4.4**) cdnjs'te **hiç var olmayan bir sürümdü** — gerçek bir istekle
404 döndüğü doğrulandı (cdnjs'in kendi API'si de bu sürümün hiç
yayınlanmadığını teyit etti). Bu, panodaki/raporlardaki grafiklerin
**gerçek tarayıcılarda hiç yüklenmediği** anlamına geliyordu — sessiz bir
kırılma, hiçbir test bunu yakalamıyordu çünkü mevcut testler CDN
URL'lerinin gerçekten erişilebilir olduğunu hiç doğrulamıyordu. En yakın
var olan sürüm olan **4.4.1**'e düzeltildi.

`test/security.js`'e yeni bir "DIŞ KAYNAK BÜTÜNLÜĞÜ" bölümü eklendi:
her cdnjs referansı için (1) integrity taşıdığı statik olarak, (2) URL'in
GERÇEKTEN 200 döndüğü CANLI bir istekle doğrulanıyor — tam da bu turda
bulunan "yanlış sürüm numarası → sessiz 404" sınıfındaki hatayı bir daha
otomatik yakalayacak şekilde.

**Doğrulama:** `npm run typecheck`/`lint`/`build` temiz. `node
test/run-all.js` → 28/28 suite geçti (`security.js` kendi içinde 66/66,
yeni 6 SRI testi dahil).

## 2026-09-14 (devam 15) — Güvenlik denetiminin son turu: git geçmişi + JWT algoritma sınırlaması (`0174fb4`)

Kullanıcı üçüncü kez "başka yapabileceğin güvenlik testi kaldı mı" diye
sordu. Bu turda ŞU ANA KADAR YAPILMAMIŞ iki farklı kontrol yapıldı:

1. **Git geçmişinin tamamı (80 commit) taranıp** yanlışlıkla eklenmiş bir
   sır/anahtar dosyası (`.env`/`.pem`/`.key`) veya gömülü bir secret
   (JWT_SECRET'a gerçek değer, özel anahtar başlığı, AWS erişim anahtarı
   deseni) arandı — önceki tüm taramalar yalnızca ŞU ANKİ dosya içeriğine
   bakıyordu, geçmişe değil. **Temiz** — hiçbir commit'te sızıntı yok.
2. **`jwt.verify()` izin verilen algoritmayı açıkça sınırlamıyordu
   (DÜŞÜK, teorik).** `algorithms` seçeneği verilmezse kütüphane, gizli
   anahtarın TÜM HMAC ailesini (HS256/384/512) kabul eder. Gerçek bir
   istismar yolu YOK (klasik RS256/HS256 "algorithm confusion" saldırısı
   bir açık anahtar gerektirir, bu sistemde hiç asimetrik anahtar yok)
   ama savunma derinliği için ucuz/risksiz: `{ algorithms: ['HS256'] }`
   eklendi.

Ayrıca webhook HMAC imzasının yalnızca DIŞARI gönderildiği, hiçbir uç
noktanın gelen bir imzayı karşılaştırmadığı (GİB durumu push değil poll
ile çalışıyor) doğrulandı — zamanlama saldırısı yüzeyi hiç yok.

**Doğrulama:** `npm run typecheck`/`lint` temiz. `node test/run-all.js`
→ 28/28 suite geçti (mevcut "alg:none reddediliyor" testi dahil, regresyon
yok).

**Bu, güvenlik denetiminin SON turu olarak kullanıcıya bildirildi.** Kod
seviyesinde pratik olarak yapılabilecek testler tüketildi: kimlik
doğrulama/yetkilendirme, enjeksiyon sınıfları (SQL/komut/XXE/SSTI/CSV),
XSS, dosya yükleme, oturum yönetimi, sırlar (kod + git geçmişi), güvenlik
başlıkları, rate-limit atlatma, mass assignment, ReDoS, JWT algoritma
karışıklığı. Geriye kalanlar bu ortamda YAPILAMAZ: gerçek ağ/TLS sızma
testi, ölçekte DoS dayanıklılığı, bağımlılık karışıklığı saldırıları,
fiziksel/sosyal mühendislik — bağımsız bir sızma testi önerisi geçerliliğini
koruyor.

## 2026-09-14 (devam 14) — CSV/formül enjeksiyonu kapatıldı (`b147308`)

Kullanıcı "başka yapabileceğin güvenlik testi var mı" diye sordu. Ek bir
tarama yapıldı: Zod şemalarındaki `.passthrough()` kullanımları (yalnızca
salt-okunur sorgu filtrelerinde, hiçbir yazma yolunda değil — mass
assignment riski yok), şablon/belge render motoru (`eval`/`new Function`/
`vm` hiç kullanılmıyor — SSTI riski yok), ReDoS'a açık düzenli ifade
deseni arandı (bulunmadı, tüm serbest metin alanları zaten Zod ile
uzunluk sınırlı).

**Bulunan gerçek açık:** `public/js/ui.js`'teki `UI.exportCsv()` — TÜM CSV
dışa aktarım butonlarının (Ürünler, Partiler, Kullanıcılar, Raporlar,
Denetim Kaydı, Muhasebe Aktarımı) kullandığı tek paylaşılan fonksiyon —
yalnızca çift tırnakları kaçışlıyordu, hücre değerinin `=`/`+`/`-`/`@` ile
başladığı durumu hiç ele almıyordu (OWASP "CSV Injection"). Bir müşteri/
ürün adı `=HYPERLINK("http://evil.com",...)` gibi ayarlanırsa, CSV
Excel/Sheets'te açıldığında hücre metin değil FORMÜL olarak çalışır —
veri sızıntısı veya (eski Excel'lerde DDE ile) komut çalıştırma riski.
Düzeltme: değer tehlikeli bir karakterle başlıyorsa başına tek tırnak (`'`)
ekleniyor (Excel/Sheets'in "zorla metin" kuralı) — görünen değer
değişmiyor, formül olarak yorumlanması engelleniyor. Tek fonksiyondaki
düzeltme uygulamadaki TÜM CSV dışa aktarımlarını aynı anda kapatıyor.

`test/security.js`'e gerçek davranışsal test eklendi: jsdom'da
`UI.exportCsv` 5 farklı formül payload'ıyla çağrılıyor, `Blob`
constructor'ı mock'lanarak üretilen CSV içeriği yakalanıyor, hiçbirinin
ham formül karakteriyle kalmadığı kanıtlanıyor.

**Doğrulama:** `npm run typecheck`/`lint`/`build` temiz. `node
test/run-all.js` → 28/28 suite geçti (`security.js` kendi içinde 60/60).

**Kullanıcıya verilen nihai değerlendirme:** kod seviyesinde pratik olarak
yapılabilecek güvenlik testleri (kimlik doğrulama/yetkilendirme, enjeksiyon
sınıfları — SQL/komut/XXE/SSTI/CSV, XSS, dosya yükleme, oturum yönetimi,
sırlar, güvenlik başlıkları, rate-limit atlatma, CSRF, mass assignment,
ReDoS) tüketildi. Geriye kalanlar bu ortamda YAPILAMAZ: gerçek bir ağ/TLS
sızma testi, ölçekte DoS dayanıklılığı, bağımlılık karışıklığı (dependency
confusion) saldırıları, fiziksel/sosyal mühendislik faktörleri — bunlar
özel araç/ortam gerektirir, canlıya almadan önce bağımsız bir sızma testi
önerisi geçerliliğini koruyor.

## 2026-09-14 (devam 13) — Kapsamlı güvenlik denetimi (`9333dcf`)

Kullanıcı "sistemi tüm güvenlik testleriyle test et, güvenli olduğuna emin
olmak istiyorum" dedi. Mevcut `test/security.js` (59 test) ve
`test/multitenancy.js` (148 test) baseline olarak çalıştırıldı (ikisi de
tam geçti), `npm audit` temiz (0 zafiyet). Ardından otomatik testlerin
kapsamadığı alanlar elle tarandı: route bazında yetki kontrolü kapsamı
(24 route dosyasının 22'si `requireAuth` kullanıyor — eksik 2'si kasıtlı
olarak herkese açık: `auth.js` giriş, `docs.js` OpenAPI şeması), tüm SQL
string enterpolasyonları (data-health.js birleştirme/import-commit.js
toplu silme — hepsi sabit sunucu tanımlı tablo/sütun haritalarından
geliyor, gerçek enjeksiyon yolu yok), komut enjeksiyonu (tek
`child_process.exec` çağrısı yalnızca operatörün kendi ortam
değişkeninden), XXE (libxmljs2 yalnızca kendi ürettiğimiz XML'i
ayrıştırıyor), CORS/güvenlik başlıkları/rate limiting yapılandırması.

**Bulunan ve düzeltilen 2 gerçek açık:**

1. **JWT_SECRET üretimde zorunlu değildi (YÜKSEK).** `middleware/auth.js`
   `JWT_SECRET` tanımlı değilse herkesçe bilinen sabit bir değere
   (`depo-takip-dev-secret-change-me`) sessizce düşüyordu.
   `docker-compose.yml` bunu kendi `${JWT_SECRET:?...}` sözdizimiyle
   zorunlu kılıyordu ama `docs/KURULUM.md`'deki elle kurulum yolunda
   hiçbir kod denetimi yoktu — biri `.env` oluşturmayı unutursa sunucu
   sessizce açılır ve bu GitHub deposunda görülebilir varsayılan
   anahtarla imzalanmış GEÇERLİ admin token'ları üretilebilir hale
   gelirdi. `server/index.js`'e "boş veritabanı"/lisans kontrolüyle AYNI
   desende bir kontrol eklendi: `NODE_ENV=production` VE `JWT_SECRET`
   tanımsızsa sunucu açılmayı reddediyor. `test/security.js`'e gerçek
   davranışsal test eklendi (ayrı bir sunucu süreci gerçekten bu
   koşullarla başlatılıp çıkış kodu 1 ile reddedildiği kanıtlanıyor —
   eskiden yalnızca zayıf bir statik regex kontrolü vardı).

2. **nginx referans yapılandırması X-Forwarded-For'u EKLİYORDU,
   DEĞİŞTİRMİYORDU (ORTA).** `docker-compose.yml`'de nginx internete açık
   TEK kenar. `nginx.conf`'taki `$proxy_add_x_forwarded_for` istemcinin
   gönderdiği sahte bir X-Forwarded-For değerini koruyup sonuna kendi
   gördüğü IP'yi ekliyordu; `server/index.js`'teki `trust proxy: 1` ile
   birleşince Express bu sahte değeri `req.ip` olarak güvenilir kabul
   ediyordu — bir saldırgan bu başlığı her istekte değiştirerek giriş
   kaba-kuvvet kilidini VE genel API hız sınırlayıcısını (300/dk)
   tamamen atlatabilirdi. Düzeltme: `X-Forwarded-For $remote_addr` —
   istemcinin gönderdiği değer tamamen atılıyor.

Ayrıca küçük bir tutarsızlık: `auth.js`'teki kendi-kendine şifre
değiştirme bcrypt maliyeti 10 kullanıyordu, admin tarafı 12 — eşitlendi.

**İncelenip gerçek bir açığa yol açmadığı doğrulanan, kod değişikliği
gerektirmeyen alanlar (dokümante edildi, sessizce atlanmadı):** SSRF
(webhook URL'leri/etiket yazıcısı IP'si admin tarafından yapılandırılıyor,
iç ağ/bulut metadata uç noktalarına karşı denylist yok — ciddiyeti düşük
çünkü zaten yalnızca admin rolüne açık, ayrı bir mühendislik kararı
gerektiriyor); e-Fatura entegratör API anahtarının düz metin saklanması —
bu, kullanıcıyla bu oturumda ayrıca tartışılıp ERTELENMESİ onaylanan
TCKN/banka bilgisi alan-bazlı şifreleme kararıyla aynı kapsamda, yeni bir
bulgu değil.

**Doğrulama:** `npm run typecheck`/`lint`/`build` temiz. `node
test/run-all.js` → **28/28 suite geçti** (güncellenen `security.js` kendi
içinde 59/59). `npm audit` → 0 zafiyet.

## 2026-09-13 (devam 12) — KVKK sıfır-eksik: anonimleştirme, veri raporu, saklama süresi taraması (`b1d82bb`)

"kapatılabilir olanların tümünü kapatalım eksik kalmasın" talimatının KVKK
kısmı tamamlandı — `docs/KVKK-DEGERLENDIRME.md`'de tespit edilen 4 maddeden
3'ü kapatıldı (4. madde — alan bazlı şifreleme — bilinçli olarak ayrı bir
oturuma bırakıldı, aşağıda gerekçesiyle).

**1. Geri döndürülemez anonimleştirme (KVKK m.7).** `server/lib/kvkk.js`
(yeni): müşteri/tedarikçi/kullanıcı için `anonymizeCustomer/Supplier/User` —
ad, iletişim, VKN/TCKN, banka bilgisi kalıcı olarak silinir; sipariş/fatura
**geçmişi (tutar/tarih) korunur**. Geçmiş e-Belge XML'leri üretim anındaki
bir kopyayı zaten kendi içinde taşıdığı için (bkz. e-Fatura turundaki
`e_documents.xml` — hiç purge edilmiyor) bu işlem VUK'un 10 yıllık belge
saklama zorunluluğunu ihlal etmiyor. Yeni route'lar (`POST .../:id/anonymize`)
**yalnızca admin** — manager bile yetkili değil, geri dönüşü olmadığı için.
İkinci çağrı 409 döner (idempotency değil, kalıcı durum değişikliği —
tekrar denenemez). Kendi hesabını veya son yönetici hesabını anonimleştirme
reddediliyor. Migration 016: `customers`/`suppliers`'a `deactivated_at` +
`anonymized_at`, `users`'a `anonymized_at`.

**2. "Hangi veri tutuluyor" raporu (KVKK m.11/b).** Aynı dosyada
`exportCustomerData/SupplierData/UserData` — kimlik verisi + ilgili
sipariş/fatura/e-Belge/destek talebi/ziyaret/fırsat/denetim kaydı özeti.
`GET .../:id/data-export` (admin) — arayüzde JSON dosyası olarak indiriliyor
(`UI.downloadJson()`, yeni — `exportCsv` ile aynı Blob deseni).

**3. Saklama süresi taraması (KVKK — "ilişkisi sona eren veri N yıl sonra
anonimleştirilir").** `server/services/data-retention.js` (yeni):
`webhooks.js`/`notifications.js` ile AYNI `setInterval` + `try/catch`
zamanlayıcı deseni. **Varsayılan olarak KAPALI** (`kvkkAutoAnonymizeEnabled`
ayarı, varsayılan `'0'`) — otomatik, geri dönüşü olmayan bir silme işlemini
varsayılan olarak açık bırakmak güvensiz bir varsayılan olurdu (CLAUDE.md
§26). Yalnızca müşteri/tedarikçi (iş ortağı) verisini kapsıyor —
**kullanıcı/çalışan kayıtları kasıtlı olarak dışında**: bir çalışanın ne
zaman anonimleştirileceği İK politikası gerektirir, bu proje İK/bordroya
hiç girmiyor (bkz. standing constraint). Admin > Ayarlar'a "KVKK Saklama
Politikası" kartı eklendi (saklama yılı + anahtar + "şimdi çalıştır").

**Gerçek bulunan hata (test sırasında yakalandı):** `runRetentionSweep()`
ilk yazımda `Number(getSetting(...)) || 10` kullanıyordu — saklama süresi
**0** yıl olarak ayarlandığında (test senaryosu: "hemen anonimleştir")
`0 || 10` JavaScript'te `10`'a değerleniyor, yani 0 hiçbir zaman gerçek bir
değer olarak kullanılamıyordu. `test/kvkk.js`'in retention testi bunu
YAKALADI (0 yıl ayarlanınca hiçbir şey anonimleşmedi); `Number.isFinite`
kontrolüyle düzeltildi.

**Doğrulama:** `npm run typecheck`/`lint`/`build` temiz. `test/kvkk.js`
(yeni, 39 test). `node test/run-all.js` → **28/28 suite geçti**. Gerçek
tarayıcıda doğrulandı: müşteri anonimleştirme (liste görünümünden
kayboluyor, `is_active=0`) + veri dışa aktarım (200, JSON indirildi),
Admin > Kullanıcılar'daki KVKK butonları, Ayarlar'daki saklama kartı ve
"şimdi çalıştır" butonunun gerçekten `POST /api/data-retention/run`'ı
tetiklediği.

**Bilinçli olarak dışarıda bırakılan (KVKK-DEGERLENDIRME.md §3.3):**
veritabanı/yedeklerin "at rest" şifrelenmesi (TCKN/banka bilgisi için alan
bazlı şifreleme) — kod incelemesi şunu gösterdi: `tax_no` alanı
`data-health.js`'de SQL `GROUP BY tax_no` ile mükerrer VKN taraması için
kullanılıyor, `einvoice.js`/`ubl.js` e-Fatura XML'i için düz metin VKN
gerektiriyor, `import-commit.js` toplu içe aktarımda okuyup yazıyor —
rastgele IV'li standart şifreleme bu üç noktayı gerçek bir riskle
(mükerrer tespitinin bozulması, e-Belge'ye şifreli veri sızması) kırar.
Bu, "değerlendir" değil şimdi "kapat" kapsamında bile ayrı, dikkatli bir
mühendislik geçişi (uygulama katmanında şifrele/çöz sarmalayıcı + en az
3 dosyanın okuma yollarının güncellenmesi) gerektiriyor — sessizce
atlanmadı, burada kayda geçirilip kullanıcıya bildirilecek.

## 2026-09-13 (devam 11) — e-Fatura sıfır-eksik: GİB resmi şema doğrulaması + iade izlenebilirliği (`212aabb`)

Destek/Saha Ziyaret modüllerinden sonra kullanıcı sordu: "e-Fatura ve KVKK
alanlarını nasıl sıfır eksik olacak şekilde toplayabiliriz". Yaptığım
ayrımda 7 madde "kapatılabilir" (kod ile tamamen kapatılabilir, entegratör
hesabı/avukat gerektirmez) olarak işaretlendi; kullanıcı **"kapatılabilir
olanların tümünü kapatalım eksik kalmasın"** dedi. Bu commit e-Fatura'nın
3 maddesini kapatıyor (KVKK'nın 4 maddesi henüz YAPILMADI — bkz. Pending).

**Kullanıcıdan açık indirme onayı alındı** ("evet indir") — GİB'in resmi
e-Belge portalından UBL-TR 1.2.1 şema paketi (`UBL-TR1.2.1_Paketi.zip`)
indirildi, `xsdrt/` altındaki maindoc+common XSD'leri (19 dosya)
`server/lib/ubl-schema/`'ya kopyalandı.

**1. Gerçek GİB XSD şemasına karşı doğrulama.** Şimdiye kadar üretilen
e-Fatura/e-Arşiv/e-İrsaliye XML'i HİÇBİR ZAMAN gerçek devlet şemasına karşı
doğrulanmamıştı — yalnızca kendi iç alan-bazlı kontrolümüz (`validateInvoiceInput`)
vardı. `server/lib/ubl-validate.js` (yeni, `libxmljs2` sarmalayıcı) her
üretilen belgeyi gerçek şemaya karşı doğruluyor; `server/services/einvoice.js`
artık `assertSchemaValid()` çağırıyor — şemaya uymayan belge ASLA
üretilmiyor (422 ile net hata). Doğrulama sessizce atlanmıyor: ikili
kurulu değilse 500 + açık neden döner.

Gerçek şemaya karşı doğrulama, `server/lib/ubl.js`'de daha önce fark
edilmemiş **7 gerçek yapısal hata** ortaya çıkardı (GİB'in resmi
`TicariFaturaOrnegi.xml`/`IadeFaturasiOrnegi.xml`/`Irsaliye-Ornek1.xml`
örnekleriyle karşılaştırılarak, XSD `xsd:sequence` tanımları okunarak
düzeltildi): eksik `ext:UBLExtensions`, eksik `cac:Signature`, yanlış
sırada `PricingExchangeRate`, ters `Country` (IdentificationCode/Name)
sırası, eksik `CitySubdivisionName` (DeliveryAddress), ters
`ShipmentStage`/`Delivery` sırası, eksik `FamilyName` (DriverPerson).
Bunlar gerçek dünyada bir entegratör/GİB tarafından reddedilmeye yol
açabilecek kusurlardı.

**2. İade faturası (İADE) ↔ orijinal fatura izlenebilirliği.** GİB'in
resmi `IadeFaturasiOrnegi.xml`'i, iade faturasının `cac:BillingReference`
ile orijinal faturaya (belge no + tarih) referans vermesi gerektiğini
gösterdi. Migration 015: `customer_invoices.original_invoice_id`.
`server/routes/sales.js`: `invoiceType==='iade'` iken `originalInvoiceId`
zorunlu, aynı müşteriye ait olması doğrulanıyor (422/404). `einvoice.js`:
orijinal faturanın kendi e-Belge kaydından belge no/tarih çekiliyor
(henüz e-Belge yoksa BillingReference sessizce atlanıyor, hata değil).
**Bilinçli kapsam kararı:** `frontend-react/SalesView.jsx`'e iade
faturası oluşturmak için özel bir UI eklenmedi — backend tam kapalı ve
test edilmiş durumda, UI kapsam dışı bırakıldı (istenirse ayrı bir adımda
eklenebilir).

**3. 10 yıllık saklama.** Kod incelemesiyle kapatıldı (yeni kod değil):
e-Belge XML'i `e_documents.xml` sütununda satır içi saklanıyor, hiçbir
temizleme/silme rotası yok — saklama yapısal olarak zaten sağlanıyor.
`docs/KURULUM.md`'ye gelecekteki bakımcılar için açık bir uyarı eklendi:
bu tabloyu etkileyen bir temizleme işi ASLA eklenmemeli.

**Yan konu — `.npmrc` `ignore-scripts=true` çakışması:** bu ayar (önceki
oturumda better-sqlite3/node-gyp CI hatası için eklenmişti) libxmljs2'nin
KENDİ native kurulum script'ini de engelliyor. Otomatik lifecycle hook
yerine `package.json`'a açık `"native:rebuild"` script'i eklendi, CI/
Dockerfile/docs/KURULUM.md'ye açık bir kurulum adımı olarak eklendi
(`ignore-scripts`, elle çağrılan `npm run <ad>` script'lerini engellemiyor,
yalnızca otomatik lifecycle hook'ları).

**Doğrulama:** `npm run typecheck`/`lint`/`build` temiz. `node
test/run-all.js` → **27/27 paket geçti**. `test/einvoice.js` özelinde
93/93 (GİB şemasına karşı doğrulama testleri + iade faturası için 7 yeni
test: eksik orijinal reddi, farklı müşteri reddi, başarılı oluşturma,
BillingReference doğruluğu, şema geçerliliği). Commit `212aabb`, push
edildi (`origin/main`).

**Sırada:** KVKK'nın 4 kapatılabilir maddesi henüz YAPILMADI: (1) müşteri/
kullanıcı için veri anonimleştirme özelliği, (2) "bu kişi hakkında hangi
veriyi tutuyoruz" dışa aktarım raporu (KVKK m.11), (3) saklama süresi
arka plan işi, (4) hassas alanlar (TCKN, banka bilgisi) için alan bazlı
şifreleme.

**Standing constraint (kalıcı, unutulmamalı):** kullanıcı muhasebe/İK-
bordro/pazarlama modüllerini KESİN OLARAK reddetti — sürekli mevzuat
takibi ve hukuki/mali sorumluluk istemiyor. Bu proje ömrü boyunca geçerli.

## 2026-09-13 (devam 10) — Müşteri Destek + Saha Ziyaret modülleri (`1361fce`)

"ERP+CRM'i tam kapsıyor mu" sorusuna verdiğim değerlendirmede eksik
bulunan 5 alandan (muhasebe, İK/bordro, pazarlama, destek/ticket, saha
ziyaret) kullanıcı yalnızca son ikisini istedi — "bu programda devamlı
mevzuat takibi ve hukuki/mali sorumluluk istemiyorum" diyerek muhasebe/
İK/pazarlamayı **kesin olarak reddetti**. İki modül eklendi:

**Müşteri Destek (ticket)** — Kalite modülündeki NCR akışından KASITLI
olarak ayrı (NCR ürün kusurunun kök nedenini takip eder, ticket müşteri
iletişimini/çözüm süresini takip eder). Durum makinesi: open →
in_progress/waiting_customer → resolved (çözüm açıklaması zorunlu) →
closed (yeniden açılamaz). Şikayet kategorisindeki ve kayıtlı müşterisi
olan talepler "Uygunsuzluğa Dönüştür" ile tek adımda gerçek bir NCR
kaydına dönüşür (`ncrs.source='customer'` — şemada zaten vardı).

**Saha Ziyaret Takibi** — CRM/Fırsatlar ekranına üçüncü sekme olarak
eklendi (ayrı bir üst menü yerine — fırsatlarla doğal ilişkisi
nedeniyle). Tarayıcı Geolocation API'siyle isteğe bağlı konum yakalama;
izin reddedilirse ziyaret yine de kaydedilir.

Her iki modül de mevcut CRM (`server/routes/crm.js`) ve Kalite
(`server/routes/quality.js`) ile AYNI kod desenlerini kullanıyor — yeni
bir mimari icat edilmedi. OpenAPI şeması da güncellendi (bu oturumun
başında tam bu tür bir tutarsızlığı — CRM/pivot eklenip OpenAPI'nin
güncellenmemesi — düzeltmiştim, aynı hatayı tekrarlamamak için).

**Doğrulama:** `test/support.js` (29 test) ve `test/visits.js` (19 test)
gerçek sunucuya karşı yazıldı; `node test/run-all.js` 27/27 paket geçti.
Browser panelinde GERÇEK bir talep oluşturuldu → yorum eklendi →
uygunsuzluğa dönüştürüldü VE Kalite modülünde gerçekten `UYG-2026-002`
olarak göründüğü doğrulandı; bir saha ziyareti oluşturulup GPS reddi
senaryosunun ("Konum alınamadı, izin verilmedi") doğru göründüğü de
tarayıcıda elle doğrulandı — yalnızca API testleriyle değil.

## 2026-09-13 (devam 9) — "Sadece kod olarak eksik var mı" denetimi (`9ca0101`)

5 maddelik satışa hazırlık turundan sonra kullanıcı "sadece yazılım ve kod
olarak değerlendirirsen eksik var mı" diye sordu. Üç somut alanı (dosya
yükleme güvenliği, `npm audit`, gözlemlenebilirlik/çökme bildirimi)
detaylı inceledim; `npm audit` temiz çıktı, diğer ikisinde 5 gerçek bulgu
vardı, kullanıcı "tümünü düzelt" dedi:

1. **`server/services/import.js`** — Excel içe aktarımında satır sayısına
   üst sınır yoktu (DoS riski: sıkıştırılmış küçük bir dosya bellekte çok
   büyük bir yapıya açılabilir). 50.000 satır sınırı eklendi, gerçek
   50.001 satırlık bir dosya üretilerek reddedildiği kanıtlandı
   (`test/import.js`'e kalıcı regresyon testi eklendi).
2. **`server/routes/documents.js`** — diskteki dosya uzantısı istemcinin
   ham dosya adından türetiliyordu (`image/png` MIME'li ama adı
   `"zararli.php"` olan bir dosya diskte `.php` uzantısıyla durabilirdi).
   Artık uzantı, zaten doğrulanmış MIME tipinden bir haritayla
   türetiliyor. Gerçek bir HTTP isteğiyle doğrulandı; `test/security.js`
   içindeki daha önce tamamen STATİK (kaynak kodu regex) olan dosya
   yükleme testlerine gerçek davranışsal bir test eklendi.
3. **`server/routes/import.js`** — dosya filtresi "MIME veya uzantı
   tutarsa kabul et" mantığındaydı ve kabul edilen MIME'ler arasında
   `application/octet-stream` (pratikte her şey) vardı — MIME kontrolü
   büyük ölçüde etkisizdi. Uzantı artık zorunlu tek kapı; gerçek
   doğrulamanın zaten ExcelJS'in dosyayı açabilmesiyle yapıldığı yorumda
   açıkça belirtildi.
4. **`server/lib/webhooks.js`** — bildirim zamanlayıcısı (`notifications.js`)
   kendi `try/catch` korumasına sahipken, webhook yeniden deneme
   zamanlayıcısı aynı korumaya sahip değildi; `setInterval` içindeki
   senkron bir DB hatası tüm süreci çökertebilirdi. Aynı desene getirildi.
5. **`server/index.js`** — hiçbir global `uncaughtException`/
   `unhandledRejection` yakalayıcısı yoktu. Docker'da `restart:
   unless-stopped` olduğu için bir çökme sürekli kesinti yaratmaz, ama
   kimseye haber verilmiyordu. Net bir "fatal" log satırı yazıp kasıtlı
   olarak çıkan yakalayıcılar eklendi.

**Dürüstçe belirtilmesi gereken:** madde 4 ve 5 davranışsal olarak test
EDİLMEDİ — senkron/async bir DB hatasını deterministik olarak tetiklemek
ya production koduna bir test-arka-kapısı eklemeyi ya da iç mock'lamayı
gerektirirdi. Bunun yerine kod incelemesiyle `notifications.js`'teki
zaten kanıtlanmış desenle birebir aynı olduğu doğrulandı.

**Doğrulama:** `npm run typecheck`/`lint`/`build` temiz, `node
test/run-all.js` 26/26 paket geçti (yeni 2 test dahil), CI yeşil.

## 2026-09-13 (devam 8) — Satışa hazırlık: 5 madde (7 commit)

GitHub'a ilk push'tan sonra kullanıcı "bu yazılım bir firmaya/fabrikaya
satılmaya hazır mı" diye sordu. Verdiğim dürüst değerlendirmede 5 somut
madde işaretlenmişti; kullanıcı hepsini sırayla ve tam yetkiyle
tamamlamamı istedi:

**1. GitHub Actions CI'ın gerçek bir çalıştırması (`8260bc1`, `957fd8a`,
`d2a53c6`).** İlk push'tan sonra CI GERÇEKTEN çalıştı ve başarısız oldu —
tam da şüphelenilen "hiç gerçek çalıştırma görmedi" boşluğu doğrulandı.
Üç ayrı kök neden art arda bulunup düzeltildi:
- Windows runner'da `better-sqlite3` node-gyp ile derlemeye düşüyordu
  (önceden derlenmiş ikili bulunmasına rağmen) çünkü npm, paketin kök
  dizinindeki `binding.gyp` dosyasını görünce otomatik `node-gyp rebuild`
  çalıştırıyor (bilinen bir npm davranışı). İki yanlış çözüm denendi
  (msvs_version zorlama, güncel node-gyp kurulumu — ikisi de node-gyp'in
  GitHub'ın yeni VS sürümünü TANIYAMAMASI sorununu çözemedi) önce asıl kök
  nedene ulaşıldı: kök dizine `ignore-scripts=true` içeren bir `.npmrc`
  eklendi (yalnızca better-sqlite3 ve macOS'a özel fsevents'i etkiliyor,
  ikisinin de kurulum betiği gereksiz).
- `test/planning.js` haftanın hangi günü çalıştırıldığına bağlıydı
  (`dstr(-1)` "dün" bir Cumartesi/Pazar'a denk gelince vardiya tanımı
  0 planlanan dakika döndürüyordu — uygulama hatası değil, testin kendi
  tarih seçimi kırılgandı). `lastWeekdayStr()` yardımcı fonksiyonuyla
  düzeltildi, gerçekten bir Pazar günü çalıştırılarak doğrulandı.
- `better-sqlite3@13` artık Node ≥22 gerektiriyor; matriste Node 20 da
  test ediliyordu. `package.json` engines alanı ve CI matrisi ≥22'ye
  çekildi.
**Sonuç: CI artık gerçekten yeşil** (`gh run view --json conclusion` ile
doğrulandı, "success").

**2. e-Fatura: gerçek entegratöre bağlanmaya hazır altyapı (`e92c9c7`).**
Araştırma (WebSearch) gerçek Türkiye e-Fatura entegratörlerinin (Foriba,
Uyumsoft, Nesbilgi, İzibiz) standart modelini doğruladı: mali mühür/
e-imzayı entegratör kendisi uyguluyor, müşteri yalnızca imzasız UBL-TR
XML'i onların API'sine gönderiyor — yani elektronik imza (XAdES-BES)
üretimi bu modelde GEREKMİYOR (bu bilinçli olarak yapılmadı, nedeni
kayıtlı). Asıl eksik bağlantı/kimlik doğrulama katmanındaydı:
`httpProvider` yalnızca Bearer token destekliyordu ve gönderim/durum/
mükellef sorgu yolları ayarlardan hiç değiştirilemiyordu. Eklendi: üç
kimlik doğrulama şeması (bearer/basic/özel başlık), tüm yolların
ayarlardan okunması, `POST /edocs/settings/test-connection` (kendi
VKN'imizi sorgulayarak fatura göndermeden bağlantıyı kanıtlar), Admin
arayüzünde "Gelişmiş entegratör ayarları" kartı + "Bağlantıyı Test Et"
düğmesi, ve gerçek bir sahte HTTP sunucusuna karşı çalışan yeni testler
(`test/einvoice.js`, 82/82 geçti). `docs/KULLANIM-KILAVUZU.md`'ye
canlıya alma kontrol listesi eklendi.

**3. KVKK / veri koruma değerlendirmesi (`e6dbba1`).** Kullanıcı
"değerlendir" dedi (uygula değil) — `docs/KVKK-DEGERLENDIRME.md` yazıldı:
gerçek kod incelemesine dayalı kişisel veri envanteri, var olan olumlu
tedbirler (bcrypt, RBAC, audit log, rate limiting), ve gerçek boşluklar
(en önemlisi: veri silme/anonimleştirme ve "bana ait veriyi göster"
taleplerini karşılayacak hiçbir mekanizma yok — `DELETE /customers/:id`
yalnızca soft-delete, kişisel veri süresiz kalıyor). Belgede açıkça
belirtildi: bu bir mühendislik değerlendirmesidir, hukuki görüş değildir.

**4. Tek-kurulum-başına-müşteri modeli denetimi (`f7a4079`).** Çok
şirketlilik istenmiyor ("ayrı firma/fabrikalara ayrı kurulum" modeli).
`server/scripts/setup.js` ve `docs/KURULUM.md` yeniden incelendi — genel
olarak sağlam bulundu, TEK gerçek ve somut eksik: `docs/KURULUM.md`'nin
gereksinim tablosu hâlâ "Node 18/20 LTS" yazıyordu, ama madde 1'deki
düzeltme `package.json` engines alanını ≥22'ye çıkarmıştı — bu, ayrı bir
müşteriye kurulum yapan biri için gerçek bir hata kaynağı olurdu.
Düzeltildi.

**5. Lisanslama altyapısı (`574b178`).** Kullanıcı: bugünkü model ömür
boyu lisans, aktif kısıtlama istemiyor, ama aylık/yıllık lisansa
dönülürse "sadece talep etmem kalsın" diye altyapı istiyor. Yan bulgu:
`package.json`'daki `"license": "MIT"` alanı GERÇEK bir hukuki sorundu —
ticari/kapalı bir ürünü yanlışlıkla açık kaynak lisansı altında
işaretliyordu; `UNLICENSED` olarak düzeltildi, kök dizine taslak bir
`LICENSE` dosyası eklendi (hukuk danışmanı incelemesi gerektiği açıkça
belirtildi). `server/lib/license.js`: Ed25519 imza doğrulama (ek
bağımlılık yok), `LICENSE_FILE` ortam değişkeni tanımlı DEĞİLSE hiçbir
kontrol yapmaz (bugünkü sıfır sürtünmeli varsayılan); tanımlıysa
"boş veritabanı" ile aynı desende kasıtlı olarak açılmama. Satıcı aracı:
`npm run license:generate -- --licensee "Firma" [--expires TARIH]` —
özel anahtar `license-signing-key.pem`'de (`.gitignore`'da, ASLA commit
edilmez). Yan ürün: `/api/data-health/system` endpoint'i zaten vardı ama
hiçbir zaman arayüze bağlanmamıştı (KULLANIM-KILAVUZU.md'nin iddia ettiği
"Veri Sağlığı sürüm/DB boyutu/yedek yaşını gösterir" özelliği aslında
YOKTU) — bu tutarsızlık da kapatıldı, yeni "Sistem bilgisi" kartı hem bu
eski boşluğu hem yeni lisans durumunu gösteriyor. `test/license.js`
(17 test): önceden gerçek özel anahtarla imzalanmış 3 sabit örnek
(süresiz/ileri-tarihli/süresi-dolmuş — testler bir daha özel anahtara
ihtiyaç duymuyor) + dört gerçek sunucu-alt-süreç açılış senaryosu.

**Doğrulama (toplam):** her commit kendi `npm run typecheck`/`lint`/
`build` + `node test/run-all.js` ile ayrı ayrı doğrulandı; son durumda
26/26 paket geçti (yeni `license` paketi dahil). CI'ın kendisi de GERÇEK
bir GitHub Actions çalıştırmasında yeşil. Browser panelinde e-Belge
"Bağlantıyı Test Et" akışı ve Veri Sağlığı "Sistem bilgisi" kartı gerçek
tarayıcıda elle doğrulandı.

**Kasıtlı olarak dokunulmayan/ertelenen (dürüstçe belirtildi):**
- e-Fatura'da elektronik imza (XAdES-BES) — araştırma sonucu gerçek
  entegratör modelinde gerekmediği için değil, "kendi mali mührünle GİB'e
  doğrudan özel entegratör olarak bağlanma" gibi çok daha büyük, ayrı bir
  GİB sertifikasyon süreci gerektiren bir model için gerekir.
- KVKK madde 4.1/4.2'deki öneriler (veri anonimleştirme özelliği, veri
  sahibi bilgi talebi raporu) — kullanıcı "değerlendir" dedi, "uygula"
  değil; bu oturumda UYGULANMADI, yalnızca belgelendi.
- Veritabanı/yedek şifrelemesi (KVKK 3.3) — `better-sqlite3` SQLCipher
  desteklemiyor, sürücü değişikliği gerektiren ayrı, büyük bir karar.

## 2026-09-13 (devam 7) — Proje adı "Sentez" olarak değiştirildi (`79ac1ff`)

Kullanıcı "bu olan isim çok olmuyor bence" dedi, yeni isim arayışına
girildi. İlk iki turdaki önerilerim ("Yekpare/Kervan/Meridyen/Pusula/
Sinerji/Ekosis" gibi soyut/kavramsal isimler) kullanıcı tarafından
reddedildi — "piyasadakilere benzer bişey olsun, duyunca bizim yazılım
belli olsun" dedi (Logo/Netsis/Mikro/Nebim tarzı, kısa, marka gibi duran
bir isim istendi). Üçüncü turda sunulan seçeneklerden **"Sentez"**
seçildi (bir araya getirme/bütünleştirme anlamı, kapsayıcılığı doğrudan
anlatıyor; ciddi/kurumsal, gerçek Türkçe kelime).

**Kapsam kararı (kendi inisiyatifimle, CLAUDE.md §14 değişim bütçesi
gereği):** yalnızca **görünen marka/başlık katmanı** güncellendi —
`package.json` adı, HTML `<title>`/`<h1>` etiketleri, mobil terminal
logosu, PWA manifest, OpenAPI başlığı, sunucu log mesajı, e-posta konu
etiketi (`[Sentez]`), README/kullanım kılavuzu başlıkları, kurulum/
yükseltme script banner'ları, nginx.conf yorumu (18 dosya, +25/-25 satır).
**Bilinçli olarak DOKUNULMADI** (teknik/dosya sistemi katmanı —
değiştirmek gereksiz risk/geniş kapsam yaratırdı): `depo-takip.sqlite`
veritabanı dosya adı, JWT secret varsayılan değeri
(`depo-takip-dev-secret-change-me`), `SMTP_FROM` varsayılanı,
`docker-compose.yml` container adı, `.env.example` örnek yolları,
`docs/KURULUM.md` örnek komutları, test dosyalarındaki dosya yolu
referansları, ve bu dosyanın (`PROJECT_STATUS.md`) önceki tüm tarihsel
kayıtları.

**Doğrulama:** `npm run typecheck`, `npm run lint`, `npm run build`,
`node test/run-all.js` — tümü geçti (`test/email.js`'teki `[Sentez]`
konu etiketi testi dahil); tek istisna yine bilinen `planning`
kırılganlığı (dokunulmadı).

**Hâlâ açık:** proje hâlâ hiçbir uzak depoya push edilmedi (`git remote
-v` boş) — bu makinede `gh` CLI kurulu değil, "Claude in Chrome" uzantısı
bağlı değil, bu yüzden GitHub repo oluşturma otomatikleştirilemedi.
Kullanıcıya iki seçenek sunuldu: (A) uzantıyı kurup bağlaması, (B) kendisi
GitHub'da manuel bir private repo oluşturup URL'sini vermesi. Cevap
bekleniyor.

## 2026-09-13 (devam 6) — Genel gözden geçirme sonrası düzeltmeler (4 commit)

5 maddelik yol haritası tamamlandıktan sonra kullanıcı "genel bir gözden
geçirme yapalım, eksikleri ve eklesek iyi olur dediğin yerleri belirt"
dedi. Bulunan öncelikli boşluklardan ikisi (OpenAPI güncel değildi, gerçek
tarayıcı E2E testi yoktu) ve "bilinçli kapsam dışı ama hatırlatmaya değer"
maddelerin tamamı ele alındı. Sırayla 4 ayrı commit:

**1. Webhook otomatik yeniden deneme kuyruğu (`cb3a4ec`).** Webhook'lar
Aşama 5'ten beri fire-and-forget'ti — tek deneme, otomatik retry yok.
`webhook_deliveries`'e `retry_count`/`next_retry_at` eklendi (migration
012); `sendDelivery` artık üstel geri çekilme + jitter ile (~1dk → ~16dk,
5 deneme hakkı, sonra dead-letter) otomatik kuyruğa alıyor.
`processRetryQueue()` her 60 saniyede kendiliğinden çalışıyor;
`POST /webhooks/process-retry-queue` (admin) beklemeden tetiklemek için.
**Gerçekten test edildi** (yalnızca "alan var" değil): izole bir webhook
üzerinde başarısızlık → kuyruk tetikleme → GERÇEK yeni bir teslimat
denemesinin oluştuğu (retryCount=1) ve ilk kaydın `next_retry_at`'inin
temizlendiği (çift işleme yok) doğrudan kanıtlandı.

**2. BI pivot'u satış/satın alma/kalite verisini de kesiştiriyor
(`ca34c30`).** Aşama 8'in ilk sürümü yalnızca `movements`'a bakıyordu.
`server/services/pivot.js`'e `sales`/`purchasing`/`quality` veri kaynakları
eklendi (her biri kendi boyut/ölçü/tarih-filtresi whitelist'iyle — tarih
temsilleri farklı olduğu için: movements/quality epoch ms, sales/purchasing
'YYYY-MM-DD' string). Alan adları uydurulmadı, gerçek şemadan
(`001_initial_schema.js`) doğrulandı. Frontend'e veri kaynağı seçici
eklendi; kaynak değişince boyut/ölçü listeleri dinamik güncelleniyor.

**3. OpenAPI şeması CRM + Özel Rapor + webhook retry ile güncellendi
(`6bcb1c3`).** `server/lib/openapi.js` Aşama 5'te yazılmıştı; Aşama 7
(CRM) ve Aşama 8 (pivot) eklendiğinde hiç güncellenmemişti — dış bir
sistem bu iki modülün var olduğunu göremiyordu. 9 yeni path + 10 yeni
şema eklendi; dosyaya "bu şema otomatik türetilmiyor, yeni route eklerken
elle güncelle" notu düşüldü (aynı hatanın tekrarlanmaması için).

**4. Gerçek tarayıcı E2E testleri — Playwright (`4fb1b5d`).** Şimdiye
kadar tüm testler ya doğrudan API'ye vuruyordu ya da jsdom kullanıyordu —
jsdom gerçek CSS cascade hesaplamıyor. Bunun somut kanıtı zaten bu
projenin kendi tarihinde vardı: Aşama 6'daki `[hidden]{display:none}`
eksikliği (kamera görünümünün giriş ekranını kapatması) YALNIZCA gerçek
bir tarayıcıda ortaya çıkmıştı. `test/e2e-browser/` (5 dosya, 12 test):
giriş/rol bazlı UI, stok girişinin gerçek sunucuya yazdığı, CRM'in
fırsat→dönüştürme akışının uçtan uca çalıştığı, ve mobil terminaldeki
`[hidden]` regresyon sınıfını doğrudan hedefleyen bir test. CI'a
(`.github/workflows/ci.yml`) Chromium kurulumu + test adımı eklendi.
**Gerçekten çalıştırıldı** (12/12) — yazılıp denenmeden bırakılmadı;
geliştirme sırasında bulunan 3 kendi selector hatam da kök nedenine
inilerek düzeltildi (bkz. commit mesajı).

**Kasıtlı olarak YAPILMAYAN/reddedilen maddeler (dürüstçe belirtildi):**
- **e-Fatura gerçek entegratör testi** — entegratör hesabı/GİB erişimi
  yok, yapılamaz. Kullanıcı bunu edinirse ele alınabilir.
- **PWA service worker'ın gerçek cihazda doğrulanması, kamerayla barkod
  okuma, el terminalinin sahada denenmesi** — hepsi fiziksel cihaz/gerçek
  ağ ortamı gerektiriyor, bu ortamda yapılamaz (YOL-HARITASI.md'nin
  "yalnızca sahada çözülebilecekler" listesiyle tutarlı).
- **Çok şirketlilik (multi-tenant) aktivasyonu** — kullanıcıya soruldu,
  **"olduğu gibi bırak"** kararı verildi (tek tesis kullanımı hâlâ
  geçerli; onlarca route'ta yüzlerce sorguya `company_id` filtresi eklemek,
  şirket seçici arayüz, `/companies` CRUD, `number_sequences`'i şirket
  bazlı yapmak gerektiren haftalarca sürecek, yanlış yapılırsa şirketler
  arası veri sızıntısına yol açabilecek riskli bir iş — gerçek bir ikinci
  müşteri onboard edilecekken ele alınmalı).

**Hâlâ kapatılmamış, kullanıcının kendi kararını gerektiren boşluk:**
proje hâlâ hiçbir uzak depoya (GitHub vb.) push edilmemiş — `git remote -v`
boş. `.github/workflows/ci.yml` yazılı ama hiç gerçek bir Actions
çalıştırması görmedi (bu commit'teki Playwright adımı dahil). Tek nokta
arızası riski hâlâ geçerli; en ucuz düzeltme `git remote add` + ilk push.

**Doğrulama (toplam):** `tsc`/`eslint` temiz. `node test/run-all.js` her
3 backend değişiklikten sonra ayrı ayrı çalıştırıldı — yeni/değişen
paketler (`webhooks` 32/32, `pivot` 29/29, `openapi` 10/10) dahil tüm
paketler geçti; tek istisna yine `planning` (tarihe bağlı, önceden bilinen,
bu turda dokunulmayan kırılganlık). `npx playwright test` 12/12.

---

## 2026-09-13 (devam 5) — Aşama 8 TAMAMLANDI: BI / raporlama derinliği (`41281ef`)

Kullanıcının "5 maddeyi sırayla yap" talimatının SON maddesi. 9 sabit
raporun (stok değerleme, trendler, ölü stok, devir hızı, ABC, sipariş
önerileri, tedarikçi performansı, kalite KPI, üretim maliyetleri) üstüne,
kullanıcının KENDİ kesişimini kurabildiği bir "Özel Rapor" sekmesi eklendi.

**Bilinçli kapsam sınırı (kullanıcıyla daha önce netleştirilen plana göre):**
serbest SQL veya sürükle-bırak rapor tasarımcısı YOK — SQL injection ve
yetkisiz veri erişimi riski gerçek, fayda/karmaşıklık oranı düşük. Bunun
yerine `movements` (stok hareketleri — depo verisinin en zengin, tek
tablosu) üzerinde ÖNCEDEN TANIMLANMIŞ, güvenli bir boyut (gün/ay/ürün/depo/
hareket tipi/referans tipi) + ölçü (miktar/değer/adet) + filtre whitelist'i.
Talep tahmini (forecasting) kapsam dışı bırakıldı — ayrı bir veri bilimi
çalışması gerektirir, bu turun "genel envanter/BI" hedefinin dışında.

**Güvenlik — gerçekten test edildi, sadece iddia edilmedi:**
`server/services/pivot.js`'teki whitelist'e karşı doğrudan SQL enjeksiyonu
denemeleri (`"1); DROP TABLE users;--"` gibi boyut/ölçü/filtre değerleri
olarak) `test/pivot.js`'de çalıştırıldı — hepsi 400 ile reddedildi VE
denemeler sonrası veritabanının (users tablosu dahil) sağlam kaldığı ayrıca
doğrulandı. Kullanıcı girdisi hiçbir zaman ham SQL string'ine karışmıyor,
yalnızca sabit anahtar kelimelerle eşleştiriliyor.

**Kayıtlı raporlar:** kullanıcı bir pivot konfigürasyonunu isim vererek
kaydedip tekrar çağırabiliyor (`saved_reports` tablosu). Yetki modeli:
rapor tanımı oluşturmak/görmek salt-okunur bir tercih olduğu için TÜM
authenticated kullanıcılara (görüntüleyici dahil) açık; SİLME ise yalnızca
raporun sahibi VEYA bir yönetici/müdür için — başkasının raporunu silme
denemesi 403 ile reddediliyor (test edildi).

**Doğrulama:** `tsc`/`eslint` temiz. `test/pivot.js` (yeni, 21 test).
`node test/run-all.js`: `pivot` + güncellenen `ui-smoke` (Raporlar artık
10 sekme) dahil TÜM paketler tam geçti; tek başarısız paket yine `planning`
(tarihe bağlı, önceden bilinen, bu oturumda dokunulmayan kırılganlık — bkz.
Aşama 3 kaydı). Tarayıcıda gerçekten doğrulandı: boyut/ölçü değiştirip
çalıştırma, gerçek sonuç tablosu+grafiği, rapor kaydetme, kayıtlı rapora
tıklayıp konfigürasyonun geri yüklenmesi, silme.

**Sırada:** Kullanıcının önceliklendirdiği 5 maddenin (1. Barkod ZPL,
2. OpenAPI+Webhook, 3. PWA/Offline, 4. CRM, 5. BI/Raporlama) TAMAMI
tamamlandı. Bir sonraki adım için kullanıcıyla yön teyidi alınacak — plan
dosyasındaki (`peppy-puzzling-plum.md`) daha önce kapsam dışı bırakılan
maddeler (Aşama 3 Faz 2+ zaten tamamlanmıştı; e-Fatura gerçek entegratör
testi hâlâ entegratör hesabı gerektirdiği için bekliyor) veya kullanıcının
belirteceği yeni bir öncelik.

---

## 2026-09-13 (devam 4) — Aşama 7 TAMAMLANDI: CRM / satış hunisi (`d89384d`)

Rekabet-eksikliği önceliğinde Aşama 6'dan (PWA/Offline) sonraki madde.
`sales_orders`'ın ÖNCESİNE eklenen yeni bir modül: bir satış fırsatı
(opportunity) doğar, aşamalardan geçer (yeni → iletişimde → teklif verildi →
kazanıldı/kaybedildi), kazanılırsa gerçek bir satış siparişine dönüşür.

**Şema:** `010_crm.js` — `opportunities` + `opportunity_lines`, `sales_orders`'a
nullable `opportunity_id` (geriye izlenebilirlik). Fırsat, mevcut bir müşteriye
bağlanabilir VEYA henüz müşteri olmayan bir "aday" adıyla açılabilir
(`customerId` opsiyonel, `customerName` her zaman zorunlu).

**Gerçek bir kod-tekrarı önlendi:** `server/services/sales-orders.js` (yeni) —
satış siparişi oluşturma mantığı (kredi limiti kontrolü, kur kilitleme, denetim
kaydı) `server/routes/sales.js`'ten çıkarılıp tek bir yere taşındı; hem normal
`POST /sales/orders` hem CRM'in `POST /crm/opportunities/:id/convert`'i AYNI
fonksiyonu çağırıyor. `sales.js`'in davranışı değişmedi — bu, iki ayrı route'un
aynı işlemi yapması gereken bir durumda kopya mantık yazmamak için haklı,
küçük bir refactor (CLAUDE.md §17 DRY).

**Aşama geçiş kuralları (gerçekten test edildi, bkz. `test/crm.js`):**
kaybedilme sebebi olmadan "kaybedildi" işaretlenemiyor; kapanmış (won/lost)
bir fırsat ne düzenlenebiliyor ne yeniden açılabiliyor; yalnızca "won" VE
henüz dönüştürülmemiş fırsatlar dönüştürülebiliyor (aynı fırsat ikinci kez
dönüştürülemiyor — idempotency); müşterisi olmayan bir adayı dönüştürmek
dönüştürme anında müşteri seçimini zorunlu kılıyor; kalemsiz bir fırsat
dönüştürülemiyor.

**Webhook entegrasyonu:** `EVENT_CATALOG`'a `opportunity.won` eklendi — bir
fırsat kazanıldığında Aşama 5'te kurulan webhook altyapısı üzerinden dış
sistemlere (ör. bir satış bildirim aracı) bildirilebiliyor.

**Frontend:** `frontend-react/CrmView.jsx` (yeni) — "Fırsatlar" adında yeni bir
üst-seviye ekran (Operasyon grubunda, Satış'tan önce, mantıksal akışa uygun).
2 sekme: **Huni** (sürükle-bırak YOK — bilinçli olarak minimal tutulan sütunlu
görünüm + "İlerlet"/"Kaybedildi" butonları) ve **Fırsatlar** (filtrelenebilir
tam liste).

**Gerçek bulunan hata (geliştirme sırasında, ESLint tarafından yakalandı):**
CRM için `source` adında yeni bir i18n anahtarı eklerken, NCR modülünde
ZATEN VAR OLAN bir `source` anahtarıyla çakıştığı fark edilmedi — JS nesne
literalinde son tanım sessizce kazanır. Değerler aynı metni taşıdığı için
(`"Kaynak"`) görsel bir hataya yol açmadı ama gerçek bir kod kalitesi
sorunuydu (projenin daha önce bulduğu `dueDate` çakışmasıyla aynı sınıf —
bkz. "İkinci tur" kaydı). `npx eslint .`'in `no-dupe-keys` kuralı bunu
DERLEME ANINDA yakaladı; yeni anahtar `oppSource` olarak ayrıldı, NCR
tarafına dokunulmadı.

**Doğrulama:** `tsc`/`eslint` temiz. `test/crm.js` (yeni, 31 test) — en
değerli kontrol: kazanılmış bir fırsatı dönüştürmenin GERÇEKTEN bir satış
siparişi oluşturduğu ve bu siparişin doğru müşteri/kalemleri taşıdığı,
doğrudan `GET /sales/orders/:id` ile doğrulandı (yalnızca "201 döndü" değil).
`node test/run-all.js`: `crm` + güncellenen `ui-smoke` (yeni ekran + 2 sekme
kontrolü) dahil TÜM paketler tam geçti; tek başarısız paket yine `planning`
(tarihe bağlı, önceden bilinen, bu oturumda dokunulmayan kırılganlık — bkz.
Aşama 3 kaydı). Tarayıcıda gerçekten doğrulandı: huni görünümü (4 sütun,
doğru gruplama/toplam), fırsat detay modalı, yeni fırsat formu (müşteri/yeni
aday seçimi), Fırsatlar liste sekmesi.

**Sırada:** Kullanıcının "5 maddeyi sırayla yap" talimatına göre Aşama 8 —
BI/raporlama derinliği (yapılandırılabilir pivot tablo veya en azından
sürükle-bırak rapor oluşturucu; talep tahmini kapsam dışı bırakılmıştı).

---

## 2026-09-13 (devam 3) — Aşama 6 TAMAMLANDI: PWA / çevrimdışı mobil terminal (`d3cf0e0`)

Rekabet-eksikliği önceliğinde Aşama 5'ten (Webhook+OpenAPI) sonraki madde.
Depo terminalinin (`public/mobile.html`) çevrimdışı kuyruğu şimdiye kadar
localStorage'da tek bir JSON dizisi olarak tutuluyordu ve sayfanın kendisi
hiç önbelleklenmiyordu — cihaz açılışta bağlantı yoksa terminal hiç
yüklenmiyordu. Depo/saha Wi-Fi kapsamasının genelde kötü olduğu bir ürün
için gerçek bir boşluktu.

**Yapılanlar:**
- `public/js/mobile-db.js` (yeni): IndexedDB tabanlı kuyruk (`MobileDB.add/
  getAll/clear`) — localStorage'a göre yapılandırılmış kayıt bazlı çalışma,
  çok daha yüksek depolama sınırı, kaynak baskısında daha geç temizlenme.
- `public/js/mobile.js`: kuyruk mantığı (`submit`/`flushQueue`/`paintQueue`/
  `queue` ekranı) IndexedDB'ye taşındı (async). `migrateLegacyQueue()`:
  yükseltme sırasında eski localStorage kuyruğunda bekleyen işlem varsa
  bir kerelik IndexedDB'ye taşınır — sessizce kaybolmaz.
- `public/sw.js` (yeni): YALNIZCA terminal kabuğunu (mobile.html+css/js+
  manifest+simgeler) önbellekler; API çağrıları ve masaüstü arayüzü
  fetch olayında hiç ele alınmaz — ikisi de her zaman canlı veriyle çalışır.
- `public/manifest.webmanifest` + `public/icons/*.png` (harici bağımlılık
  olmadan Node `zlib` ile üretilen gerçek PNG'ler): terminal artık
  "Ana Ekrana Ekle" ile kurulabilir bir PWA.
- `server/index.js`: `/sw.js` için açık `Content-Type` route'u.

**Gerçek bulunan, Aşama 6'dan bağımsız bir hata (aynı commit'te düzeltildi):**
`public/css/mobile.css` hiçbir yerde `[hidden]{display:none}` sıfırlaması
tanımlamıyordu. `.m-cam` gibi sınıflar kendi `display` değerini koşulsuz
tanımladığı için (author stylesheet tarayıcının varsayılan `[hidden]`
kuralını HER ZAMAN ezer) kamera görünümü `hidden=true` olsa bile GÖRÜNÜR
KALIYORDU — giriş ekranı tamamen kapanıyordu. `jsdom` testleri bunu hiç
yakalayamazdı (gerçek CSS cascade hesaplamıyor); yalnızca gerçek tarayıcıda
açılınca ortaya çıktı (bkz. Browser paneli doğrulaması). Tek satırlık
global kuralla düzeltildi.

**Doğrulama:** `tsc`/`eslint` temiz. `test/mobile.js` — jsdom IndexedDB'yi
hiç uygulamadığı için (belgelenmiş sınırlama) gerçek IndexedDB'nin async
sözleşmesini taklit eden minimal bir sahte sürüm eklendi, `mobile-db.js`'in
GERÇEK kodu mock'lanmadan çalıştırıldı; yükseltme/migrasyon senaryosu
doğrudan test edildi. Bu süreçte jsdom'un `DOMContentLoaded`'ı KENDİSİ de
ateşlediği keşfedildi (testteki elle `dispatchEvent` migrasyonu iki kez
çalıştırıp kaydı ikiletiyordu) — testten kaldırılarak düzeltildi (kod
hatası değil, test kurulumu artefaktı). 59/59. `test/pwa.js` (yeni, 31
test): manifest alanları, önbellek listesinin **hiçbir `/api` yolu
içermediği** (en kritik kontrol), simgelerin geçerli PNG olduğu, CSP'nin
service worker/manifest'i engellemediği. `node test/run-all.js`: yeni
paketlerin (mobile, pwa) ikisi de tam geçti; tek başarısız paket yine
`planning` (tarihe bağlı, önceden bilinen, bu oturumda dokunulmayan bir
kırılganlık — bkz. Aşama 3 kaydı).

**Tarayıcıda gerçekten doğrulandı:** giriş ekranı (CSS düzeltmesinden
sonra) doğru render; gerçek barkod taraması + stok girişi uçtan uca
çalıştı (gerçek sunucuya gitti, "1,00 adet girildi" ile sonuçlandı);
gerçek IndexedDB üzerinden `MobileDB.add/getAll/clear` doğrulandı.

**Doğrulanamayan, dürüstçe belirtilmesi gereken sınır:**
`navigator.serviceWorker.register()` bu oturumun kullandığı sandbox'lı
Browser panelinde her zaman "An unknown error occurred when fetching the
script" ile başarısız oluyor. Kontrol testi olarak TAMAMEN ilgisiz bir uç
noktayı (`/health`) kaydetmeyi denedim — AYNI jenerik hata çıktı; bu,
`sw.js`'in içeriğiyle değil, bu spesifik sandbox'ın service worker kayıt
altyapısıyla ilgili bir ortam sınırlaması (projenin daha önce Chart.js CDN
engeli için belgelediği sandbox kısıtlamasıyla aynı sınıftan — bkz. Aşama
2 Faz 1 kaydı). Sunucu tarafında doğrulanabilen HER ŞEY (dosya servisi,
içerik tipi, CSP uyumu, önbellek listesi doğruluğu) `test/pwa.js` ile
kanıtlandı; asıl "çevrimdışı açılış" davranışı gerçek bir tarayıcıda/
cihazda ayrıca denenmelidir.

**Sırada:** Kullanıcının "5 maddeyi sırayla yap" talimatına göre Aşama 7 —
CRM/satış hunisi (fırsat/teklif takibi, mevcut `sales_orders`'ın öncesine
eklenen yeni bir modül).

---

## 2026-09-13 (devam 2) — Aşama 5 TAMAMLANDI: Genel API/Entegrasyon hikayesi (Webhook + OpenAPI)

Rekabet-eksikliği önceliğinde Barkod ZPL'den (Aşama 4) sonraki madde. İki
alt bölüm halinde, her biri kendi commit'i ve doğrulamasıyla tamamlandı.

**Kısım 1/2 — Webhook altyapısı (`e19f977`).** `webhooks` + `webhook_deliveries`
tabloları (`009_webhooks.js`). Sabit bir olay kataloğu (`purchase_order.
{created,approved,received}`, `sales_order.created`, `shipment.
{created,status_changed}`, `production_order.completed`, `ncr.opened`) —
ilgili route'larda (purchasing/sales/production/quality) iş işlemi
COMMIT OLDUKTAN SONRA `dispatchEvent()` çağrılıyor. Teslimat: HMAC-SHA256
imzalı (`X-Webhook-Signature: sha256=...`), 8 saniye zaman aşımlı, TEK
deneme — **bilinçli kapsam sınırı: bu bir transactional outbox değil**,
fire-and-forget bir gönderim; sonuç (başarı/hata) her zaman
`webhook_deliveries`'e yazılır, otomatik yeniden deneme kuyruğu yok, yalnızca
elle (`POST .../retry`) yeniden denenebilir. v1 için kasıtlı olarak dar
tutulan bir kapsam (CLAUDE.md §14 değişim bütçesi ilkesiyle uyumlu).

Yönetim ekranına "Webhook'lar" sekmesi (CRUD + gizli anahtar bir kez
gösterimi + test pingi + teslimat geçmişi diyaloğu). `test/webhooks.js`
(25 test) gerçek bir yerel HTTP alıcı açıp imzanın GERÇEKTEN doğrulanabilir
olduğunu ve olay gövdesinin gerçek iş verisini taşıdığını kanıtlıyor —
yalnızca "istek atıldı" değil.

**Gerçek bulunan hata:** `/api/webhooks/:id/deliveries` `success` alanını
ham SQLite `INTEGER` (0/1) olarak döndürüyordu; test `d.success === true`
gibi katı bir eşitlik bekliyordu. SQLite'ın yerel boolean tipi olmaması
kaynaklı gerçek bir API sözleşmesi hatasıydı (test hatası değil) —
projedeki mevcut `!!row.is_active` deseniyle düzeltildi.

**Kısım 2/2 — OpenAPI 3.0 şeması + interaktif doküman sayfası (`3a63737`).**
`server/lib/openapi.js` elle yazılan OpenAPI 3.0.3 şeması (~24 yol grubu,
~30 şema) — sistemin TÜM iç uçlarını değil, dış sistemlerin (e-ticaret,
B2B portal, muhasebe, başka bir ERP) entegre olmak isteyeceği ana
kaynakları kapsıyor; alan adları `test/contract.js`'in doğruladığı gerçek
sözleşmeden alındı. `GET /api/docs/openapi.json` kimlik doğrulama
gerektirmeden servis eder (Postman/Insomnia'ya dışarıdan içe aktarım için
bilinçli tercih). `public/api-docs.html`: bağımsız bir Swagger UI sayfası.
`test/openapi.js` (10 test) — en değerli kontrol `collectRefs()` ile tüm
şema referanslarını gezip her birinin gerçekten var olan bir şemaya işaret
ettiğini kanıtlıyor (yanlış yazılmış bir referans Swagger UI'da sessizce
bozuk görünür, hata vermez).

**Gerçek bulunan hata (tarayıcıda doğrulama sırasında):** `api-docs.html`
ilk yazımda Swagger UI dosyalarını `cdn.jsdelivr.net`'ten yüklüyordu —
ama `server/index.js`'teki CSP yalnızca `cdnjs.cloudflare.com`'a
(script-src) ve `fonts.googleapis.com`'a (style-src) izin veriyor, sayfa
hiç açılmıyordu (tarayıcı konsolunda CSP ihlali). Ayrıca sayfanın inline
`<script>` ve inline `onerror` handler'ı da CSP'nin `script-src`'de
`unsafe-inline` bulunmaması yüzünden çalışmıyordu. Düzeltme: (1) Swagger UI
dosyaları zaten güvenilen `cdnjs.cloudflare.com`'a taşındı — yeni bir CDN
kaynağı açmak yerine mevcut, zaten Chart.js için güvenilen host'un
style-src'ye de eklenmesi (güvenlik yüzeyi minimum genişletildi); (2)
sayfanın JS'i `public/js/api-docs.js`'e taşındı (inline script yasak).
Tarayıcıda gerçekten açılıp "Try it out" ile bir uç noktanın etkileşimli
çalıştığı doğrulandı.

**Doğrulama (toplam):** `npx tsc --noEmit` temiz, `npx eslint .` 0 hata
(yalnızca ilgisiz, önceden var olan uyarılar). `node test/run-all.js` —
labels/webhooks/openapi paketlerinin üçü de tam geçti. Tek başarısız paket
`planning` — `test/planning.js:270`'teki `dstr(-1)` ("dün") tarihe bağlı,
önceden var olan bir kırılganlık (hafta sonuna denk gelince ilgili
vardiyanın çalışma takviminde olmaması `plannedMinutes=0` üretiyor —
bkz. Aşama 3 kaydı); bu oturumda dokunulan hiçbir dosyayla ilgisi yok.

**Sırada:** Kullanıcının "5 maddeyi sırayla yap" talimatına göre Aşama 6 —
PWA/Offline mobil (`public/mobile.html`'in service worker + IndexedDB
tabanlı gerçek bir çevrimdışı senkronizasyon motoruna yükseltilmesi).

---

## 2026-09-13 (devam) — Aşama 4: Barkod etiket yazdırma (Zebra/ZPL)

React geçişi tamamlandıktan sonra kullanıcı, önceki oturumda sıralanan
5 rekabet-eksikliğini (Barkod ZPL → OpenAPI/Webhook → PWA/Offline → CRM →
BI) belirtilen öncelik sırasıyla yapmaya karar verdi. İlki tamamlandı.

**Tespit:** Belge şablonu sisteminde "Parti Etiketi" (100×70mm,
`showBarcode` anahtarı) ayarı `005_templates.js`'ten beri vardı ama HİÇ
kullanılmıyordu — ne bir "etiket yazdır" eylemi ne de barkod render eden
bir kod mevcuttu. Bu, admin'in yapılandırabileceği ama asla devreye
girmeyen "ölü" bir özellikti.

**Yapılanlar:** `server/lib/zpl.js` (yeni, `ubl.js` ile aynı saf-üretici
deseni) — 203dpi, `^CI28` (Türkçe karakterler), Code128 barkod, kaçışlama,
kopya sayısı. `server/routes/labels.js` (yeni): `GET /api/labels/
{item,lot}/:id/zpl` (önizleme/indirme, herkese açık) ve `POST /api/labels/
print` (ağdaki Zebra yazıcıya ham TCP/9100 ile gönderim, `stock.write`
yetkisi ister). Ayarlara `labelPrinterIp`/`labelPrinterPort` eklendi
(mevcut serbest key-value tablosu, migration gerekmedi). Items ve Lots
ekranlarına "Etiket Yazdır" düğmesi + paylaşılan diyalog
(`frontend-react/labelPrint.js`), Admin > Ayarlar'a yazıcı IP/port kartı.

**Önemli tasarım kararı:** yazıcı ayarlanmamışsa veya ulaşılamıyorsa API
AÇIKÇA hata verir (400/502) — "gönderildi" denip aslında hiçbir şeyin
basılmamış olması depo operatörünü yanıltır. `test/labels.js` (23 test)
bunu doğruluyor; ayrıca ZPL üretici çıktısının yapısını (komut sınırları,
kaçışlama, barkod verisi zorunluluğu) test ediyor.

**Yan bulgu — düzeltildi (ayrı commit):** `tsconfig.json`'ın `include`
listesi `frontend-react/**/*.jsx`'i HİÇ kapsamıyordu — Aşama 3'ün tamamı
boyunca (10 ekran, 9 commit) her "tsc temiz" doğrulaması teknik olarak
doğruydu ama bu dosyaların hiçbirini kontrol etmiyordu. Kapsama alınca
ortaya çıkan iki sorun çözüldü: (1) `UI`/`Api` gibi paylaşılan global'ler
modül dosyalarında (import/export içerdikleri için TS bunları "script"
değil "module" sayıyor) tanınmıyordu; (2) bu tarz DOM-ağırlıklı kod zaten
projedeki HER server/public dosyasının kullandığı `// @ts-nocheck`
kuralına tabi olmalı (kasıtlı "kademeli tip güvenliği" — CLAUDE.md'nin
"invent olmadan mevcut sözleşmeyi kullan" ilkesiyle uyumlu). Tüm 14
frontend-react dosyasına `@ts-nocheck` eklendi, `tsconfig.json`'a
`frontend-react/**/*.{jsx,js}` + `jsx: "react-jsx"` eklendi.

**Doğrulama:** `npx tsc --noEmit` temiz. `npx eslint .` 0 hata.
`node test/run-all.js` — labels dahil paketlerin tamamı geçti (tek bilinen
istisna: `task_0a67ef75`'te takip edilen, ilgisiz tarih-bağımlı
`planning.js` kırılganlığı). Tarayıcıda elle doğrulama: Items/Lots'ta
etiket yazdır diyaloğu doğru veriyle açıldı, yazıcı ayarlanmamışken doğru
hata mesajı göründü, Admin > Ayarlar'da yazıcı IP/port kaydedilebildi.

**Sırada:** Aşama 5 — OpenAPI + webhook.

---

## 2026-09-13 — Aşama 3 TAMAMLANDI: React'e kademeli geçiş — 10/10 ekran

Kullanıcı, Dashboard + Items pilotunu tarayıcıda gördükten sonra "bence
herşey yolunda diğer kısımlarıda geçirip tüm proje geçsin" dedi — kalan 8
ekranın tamamının React'e taşınması için açık onay. Bu oturumda Counts,
Lots, Production, Reports, Planning, Purchasing, Quality, Sales, Admin
sırasıyla taşındı. **Artık `public/js/views/` klasörü tamamen kalktı;
`public/index.html` tek bir script (`/dist/react-views.js`) yüklüyor ve
bu bundle 10 ekranın tamamını (`window.ViewX`) tanımlıyor.**

**Değişmeyen disiplin (Dashboard/Items'tan devralındı):** iş mantığı
YENİDEN YAZILMADI — her ekran, `UI.table()/card()/tabs()/modal()` gibi
mevcut yardımcı fonksiyonları aynen çağıran, aynı HTML'i üreten bir React
bileşenine dönüştürüldü. Değişen yalnızca dış kabuk: modül-seviyesi
`let state/tab/...` → `useState`/`useRef`; `render(el)/load(el)` →
veri-çekme `useEffect`'i + `dangerouslySetInnerHTML` + DOM-bağlama
`useEffect`'i. Diyaloglar (`UI.modal()`) global bir overlay sistemi
olduğu için hiçbir ekranda değişmedi.

**Kullanıcıyla netleştirilen mimari karar (Items'ta soruldu, tüm ekranlara
uygulandı):** filtre/sekme/sayfa durumu artık ekrandan ayrılıp geri
dönüldüğünde KORUNMUYOR — Dashboard'daki gibi her navigasyonda bileşen
sıfırdan mount ediliyor (`mountView.jsx`). Bilinçli, kabul edilmiş küçük
bir davranış değişikliği; ek "yenile sinyali" altyapısı kurmaktan kaçınmak
için.

**Sekmeli ekranlar için ek desen (Reports'ta ilk kez, sonra tekrarlandı —
Planning/Purchasing/Quality/Sales/Admin):** dış kabuk (topbar + `UI.tabs()`
+ body/actions konteynerleri) sabit, her sekme kendi verisini çekip bu
konteynerleri DOĞRUDAN dolduran ayrı bir fonksiyon. `UI.tabs()` kendi
tıklama bağlamasını kendisi yapıyor (`setTimeout(0)`) ve her çağrıda
rastgele id ürettiği için React bunu her render'da tazeliyor — vanilla
sürümün "her `load()` tam yeniden kurar" davranışıyla zaten örtüşüyor.
Bazı ekranlarda iki tür yenileme var: `reload()` (yalnızca aktif sekmeyi
yeniden çeker) ve `fullReload()` (paylaşılan ön-koşul veriyi de yeniden
çeker — Planning'de iş merkezi/vardiya ekle-düzenle-sil sonrası).

**Gerçek bulunan/düzeltilen sorunlar (bu turda):**
1. **Kamera/zamanlayıcı referans hatası (Items):** `scanStream`/
   `scanTimer`/`stopWedge` ilk portta düz `let` idi — React bir bileşeni
   her yeniden render ettiğinde fonksiyon gövdesi baştan çalışır, bu da
   tarama sırasında bir render olursa kamera referansının sessizce
   sıfırlanabileceği anlamına gelirdi. `useRef`'e taşınarak düzeltildi.
2. **`test/barcode.js` regresyonu:** kamera mantığının kaynağını STATİK
   olarak `public/js/views/items.js`'den okuyordu; dosya silinince ENOENT
   ile patlıyordu. `run-all.js` özetinde "barcode" satırının sessizce
   kaybolmasıyla yakalandı; `frontend-react/ItemsView.jsx`'i okuyacak
   şekilde güncellendi.
3. **`ViewLots.traceDialog` çapraz-modül bağımlılığı (Lots):** hâlâ
   vanilla olan sales.js/production.js/quality.js tarafından
   `ViewLots.traceDialog(lotId)` olarak dışarıdan çağrılıyordu — bu yüzden
   `LotsView.jsx`'te React bileşeninden bağımsız, modül seviyesinde bir
   fonksiyon olarak dışa aktarıldı (`main.jsx`: `window.ViewLots = {
   ...mountView(LotsView), traceDialog }`).
4. **`test/security.js`'te ölü kod:** artık var olmayan
   `public/js/views/` dizinini okuyan, zaten hiç kullanılmayan bir satır
   (eslint'in aylardır işaretlediği) temizlendi.

**Build zinciri:** her ekran eklendiğinde `public/index.html`'den ilgili
`<script src="/js/views/X.js">` satırı kaldırıldı, `frontend-react/main.jsx`
`window.ViewX = mountView(XView)` eklendi, `test/ui-smoke.js`'nin
script-yükleme listesi ve global kontrolü güncellendi, eski dosya silindi.
Son ekran (Admin) sonrası artık boş kalan `public/js/views/` klasörü de
kaldırıldı. `README.md`'nin proje yapısı bölümü güncellendi.

**Doğrulama (HER ekran için ayrı ayrı yapıldı, hepsi geçti):**
`npx tsc --noEmit` temiz, `npx eslint .` 0 hata, `node test/run-all.js`
19/19 paket (ui-smoke'taki ekrana özel render/diyalog kontrolleri dahil).
Admin dahil birkaç ekran tarayıcıda elle de doğrulandı (gerçek veri,
diyalog açılışı).

**Bilinen, İLGİSİZ bir kırılganlık bu turda tekrar tekrar gözlendi ve
ayrı bir arka plan görevi olarak işaretlendi (task_0a67ef75):**
`test/planning.js`'deki "planlanan süre vardiya tanımından alındı" testi
`dstr(-1)` ("dün") kullanıyor; sistem tarihi hafta sonuna denk geldiğinde
(bu oturumda tarih 2026-09-13'e/Pazar'a döndü) vardiya tanımı o günü
kapsamadığından `plannedMinutes=0` çıkıyor — bu doğru iş mantığı, testin
kendisi hafta sonuna dayanıklı yazılmamış. React geçişiyle ilgisi yok.

**Bilinen ortam sınırlaması (koddan değil sandboxtan kaynaklanıyor):**
grafikler bu tarayıcı korumalı ortamında boş kalıyor çünkü Chart.js dış
CDN'den (`cdnjs.cloudflare.com`) yükleniyor ve bu ortam dış CDN erişimini
engelliyor. `UI.chart()`'ın önceden var olan `typeof Chart === 'undefined'`
koruması devreye giriyor; gerçek bir tarayıcıda sorun yaşanmaz.

**Sırada:** Kullanıcıyla anlaşılan kontrol noktası — React geçişi artık
tamamlandığına göre, plan dosyasındaki (`C:\Users\ilker\.claude\plans\
peppy-puzzling-plum.md`) Aşama 4-8 (barkod ZPL, OpenAPI/webhook, PWA,
CRM, BI) için kullanıcıyla yön teyidi alınacak.

---

## 2026-09-12 (devam 6) — Rekabet eksiklerini kapatma turu: Aşama 3 (React — Ürünler/Items)

Dashboard pilotu onayının ardından kullanıcı devam kararı verdi. Plan
dosyasındaki öncelik sırasına göre (Aşama 3: "Stok/Ürünler gibi en çok
kullanılan ekranlar") ikinci ekran olarak **Ürünler (Items)** React'e
taşındı — barkod tarama (kamera + USB okuyucu), ürün formu (dinamik BOM
editörü), stok girişi diyaloğu, ürün kartı (hareketler/belgeler/fiyat
geçmişi) ve CSV dışa aktarım dahil, listedeki EN KARMAŞIK ekranlardan biri.

**Önceden netleştirilen mimari karar:** vanilla `items.js`'de filtre/sayfa
durumu (kategori, arama, sayfa no) modül kapsamında tutuluyor ve ekrandan
ayrılıp geri dönünce KORUNUYORDU. Kullanıcıya bu davranışı koruyup
korumamak soruldu (korumak, tüm liste ekranları için yeni bir "yenile
sinyali" altyapısı gerektirirdi); kullanıcı **Dashboard'daki gibi her
navigasyonda sıfırlanmasını** seçti — daha basit, ek altyapı yok. Bu karar
tüm gelecek liste ekranları (Lots, Counts, Purchasing, Sales, Quality,
Reports, Admin) için de geçerli sayılacak.

**Yapılanlar:**
- `frontend-react/mountView.jsx` (yeni, küçük refactor): Dashboard'daki
  root/mountCount tekrar-mount deseni artık iki view'da da kullanıldığı
  için ortak bir yardımcıya çıkarıldı (`mountView(Component)`); prematüre
  değil, ikinci gerçek kullanım noktasıyla haklı çıkan bir soyutlama.
- `frontend-react/ItemsView.jsx` (yeni): `public/js/views/items.js`'nin
  neredeyse birebir portu — iş mantığı, `UI`/`Api` çağrıları, HTML üretimi
  DEĞİŞMEDİ. Yalnızca dış kabuk React'leşti: modül-seviyesi `let
  state/warehouses/suppliers/allItems` → `useState`/`useRef`, `render(el)/
  load(el)` → veri-çekme `useEffect`'i + `dangerouslySetInnerHTML` + DOM-
  bağlama `useEffect`'i (Dashboard'daki desenle aynı). Diyaloglar (barkod
  tarama, ürün formu, stok girişi, ürün kartı) `UI.modal()` gibi GLOBAL bir
  overlay sistemini kullandığı için değişmeden taşındı.
- **Gerçek bulunan/düzeltilen risk:** ilk portta kamera akışı/zamanlayıcı
  (`scanStream`/`scanTimer`/`stopWedge`) düz `let` olarak bileşen gövdesine
  konmuştu — ama React bir bileşeni her yeniden render ettiğinde fonksiyon
  gövdesi BAŞTAN çalışır, bu da tarama sırasında beklenmedik bir render
  olursa kamera referansının sessizce sıfırlanabileceği (ve kameranın asla
  kapatılamayacağı) anlamına gelirdi. `useRef`'e taşınarak düzeltildi —
  vanilla sürümdeki modül-seviyesi (kalıcı) kapsamla aynı garanti sağlandı.
- `public/index.html`: `/js/views/items.js` script etiketi kaldırıldı
  (artık `/dist/react-views.js` içinde, Dashboard'la aynı bundle).
- `frontend-react/main.jsx`: `window.ViewItems = mountView(ItemsView)`.
- `public/js/views/items.js` silindi (React'e taşındı, artık ölü kod).
- `test/ui-smoke.js`: script-yükleme listesi güncellendi; tek bundle artık
  hem `ViewDashboard` hem `ViewItems` tanımladığından kontrol iki global'i
  birden doğruluyor.
- **Gerçek bulunan ikinci regresyon:** `test/barcode.js` — kamera
  mantığının kaynak metnini STATİK OLARAK `public/js/views/items.js`'den
  okuyup desen arıyordu (ör. `getTracks().forEach(t => t.stop())`,
  `clearInterval(scanTimer)`). Dosya silinince test `ENOENT` ile
  patlıyordu; `node test/run-all.js`'in özetinde "barcode" satırının
  sessizce KAYBOLDUĞU fark edilerek yakalandı. `frontend-react/
  ItemsView.jsx`'i okuyacak ve `useRef` tabanlı yeni değişken adlarını
  (`scanStreamRef.current`, `scanTimerRef.current`) tanıyacak şekilde
  güncellendi.

**Doğrulama:** `npx tsc --noEmit` temiz. `npx eslint .` 0 hata (49 uyarı,
öncesinde de vardı + 1 yeni `card` unused — vanilla dosyada da vardı,
davranış değişikliği değil). `node test/run-all.js` 19/19 paket geçti
(ui-smoke'taki "items renders", "item card opens", "new item form opens",
"stock-in dialog opens" dahil — gerçek React bundle'ına karşı). Tarayıcıda
elle doğrulama: ürün listesi gerçek verilerle render edildi, filtre
uygulanıp (9→1 ürün) başka ekrana geçilip geri dönüldüğünde filtrenin
kararlaştırıldığı gibi sıfırlandığı, ürün kartı/yeni ürün formu (BOM
dahil)/stok girişi diyaloglarının açıldığı doğrulandı.

**Sırada:** Kullanıcıyla anlaşılan kontrol noktası — bir sonraki ekran
(veya Aşama 4-8'e geçiş) için tekrar teyit alınacak.

---

## 2026-09-12 (devam 5) — Rekabet eksiklerini kapatma turu: Aşama 2 Faz 1 (React pilotu — Panel/Dashboard)

**Kapsam:** Arayüz modernizasyonuna kademeli (strangler-fig) geçişin ilk
adımı. Kullanıcıya büyük-patlama React geçişinin riskleri anlatıldı
("reacte geçmek bize ne kazandırır ne kaybettirir riskleri neler");
kullanıcı önerilen küçük/tersine çevrilebilir pilotu onayladı ("senin
önerinle devam et"): 10 ekrandan yalnızca **Panel (Dashboard)** — en düşük
iş riskli, salt okunur ekran — React'e taşınır, diğer 9 ekran hiç
değişmeden vanilla JS'te kalır; sonuç değerlendirilmeden geri kalan 9
ekrana geçilmez.

**Yapılanlar:**
- `vite.config.js` (yeni): `frontend-react/` kaynağını TEK dosyaya
  (`public/dist/react-views.js`) derliyor; çıktı formatı bilinçli olarak
  **IIFE** (ES modül değil) — modül script'leri tarayıcıda otomatik
  ertelenir ve `app.js`'nin `VIEWS` nesnesini kurduğu andan SONRA çalışır,
  bu da `window.ViewDashboard`'ı henüz tanımlanmamış bulup `undefined`
  bırakırdı. IIFE, eski `dashboard.js`'nin yükleme sırasını birebir korur.
- `frontend-react/main.jsx`, `frontend-react/DashboardView.jsx` (yeni): KPI
  kartları, 3 grafik (Chart.js — aynen çağrılıyor), kritik listeler; iş
  mantığı YENİDEN YAZILMADI — `UI.stat()/card()/table()/chart()` ve
  `Api.summary()/trends()` olduğu gibi çağrılıyor.
- **Gerçek bulunan/düzeltilen hata:** ilk yazımda `window.UI`/`window.Api`
  kullanıldı — ama `public/js/ui.js`/`api.js` bunları üst seviye `const` ile
  tanımlıyor, ve klasik `<script>`'te üst seviye `const` `window`'a
  EKLENMEZ (yalnızca `var` eklenir), yalnızca sayfadaki tüm script'lerin
  paylaştığı sözcüksel kapsamdan bare tanımlayıcı olarak erişilebilir.
  Tarayıcıda `TypeError: Cannot destructure property 't' of 'window.UI' as
  it is undefined` ile yakalandı, `window.UI`→`UI`/`window.Api`→`Api`
  olarak düzeltildi ve tarayıcıda gerçek verilerle doğrulandı.
- `public/index.html`: dashboard script etiketi `/dist/react-views.js`'e
  çevrildi (aynı konum, klasik script, `type="module"` YOK).
- `eslint.config.js`: `frontend-react/**/*.jsx` için yeni blok (ES modül +
  JSX ayrıştırma + `UI`/`Api`/vb. paylaşılan globaller); `public/dist/**`
  lint'ten hariç tutuldu (üretilen dosya, düzenlenmez — CLAUDE.md §54);
  `vite.config.js` Node/CommonJS globallerine eklendi.
- **Build zinciri tamamlandı** (plan bunu Faz 1'in parçası olarak
  öngörmüştü, ertelenmedi): `Dockerfile` iki aşamalı hale getirildi
  (builder aşaması `npm run build` çalıştırır, yalnızca `public/dist/`
  çıktısı son (dev bağımlılıksız) imaja kopyalanır); `.github/workflows/
  ci.yml`'e `npm run build` adımı eklendi (typecheck/lint'ten sonra,
  testlerden önce); `.gitignore`'a `public/dist/` eklendi (üretilen dosya
  commit'lenmez).
- `test/ui-smoke.js`: Dashboard'a özel jsdom testi artık gerçek üretim
  eserini (`public/dist/react-views.js`) yüklüyor — önceden üretimden
  koparılmış eski `public/js/views/dashboard.js` kaynağını doğrudan
  yüklüyordu, bu da React'e geçildikten sonra ARTIK TESTİN GERÇEKTE NEYİ
  DOĞRULADIĞINI YANLIŞ GÖSTERİYORDU (sahte güven). Bina bulunamazsa açık
  hata verir (`npm run build` ipucuyla). `dashboard renders` ve `dashboard
  and report charts are constructed` testleri React bundle'ına karşı
  geçiyor.
- Artık üretimde kullanılmayan `public/js/views/dashboard.js` silindi
  (yalnızca yorumlarda tarihsel referans kaldı).

**Doğrulama:** `npx tsc --noEmit` temiz. `npx eslint .` 0 hata (52 uyarı,
hepsi bu değişiklikten önce de vardı, ilgisiz). `node test/run-all.js`
19/19 paket geçti (ui-smoke dahil, React bundle'ına karşı). Tarayıcıda
elle doğrulama: gerçek KPI verileri (₺181.118 toplam stok değeri vb.)
doğru render edildi, konsol hatası yok.

**Bilinen sınırlama (bu ortama özel, kodda değil):** grafikler bu
sandbox'ta boş kalıyor çünkü Chart.js `cdnjs.cloudflare.com`'dan
yükleniyor ve bu tarayıcı korumalı ortamı dış CDN erişimini engelliyor
(`net::ERR_CONNECTION_REFUSED`). `UI.chart()` zaten `typeof Chart ===
'undefined'` durumunda sessizce çıkıyor (mevcut, önceden var olan
davranış) — eski vanilla dashboard da bu sandbox'ta aynı şekilde
etkilenirdi. Gerçek bir tarayıcıda (CDN erişimi olan) sorun yaşanmaz.

**Sırada:** Kullanıcıyla anlaşılan kontrol noktası — geri kalan 9 ekranın
React'e taşınmasına (Aşama 3) otomatik geçilmeyecek; önce bu pilotun
sonucu değerlendirilip yön kullanıcıyla teyit edilecek.

---

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
