# Dream Plus — satış öncesi güncel inceleme

> **26 Eylül 2026 notu:** Bu belge yazıldığı günün fotoğrafıdır. T01–T16
> ve T18'in kod/test kısmı sonradan kapatıldı; güncel durum, kalan saha
> doğrulamaları ve K-01…K-15 için alınan varsayılan kararlar
> [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md) en üst bölümündedir.

20 Eylül 2026 · Koordinatör: Codex · Proje: `C:\Projelerim\Dream\dream-plus`

**Karar: Ürün ticari geliştirmeye değer bir temele sahip; mevcut sürüm müşteri canlı kullanımına hazır değil.** Bu çalışma dosya incelemesi, izole doğrulama ve ticarileştirme planıdır. Uygulama hataları bu çalışmada düzeltilmedi. Yeni modül eklemekten önce stok/mali doğruluk, yedekleme ve tekrarlanabilir teslim tamamlanmalı.

## 1. İncelemenin kapsamı

- Başlangıç envanteri: **254 dosya; 247 metin dosyası, 60.107 fiziksel satır**. Yorum, belge, eski kanıt ve kilit dosyası dahildir; kod satırı sayısı değildir. [Dosya envanteri](DOSYA-ENVANTERI.csv) SHA-256, boyut, satır ve yapısal örüntü sayılarını içerir. `envanter.py` ile yeniden üretilebilir.
- `node_modules`, `.git` iç nesneleri, müşteri `data/` dizini, derlenmiş `public/dist`, test sonuçları ve bu yeni denetimin çıktıları kaynak incelemesi dışında tutuldu. Bağımlılıklar manifest/kilit dosyası ve npm audit ile değerlendirildi; üçüncü taraf kaynaklarının tamamı elle incelenmedi.
- `.env`, `.npmrc`, lisans özel anahtarı içerikleri okunmadı; yalnızca dosya varlığı/boyutu envanterlendi. Dört ikili/diğer dosya içerik incelemesi dışındadır.
- Tüm metin dosyaları otomatik tam dosya envanteri ve yapısal taramadan geçti. Backend route/servis/migration/middleware + DB/migrate kapsamındaki **67 dosya** yardımcı ajan tarafından tam okundu. Koordinatör başlangıç, bakım, yedek, lisans, ortak kütüphaneler, yapılandırma ve kritik bulguları ayrıca inceledi.
- Arayüz/public/test kapsamında **114 metin dosyası** envanterlendi ve örüntüler tarandı; yardımcı ajan en az 37 dosyayı tamamen, büyük dosyaların ilgili bölümlerini ayrıntılı okudu. **Her arayüz/test/belge satırının tek tek semantik doğruluğu kanıtlanmış değildir.** “Bütün dosyalar hatasız” sonucu çıkarılamaz.
- Gerçek müşteri verisi kullanılmadı. Testler geçici, sentetik veritabanlarında çalıştı. Build, üretilmiş `public/dist` çıktısını yeniledi. Mevcut kullanıcı değişiklikleri korundu; commit/push/dağıtım yapılmadı.
- Git kökü alt klasördür; HEAD `fd5e471`. Başlangıçta `PROJECT_STATUS.md`, `README.md` değişmiş; `.claude/`, `CLAUDE.md`, geliştirici rehberi, tam eksik listesi ve Faz 0 testleri izlenmeyen kullanıcı dosyalarıydı.

## 2. Bugün gerçekten çalıştırılan kontroller

Ortam: Windows / PowerShell, Node v24.19.0, Python 3.12.10. CI tanımındaki Node 22/Linux matrisi bu bilgisayarda tekrar çalıştırılmadı.

| Kontrol | Sonuç | Kanıt / açıklama |
|---|---|---|
| `npm run build` | **Geçti** | [build.log](kanitlar/build.log), 1 vendor + 13 ekran |
| `node test/run-all.js` | **Geçti** | [test-all.log](kanitlar/test-all.log), 36 paket |
| `npm run test:e2e-browser` | **Geçti** | [browser.log](kanitlar/browser.log), 35 Chromium testi / 45,6 sn |
| `npm run typecheck` | **Kaldı** | [typecheck.log](kanitlar/typecheck.log), 266 tanı; Faz 0 testleri ve yardımcı kütüphanede |
| `npm run lint` | **Kaldı** | [lint.log](kanitlar/lint.log), 2 hata / 45 uyarı; ilk koşu, yeni denetim betiği eklenmeden önce |
| Yedi Faz 0 denetim dosyası | **Kaldı** | 141 PASS, 75 FAIL, 1 ERROR, 215 INFO; [özet](kanitlar/test-summary.json) |
| NCR hurda / doğrudan Node giriş limiti / tam yedek | **Kaldı** | [Yeni tekrar üretimler](kanitlar/reproduce-new.json), çalıştırılabilir [betik](kanitlar/reproduce-new.cjs) |
| `npm audit --omit=dev --json` | **Geçti** | [npm-audit.json](kanitlar/npm-audit.json), bildirilen üretim zafiyeti 0; uygulama güvenliğini kanıtlamaz |
| Git diff boşluk kontrolü | **Geçti** | Mevcut izlenen değişikliklerde `git diff --check`; CRLF bildirimleri hata değil |
| Temiz müşteri makinesi, servis/TLS, Docker, fiziksel cihaz, pilot | **Doğrulanamadı** | Bu çalışma bu ortamlara dağıtım yapmadı |
| Gerçek veri migration / üretim değişikliği | **Uygulanamaz** | Bu incelemenin kapsamı değil; yapılmadı |

**Sayıları doğru yorumlama:** 75 FAIL, 75 bağımsız ürün hatası demek değildir. Bazı kontroller birden çok durumu birleştiriyor; bazı beklentiler ürün politikası gerektiriyor. PASS toplamında yalnız gözlem üreten kontroller de var. 215 INFO başarı değildir. `b4c-ops` içindeki ERROR, test sorgusunun olmayan `s.created_at` sütununu istemesinden kaynaklanıyor; ürün kusuru sayılmadı. `b1a-sales` 35/5 sonucunu loga yazdıktan sonra mevcut salt okunur sonuç JSON'una yazarken EPERM aldı; sonucu yeni logdan aldık, eski JSON'u güncel kanıt saymadık. Test verisi temizliği bu hata yolunda garanti edilmedi; müşteri verisine temas yok.

Ana test takımı Faz 0 testlerini çalıştırmıyor. Bu yüzden ana testlerin yeşil olması aşağıdaki bulguları kapatmıyor. Tip/lint sorunlarını testleri dışlayarak veya kuralları kapatarak gizlememek gerekir.

## 3. Satıştan önce öncelikli teknik işler

P1: müşteri verisi, stok, para, erişim veya temel kullanım üzerinde önemli etki. “Kaynak” statik incelemeyi, “API” bu oturumdaki gerçek izole tekrar üretimi belirtir.

| ID | Öncelik ve bulgu | Kanıt | Tamamlanma ölçütü |
|---|---|---|---|
| T01 | P1: NCR hurda sağlam lotu tüketiyor | **API:** reddedilmiş 5 adet kalıyor, sağlam 10→5; HTTP 200. `server/routes/quality.js:302,315`, `server/services/stock.js:98,126` | Sadece NCR'ye bağlı lot doğru miktarda azalır; sağlam lot değişmez; tekrar ve kısmi hata testi geçer |
| T02 | P1: Yedek DB ile sınırlı, uploads yok | **API + kaynak:** oluşturulan tek çıktı `.sqlite`; `server/scripts/backup.js:43,53`, `restore.js` | DB+dosya manifesti+hash; temiz dizine geri dönüş; bozuk/eksik paket reddi; kesintide tutarlı kurtarma |
| T03 | P1: Doğrudan Node portunda IP başlığıyla giriş limiti aşılabiliyor | **API:** 10 yanlış giriş sonrası 429, değişen X-Forwarded-For ile tekrar 401. `server/index.js:99` | Doğrudan bağlantıda istemci başlığına güvenilmez; izinli proxy ve doğrudan kurulum ayrı test edilir. Nginx başlığı üzerine yazıyor; aynı bulgu nginx arkasında doğrulanmış sayılmaz |
| T04 | P1: Ürün birleştirme birim/reçete/ilişki bütünlüğünü bozuyor | **API:** DH-02/03/09; reçete 5 yerine 2, kg+adet birleşiyor. `server/routes/data-health.js:48,138,155` | Birim uyuşmazlığı reddi; tüm ilişkiler korunur; reçete kaybı yok; kaynak/hedef cache ve defter mutabık |
| T05 | P1: Import satır hataları ve geri alma kısmi veri kaybı riski | **Kaynak:** `server/services/import-commit.js:225,293,305,333` | Çok yazmalı her satır savepoint/transaction; FK hatasında önceki silmeler de geri alınır; tekrar üretim + regresyon |
| T06 | P1: Alış faturası gerçek kısmi teslimat eşleştirmesi yapmıyor | **API + kaynak:** SI-01/02; `server/routes/purchasing.js:630` | PO/teslim/fatura satırı miktar tahsisi, aynı miktara ikinci fatura engeli, doğru receipt sahipliği, satır kur/vergi snapshot |
| T07 | P1: Sayımı Kaydetmeden Onayla, girilen miktarları kaybedebilir | **Kaynak:** `frontend-react/CountsView.jsx:139`, `public/js/ui.js:64` | Onay penceresi açılmadan girişler alınır; eski kayıtlı ve yeni sayımda gerçek tarayıcı testi |
| T08 | P1: Sayfalama bazı ekranlarda hep ilk sayfayı getiriyor | **Kaynak:** `SalesView.jsx:55,84`, `PurchasingView.jsx:57,90`, Counts/Quality/Admin/Planning benzer | 26./51. kayıt görünür; sayfa state korunur; filtre değişince sıfırlanır; >300 ürün ve >200 müşteri seçimde aranabilir |
| T09 | P1: MRP make/buy alanı normal ürün API'sinde kayboluyor; tarihsel arz/talep eksik | **API:** MP-00; **kaynak:** `items.js:123`, `mrp.js:100,112,125` | make/buy kaydı korunur; yarınki ihtiyaç sonraki ay teslimiyle karşılanmaz; emre sabit BOM ve emniyet stoğu testleri |
| T10 | P1: Kapasite gerçek vardiya ve çakışmaları yerleştirmiyor | **Kaynak:** `server/services/capacity.js:116,128` | Aynı kaynakta iki iş çakışmaz; vardiya/mola/gece yarısı/çok gün senaryoları geçer |
| T11 | P1: Fatura ödeme durumu koşulsuz değişiyor | **API:** INV-02/AC-02; `server/routes/sales.js:471` | İptal/iade için açık kural; mükerrer çağrı etkisiz; tahsilat kapsamı net; audit korunur |
| T12 | P1: Anonimleştirme eski kimlik bilgilerini audit/kopyalarda bırakıyor | **API:** KV-01/02/03/05, CR-05; `server/lib/kvkk.js`, müşteri/CRM yazma yolları | Kişisel veri envanteri + hukuken gereken saklama kararı; kapsam içi alanlarda kalıntı testi; anonim kayıt yaşam döngüsü |
| T13 | P1: Sağlık otomatik düzeltmesi kullanılabilir stok cache'ini yenilemiyor | **Kaynak:** `server/services/data-health.js:123` | Miadı geçmiş lot blocked olduktan sonra cache=available lot toplamı; hedefli runtime testi |
| T14 | P1/P2: Kalite imzası parolayı/ölçümleri doğrulamıyor | **Kaynak:** `server/routes/quality.js:153,189` | Yanlış parola reddi, onaylanan içeriğin snapshot/hash doğrulaması; hukuki e-imza iddiası yapılmaz |
| T15 | P1/P2: Webhook olay kaybı ve hedef adres politikası | **Kaynak:** `server/lib/webhooks.js:sendDelivery/dispatchEvent/processRetryQueue` | İş transaction'ında outbox, sabit olay kimliği, çökme/tekrar testleri; izinli hedef ve yönlendirme politikası |
| T16 | P1/P2: Sayı/tarih/boolean ve geçmiş maliyet tutarlılığı | **API + kaynak:** CO/AD/PL testleri; `import.js:202`, `accounting-export.js:39`, `stock.js` | Belirsiz ondalık reddi/seçili yerel biçim; kart KDV değişince eski belge değişmez; seçili maliyet yöntemiyle rapor mutabakatı |
| T17 | P1 teslim: Kurulum, sürüm, lisans ve müşteri paketi | **Kaynak:** KURULUM, Docker, license, index | Kaynak/sır/demo ayrımı; temiz Windows kurulumu; servis restart/TLS; kontrollü upgrade + tam yedek; lisans/yenileme davranışı testi |
| T18 | P2 kalite: Test kapıları, hata ekranları, çift gönderim, erişilebilirlik | Bu bölümdeki tsc/lint, UI incelemesi | Tip/lint geçer; kritik kötü senaryolar CI'da; başarısız API'de hata/tekrar; çift tıklamada tek etki; klavye/odak testi |

T04'te müşteri/tedarikçi birleştirmesinin FK hatası dış transaction tarafından geri alınıyor; bu alt senaryoya kanıtsız “kısmi birleşti” demiyoruz. T05 satır içi hata yutma farklı bir durumdur. Miadı geçmiş malın çıkış politikası, toleranslar, sayım kesim zamanı ve kısmi ödeme gibi iş kararları eski listedeki K maddeleriyle netleştirilmeli; sessiz varsayımla uygulanmamalı.

## 4. Paket, lisans ve belgelerde tespit edilen çelişkiler

- `LICENSE` hak sahibi alanı hâlâ yer tutucu. Dağıtılan üçüncü taraf bağımlılıkların lisans/bildirim dosyaları ayrıca envanterlenmeli. Hukuki uygunluk bu incelemeyle onaylanmadı.
- Lisans imzası Ed25519; fakat `LICENSE_FILE` boşsa kontrol tamamen kapanıyor. Kullanıcı/modül/kurulum kapsamı ve çalışma sırasında süre yönetimi yok. Yıllık gelir modeli yalnız bu değişkeni ekleyerek ticari olarak tamamlanmış olmaz. Kaynağa erişen yerel yöneticiden mutlak kopya koruması beklenmemeli.
- Özel imzalama anahtarı klasörde mevcut. İçeriği okunmadı. Bu Git kopyasında `git ls-files` ve `git log --all -- license-signing-key.pem` sonuçları boş; geçmiş başka kopyalara sızmadığını kanıtlamaz. Müşteri paketi izin listesiyle üretilmeli; klasörü bütünüyle ZIP yapmak uygun değil.
- `server/index.js:51` başlangıçta otomatik migration yapıyor; yükseltme scriptindeki yedekli yol zorunlu değil. Eski 017 migration e-belge tablolarını kaldırıyor; eski müşteri verisi varsa geçiş etkisi ayrıca değerlendirilmeli.
- README build adımını anlatıyor; KURULUM ve saha belgeleri `npm install --omit=dev` sonrası build olmadan başlatıyor. Bu akış ancak önceden derlenmiş ve doğrulanmış dağıtım paketi varsa çalışır; Git kaynak teslimiyle eşdeğer değil.
- Saha kartında `restore --verify` gerçek geri yükleme yapılmış gibi yazılmış; bu komut yazmadan doğrular. Tam geri dönüş provası farklıdır.
- Masaüstü ürün kararı kayıtlı olsa da mobil route/statik dosyalar ve Docker `COPY public/` hâlâ mevcut. Mobilin kapsam dışı yazılması paketten çıkarıldığı anlamına gelmez. Önceki “en son kaldır” kararı korundu; bu çalışmada silinmedi.
- Nginx TLS bloğu yorumlu; saha kartı doğrudan HTTP/3000 erişimi anlatıyor. Desteklenecek tek net güvenli kurulum yoluna ihtiyaç var.
- Eski belgelerde IP audit kaydı yok deniyor; güncel `server/lib/core.js` `req.ip` yazıyor. V11'in yalnız bulk-update ifadesi eksik: import da procurement_type yazabiliyor. V13'te mükerrer iş merkezi için güncel açık 409 kontrolü var. Belgedeki her eski bulgu otomatik yeniden doğrulanmış sayılmamalı.
- Belge revizyonu çatallanması ve silinen dosyanın diskte kalması Faz 0'da tekrarlandı. Paylaşılan revizyon dosyalarını dikkate almadan `unlink` eklemek doğru çözüm olmayabilir.

## 5. Proje alanlarının durumu

| Alan | Durum | Bilinen / açık konu |
|---|---|---|
| Ürün ve kullanıcı | Açık soru | Stok/üretim odaklı, tek müşteri/tesis mimarisi biliniyor; ilk hedef sektör ve erişilebilir müşteri teyidi bekleniyor |
| İş kuralları | Açık soru | Kod ve K-01…K-15 listesi var; miat/iadeler/tolerans/sayım/ödeme kararları açık |
| Mimari | Biliniyor | Express + SQLite WAL; React ekranları ve ortak DOM yardımcıları; mevcut monolit korunmalı |
| Veri | Biliniyor / Açık soru | 22 migration ve lot/maliyet modeli incelendi; müşteri gerçek veri hacmi/mutabakâtı bilinmiyor |
| Güvenlik ve gizlilik | Açık soru | Oturum/yazma yetkileri mevcut; veri okuma politikası, anonimleştirme, proxy, saha TLS kabulü açık |
| API ve entegrasyon | Biliniyor | REST, kısmi OpenAPI, webhook, muhasebe aktarımı; resmî e-belge kapsam dışında |
| Test ve kalite | Biliniyor | Bu rapordaki gerçek koşu; kritik başarısızlıklar açık |
| Çalışma/dağıtım | Açık soru | Yerel Windows doğrulandı; müşteri temiz kurulum ve hizmet modeli doğrulanmadı |
| Operasyon/yedek | Açık soru | DB yedeği var, tam paket yok; müşteri RPO/RTO ve destek saatleri kararlaştırılmalı |
| Lisans/dış koşullar | Açık soru | Mülkiyet lisansı yer tutuculu; sözleşme ve bileşen bildirimleri tamamlanmalı |

## 6. Tamamlama sırası ve kalite kapıları

1. **Doğrulama temelini güvenilir yap:** Faz 0 tip/lint/test SQL ve sonuç yazma problemleri; somut hataları kalıcı regresyonlara çevir. Ana paketi geçiyor diye mevcut FAIL'leri dışarıda unutma.
2. **Stok ve veri kaybını kapat:** T01/T04/T05/T07/T13; T02 tam yedek aynı önceliktedir. Her değişiklik önce izole kötü senaryoyla, sonra mevcut paketle doğrulansın.
3. **Mali ve üretim zincirini tamamla:** T06/T09/T10/T11/T16; eski kayıt mutabakatını ayrı önizlemeli iş olarak ele al. Kapsam kararları ölçülebilir kabul senaryolarına dönsün.
4. **Güvenli teslimi tamamla:** T03/T12/T14/T15/T17 ve gerçek sayfalama. Satılacak modüllerin tüm kritik hataları kapanmadan canlı müşteri teslimi yok.
5. **Kontrollü pilot:** Satın alma→kabul/kalite→üretim→sevkiyat→iade→rapor zinciri, iki gerçek rol, sayım ve tam geri yükleme. Mevcut kayıt yöntemiyle en az bir tam iş çevriminde mutabakat. İlk pilot için 30–60 günlük süre bir plan önerisidir, bitiş garantisi değildir.
6. **Genel satış:** Kritik açık yok; temiz kurulum/restart/yükseltme/kurtarma kanıtı var; müşterinin kabul tutanağı, eğitim ve destek kapsamı teslim edilmiş. Mobilin son aşamada kaldırılması ve paket denetimi kayıtlı kapsamla tamamlanmış.

Takvim ancak ilk düzeltme grubunun gerçek süresi ve müşteri kapsamı görüldükten sonra netleştirilmeli. Bugün “%90 bitti” veya kesin satış tarihi için ölçülebilir dayanak yok.

## 7. Bağımsız inceleme ve kararlar

`ai_team.py --phase plan` seçili kurallar/paket/devir belgesiyle çalıştırıldı. Claude CLI 60 saniyede zaman aşımına uğradı; görüş alınmış sayılmadı. Gemini yanıt verdi; bu yanıt kaynak kodun tam incelemesi değildir. DB+dosya yedeği önerisi kodla doğrulandı. “Lisans denetimini DB açılmadan önce taşı” önerisi zaten yapılmış; uygulanmadı. “e-Fatura yokluğu satışa hukuken engel” sonucu verilen kanıtla desteklenmedi ve benimsenmedi; kayıtlı ürün kapsamında e-belge yok.

İki bağlı Codex yardımcı ajan yalnız okuma yaptı; UI ve core bulguları kaynakla kontrol edildi, NCR ayrıca API'de tekrarlandı. MRP sipariş satırı kuruna dair ilk yardımcı ajan şüphesi migration020 trigger'ı görülünce geri çekildi; hata listesine alınmadı. Görüş birliği test kanıtının yerine kullanılmadı.

Son `--phase review` sonucu [peer-review.json](kanitlar/peer-review.json) içinde. Claude tekrar 60 saniyelik zaman aşımı verdi; bu plan çağrısının kör tekrarı değil, raporun ayrı son incelemesiydi. Gemini teknik engellerin kapanması gerektiğini yineledi. Ancak planı “satışa hazır iddiası” olarak okuması metinle uyuşmuyor; plan açıkça hazır olmadığını söylüyor. PASS/toplam oranına INFO kayıtlarını dahil ederek başarı oranı çıkarması da geçersiz. Bu yorumlar benimsenmedi; yedek ve canlı teslim öncesi kritik hata kapısı zaten raporda mevcut. İki harici görüş çağrısı birer turla ve çağrı başına 60 saniyeyle sınırlandı.

Ticari plan ve müşteri görüşme taslağı: [SATIS-VE-GELIR-PLANI.md](SATIS-VE-GELIR-PLANI.md).

**Sonraki somut geliştirme:** T01 NCR yanlış lot tüketimini hedefli regresyonla düzelt; aynı veri bütünlüğü grubunda tam yedek, birleştirme ve import atomikliği devam eder. Bu rapor satışa hazır onayı değildir.
