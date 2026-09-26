# Dream Plus — Claude sonrası bağımsız son denetim

> **Güncellik notu:** Bu belge `c1714b4` sürümündeki açıkları kaydeden tarihsel
> denetimdir. Buradaki yedi teknik engel daha sonraki `8ccb7c2`, `7dd0767` ve
> 2.0.1 sertleştirme turunda kapatıldı. Güncel karar ve gerçekten açık kalan
> saha kapıları için
> [`SATISA-HAZIRLIK-SON-DURUM-2026-09-26.md`](SATISA-HAZIRLIK-SON-DURUM-2026-09-26.md)
> esas alınır.

**Tarih:** 26 Eylül 2026

**İncelenen sürüm:** `c1714b4` (`main`, `origin/main`)

**Amaç:** Claude Code tarafından kapatıldığı bildirilen satış engellerini kod,
test ve paket çıktısıyla yeniden doğrulamak; ücretli müşteri kurulumundan önce
kalan işleri önem sırasıyla belirlemek.

## Karar

Claude turu gerçek ve kapsamlı ilerleme sağladı. T06 eski alış faturası
mutabakatı, kısmi tahsilat/ödeme defterleri, tarihsel MRP snapshot'ı,
çakışmasız kapasite planlama, sayfalama, arayüz dayanıklılığı, lisans operasyonu
ve müşteri release paketi uygulandı. Ana regresyon, tarayıcı, derleme, tip,
lint ve bağımlılık kontrolleri çalışıyor.

Ancak ürün bugün **genel satışa hazır değildir**. İlk ücretli üretim kurulumu
öncesinde kapatılması gereken **7 teknik**, sahada kanıtlanması gereken **7
operasyonel/ticari kapı** vardır. En önemli neden, Faz 0 paketinin bazı açıkları
`INFO` yazıp ilgili senaryoyu `PASS` saymasıdır. Bu yüzden
`217 PASS / 0 FAIL / 0 ERROR` ifadesi bütün gözlemlerin doğru davranış olduğunu
kanıtlamaz.

## Canlı doğrulama sonucu

| Kontrol | Durum | Sonuç |
| --- | --- | --- |
| `node test/run-all.js` | **Geçti** | 40 paket |
| `npm run test:e2e-browser` | **Geçti** | 39/39 Chromium |
| `npm run build` | **Geçti** | Vite build; `.env` içindeki `NODE_ENV` için mevcut uyarı var |
| `npm run typecheck` | **Geçti** | Tip hatası yok |
| `npm run lint` | **Geçti** | 0 hata, 45 uyarı |
| `npm audit --omit=dev --audit-level=high` | **Geçti** | 0 bulgu |
| `npm run release` | **Geçti** | `release/dream-plus-2.0.0`, 160 dosya, commit `c1714b4` |
| `npm run test:mobile` | **Kaldı** | Silinmiş pakete işaret ediyor: `Unknown test suite` |
| `npm run test:pwa` | **Kaldı** | Silinmiş pakete işaret ediyor: `Unknown test suite` |
| `git diff --check b34ed42..c1714b4` | **Kaldı** | Arşiv belgede 2 trailing whitespace |
| Temiz Windows, servis restart, gerçek TLS, off-site restore, müşteri pilotu | **Doğrulanamadı** | Bu bilgisayardaki sandbox testleri bunların yerine geçmez |

**Bağımsız ajan incelemesi:** AGENTS.md gereği `ai_team.py --phase review
--rounds 2 --timeout 300` ile Claude ve Gemini görüşü istendi. Çağrı 10 dakika
50 saniye boyunca hiçbir sonuç/ara çıktı vermedi; Gemini alt süreci belirtilen
ajan sınırını aştığı için işlem durduruldu. Bu denetimde bağımsız ajan görüşü
**Doğrulanamadı**; görüş alınmış gibi kabul edilmedi ve otomatik tekrar
yapılmadı.

## P1 — ilk ücretli üretim kurulumundan önce kapatılacak teknik işler

### 1. Ürün kodu ve barkodu benzersiz değil; silinen bileşen reçetede kalabiliyor

- Faz 0 canlı sonucu iki aynı kod/barkodlu ürün için `201, 201` döndüğünü
  gösteriyor (`test/faz0-verify/results/b1b-stock.json`, IT-02c).
- Test açıklaması "mükerrer kod/barkod 4xx" dese de yalnız ikinci cevabın 500
  olmamasını doğruluyor (`test/faz0-verify/b1b-stock.js:336-343`).
- Şemada `items(code)` ve `items(barcode)` için yalnız normal indeks var;
  şirket kapsamında `UNIQUE` kısıtı yok
  (`server/migrations/001_initial_schema.js:744-745`).
- Reçetede kullanılan bileşen soft-delete ile `204` alıyor
  (`test/faz0-verify/results/b1b-stock.json`, IT-02b); silme akışı BOM kullanımını
  denetlemiyor (`server/routes/items.js:325-337`).

**Etki:** Barkod araması yanlış ürünü seçebilir; ürün koduyla entegrasyon ve
raporlama belirsizleşir; aktif reçete silinmiş bileşenle üretim/MRP davranışını
bozabilir.

**Kabul:** Önce mevcut mükerrerleri raporla ve yönetici kontrollü birleştirme/
yeniden kodlama uygula; sonra kod zorunlu olacaksa `UNIQUE(company_id, code)`,
opsiyonel kalacaksa kod ve barkod için boş olmayan değerlere koşullu şirket
kapsamlı benzersizlik ekle. Aktif BOM, açık sipariş ve stok
bağları varken ürün silmeyi engelle veya açık bir yerine-geçirme akışı kullan.
İkinci eşzamanlı kayıt 409/422 vermeli ve kalıcı negatif test CI'da çalışmalı.

### 2. Yanlış mali hareketler için ters kayıt yolu yok

- Müşteri ve tedarikçi ödeme satırları güncellenemez; bu doğru bir audit
  yaklaşımıdır. Fakat ödeme servisinde ters/iptal kaydı veya orijinal ödemeye
  bağlı düzeltme işlemi bulunmuyor
  (`server/services/invoice-payments.js:68-104`, `128-168`).
- Migration yalnız `UPDATE` engelliyor; ters kayıt veri modeli yok
  (`server/migrations/025_invoice_payments_and_reconciliation.js:41-105`).
- Yanlış mal kabulünü iptal/ters çevirme uçlarının üçü de 404
  (`test/faz0-verify/results/b2-purch-auth.json`, RC-06b) ve buna rağmen RC-06
  `PASS` sayılıyor.

**Etki:** Kullanıcı yanlış tarih/tutar/yöntemle ödeme veya yanlış miktarla mal
kabul girdiğinde güvenli düzeltme yapamaz. Doğrudan SQL müdahalesi audit ve stok
maliyetini bozar.

**Kabul:** Kayıtları değiştirmek/silmek yerine kaynak kayda bağlı ters kayıt,
sebep, yetkili, tarih ve idempotency anahtarı ekle. Fatura bakiyesi, stok lotu,
ortalama maliyet, PO teslim miktarı ve audit aynı transaction içinde geri
dönmeli; kısmi tüketilmiş lotta açık ve test edilmiş politika olmalı.

### 3. Muhasebe dışa aktarımı tam yevmiye köprüsü değil

- Satış faturası aktarımı alıcı, satış geliri ve KDV satırlarını üretiyor;
  satış maliyeti ve stok alacağı üretmiyor
  (`server/services/accounting-export.js:59-84`).
- Faz 0 canlı sonucu `cogs:false, stokAlacak:false` olduğu halde AC-01'i `PASS`
  sayıyor (`test/faz0-verify/results/b4c-ops.json`, AC-01c;
  `test/faz0-verify/b4c-ops.js:271-286`).
- Tahsilat/ödeme defterleri eklendi fakat kasa/banka, alıcı ve satıcı
  kapatma yevmiyeleri muhasebe exportunda yok.

**Etki:** Çıktı borç/alacak bakımından dengeli görünür, fakat dönem kârı, stok
hesabı ve nakit/satıcı kapama kayıtları eksik kalır. "Muhasebe aktarımı" olarak
satılırsa müşterinin muhasebe fişi eksik oluşabilir.

**Kabul:** Ürün vaadi iki seçenekten biriyle netleşmeli: (a) yalnız fatura
fişi exportu olduğu açıkça sınırlandırılmalı; veya (b) sevkiyatın gerçek
`cogs_base` değerinden maliyet/stok, ödeme defterinden kasa-banka/cari kapama ve
iade ters kayıtları eklenmeli. Her belge için beklenen hesaplar ve toplamlar
sözleşme testiyle doğrulanmalı.

### 4. Para alanları SQLite `REAL` ve JavaScript `Number` kullanıyor

- Fatura, ödeme, fiyat, maliyet, kur ve onay limitlerinin önemli bölümü `REAL`
  (`server/migrations/001_initial_schema.js`; ödeme tutarları için
  `server/migrations/025_invoice_payments_and_reconciliation.js:41-71`).
- Servis iki ondalığa yuvarlıyor, ancak ikili kayan nokta veritabanı toplamı,
  büyük değerler ve farklı hassasiyette kur/birim fiyat işlemlerinde kalıcı
  finansal sınır değildir.

**Etki:** Çok satırlı/dövizli işlemlerde kuruş farkları, eşik karşılaştırması ve
mutabakat sapması oluşabilir. Bu risk yalnız yeşil örnek testlerle kapanmaz.

**Kabul:** Para, miktar, birim fiyat ve kur için ayrı hassasiyet/yuvarlama
politikası kararlaştır. Para toplamlarını en küçük para birimi tamsayısı veya
kesin decimal temsile taşıyan genişlet-geri doldur-doğrula-geçiş migration'ı
tasarla; mevcut veriye mutabakat raporu ve geri dönüş planı hazırla.

### 5. Faz 0 başarı ölçütü gerçek açıkları gizliyor

- IT-02, RFQ-01, RC-06, TP-02, AD-08 ve AC-01 testleri açıklamalarında kritik
  davranışı soruyor; fakat bulguyu `INFO` yazıp başka/zayıf bir assertion ile
  `PASS` oluyor.
- Canlı sonuçlar: mükerrer ürün `201`, RFQ award `404`, receipt reverse `404`,
  scriptli SVG `201`, `approvalLimit=1e300` `200`, COGS yok.

**Etki:** CI yeşilken satış açısından gerekli davranışlar eksik kalıyor ve
durum belgesi yanlış güven veriyor.

**Kabul:** Her `INFO` kaydını `beklenen`, `kapsam dışı` veya `açık` olarak
sınıflandır. Açık kabul edilen davranışlarda gerçek assertion ekle ve test
başarısız olsun; kapsam dışı kararı ürün belgesine işle. `0 FAIL` sayısını ancak
açıkların tamamı kapandığında satış kanıtı olarak kullan.

### 6. Büyük onay limiti sınırlandırılmıyor

- Kullanıcı güncellemesi `approvalLimit: 1e300` değerini 200 ile kabul ediyor
  (`test/faz0-verify/results/b2-purch-auth.json`, AD-08b).
- Şema yalnız `finite().min(0)` kullanıyor; iş açısından makul bir üst sınır
  yok (`server/routes/admin.js:66`).

**Etki:** Hatalı giriş pratikte sınırsız onay yetkisine dönüşebilir; rapor ve UI
hesaplarını anlamsız büyüklüklerle bozabilir.

**Kabul:** Para temsili kararıyla uyumlu, belgelenmiş bir azami limit koy;
sunucu, veritabanı ve UI aynı sınırı uygulasın. Sınır üstü değer 422 vermeli.

### 7. Release doğruluğu ve güncel durum belgeleri tutarsız

- Mobil/PWA kaldırıldığı halde `package.json:31` ve `package.json:42` silinmiş
  test paketlerini çağırıyor; iki komut da kırılıyor.
- `PROJECT_STATUS.md:9` ve `:58` değişikliklerin commit edilmediğini söylüyor;
  oysa `c1714b4` `origin/main` üzerindedir.
- Aynı dosyanın üst bölümü işleri tamamlandı gösterirken `:158-168` eski açık
  listeyi güncelmiş gibi tutuyor.
- `docs/GELISTIRICI-REHBERI.md:27-29` kaldırılmış mobil terminali hâlâ yığının
  parçası/kaldırılma sürecinde gösteriyor. `docs/YOL-HARITASI.md:447` ise mobil
  terminali tamamlanmış özellik diye listeliyor.
- Commit aralığı için `git diff --check` arşiv belgede iki boşluk hatası veriyor.

**Etki:** Yeni geliştirici yanlış komut çalıştırır; müşteri ve satıcı paket
kapsamını yanlış anlar; release onayı izlenebilir olmaz.

**Kabul:** Tek güncel durum kaynağı bırak; tarihsel bölümleri açıkça arşivle.
Kaldırılmış script ve ürün iddialarını temizle, doküman linklerini doğrula,
`git diff --check`i CI kapısı yap. Release notu commit, migration, bilinen
sınırlar ve saha kanıtlarını içersin.

## P2 — kapsam kararı veya güvenlik sertleştirmesi

1. **SVG logo:** MIME kontrolü ham `image/svg+xml` verisini saklıyor
   (`server/routes/templates.js:20-28`, `168-176`); script içeren SVG 201 alıyor.
   Mevcut kullanım `<img>` bağlamında olduğu için bu denetimde çalıştırılabilir
   XSS kanıtlanmadı. Güvenli ve basit çözüm SVG'yi reddetmek; desteklenecekse
   sunucu tarafında güvenilir sanitizer ve içerik doğrulaması gerekir.
2. **RFQ ödüllendirme/dönüşüm:** Şema `awarded` durumunu taşıyor, test
   `/rfqs/:id/award` bekliyor, uç 404. Bu özellik satılacaksa teklif seçimi,
   yetki, audit ve PO dönüşümü tamamlanmalı; satılmayacaksa UI/kılavuzda yalnız
   karşılaştırma kapsamı açık yazılmalı.
3. **Satın alma yaşam döngüsü:** PO kapatma/iptal ve supplier-return liste/
   durum akışlarının eksik uçları ürün kapsamı olarak karara bağlanmalı. Yanlış
   mal kabul ters kaydı P1 kapsamında ayrı tutulmuştur.
4. **HTTP/CORS/health sertleştirmesi:** Üretimde izinli origin ve güvenilen proxy
   zorunlu güvenli varsayılan olmalı; ayrıntılı health verisi yalnız yönetici/
   iç ağ bağlamında sunulmalı. Nginx testi geçti, fakat gerçek müşteri proxy
   kurulumu saha kapısıdır.
5. **Lint/tip borcu:** Lint 0 hata olsa da 45 uyarı ve birçok `@ts-nocheck`
   kalıyor. Bunlar tek başına satış engeli değil; finans, stok ve yetki
   sınırlarından başlanarak azaltılmalı.

## Saha ve ticari kapılar — kodla kapatılmış sayılmaz

| # | Kapı | Geçme kanıtı |
| ---: | --- | --- |
| 1 | Temiz Windows kurulumu, servis ve yeniden başlatma | Release paketiyle sıfır makine; teknik olmayan kişi kılavuzla kurar; restart sonrası sağlık kontrolü geçer |
| 2 | Gerçek TLS, alan adı ve reverse proxy | HTTPS, HSTS/CSP/CORS/proxy IP davranışı ve login rate limit gerçek topolojide doğrulanır |
| 3 | Off-site yedek ve felaket dönüşü | Başka hedefteki gerçek bundle boş makineye alınır; DB + belgeler açılır; ölçülen RPO/RTO kaydedilir |
| 4 | Gerçek cihaz ve çıktı | Desteklenen USB barkod okuyucu, etiket/yazıcı ve kritik belge çıktıları müşteri donanımında denenir |
| 5 | Temsili büyük veri ve yükseltme | Çok yıllı hacimde süre/bellek ölçülür; eski müşteri kopyası migration + rollback tatbikatını geçer |
| 6 | Müşteri pilotu ve imzalı kabul | Satın alma→kalite→üretim→sevkiyat→fatura→iade→rapor zinciri gerçek roller/veriyle paralel çalışır; kritik fark yoktur |
| 7 | Hukuki ve ticari paket | Avukat onaylı lisans/satış sözleşmesi, KVKK roller/metinleri, destek kapsamı-SLA, yedek sorumluluğu, güncelleme/ayrılma ve veri dışa aktarım şartları hazırdır |

Bağımsız ağ/sızma testi de ilk genel satıştan önce önerilir. Teknik KVKK
özellikleri hukuki uygunluk onayı değildir. `LICENSE` içindeki örnek mülkiyet
metni müşteri sözleşmesinin yerine geçmez.

## Önerilen uygulama sırası

1. Faz 0 `INFO` kayıtlarını açık/kapsam dışı/beklenen olarak sınıflandır; CI'ın
   yanlış yeşilini düzelt.
2. Ürün kodu/barkod benzersizliği ile BOM soft-delete korumasını migration ve
   negatif/eşzamanlı testlerle kapat.
3. Ödeme ve mal kabul ters kayıtlarını aynı audit/idempotency modeliyle ekle.
4. Muhasebe export kapsamını ürün vaadiyle eşleştir; COGS/stok ve ödeme
   yevmiyelerini ya uygula ya da açıkça kapsam dışı ilan et.
5. Para temsilini ve migration yolunu kararlaştır; mevcut veri mutabakat aracını
   üret.
6. `approvalLimit`, SVG, CORS/health ve kalan P2 sertleştirmelerini tamamla.
7. Kırık scriptleri ve çelişkili belgeleri düzelt; release adayını yeniden
   paketle ve bütün testleri çalıştır.
8. Temiz Windows + TLS/proxy + off-site restore + büyük veri tatbikatını kaydet.
9. Bir kontrollü müşteri pilotu yap; açık kritik bulgu yoksa imzalı kabul al.
10. Sözleşme, destek ve fiyatlama kararlarıyla ilk ücretli üretim sürümünü
    onayla.

## Tamamlanma ölçütü

Ürün ancak P1 maddeleri kapalı, Faz 0 gerçek beklentilerle yeşil, saha
kapılarının ilk altısı kanıtlı ve hukuki/ticari paket hazır olduğunda "satışa
hazır" sayılmalıdır. Otomatik pilot ve release paketi gereklidir; gerçek müşteri
kurulumu ve kabulünün yerine geçmez.
