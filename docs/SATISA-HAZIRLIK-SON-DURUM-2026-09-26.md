# Dream Plus 2.0.1 — satışa hazırlık son durum

**Tarih:** 26 Eylül 2026  
**Kapsam:** Tek müşteriye ait, ayrı kurulum olarak çalışan Dream Plus ERP  
**Teknik karar:** Kod deposunda kapatılabilen satış engelleri kapatıldı. Sürüm,
temiz müşteri kurulumu ve kontrollü pilot için bir **release candidate**'dır.
Gerçek müşteri ağı, cihazı, hukuki metni ve imzalı kabulü kod testiyle
kanıtlanamayacağı için bunlar her satışta aşağıdaki teslim kapılarından geçer.

## Kapatılan teknik başlıklar

- Stok, lot, sevkiyat, sayım, üretim, satın alma, satış ve kalite işlemlerinde
  yetki, eşzamanlılık, ters kayıt ve veri bütünlüğü kontrolleri tamamlandı.
- Müşteri ve tedarikçi faturaları ile ödemelerde tam sayı kuruş alanları kaynak
  gerçeklik oldu. Eski ondalık alanlarla ayrışma veritabanı tetikleriyle
  engelleniyor; yarım kuruş politikası sıfırdan uzağa yuvarlamadır.
- Kısmi tahsilat/ödeme, fazla ödeme engeli, ödeme ve mal kabul ters kaydı,
  gerçek sevkiyat maliyeti, stok alacağı ve ödeme yevmiyeleri test edildi.
- Eski alış faturaları yönetici kontrollü mutabakat, KDV/kur snapshot'ı,
  onay ve ödeme kapısıyla güvenli akışa alındı.
- Bildirim okundu durumu kullanıcıya ayrıldı. Bir kullanıcının okuması başka
  kullanıcının rozetini değiştirmiyor.
- Belge yüklemede bildirilen MIME yerine gerçek dosya bayt imzası kontrol
  ediliyor; sahte görsel/ofis içeriği reddediliyor ve indirme ek olarak sunuluyor.
- Üretimde `CORS_ORIGINS` boşsa çapraz kaynak izin başlığı verilmiyor. `/health`
  kullanıcı sayısı veya iç veritabanı hata mesajı açıklamıyor.
- Kur ve fatura dönüşümleri güvenli tamsayı para aralığını aşarsa kayıt öncesi
  422 dönüyor; uç değerler 500 veya bozuk mali kayıt üretmiyor.
- Satın alma ekranında tedarikçi iadesi oluşturma, listeleme ve durum ilerletme
  akışı bulunuyor.

## Doğrulama kanıtı

| Kontrol | Durum | Sonuç |
| --- | --- | --- |
| `node test/run-all.js` | **Geçti** | 41 izole test paketi |
| Faz 0 doğrulama | **Geçti** | 217 kontrol, 0 başarısız, 0 hata |
| Chromium uçtan uca | **Geçti** | 39/39 |
| Güvenlik paketi | **Geçti** | 69/69, 0 uyarı |
| Muhasebe paketi | **Geçti** | 36/36 |
| API sözleşmesi / OpenAPI | **Geçti** | 58/58 ve 10/10 |
| UI smoke | **Geçti** | 113/113 |
| Build / typecheck | **Geçti** | Hata yok |
| Lint | **Geçti** | 0 hata; tarihsel uyarılar var |
| `npm audit --audit-level=high` | **Geçti** | 0 bilinen zafiyet |
| Temiz release paketi kurulumu | **Geçti** | İzole dizin, `npm ci --omit=dev`, 0 zafiyet |
| Üretim süreci yeniden başlatma | **Geçti** | `/health`, migration=0, yeniden giriş başarılı |
| Tam yedek ve boş dizine geri yükleme | **Geçti** | bütünlük `ok`, FK=0, firma/kullanıcı ve giriş korundu |
| Docker imajı | **Doğrulanamadı** | Bu bilgisayarda Docker kurulu değil |

Temiz paket provası gerçek müşteri verisine dokunmadan işletim sistemi geçici
dizininde yapıldı. Tam yedek başka boş dizine geri yüklendi ve geri yüklenen
kopya ayrı üretim süreciyle açıldı. Bu, uygulama paketini ve kurtarma zincirini
kanıtlar; başka fiziksel bilgisayar, gerçek servis yöneticisi veya off-site
depolama sağlayıcısı kanıtı değildir.

Bağımsız `ai_team.py --phase review --timeout 300` turunda Gemini verilen
dosyalarda yeni somut hata bulmadı. Claude 1,91 saniyede oturum kota sınırı
mesajı verdiği için Claude incelemesi **Doğrulanamadı**. Bağlam sınırı nedeniyle
bazı test dosyaları yardımcı incelemeye gitmedi; ana karar yerel kod ve canlı
test sonuçlarına dayanır.

## Her ücretli teslimatta kapanacak dış kapılar

| Kapı | Sorumlu | Zorunlu kanıt | Şimdiki durum |
| --- | --- | --- | --- |
| Temiz müşteri bilgisayarı ve servis | Kurulumcu | Bilgisayar yeniden başladıktan sonra sağlık ve giriş | **Doğrulanamadı** |
| TLS, alan adı ve proxy | Kurulumcu / müşteri BT | Uyarısız HTTPS, doğru `TRUST_PROXY`, kapalı doğrudan port | **Doğrulanamadı** |
| Gerçek off-site yedek | Müşteri / kurulumcu | Uzak hedefte bundle ve oradan boş ortama geri dönüş | **Doğrulanamadı** |
| Barkod ve yazıcılar | Müşteri / kurulumcu | Müşterinin USB okuyucu, etiket ve belge çıktıları | **Doğrulanamadı** |
| Temsili müşteri verisi | Müşteri / kurulumcu | İçe aktarma, süre/bellek, migration ve geri dönüş tutanağı | **Doğrulanamadı** |
| Pilot kabul | Müşteri | `PILOT-KABUL-PLANI.md` 13 adım ve imzalı tutanak | **Doğrulanamadı** |
| Hukuki/ticari paket | Satıcı / hukukçu | Lisans/satış sözleşmesi, KVKK rolleri, destek-SLA, yedek sorumluluğu | **Doğrulanamadı** |

Bu kapılar ürün kodunda eksik özellik anlamına gelmez; müşteri ve ortam seçilmeden
gerçekleştirilemeyen teslim koşullarıdır. Herhangi biri kaldığında o müşterinin
üretim kurulumu kabul edilmiş sayılmaz.

## Satış teslim sırası

1. `release/dream-plus-2.0.1` paketindeki `RELEASE.json` ve
   `SHA256SUMS.txt` doğrulanır.
2. Müşteriye özel `.env`, yönetici hesabı ve gerekiyorsa imzalı lisans dosyası
   oluşturulur; demo hesap/verisi taşınmaz.
3. `docs/SAHA-KURULUM-KARTI.md` uygulanır; servis, TLS ve yedek zamanlaması
   kurulur.
4. `docs/PILOT-KABUL-PLANI.md` gerçek kullanıcı ve verilerle yürütülür.
5. Kritik hata sayısı sıfır, geri yükleme başarılı ve tutanak imzalıysa üretim
   kabulü verilir. Açık kritik olmayan maddeler sahip ve hedef tarihle kaydedilir.

Eski denetim belgeleri tarihsel kanıttır. Güncel karar için bu belge ile
`PROJECT_STATUS.md` dosyasının en üst bölümü esas alınır.
