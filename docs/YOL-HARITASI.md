# Yol Haritası

Bu belge, sistemin sahada kullanılabilir hale gelmesi için kalan işleri sıralar.
`PROJECT_STATUS.md` neyin yapıldığını, bu belge neyin kaldığını gösterir.

---

## Kapsam kararı

**e-Fatura / e-İrsaliye ve muhasebe entegrasyonu kapsam dışıdır.** Resmî belge sorumluluğu
alınmak istenmediği için bu modüller geliştirme sırasına alınmamıştır.

- e-Belge modülü kodda duruyor ama **varsayılan olarak kapalı** (`einvoiceEnabled = 0`).
  İleride istenirse açılabilir; adaptör katmanı hazır.
- Faturalama sistem içinde yalnızca **kayıt ve raporlama** amaçlıdır; resmî belge üretmez.
- Muhasebeye aktarım yok. Muhasebe süreci mevcut yöntemle yürütülür.

Bu karar, sistemin *operasyonel* bir araç olarak konumlandığı anlamına gelir:
stok, üretim, kalite, planlama ve sevkiyat takibi. Mali/resmî taraf dışarıda.

---

## Sıra

Sıralama şu mantıkla kuruldu: veri aktarılmadan sistem hiç başlamaz (1), sonra
insanların günlük olarak eline değen şeyler gelir (2, 3), ardından gerçek veriyle
dayanıklılık (4), en sonda ürünleşme (5, 6).

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
listelendi ve sisteme sızmadı. `test/import.js` → 82/82.

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

`test/mobile.js` → 57/57. Adres: `/mobile.html` (masaüstü kenar çubuğundan da bağlantı var).

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
şemaya göre düzeltildi.

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
| 3 | Mobil / el terminali | **tamamlandı** |
| 4 | Gerçek veri dayanıklılığı | **tamamlandı** |
| 5 | Çok şirketlilik | **atlandı** (tek tesis) |
| 6 | Kurulum / yükseltme | **tamamlandı** |
| — | e-Fatura, muhasebe | **kapsam dışı** |
