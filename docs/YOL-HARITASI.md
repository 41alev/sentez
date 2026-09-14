# Yol Haritası

Bu belge, sistemin sahada kullanılabilir hale gelmesi için kalan işleri sıralar.
`PROJECT_STATUS.md` neyin yapıldığını, bu belge neyin kaldığını gösterir.

---

## Kapsam kararı (güncellendi — bkz. not)

> **Not (bu güncelleme tarihinde):** Bu bölüm ilk yazıldığında hem e-Fatura hem
> muhasebe entegrasyonu tamamen kapsam dışıydı. O tarihten sonra **program-bağımsız
> bir muhasebe aktarım köprüsü eklendi** (bkz. §7) — bu, resmî bir e-Fatura/GİB
> entegrasyonu DEĞİL, yalnızca CSV/JSON dışa aktarımdır, aşağıdaki e-Fatura kararını
> etkilemez. e-Fatura/e-İrsaliye tarafı hâlâ aynı gerekçeyle kapsam dışıdır.

**e-Fatura / e-İrsaliye resmî entegrasyonu kapsam dışıdır.** Resmî belge sorumluluğu
alınmak istenmediği için bu modül devreye alınmamıştır (bir entegratör/GİB hesabı da
yoktur — bkz. "Yalnızca sahada çözülebilecekler").

- e-Belge modülü kodda duruyor ama **varsayılan olarak kapalı** (`einvoiceEnabled = 0`,
  bkz. `server/seed.js`, `server/scripts/setup.js`). İleride bir entegratör hesabı
  edinilirse açılabilir; adaptör katmanı (`server/routes/edocs.js`) ve UBL şema
  doğrulama (`server/lib/ubl.js`) hazır, yalnızca gerçek bir entegratöre karşı hiç
  test edilmedi.
- Faturalama sistem içinde yalnızca **kayıt ve raporlama** amaçlıdır; resmî belge
  üretmez — bunu üreten ayrı, kapalı e-Belge modülüdür.
- **Muhasebeye aktarım artık VAR** (bkz. §7) — resmî bir entegrasyon değil, hangi
  muhasebe programına geçilirse geçilsin hesap kodu eşlemesiyle uyarlanabilen genel
  bir yevmiye fişi dışa aktarımı.

Sistem hâlâ öncelikle *operasyonel* bir araç: stok, üretim, kalite, planlama,
sevkiyat, CRM, destek takibi. Mali/resmî tarafın yalnızca "resmî belge üretme"
kısmı (e-Fatura/e-İrsaliye) dışarıda; muhasebeye veri aktarımı artık içeride.

---

## Sıra

Sıralama şu mantıkla kuruldu: veri aktarılmadan sistem hiç başlamaz (1), sonra
insanların günlük olarak eline değen şeyler gelir (2, 3), ardından gerçek veriyle
dayanıklılık (4), sonra ürünleşme (5, 6). 7-12 arası, bu belgenin ilk yazımından
SONRA — rakip ürünlere karşı geride kalınan alanları kapatmak için ayrı bir
oturumlar dizisinde — eklenen ve o dönemde bu belgeye hiç işlenmemiş modüllerdir;
her biri kendi test paketiyle doğrulanmış, çalışan koddur.

### 1. Excel'den veri aktarımı — **TAMAMLANDI**

Mevcut veriler Excel'de. Elle giriş binlerce kalem için gerçekçi değil.

Kapsam:
- Şablon indirme: her veri tipi için doğru sütunlara sahip boş Excel
- Yükleme ve **önizleme**: kaydetmeden önce ne olacağını göster
- Satır bazında doğrulama: eksik zorunlu alan, tanımsız birim, tekrarlayan kod,
  var olmayan tedarikçi referansı
- Hatalı satırları atlayıp geçerlileri alma seçeneği
- Desteklenecek tipler: ürünler, tedarikçiler, müşteriler, açılış stoğu (parti bazlı),
  reçeteler, iş merkezleri, rotalar
- Aktarım geçmişi: ne zaman, kim, kaç satır, kaç hata
- Geri alma: son aktarımı iptal etme

Kabul ölçütü karşılandı: 1000 satırlık dosya doğrulanıp kaydedildi, hatalı satırlar
listelendi ve sisteme sızmadı. `test/import.js` → 87/87 (üç tekrar-kayıt modunun
üçü de — atla/güncelle/hata ver — gerçek Excel dosyalarıyla test ediliyor).

Yapılanlar:
- 7 aktarım tipi: ürünler, tedarikçiler, müşteriler, açılış stoğu, reçeteler,
  iş merkezleri, rotalar
- Şablon indirme: başlık + açıklama satırı (zorunlu mu, hangi değerler) + örnek satır
- Esnek sütun eşleştirme: "ÜRÜN ADI", "urun adi", "Ad" hepsi tanınır; kısmi eşleşme
  de kabul edilir ("Miktar (kg)" → miktar)
- Türkçe/İngilizce sayı biçimi: "1.234,56" ve "1,234.56" ikisi de doğru okunur.
  Bu önemsiz görünür ama yanlış okunan bir maliyet sessizce yanlış stok değeri üretir.
- Satır bazlı doğrulama: eksik zorunlu alan, okunamayan sayı, dosya içi tekrar,
  var olmayan referans (ürün/iş merkezi), ürünün kendi bileşeni olması
- Tanınmayan değerler uyarıyla varsayılana düşer, satır reddedilmez
- Tekrar davranışı seçilebilir: atla / güncelle / hata ver
- İki aşama: doğrula ve göster → kullanıcı onaylarsa yaz
- Geri alma: yalnızca o aktarımın OLUŞTURDUĞU kayıtlar silinir; hareket görmüş stok
  ve başka yerde kullanılan kayıtlar korunur ve sebebi bildirilir
- Aktarım geçmişi ve denetim kaydı

**Bu sırada bulunan gerçek hata:** Sistemin ürettiği şablonun başlıkları
(ör. "Birim Başına Miktar") eşleştirme listesinde yoktu — yani kullanıcıya
"bu şablonu doldurun" deyip dosyasını reddediyordu. Başlık etiketleri eşleştirmeye
dahil edildi ve her tip için şablon gidiş-dönüş testi eklendi.

### 2. Yazdırılabilir belge şablonları — **TAMAMLANDI**

Sevk irsaliyesi ve sipariş formu var ama firma logosu, kaşe alanı ve özel alanlar yok.
Her fabrika kendi formatını ister.

`test/templates.js` → 50/50.

Yapılanlar:
- 8 belge tipi: sevk irsaliyesi, satın alma siparişi, üretim emri, muayene raporu,
  izlenebilirlik raporu, sayım listesi, parti etiketi, stok kartı
- Firma kimliği: logo yükleme (PNG/JPEG/SVG/WEBP, 512 KB), antet bilgileri,
  tüm belgelerde ortak dipnot
- Şablon düzenleyici: kâğıt boyutu (A4/A5/Letter/Etiket), yön, kenar boşluğu,
  yazı boyutu, vurgu rengi, logo yüksekliği, hangi alanların görüneceği,
  imza kutuları (en fazla 4), üst ve alt not
- Kaydetmeden önce önizleme yazdırma
- Varsayılana dönüş — kullanıcı ayarları bozduğunda çıkış yolu olmalı
- Etiket için ayrı varsayılanlar: küçük kâğıt, sayfa numarası kapalı, barkod açık.
  Sıfırlama da bunu korur; genel varsayılanı uygulamak etiketi A4 yapardı.

Tasarım notu: yazdırma motoru iki imzayı da destekler — `printDoc(başlık, gövde)`
ve `printDoc(tip, başlık, gövde)`. Eski çağrıların hepsini değiştirmek yerine
geriye dönük uyum korundu.

Logo veritabanında base64 olarak saklanır. Yazdırma penceresi ayrı bir belge
olduğu için dosya yolu yerine gömülü veri kullanmak, yetkilendirme ve yol
sorunlarını tamamen ortadan kaldırır; boyut sınırı bu yüzden dar tutuldu.

### 3. Mobil / el terminali depo akışı — **TAMAMLANDI**

Depo işi masaüstünde yapılmaz. Mevcut arayüz mobilde açılıyor ama tek elle kullanıma
göre tasarlanmadı.

`test/mobile.js` → 63/63 + `test/e2e-browser/mobile-offline-queue.spec.js` (gerçek
tarayıcıda `context.setOffline()` ile GERÇEK ağ kesintisi). Adres: `/mobile.html`
(masaüstü kenar çubuğundan da bağlantı var).

Yapılanlar:
- Ayrı, hafif bir arayüz: 56px dokunma hedefleri, yüksek kontrast, birincil
  eylemler ekranın altında (başparmak yukarı zor uzanır)
- **Merkezi fikir — okut, sistem anlasın:** `/mobile/resolve` okutulan kodun ürün
  barkodu mu, parti no mu, belge no mu, raf etiketi mi olduğunu bulur. Kullanıcı
  önce menüden işlem seçmek zorunda değil.
- Beş akış: mal kabul, toplama, sayım, malzeme çıkışı, yer değiştirme
- Görev ekranı: bekleyen mal kabul / sevkiyat / sayım / üretim sayılarıyla
- Toplama listesi FEFO sırasıyla parti ve **raf** önerir — aramak zaman kaybıdır
- Çevrimdışı kuyruk: bağlantı yoksa işlem localStorage'a alınır, bağlantı gelince
  gönderilir. Kullanıcıya "oldu" denir çünkü onun açısından olmuştur.
- Toplu gönderimde bir işlemin hatası diğerlerini düşürmez; her işlem kendi
  sonucunu döndürür, başarısızlar sebebiyle kullanıcıya gösterilir
- USB okuyucu (tuş aralığından algılama) + kamera (BarcodeDetector) + elle giriş

Tasarım notu: toplama ekranı stok hareketi YAZMAZ, yalnızca işaretler. Sevkiyat
masaüstünden oluşturulur; parti seçimi ve kasa bilgisi orada girilir. Terminalde
sevkiyat kapatmak, yanlış basılan bir düğmenin faturaya dönüşmesi demek olurdu.

**Bu sırada bulunan hatalar:** `stock_counts` tablosunda `date`, `stock_lots`
tablosunda `location` sütunu yok (raf ürün kartında tutuluyor). Sorgular gerçek
şemaya göre düzeltildi. Ayrıca `POST /mobile/sync` kalite rolünü TÜMÜYLE
dışlıyordu — kalite masaüstünde sayım kaydedebildiği (count.write) halde mobil
terminalde hiçbir işlem yapamıyordu; route artık kaliteyi kabul ediyor ama yalnızca
sayım işlemine izin veriyor (stok girişi/transfer hâlâ reddediliyor, masaüstüyle
aynı sınır).

### 4. Gerçek veriyle dayanıklılık — **TAMAMLANDI**

Sistem temiz veriyle test edildi. Gerçek veri temiz olmaz.

`test/data-health.js` → 60/60. Arayüz: Yönetim > Veri Sağlığı.

**22 kontrol.** Yabancı anahtarlar verinin şeklini korur; korumadığı şey anlamıdır.
Reçetesi olmayan bir "üretilir" ürün veritabanı açısından kusursuzdur, işletme
açısından bozuktur.

- Stok: kart/parti tutarsızlığı, eksi miktar, maliyetsiz stok, süresi geçmiş ama
  kullanılabilir parti, ürünü silinmiş parti
- Reçete: reçetesiz "üretilir" ürün, reçeteli "satın alınır" ürün, kendi kendinin
  bileşeni, döngüsel reçete, birim uyuşmazlığı (kutu/adet karışıklığı)
- Tekrar: aynı kod, aynı barkod, aynı VKN'li cari, birbirine çok benzeyen adlar
- Belge: sipariş fazlası teslim/sevk, 90 günden uzun açık kalmış belgeler
- Tanım: birimi boş ürün, tedarikçisiz kritik stok, vardiyasız iş merkezi,
  pasif iş merkezine bağlı rota, raf ömrü tanımsız SKT'li ürün

Sağlık puanı (0-100) tek bakışta durum verir; kritik bulgular ağır tartılır.

**Düzeltme dürüstlüğü:** Yalnızca doğru sonucu kesin bilinen bulgular otomatik
düzeltilir (stok özetini yeniden hesapla, süresi geçmişi bloke et, birimi tamamla).
Doğru değeri yalnızca işi bilen birinin belirleyebileceği bulgular (eksi stok,
tekrarlayan barkod, döngüsel reçete) açıkça reddedilir — sessizce bir şey uydurmak
daha kötüdür. Durum değiştiren düzeltmeler hareket kaydı bırakır.

**Birleştirme:** Aynı şeyi temsil eden iki kaydı birleştirir; tüm bağlar hedefe
taşınır. Geri alınamaz olduğu için önce ne taşınacağı sayılıp gösterilir.

**Toplu güncelleme:** Excel'den gelen yüzlerce kaydın birimi veya tedarik şekli
tek seferde düzeltilebilir.

**Bulunan gerçek hata:** `/items/:id` silinmiş ürünü de döndürüyordu — liste onu
gizlerken tekil sorgunun göstermesi tutarsızlıktı ve birleştirme sonrası kaynak
kayıt hâlâ varmış gibi görünüyordu. Düzeltildi.

### 5. Çok şirketlilik — **ATLANDI**

Şema hazır (`company_id` alanları var) ama arayüz ve yetkilendirme kullanmıyor.
**Tek tesis kullanımı planlandığı için atlandı.** Birden fazla şirket veya tesis
takip edilmesi gerekirse buradan devam edilebilir; veri modeli hazır.

### 6. Kurulum ve sürüm yükseltme yolu — **TAMAMLANDI**

`test/setup-upgrade.js` → 46/46. Belge: [`KURULUM.md`](KURULUM.md)

**Bulunan ciddi hata:** Boş veritabanıyla başlatılan her kurulum demo verisini
otomatik yüklüyordu — sahte firma, sahte müşteriler ve şifresi belgelerde yazan
beş kullanıcı. Bir fabrikada bu hem anlamsız veri hem açık bir güvenlik deliği.
Artık demo verisi yalnızca `DEMO_DATA=1` ile gelir; üretimde boş veritabanı
bulunursa sunucu başlamaz ve kuruluma yönlendirir.

- `scripts/setup.js` — firma, yönetici hesabı, depo, para birimi ve kur kaydı.
  Etkileşimli veya parametreli. Şifre kuralı uygulamayla aynı; kurulumda zayıf
  şifreye izin vermek, hiç değiştirilmeyen bir yönetici şifresi bırakır.
  Şifre ekrana basılmaz, ortam değişkeninden alınabilir.
- `scripts/upgrade.js` — sunucu kontrolü → yedek al ve **doğrula** → bekleyenleri
  göster → uygula → sonucu doğrula → başarısızsa **yedeğe geri dön**.
  `--dry-run` ile hiçbir şey değiştirmeden ne yapacağını söyler.
- Yükseltme öncesi yedek `-pre-upgrade` etiketiyle saklanır ve rotasyonda
  silinmez — bir sorun haftalar sonra fark edilebilir.
- `GET /data-health/system` — sürüm, migration durumu, veritabanı boyutu,
  son yedeğin üzerinden geçen gün
- `docs/KURULUM.md` — kurulum, ortam ayarları, yedekleme, yükseltme, Docker,
  izleme ve sorun giderme

Geri dönüş gerçekten test edildi: kasıtlı olarak yarıda patlayan bir migration
yazılıp veritabanının yükseltme öncesi haline döndüğü, yarım kalan tablonun
geride bırakılmadığı ve migration kaydının geri alındığı doğrulandı.

### 7. Muhasebe aktarım köprüsü — **TAMAMLANDI**

Türkiye'deki muhasebe programlarının (Logo/Netsis/Mikro vb.) hepsi farklı — hangisi
seçilirse seçilsin uyarlanabilecek, **programdan bağımsız** bir köprü hedeflendi;
belirli bir programa özel entegratör YAZILMADI.

`test/accounting-export.js` → 22/22. Arayüz: Yönetim > Muhasebe Aktarımı.

Yapılanlar:
- Hesap kodu eşlemesi (`account_code_mappings`): satış geliri, satış KDV'si, alış
  KDV'si, alıcılar, satıcılar, stok gibi anahtarların hangi hesap koduna gideceği
  tekdüzen hesap planı varsayılanlarıyla önceden dolu, ayardan değiştirilebilir
- Verilen tarih aralığındaki satış + alış faturalarından çift taraflı (borç=alacak)
  yevmiye satırı üretimi; dönem sonu kontrolü toplam borç ≠ alacak ise hata verir,
  sessizce yanlış bir dışa aktarım asla üretilmez
- CSV/JSON dışa aktarım (mevcut `UI.exportCsv()` deseniyle aynı)

Kapsam dışı bırakılan (bilinçli): belirli bir programa (Logo/Netsis) özel API
entegrasyonu, otomatik/zamanlanmış aktarım — bunlar hâlâ elle, dönem sonunda
yapılan bir dışa aktarım.

### 8. Arayüz modernizasyonu — React'e tam geçiş — **TAMAMLANDI**

Vanilla JS arayüz (`public/js/views/*.js`) kademeli olarak (strangler-fig deseniyle,
tek seferde değil) React'e taşındı. Bu belgenin ilk yazıldığı tarihte yalnızca
Panel (Dashboard) ekranı React'teydi ("Faz 1 pilotu"); **artık `public/js/views/`
dizini hiç yok — 14 ekranın TAMAMI** (`frontend-react/*.jsx`) React'te:
Panel, Ürünler, Partiler, Sayımlar, Üretim, Satın Alma, Satış, CRM, Destek,
Planlama, Kalite, Raporlar, Yönetim.

- Build: Vite (`npm run build` → `public/dist/react-views.js`, Express bunu
  servis eder). `.github/workflows/ci.yml`'deki CI adımı bunu her push'ta
  yeniden derleyip test ediyor.
- Paylaşılan global mimari (`Api`, `UI`, `I18N`) DEĞİŞTİRİLMEDİ — React
  bileşenleri bunları aynen çağırıyor; iş mantığı, yetkilendirme (`can()`),
  yazdırma motoru yeniden yazılmadı.
- **Bilinen eksik (bkz. genel check-up, madde 2):** `vite build` TEK bir
  ~517KB'lık JS dosyası üretiyor, ekran bazlı kod bölme (`dynamic import()`)
  yok — bu belgenin güncellendiği oturumda ele alındı, aşağıdaki not için
  `PROJECT_STATUS.md`'ye bakın.

### 9. CRM / satış hunisi — **TAMAMLANDI**

Sipariş oluşmadan ÖNCEKİ süreç: bir fırsat (opportunity) doğar, aşamalardan
geçer (yeni → iletişimde → teklif verildi → kazanıldı/kaybedildi), kazanılırsa
gerçek bir satış siparişine dönüştürülür (mevcut sipariş kod yoluyla, kopya
mantık yazılmadan).

`test/crm.js` → 31/31, `test/visits.js` → 19/19. Arayüz: CRM sekmesi.

Yapılanlar:
- Fırsat huni takibi, aşama ilerletme/kaybedildi işaretleme, toplam tahmini
  değer hesaplama
- Fırsata bağlı (isteğe bağlı) saha ziyaret kaydı — yalnızca geçmişe dönük,
  gelecek tarihli randevu/planlama kapsam dışı; konum bilgisi isteğe bağlı
  (tarayıcı Geolocation API'sinden geldiği gibi kaydedilir, sunucu doğrulamaz)
- Aşama/alan değişiklikleri ayrı bir "aktivite geçmişi" tablosu yerine mevcut
  `audit_log`'da tutulur — projenin geri kalanıyla aynı desen

### 10. Müşteri destek/talep (ticket) takibi — **TAMAMLANDI**

Kalite modülündeki uygunsuzluk (NCR) akışından kasıtlı olarak ayrı: NCR bir ÜRÜN
kusurunun kök nedenini takip eder, ticket müşteriyle iletişimi ve çözüm süresini.

`test/support.js` → 29/29. Arayüz: Destek sekmesi.

Yapılanlar:
- Talep açma, öncelik/durum takibi (öncelik sırasına göre listeleme), serbest
  metin yorum geçmişi (`support_ticket_comments` — bir talepte genelde birden
  çok görüşme birikir)
- Gerçek bir ürün kusuru şikayeti geldiğinde `POST /:id/to-ncr` ile tek adımda
  NCR'ye dönüştürme, veri tekrar girilmez

### 11. Üretim planlama ve kapasite (MRP) — **TAMAMLANDI**

`test/planning.js` → 78/78. Arayüz: Planlama sekmesi.

Yapılanlar:
- İş merkezleri, vardiyalar, tatil/istisna takvimi, rotalar (operasyon sırası)
- Kapasite görünümü (gün bazlı, iş merkezi bazlı doluluk)
- MRP çalıştırma: reçete patlaması + açık talep/sipariş üzerinden net ihtiyaç
  hesaplama, satın alma/üretim önerisi üretme; öneriyi gerçek bir siparişe
  dönüştürme veya reddetme
- Döngüsel reçete kontrolü MRP çalıştırılmadan önce uyarı üretir

### 12. Genel API/entegrasyon: OpenAPI + Webhooks — **TAMAMLANDI**

Rekabet eksikleri arasında sayılan "dışarıyla konuşamama" sorunu için: dış
sistemlerin (bir başka yazılım, entegrasyon aracı, kod üretici) bu API'yi
keşfedip olaylara abone olabilmesi.

`test/openapi.js` → 10/10, `test/webhooks.js` → 32/32. Arayüz: Yönetim >
Webhook'lar; şema `/api/docs/openapi.json`'da kimlik doğrulamasız servis edilir
(Postman/Insomnia doğrudan içe aktarabilsin diye).

Yapılanlar:
- OpenAPI 3.0 şeması elle yazılı; test her `$ref`'in gerçekten var olan bir
  şemaya işaret ettiğini kanıtlıyor (aksi halde Swagger UI sessizce bozuk
  görünürdü)
- Webhook abonelikleri: 9 olay tipi (sipariş oluşturma/onay/teslim alma,
  sevkiyat oluşturma/durum değişimi, üretim emri tamamlanması, NCR açılması,
  fırsat kazanılması)
- Otomatik yeniden deneme kuyruğu: başarısız teslimat otomatik olarak tekrar
  denenir (üstel geri çekilme), yalnızca admin manuel tetikleyebilir/durumu
  görebilir — webhook'lar dışarıya iş verisi gönderdiği için yönetimi
  bilinçli olarak admin-only tutuldu (bkz. `PROJECT_STATUS.md` rol taraması
  bulgu 13)

### 13. Barkod etiket yazdırma (Zebra/ZPL) — **TAMAMLANDI**

`test/labels.js` → 23/23. Arayüz: Ürün/Parti ekranlarındaki "Etiket yazdır".

Yapılanlar:
- ZPL (Zebra Programming Language) komut üretici — 203 dpi, mevcut "etiket"
  kâğıt boyutu şablonuyla (100×70mm) eşleşecek şekilde
- Yazıcıya gönderim: ham TCP soket, port 9100 (ZPL yazıcılarının fabrika
  ayarı "raw port" dinleme yöntemi — ayrı bir sürücü/ajan gerektirmez)
- Yazdırmadan önce ZPL dosyasını indirme seçeneği de var (yazıcı yoksa/uzaktaysa
  önizleme/manuel gönderim için)

### 14. KVKK uyumluluğu — **TAMAMLANDI**

`test/kvkk.js` → 39/39. Arayüz: Yönetim > Ayarlar (KVKK bölümü) ve kullanıcı/
müşteri/tedarikçi kartlarındaki KVKK aksiyonları.

Yapılanlar:
- KVKK m.7 — geri döndürülemez anonimleştirme (kullanıcı, müşteri, tedarikçi)
- KVKK m.11/b — "hangi veriyi tutuyoruz" dışa aktarım raporu
- Otomatik saklama süresi taraması (zamanlanmış) + elle tetikleme
- Denetim kaydında literal `"null"` sızıntısı gibi gerçek bir hata bu turda
  bulunup düzeltildi (bkz. `PROJECT_STATUS.md`)

### 15. Özel rapor oluşturucu (pivot) — **TAMAMLANDI (temel düzeyde)**

Rekabet eksikleri arasında sayılan "BI/raporlama derinliği" için sürükle-bırak
bir rapor tasarımcısı YAZILMADI — bunun yerine boyut/metrik/veri kaynağı seçimli,
kaydedilebilir bir pivot tablo oluşturucu eklendi. Talep tahmini (demand
forecasting) hâlâ kapsam dışı, ayrı bir veri bilimi çalışması gerektirir.

`test/pivot.js` → 29/29. Arayüz: Raporlar > Özel Rapor.

Yapılanlar:
- Veri kaynağı/boyut/metrik seçimli pivot çalıştırma, grafik (Chart.js) ile görselleştirme
- Raporu isimle kaydetme; kayıtlı raporu yeniden yükleyip çalıştırma
- Kayıtlı rapor silme yalnızca sahibine veya admin/manager'a açık (bkz.
  `PROJECT_STATUS.md` rol taraması bulgu 14 — bu kısıt önceden yalnızca
  backend'de vardı, arayüz herkese silme ikonu gösteriyordu)

### PWA / kurulabilir uygulama (mobil terminal) — **TAMAMLANDI**

`test/pwa.js` → 31/31. Section 3'teki mobil terminale ek: `/mobile.html` gerçek
bir PWA — `manifest.webmanifest` + service worker ile ana ekrana eklenip
çevrimiçi/çevrimdışı bağımsız bir uygulama gibi açılabiliyor. Service worker'ın
önbellek listesi API çağrılarını HİÇ içermiyor (aksi halde stok/sipariş verisi
bayatlardı) — yalnızca kabuk (HTML/CSS/JS/ikonlar) önbelleklenir.

---

## Yalnızca sahada çözülebilecekler

Bunlar bu ortamda kapatılamaz; kayıt için burada duruyor.

- **Görsel estetik yargısı** — kontrast ve dokunma hedefleri ölçüldü ve düzeltildi;
  hizalama, boşluk dengesi ve genel görünüm insan gözü ister.
- **Kamerayla barkod okuma** — gerçek cihazda denenmeli (Chrome/Edge destekler).
- **El terminali sahada denenmedi** — cihaz yok. USB okuyucu mantığı ve çevrimdışı
  kuyruk test edildi; gerçek bir terminalde bir kez denenmelidir.
- **Bağımsız sızma testi** — ağ, TLS, işletim sistemi katmanı.
- **Paralel pilot** — 1–2 ay mevcut yöntemle yan yana çalıştırıp sayıların tutup
  tutmadığını görmek. Bunun yerine geçecek bir test yok.
- **Kullanıcı eğitimi** — kılavuz yazıldı ama kimse üzerinde denenmedi.

---

## Durum

| # | İş | Durum |
|---|---|---|
| 1 | Excel'den veri aktarımı | **tamamlandı** |
| 2 | Belge şablonları | **tamamlandı** |
| 3 | Mobil / el terminali (+ PWA) | **tamamlandı** |
| 4 | Gerçek veri dayanıklılığı | **tamamlandı** |
| 5 | Çok şirketlilik | **atlandı** (tek tesis, şema hazır) |
| 6 | Kurulum / yükseltme | **tamamlandı** |
| 7 | Muhasebe aktarım köprüsü (genel, programdan bağımsız) | **tamamlandı** |
| 8 | Arayüz modernizasyonu — React'e tam geçiş (14/14 ekran) | **tamamlandı** |
| 9 | CRM / satış hunisi + saha ziyaretleri | **tamamlandı** |
| 10 | Müşteri destek/talep takibi | **tamamlandı** |
| 11 | Üretim planlama ve kapasite (MRP) | **tamamlandı** |
| 12 | Genel API/entegrasyon (OpenAPI + Webhooks) | **tamamlandı** |
| 13 | Barkod etiket yazdırma (Zebra/ZPL) | **tamamlandı** |
| 14 | KVKK uyumluluğu | **tamamlandı** |
| 15 | Özel rapor oluşturucu (pivot) | **tamamlandı** (temel düzeyde — talep tahmini kapsam dışı) |
| — | e-Fatura / e-İrsaliye RESMİ entegrasyonu | **kapsam dışı** (adaptör hazır, kapalı — entegratör hesabı yok) |
