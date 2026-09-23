# KVKK / Veri Koruma Uyum Değerlendirmesi

> **Önemli uyarı:** Bu belge bir **mühendislik/teknik değerlendirmesidir**, hukuki görüş
> değildir. KVKK (6698 sayılı Kişisel Verilerin Korunması Kanunu) uyumu; VERBİS kaydı,
> aydınlatma metinleri, açık rıza metinleri, veri işleyen sözleşmeleri, saklama/imha
> politikası gibi **hukuki** unsurları da içerir — bunlar bu belgenin kapsamı dışındadır ve
> bir KVKK danışmanı/hukukçu tarafından ayrıca ele alınmalıdır. Bu belge yalnızca sistemin
> **teknik altyapısının** KVKK'nın öngördüğü teknik tedbirlerle ne ölçüde uyumlu olduğunu,
> gerçek kod incelemesine dayanarak raporlar.

Değerlendirme tarihi: 2026-09-13. İncelenen kod tabanı: bu depo, `main` dalı.

## 2026-09-20 teknik durum güncellemesi

Bu belgenin aşağıdaki ilk değerlendirme bölümleri tarihsel bulgudur; mevcut
uygulama için tek başına geçerli durum olarak okunmamalıdır. Müşteri, tedarikçi
ve kullanıcı anonimleştirme uçları mevcuttur. İlişkili sipariş, sevkiyat, CRM,
destek, ziyaret ve ilgili denetim kayıtlarındaki yapılandırılmış kimlik kopyaları
tek veritabanı işlemi içinde temizlenir. Denetim kaydının olay kimliği, aktör
kimliği, zaman ve eylemi korunur; kişisel veri taşıyan eski/yeni değer ve
açıklama alanları bu işlemde redakte edilir. Bu, denetim satırının içerik
değişmezliği varsayımına bir istisnadır ve dışa aktarılmış eski kayıtları
değiştirmez. Anonimleştirilmiş kayıtlar API ile yeniden kişisel veriyle
doldurulamaz; aynı müşteriye yeni sipariş, sevkiyat, fırsat, talep veya ziyaret
açılması engellenir.

İzole Faz 0 KV-01/02/03/05 kontrolleri geçmektedir. Bu kontrol, farklı
kayıtlara bağlantısız olarak elle yazılmış serbest metinleri, dosya eklerini,
harici webhook alıcılarını ve eski yedekleri kapsamaz. Kimlik bağlantısı olmayan
fırsat adayları da otomatik olarak bir müşteriyle eşleştirilemez. Canlı veri
üzerinde çalıştırmadan önce saklama/imha politikası, ilgili ticari belge
yükümlülükleri, yedeklerin yaşam döngüsü ve geçmiş serbest metinler ayrıca
yetkili kişilerce değerlendirilmelidir. Teknik test geçişi hukuki uygunluk
onayı değildir.

---

## 1. Sistemde işlenen kişisel veriler (envanter)

Kod tabanı gerçekten incelenerek çıkarılmıştır (`server/migrations/001_initial_schema.js`):

| Tablo | Kişisel veri alanları | Veri sahibi |
|---|---|---|
| `users` | `full_name`, `email`, `password_hash` | Sistem kullanıcısı (çalışan) |
| `customers` | `contact_person`, `phone`, `email`, `address`, `tax_no` | Müşteri firma yetkilisi / şahıs |
| `suppliers` | `contact_person`, `phone`, `email`, `address`, `tax_no`, `bank_info` | Tedarikçi firma yetkilisi / şahıs |
| `audit_log` | işlemi yapan `user_id`, IP (varsa) | Sistem kullanıcısı |

`tax_no` alanı gerçek kişi müşterilerde **TCKN** (T.C. Kimlik Numarası) taşıyabilir —
KVKK'da TCKN özel bir kategori değildir ama doğrudan kimliklendirici olduğu için önemi
yüksektir.

**Envanterde olmayan (bilinçli tasarım — iyi haber):** özel nitelikli kişisel veri (sağlık,
din, sendika üyeliği, biyometrik veri vb.) hiçbir tabloda tutulmuyor. Sistem yalnızca ticari
ilişki verisi (B2B) işliyor; bu, KVKK'nın en ağır yükümlülüklerini (özel nitelikli veri işleme
şartları) doğrudan devre dışı bırakıyor.

---

## 2. Zaten var olan teknik tedbirler (KVKK m.12 kapsamında olumlu bulgular)

Bunlar **gerçekten kodda doğrulandı**, varsayım değildir:

- **Parola güvenliği:** `bcryptjs` ile hash'leniyor (`server/routes/auth.js:3,33,89`), düz metin
  parola hiçbir yerde saklanmıyor.
- **Erişim kontrolü (yetkilendirme):** rol bazlı (`admin/manager/operator/quality/viewer`),
  her endpoint'te sunucu tarafında zorunlu — arayüz gizleme değil.
- **Denetim izi (audit log):** her değişiklik kim/ne zaman/eski-yeni değer ile kaydediliyor,
  **silinemez** (`docs/KULLANIM-KILAVUZU.md:463-464` — kodla doğrulandı).
- **Oturum güvenliği:** JWT + başarısız giriş kilitlemesi (kaba kuvvet koruması), rate
  limiting (`server/index.js:115-122`).
- **Güvenlik başlıkları:** `X-Frame-Options`, `Content-Security-Policy` (`server/index.js:63-70`).
- **Duyarlı veri loglanmıyor:** parola/token'ların log'a yazılmadığı önceki oturumlarda
  ayrıca test edilmiş (`test/security.js`, `test/email.js`).
- **Yedekleme + geri yükleme doğrulaması:** otomatik yedek, bütünlük kontrolü (KVKK m.12/3
  "kişisel verilerin kanuni olmayan yollarla ... kaybolmasını önlemek" ile örtüşüyor).

---

## 3. Gerçek boşluklar (önem sırasına göre)

### 3.1 — YÜKSEK: Veri silme/anonimleştirme hakkı (KVKK m.7, m.11) uygulanmıyor

`DELETE /api/sales/customers/:id` incelendi (`server/routes/sales.js:74-80`) — bu bir
**hard delete değil**, `is_active = 0` yapan bir **soft delete**'tir. Müşterinin adı, telefonu,
e-postası, adresi, VKN/TCKN'si **veritabanında süresiz olarak kalır**. Aynı durum
`suppliers` ve pasifleştirilen `users` kayıtları için de geçerli.

KVKK m.7 ve m.11, ilgili kişiye verisinin silinmesini/yok edilmesini/anonimleştirilmesini
talep etme hakkı tanır. Şu an sistemde bunu yerine getirecek **hiçbir mekanizma yok** —
ne bir "kişisel veriyi anonimleştir" işlemi, ne de bir saklama süresi sonunda otomatik
silme/anonimleştirme.

**Önemli nüans (icat edilmedi, gerçek bir hukuki çakışma):** Vergi Usul Kanunu ve Türk
Ticaret Kanunu, fatura/sevkiyat gibi ticari belgelerin **5-10 yıl saklanmasını zorunlu**
kılar. Yani bir müşterinin faturasını tamamen silmek KVKK'yı değil, vergi mevzuatını ihlal
eder. Doğru çözüm genellikle **"silme" değil "anonimleştirme"**dir: `customers.name`,
`contact_person`, `phone`, `email`, `address` alanları saklama süresi dolduğunda veya
talep üzerine (hukuki bir zorunluluk yoksa) anonim bir değerle değiştirilir, ama fatura
tutarı/tarihi gibi mali kayıtlar (kişisel veri içermeyen kısım) olduğu gibi kalır.

### 3.2 — YÜKSEK: Veri sahibi bilgi talebi (KVKK m.11/b) için dışa aktarım aracı yok

Bir müşteri veya çalışan "hakkımda hangi veriler tutuluyor" dediğinde, bunu tek bir
raporda çıkaracak bir endpoint/rapor **yok**. Şu an yönetici elle birden çok tablodan
(customers, sales_orders, customer_invoices, e_documents, audit_log) sorgu yapmak zorunda
kalır — bu, 30 günlük yasal yanıt süresini riske atar.

### 3.3 — ORTA: Veritabanı ve yedekler "at rest" (bekleme halinde) şifreli değil

`server/db.js` incelendi — düz SQLite dosyası, şifreleme yok. `server/scripts/backup.js`
incelendi — yedek de şifresiz bir dosya kopyası. Sunucuya fiziksel/dosya sistemi erişimi
olan biri (yanlış yapılandırılmış bir sunucu, çalınan bir yedek dosyası, yanlışlıkla genel
erişime açılmış bir depolama) **tüm müşteri/tedarikçi/çalışan verisini düz metin olarak**
okuyabilir. KVKK m.12/1-a "kişisel verilerin hukuka aykırı işlenmesini önlemek" ve Kurul'un
teknik tedbir rehberleri şifrelemeyi önerir (zorunlu değil ama beklenen bir tedbir).

**Neden bu oturumda düzeltilmedi:** `better-sqlite3` (bu projenin veritabanı sürücüsü)
SQLCipher'ı desteklemiyor; şifreleme eklemek ya sürücü değişikliği (büyük, riskli bir
mimari değişiklik) ya da uygulama katmanında alan-bazlı şifreleme (performans ve sorgu
esnekliği kaybı) gerektirir. Bu, "değerlendir" kapsamının ötesinde, ayrı bir mühendislik
kararı gerektiren bir iştir — burada kayda geçirilip kullanıcıya bildirilmesi, sessizce
atlanmasından daha doğrudur. En azından **işletim sistemi düzeyinde disk şifrelemesi**
(BitLocker/LUKS) ve **yedek dosyalarının şifreli bir konumda saklanması** kısa vadede
uygulanabilir, kod değişikliği gerektirmez.

### 3.4 — ORTA: Üçüncü taraflara veri aktarımı belgelenmemiş

Kod incelendiğinde kişisel/ticari verinin sistem dışına **gerçekten çıktığı** üç nokta var:
1. **E-posta bildirimleri** (`server/services/notifications.js`) — kullanıcının SMTP
   sağlayıcısına.
2. **Webhook'lar** (`server/lib/webhooks.js`) — kullanıcının tanımladığı üçüncü taraf
   URL'lere (ör. bir e-ticaret entegrasyonu), sipariş/müşteri verisi içerebilir.

Bunların hiçbiri kötü niyetli veya yanlış değil — B2B bir ERP'de bu aktarımlar normaldir
ve büyük olasılıkla KVKK m.5/2-c ("bir sözleşmenin kurulması veya ifasıyla doğrudan
doğruya ilgili olması") kapsamında rıza gerektirmeden yapılabilir. Ancak KVKK m.10 uyarınca
**aydınlatma metninde bu aktarımların açıkça belirtilmesi** hukuki bir gerekliliktir — bu
metin sistemin kodunda değil, şirketin kendi KVKK dokümantasyonunda olmalıdır. Burada
öneri: hangi üçüncü taraflara veri gittiğinin bu iki nokta üzerinden listelenmesi, aydınlatma
metnini hazırlayacak danışmana doğrudan verilebilir.

**Not:** Bu belgenin ilk yazıldığı tarihte var olan e-Fatura/e-Belge modülü (üçüncü
aktarım noktası olarak burada listeleniyordu) sonradan TAMAMEN kaldırıldı (bkz.
PROJECT_STATUS.md) — satılabilir bir ürün için resmî belge sorumluluğu/mevzuat takibi
istenmediği için. Bu, KVKK açısından da bir aktarım noktasını ortadan kaldırdığı için
olumlu bir yan etki.

### 3.5 — DÜŞÜK: Denetim kaydında IP adresi tutulmuyor

`audit_log` şeması incelendi — IP adresi alanı yok, yalnızca `user_id` + zaman + değişiklik.
Bu KVKK'yı ihlal etmez (fazladan veri tutmamak aslında veri minimizasyonu ilkesine daha
uygundur) ama bir güvenlik olayı sonrası adli inceleme yeteneğini sınırlar. Bilinçli bir
trade-off olarak bırakılabilir; belirtiliyor çünkü bir sonraki güvenlik incelemesinde
"neden IP loglanmıyor" sorusu çıkabilir.

---

## 4. Öncelik sırasına göre öneriler

Bunlar **öneri**dir, bu oturumda **uygulanmadı** — kullanıcı bu maddeyi "değerlendir"
olarak talep etti, "uygula" değil. Uygulanmasına karar verilirse ayrı bir iş kalemi olarak
ele alınmalıdır:

1. **(Yüksek, orta boyutlu iş)** Yönetici arayüzüne "Müşteri verisini anonimleştir" işlemi
   — `is_active=0` yapmanın yanında `name`/`contact_person`/`phone`/`email`/`address`
   alanlarını geri döndürülemez şekilde anonim bir değerle değiştirir; VKN mali kayıt
   bütünlüğü için gerekiyorsa (fatura zaten kesilmişse) korunabilir, ayrı bir hukuki
   değerlendirme gerektirir.
2. **(Yüksek, küçük iş)** Yönetici arayüzüne "Bu müşteri/kullanıcı hakkında tutulan tüm
   veriyi dışa aktar" raporu — KVKK m.11/b taleplerine 30 gün içinde yanıt verme
   yükümlülüğünü pratik hale getirir.
3. **(Orta, işletimsel, kod değişikliği gerektirmez)** Sunucu diskinin ve yedek
   dosyalarının şifreli bir ortamda tutulması; `docs/KURULUM.md`'ye bir "üretim sertleştirme"
   notu eklenmesi.
4. **(Orta, dokümantasyon)** Şirketin KVKK danışmanına bu belgenin ve bölüm 3.4'teki
   üçüncü taraf listesinin iletilmesi; aydınlatma metni/VERBİS kaydı/veri işleyen
   sözleşmelerinin hukuki süreçte tamamlanması.
5. **(Düşük)** Saklama süresi politikası tanımlanması (ör. "ilişkisi sona eren müşteri
   verisi N yıl sonra anonimleştirilir") ve bunu uygulayacak bir arka plan işi.

---

## 5. Sonuç

Sistem, **temel güvenlik hijyeni** açısından (parola hash'leme, yetkilendirme, denetim izi,
oturum güvenliği) sağlam durumda — bunlar KVKK'nın "veri güvenliğini sağlamaya yönelik
teknik tedbirler" beklentisinin büyük kısmını zaten karşılıyor. Asıl boşluk **veri sahibi
haklarının** (silme/anonimleştirme, bilgi talebi) sistemde bir arayüz/mekanizma olarak
karşılığının olmamasıdır — bu, "arka planda otomatik çalışan bir teknik önlem" değil,
**talep üzerine çalışan, elle tetiklenen bir özellik** eksikliğidir ve bir kişi gerçekten
başvuru yaptığında ortaya çıkar. Kısa vadede en yüksek fayda/maliyet oranına sahip olan,
madde 4.1 ve 4.2'deki iki özelliktir.
