# PROJECT_STATUS.md

## 26 Eylül 2026 — müşteri paketinde gereksiz dosya denetimi (Codex)

**Aktif hedef ve kabul ölçütü:** `release/dream-plus-2.0.1` içinde yalnız
çalışma, kurulum, migration, yükseltme, yedek/geri yükleme, Docker/nginx ve
müşteri belgeleri kalacak; geliştirme/test/satıcı iç araçları çıkarılacak;
doğrudan kurulum ve Docker sözleşmesi korunacak; değişiklik commit/push
edilecek ve paket temiz commit üzerinden yeniden üretilecek.

**Sonuç — Geçti:** Paket 165 girdiden **131 girdiye** indirildi. JSX/Vite ön
yüz kaynakları ve derleme betiği, demo/seed araçları, satıcı lisans üretim
betiği ve yalnız typecheck için kullanılan `.d.ts` dosyası müşteri paketinden
çıkarıldı. Müşteri `package.json` dosyası yalnız `start`, migration, kurulum,
yükseltme, yedek ve geri yükleme komutlarını taşır; devDependencies ile
derlenmiş React'in çalışma zamanında gerekmeyen paketleri kaldırılır. Müşteri
Dockerfile'ı doğrulanmış `public/dist` çıktısını kullanır ve derleyici zincirini
son imaja taşımaz. `.env`, `.env.local`, `.env.production` benzeri dosyalar
filtrelenir; yalnız güvenli `.env.example` şablonu kalır.

**Belge/güvenlik etkisi:** Müşteri kurulum belgesinden bilinen demo hesapları
ve satıcıya özel lisans anahtarı üretim adımları çıkarıldı. Süreli lisans
kurulumunda müşteriye satıcının verdiği imzalı dosyanın kullanılacağı yazıldı.
Özel anahtar, müşteri verisi, test, iç analiz, yedek, SQLite ve `node_modules`
pakete girmez. Kullanıcının izlenmeyen `.claude/` ve `CLAUDE.md` dosyalarına
dokunulmadı.

**Doğrulama — Geçti:** `npm run build`; `npm run typecheck`; `npm run lint`
(0 hata, önceden var olan 42 uyarı); `node test/release-package.js` (131 dosya,
checksum, kurcalama, özel anahtar ve `.env.*` sızıntı kontrolleri); temiz
pakette `npm ci --omit=dev` (216 paket, dev/React sızıntısı yok); müşteri
paketinden parametreli `npm run setup`; üretim sunucusunda `/health=ok` ve
yönetici girişi; `setup-upgrade` 45/45; `npm audit --omit=dev
--audit-level=high` 0 bulgu; `git diff --check` geçti.

**Bağımsız inceleme:** `ai_team.py --phase plan/review --rounds 2 --timeout
300` ile Claude ve Gemini görüşleri alındı. React/lockfile riski canlı temiz
kurulumda React dizinlerinin bulunmadığı ve girişin çalıştığı görülerek
kapandı; sunucu kodunda React importu yoktur. `.env.*` filtresi, manifest
önkoşul kontrolleri ve iki aşamalı Docker bağımlılık kurulumu inceleme üzerine
eklendi. Araç test/belge dosyalarını sır filtresi nedeniyle modele vermedi;
nihai karar yerel test ve dosya incelemesine dayanır.

**Doğrulanamadı:** Bu bilgisayarda Docker CLI kurulu olmadığı için gerçek
`docker build` çalıştırılamadı. Compose/nginx/Dockerfile portu `3000`, veri
volume'u `/app/data` ve üretim ortamı statik olarak uyumludur; ilk Docker'lı
saha kurulumunda imaj build + healthcheck yine uygulanmalıdır.

**Sonraki tek somut adım:** İlk müşteri ortamında `docs/SAHA-KURULUM-KARTI.md`
ile Docker kullanılıyorsa gerçek imajı derle; ardından TLS/off-site yedek ve
pilot kabul kapılarını müşteriyle tamamla.

## 26 Eylül 2026 — Dream Plus 2.0.1 satış adayı (Codex, teknik tur tamamlandı)

**Aktif hedef ve kabul ölçütü:** Kullanıcının tam yetkisiyle kod deposunda
kapatılabilen güvenlik, veri bütünlüğü, finans, iş akışı, kurulum ve belge
eksiklerini kapatmak; ilgili bütün testleri geçirmek; temiz dağıtım/geri dönüş
kanıtı üretmek ve sonucu `main` dalına commit/push etmektir.

**Sonuç:** Kodda kapatılabilen satış engelleri kapatıldı. Dream Plus 2.0.1,
temiz müşteri kurulumu ve kontrollü pilot için release candidate durumundadır.
Genel ve koşulsuz "hatasız" iddiası yapılmaz: TLS/proxy, gerçek off-site hedef,
müşteri donanımı/verisi, hukukçu onayı ve imzalı pilot yalnız seçilen müşterinin
sahasında kanıtlanabilir. Güncel ayrıntılı karar
[`docs/SATISA-HAZIRLIK-SON-DURUM-2026-09-26.md`](docs/SATISA-HAZIRLIK-SON-DURUM-2026-09-26.md)
dosyasındadır.

**Bu turda kapatılanlar:** `8ccb7c2` ürün/BOM bütünlüğü, finans ve mal kabul
ters kayıtları, gerçek COGS/ödeme yevmiyeleri, RFQ→PO, PO yaşam döngüsü ve
tedarikçi iadelerini; `7dd0767` kullanıcı bazlı bildirim okuma, gerçek belge
bayt doğrulaması/indirme, migration 029 tam sayı kuruş defterleri, müşteri bakiye
düzeltmesi ve satın alma iade arayüzünü getirdi. Son sertleştirme üretimde güvenli
CORS varsayılanını, sade sağlık yanıtını, kur/para güvenli aralıklarını ve
Faz 0 kredi limiti assertion'ını ekledi; sürüm 2.0.1'e çıkarıldı.

**API/veri etkisi:** Migration 028 `notification_reads`; migration 029 fatura ve
ödeme `*_minor` alanlarını ekler. Dış API ondalık sözleşmesi korunur. Para yarım
kuruşta sıfırdan uzağa yuvarlanır; uyumluluk REAL alanı ile kuruş alanının
ayrışması tetiklerle engellenir. Yeni kur girişleri `0.000001..1,000,000`
aralığındadır; fatura baz para dönüşümü güvenli tamsayı aralığını aşarsa 422 ile
kayıt öncesi durur. Üretimde CORS allow-list boşsa çapraz kaynak başlığı yoktur.

**Doğrulama — Geçti:** 41 izole `run-all` paketi; Faz 0 217/217; Chromium
39/39; güvenlik 69/69 ve 0 uyarı; muhasebe 36/36; UI 113/113; contract 58/58;
OpenAPI 10/10; build ve typecheck; lint 0 hata; `npm audit --audit-level=high`
0 bulgu. Finans/mutabakat/muhasebe/güvenlik ve Faz 0 son değişiklikten sonra
yeniden çalıştırıldı.

**Dağıtım/kurtarma kanıtı — Geçti:** 2.0.1 release komutuyla 131 dosyalık temiz
paket üretildi; `npm ci --omit=dev` 0 zafiyetle tamamlandı. Paket içinden boş
müşteri kurulumu ve ayrı `NODE_ENV=production` süreci açıldı: sürüm 2.0.1,
`/health=ok`, migration=0, yönetici girişi başarılı ve yabancı Origin için CORS
izin başlığı yoktu. Önceki tam paket provasında süreç yeniden başlatma başarılı;
tam bundle başka boş dizine geri yüklendi; SQLite bütünlüğü `ok`, yabancı anahtar
hatası 0, firma/kullanıcı/migration 29 korundu ve geri yüklenen kopyada giriş
başarılı oldu. Nihai paketin commit'i `RELEASE.json` içinde kayıtlıdır.

**Bağımsız inceleme:** `ai_team.py --phase review --timeout 300` çalıştı. Gemini
verilen dosyalarda yeni somut hata bildirmedi. Claude 1,91 saniyede oturum kota
sınırı mesajı verdiğinden Claude görüşü **Doğrulanamadı**. Bazı test dosyaları
bağlam/sır filtresiyle atlandığı için son karar canlı test ve kod kanıtındadır.

**Doğrulanamadı / dış teslim kapıları:** Bu bilgisayarda Docker yok. Ayrı fiziksel
Windows makinede servis ve reboot; gerçek TLS/alan adı/proxy; gerçek off-site
sağlayıcıdan restore; müşteri barkod/yazıcıları; temsili müşteri verisiyle
migration/performans; hukukçu onaylı sözleşme/KVKK/SLA ve imzalı 13 adımlı pilot
müşteri seçilmeden kapatılamaz. Bunlardan biri kalırsa ilgili müşteri üretim
kabulü verilmez.

**Sonraki tek somut adım:** İlk müşteri ve kurulacağı ortam belirlendiğinde
`docs/PILOT-KABUL-PLANI.md` ön koşullarını doldur; servis/TLS/off-site yedek
kurulumunu tamamlayıp 13 adımlı pilotu müşteriyle imzalı olarak kapat.

## 26 Eylül 2026 — Claude sonrası Codex bağımsız denetimi

**Aktif hedef:** `c1714b4` ile `origin/main` üzerine alınan Claude Code
değişikliklerini kod ve canlı test kanıtıyla doğrulamak; ilk ücretli müşteri
kurulumundan önce kalan işleri yanlış "tamamlandı" iddiası olmadan sıralamak.

**Karar:** Claude turu T06 mutabakat/ödeme, MRP snapshot'ı, kapasite,
sayfalama, arayüz dayanıklılığı, lisans operasyonu ve release paketi alanlarında
gerçek ilerleme sağladı. Ancak ürün **genel satışa hazır değildir**. Ayrıntılı
kanıt ve kabul ölçütleri
[`docs/CODEX-SON-DENETIM-2026-09-26.md`](docs/CODEX-SON-DENETIM-2026-09-26.md)
dosyasındadır.

**İlk ücretli üretim kurulumu öncesi 7 teknik iş:** ürün kodu/barkod
benzersizliği ve BOM soft-delete koruması; ödeme ve mal kabul ters kayıtları;
muhasebe export kapsamı (COGS/stok ve ödeme fişleri); kesin para temsili;
Faz 0 `INFO` gözlemlerinin gerçek assertion/kapsam kararına dönüşmesi; makul
onay limiti üst sınırı; kırık script ve çelişkili release/durum belgeleri.

**Saha/ticari 7 kapı:** temiz Windows+servis restart; gerçek TLS/proxy; gerçek
off-site restore; müşteri cihaz/yazıcı/barkod doğrulaması; temsili büyük veri ve
yükseltme/rollback; gerçek müşteri pilotu ve imzalı kabul; hukukçu onaylı
sözleşme/KVKK/destek kapsamı.

**Canlı doğrulama:** `node test/run-all.js` 40 paket **Geçti**;
`npm run test:e2e-browser` 39/39 **Geçti**; build, typecheck ve lint (0 hata,
45 uyarı) **Geçti**; `npm audit --omit=dev --audit-level=high` 0 bulgu;
`npm run release` **Geçti** ve 160 dosyalık `dream-plus-2.0.0` paketi üretti.
`npm run test:mobile` ile `npm run test:pwa` kaldırılmış paketlere işaret ettiği
için **Kaldı**. `git diff --check b34ed42..c1714b4`, arşiv belgede iki trailing
whitespace nedeniyle **Kaldı**. Temiz Windows/TLS/off-site restore/pilot
**Doğrulanamadı**.

**Kanıtlanan yanlış yeşiller:** Faz 0 sonuçlarında aynı ürün kodu/barkodu iki
kez 201, reçete bileşeni soft-delete 204, script içeren SVG logo 201, RFQ award
404, receipt reverse uçları 404, `approvalLimit=1e300` 200 ve muhasebe
exportunda COGS/stok alacağı yok; ilgili testler yine de PASS yazıyor. SVG için
bu denetimde çalıştırılabilir XSS kanıtlanmadı; sertleştirme açığı olarak
sınıflandırıldı.

**Bağımsız inceleme:** `ai_team.py --phase review --rounds 2 --timeout 300`
çağrısı 10 dakika 50 saniye sonuç/ara çıktı vermedi; Gemini alt süreci ajan
sınırını aştığı için durduruldu. Claude/Gemini görüşü **Doğrulanamadı** ve
alınmış sayılmadı; kör tekrar yapılmadı.

**Git/durum notu:** Üstteki Claude kaydında "commit edilmedi" yazsa da değişiklik
`c1714b4` merge commit'iyle `origin/main` üzerindedir. Aşağıdaki 23 Eylül bölümü
tarihsel kayıttır; oradaki açık liste güncel durum olarak kullanılmamalıdır.

**Sonraki tek somut adım:** Faz 0 `INFO` kayıtlarını açık/kapsam dışı/beklenen
olarak sınıflandırıp gerçek açıkları CI'da kırmızıya çevirmek; ardından ürün
kimliği/BOM bütünlüğünü migration ve eşzamanlı negatif testlerle kapatmak.

## 26 Eylül 2026 — kalan satış engellerini kapatma turu (Claude) — kod tarafı tamamlandı

**Kullanıcı talimatı (26 Eylül):** kalan işlerin tamamı durmadan, soru
sorulmadan yürütülecek; karar noktalarında koordinatör kendi kararını verir.
Bu nedenle aşağıdaki ürün kararları **koordinatör varsayımıdır**; geri
alınabilir biçimde uygulanır ve kullanıcı değiştirebilir. Commit/push
yapılmıyor (dream-plus/CLAUDE.md: açık istek olmadan commit yok).

**Güncel iş listesi (23 Eylül listesine eklenen eksikler dahil):**

1. T06 eski alış faturası mutabakatı + alış faturası onay/ödeme kapısı
2. Faz 0 yeniden ölçümü ve ayıklanması
3. T16 para/tarih/sayı kuralları
4. T09 tarihsel MRP ve emir reçete snapshot'ı
5. T10 çakışmasız kapasite çizelgeleme
6. T08 gerçek sayfalama ve sunucu taraflı arama
7. T17 müşteri kurulum paketi (kod/belge kısmı; temiz PC/TLS/off-site sahada)
8. T18 arayüz hata/çift gönderim/erişilebilirlik
9. Pilot ve satış kabulü (saha; kod ile yapılamaz)
10. **Eklendi:** K-01…K-15 ürün kararları (aşağıda varsayılan kararlar)
11. **Eklendi:** T04 kalan kısmı — birleştirmede tarihsel/serbest metin
    referansları ve çakışan reçete
12. **Eklendi:** T11 kalan kısmı — kısmi tahsilat/ödeme (K-05)
13. **Eklendi:** Mobil el terminalinin paketten kaldırılması (önceki "en son
    kaldır" kararı)
14. **Eklendi:** T03 saha kısmı — proxy/nginx arkasında giriş sınırlayıcı testi
15. **Eklendi:** Eskimiş belgelerin düzeltilmesi (GELISTIRICI-REHBERI §3/§5,
    kök PROJECT_STATUS, KVKK 3.1 başlığı, bu dosyanın eski özet/son bölümleri)

**Koordinatör varsayılan kararları (K listesi, TAM-LISTE §6):**

| Kod | Karar (varsayım) | Gerekçe |
| --- | --- | --- |
| K-01 | Miadı dolmuş lot sevk/tüketimde **engellenir**; kalite yetkilisi lot durumunu değiştirmeden istisna yok | Gıda/kimya riski; en güvenli varsayılan |
| K-02 | Ürün başına tek ölçü birimi (mevcut davranış) | Çoklu birim ayrı özellik; kapsam dışı |
| K-03 | Seri no zorunlu değil (mevcut) | Sektör seçilmedi |
| K-04 | Mevcut iade akışları korunur | Değişiklik gerektiren kanıt yok |
| K-05 | **Kısmi tahsilat/ödeme desteklenir**; ödeme defteri, fatura bakiyesini aşamaz | Gerçek işletmede kısmi ödeme olağan |
| K-06 | Sayım sırasında hareket olursa onay durur, yeni sayım gerekir (mevcut) | Stok doğruluğu |
| K-07 | Fazla teslim/fazla sevk **toleransı %0** | En güvenli varsayılan |
| K-08 | Negatif stok **izinli değil** (mevcut) | Stok doğruluğu |
| K-09 | Dört göz zorunlu değil; onay limiti 0 = limitsiz değil **yetkisiz** anlamı korunur (mevcut) | Küçük işletmede tek yönetici olabilir |
| K-10 | RPO 24 saat (günlük otomatik tam yedek), RTO 4 saat | Tek tesis KOBİ için makul başlangıç |
| K-11 | Ticari/mali kayıtlar (fatura, VKN) saklanır; kişi iletişim alanları anonimleşir (mevcut) | Hukuki onay müşteride |
| K-12 | Belgelere hukuki ibare eklenmez; firma şablonuyla müşteri ekler | Hukuki metin uydurulmaz |
| K-13 | Belge numarası yıllık sıfırlanmaz (mevcut) | Benzersizlik |
| K-14 | Chrome/Edge desteklenir; USB barkod okuyucu klavye gibi; ağ varsayılan yerel (internete kapalı) | Saha kurulum kılavuzuyla uyumlu |
| K-15 | İmzalı lisans dosyası + sözleşme (mevcut Ed25519 mekanizması) | Mevcut altyapı |

Hedef sektör ve fiyat modeli teknik işi engellemiyor; kullanıcı kararı olarak
açık bırakıldı (satış planındaki öneriler geçerli).

**Sonuç (26 Eylül 2026 akşam):** 15 maddelik listenin kodla yapılabilen
kısmının tamamı uygulandı ve test edildi. Ürün **pilot için hazır**; genel
satış onayı sahadaki dört doğrulamaya (aşağıda) ve imzalı pilot kabulüne
bağlı. Değişiklikler commit edilmedi.

| # | Madde | Durum | Kanıt |
|---|---|---|---|
| 1 | T06 eski fatura mutabakatı + onay/ödeme kapısı | Tamamlandı | `test/invoice-settlement.js`, `settlement-and-paging.spec.js` |
| 2 | Faz 0 yeniden ölçüm | 159/55/3 → **217 PASS / 0 FAIL / 0 ERROR**; `run-all` ve CI'a bağlandı | `test/faz0-verify.js` |
| 3 | T16 para/tarih/sayı | Tamamlandı (katı sayı/boolean, gerçek takvim tarihi, belirsiz ondalık importta satır hatası, belge snapshot'ları) | `test/import.js`, Faz 0 CO/AD/VZ |
| 4 | T09 tarihsel MRP | Tamamlandı | `test/planning-integrity.js` |
| 5 | T10 kapasite | Tamamlandı | `test/planning-integrity.js`, `test/planning.js` |
| 6 | T08 sayfalama/arama | Tamamlandı | `settlement-and-paging.spec.js` |
| 7 | T17 kurulum paketi | Kod/belge tamamlandı: `npm run release`, `docs/LISANS-OPERASYONU.md`, KURULUM güncellendi. Temiz PC/servis/TLS/off-site **Doğrulanamadı** (saha) | `test/release-package.js` |
| 8 | T18 arayüz | Tamamlandı: çift gönderim kilidi, odak tuzağı/diyalog rolü, etiket bağlantısı, "Yeniden Dene", Faz 0 CI'da. Dar ekranda stok dağılım grafiği kırpılıyor (kozmetik, masaüstü kapsam) | `accessibility-resilience.spec.js` |
| 9 | Pilot ve satış kabulü | Prova otomatik (**Geçti**); gerçek pilot **Doğrulanamadı** | `test/pilot-flow.js`, `docs/PILOT-KABUL-PLANI.md` |
| 10 | K-01…K-15 | Varsayılan kararlar tabloda | bu bölüm |
| 11 | T04 kalan | Tamamlandı (sevkiyat bağı, reçete toplama, farklı reçete 409) | Faz 0 DH-02/03/09 |
| 12 | T11 kısmi tahsilat | Tamamlandı | `test/invoice-settlement.js` |
| 13 | Mobil terminal kaldırıldı | Tamamlandı: dosyalar, route, testler silindi; `/sw.js` eski kayıtları temizleyen kapatma worker'ı; 018 tabloları veri korunarak yerinde | tarayıcı testleri 39/39 |
| 14 | T03 proxy arkası | Tamamlandı (nginx üzerine-yazma davranışı test edildi; append riski belgelendi) | `test/proxy-rate-limit.js` |
| 15 | Eski belgeler | Tamamlandı: rehber, KVKK 3.1, tarihsel belgelere not, kök durum, eski günlük `docs/PROJECT_STATUS-ARSIV-2026-09.md` | — |

**Ek bulunan ve düzeltilen:** Sistem durumu ekranı yedekleri yalnız `.sqlite`
sayıyordu (rutin yedek `.bundle`) — düzeltildi ve test edildi; kredi notu +
tahsilat bakiyesi (`paid_legacy`), belge revizyon dallanması, silinen belge
dosyası, pivot `__proto__`, pasif stoklu ürün değerlemesi.

**API/veri değişiklikleri:** migration `025_invoice_payments_and_reconciliation`
(yalnız ekleme: sütunlar, iki ödeme tablosu, tetikleyiciler; mevcut ödenmiş
faturalar `paid_legacy=1`; veri silinmez). Yeni uçlar OpenAPI'de. Davranış
değişiklikleri: bazı doğrulama hataları 400 yerine 422; `GET /settings`
yalnız yönetici/müdür (`/settings/public` herkese); `GET /purchasing/invoices`,
`/requests`, `/rfqs`, `/quality/capas` artık sayfalı zarf döner
(`{data,page,total}`); `/api/mobile/*` kaldırıldı.

**Doğrulama (26.09.2026, Windows, Node v24.19.0):**
`node test/run-all.js` — 40 paket, 39'u tek koşuda, `faz0-verify` b3
düzeltmesi sonrası ayrı koşuda **Geçti**; `npm run test:e2e-browser` **39/39
Geçti**; `npm run build`, `npm run typecheck`, `npx eslint .` (0 hata, 45
uyarı, önceki 46) **Geçti**; `npm audit --omit=dev --audit-level=high` 0
bildirim; `git diff --check` **Geçti**. Gerçek `data/` klasörüne dokunulmadı.

**Bağımsız inceleme:** `ai_team.py --phase review` (para/ödeme katmanı):
Codex **unavailable** (CLI yok), Gemini somut hata bildirmedi; döviz notu
incelendi — ödemeler tasarım gereği fatura dövizinde, tutarlı.

**Doğrulanamadı (saha):** temiz Windows kurulumu ve yeniden başlatmada
servis; gerçek TLS/alan adı; gerçek off-site hedeften geri yükleme; müşteri
verisiyle pilot ve imzalı kabul; hukuki KVKK/lisans metinleri.

**Sonraki tek somut adım:** değişiklikleri gözden geçirip commit etmek; ardından
`npm run release` paketiyle temiz bir Windows bilgisayarda
`docs/PILOT-KABUL-PLANI.md` ön koşul listesini uygulamak.

## 23 Eylül 2026 — T12, T14 ve T15 güvenlik/veri bütünlüğü kapatma turu

**Aktif hedef:** Dream Plus'ı başka firmalara kurulabilir, desteklenebilir ve
ölçülebilir kabul kapılarıyla satılabilir bir ürüne dönüştürmek. Bu turda üç
yüksek riskli açık uygulama ve regresyon testleriyle kapatıldı. Ürün için genel
satış onayı henüz verilmedi; müşteri ortamı, TLS, off-site geri yükleme ve pilot
kabulü hâlâ dış ortam kanıtı gerektiriyor.

**T12 — KVKK anonimleştirme bütünlüğü:** müşteri, tedarikçi ve kullanıcı
anonimleştirmeleri tek transaction içinde çalışıyor; ilişkili CRM, destek,
ziyaret, sevkiyat, sipariş ve denetim alanlarındaki kopya kişisel veriler
maskeleniyor. Anonimleştirilmiş kartların API üzerinden yeniden kimlik verisiyle
doldurulması ve yeni işleme sokulması engellendi. Veri dışa aktarımları tutarlı
bir DB snapshot'ında okunuyor. Saklama süresi işi artık anonimleştirme hatasını
sessizce yutmuyor. Hukuki KVKK uygunluğu iddia edilmiyor; saklama süresi ve veri
sorumlusu kararları müşteri sözleşmesi/politikasıyla belirlenmeli.

**T14 — kalite kararı doğrulanabilirliği:** muayene sonucu için mevcut kullanıcı
parolası yeniden doğrulanıyor. Karar, imzalayan kullanıcı, zaman, miktarlar,
notlar ve ölçüm satırları SHA-256 özetine bağlandı; sonradan değiştirilmiş kayıt
API/UI'da açıkça işaretleniyor. Başarısız ölçüm satırı varken genel kabul
engellendi. Bu mekanizma yasal nitelikli elektronik imza olarak sunulmuyor.

**T15 — webhook güvenliği ve teslimat garantisi:** üretim hedefleri yalnız HTTPS
kabul ediyor; DNS çözümündeki özel, loopback, link-local ve benzeri adresler
engelleniyor, doğrulanan adres bağlantıya sabitleniyor ve yönlendirme takip
edilmiyor. İş olayları artık iş transaction'ıyla aynı anda kalıcı outbox'a
yazılıyor. Kiralamalı işleyici kararlı olay kimliğiyle teslim ediyor, sınırlı
jitter'lı tekrar planlıyor ve başarısızlığı yönetici kuyruğunda görünür tutuyor.
Migration `024_webhook_outbox.js` eklendi. Yerel HTTP alıcı izni yalnız test
ortamında iki açık bayrakla kullanılabiliyor.

**Doğrulama — Geçti:** `node test/run-all.js` (36/36 süit),
`node test/run-all.js webhooks` (46/46), `npm run test:e2e-browser` (38/38
Chromium), `npm run build`, `npm run typecheck`, `npm run lint` (0 hata, önceden
var olan 46 uyarı), `git diff --check`, `npm audit --omit=dev
--audit-level=high` (0 bildirim). Tam test; güvenlik, stok/finans bütünlüğü,
eşzamanlılık, temiz kurulum/yükseltme, migration geri dönüşü ve DB+uploads tam
yedek/geri yükleme paketlerini de geçti. Testler geçici sandbox'larda çalıştı;
`data/` içindeki müşteri verisine dokunulmadı.

**Bağımsız inceleme:** `C:\Projelerim\Dream\ai_team.py --phase review` ile
Claude ve Gemini görüşü alındı. Snapshot tutarlılığı, webhook silme temizliği ve
IPv4-mapped IPv6 kontrolü yeniden değerlendirildi; export transaction'ı ve açık
outbox silme bu inceleme sonucunda eklendi. Araç sır filtresi `quality.js` ve
stok bütünlüğü testini modele göndermediği için T14 için bağımsız model incelemesi
**Doğrulanamadı**; T14 uygulama, API ve tam regresyonla yerel olarak doğrulandı.

**Açık satış kapıları:** T06 eski faturaların mutabakatı ve gerçek vergi/ödeme
iş akışı; T08 büyük listelerde gerçek sayfalama/arama; T09 tarihsel MRP snapshot
kuralları; T10 çizelgeleme çakışmaları; T16 kalan mali/tarih kuralları; T17
müşteri kurulum paketi, TLS ve lisans operasyonu; T18 saha erişilebilirlik/görsel
kabulü. Faz 0 olumsuz durum takımındaki kalan FAIL/ERROR'lar ana paketten ayrı
ayıklanmalı. Temiz müşteri cihazı, gerçek off-site hedef, ağ/TLS, büyük veri
migration'ı ve müşteri pilotu **Doğrulanamadı**.

**Sonraki somut adım:** T06 kapsamında eski alış faturası/teslimat kayıtları için
veri kaybetmeyen mutabakat akışını ve vergi/ödeme onay sınırlarını tamamlamak;
ardından kalan Faz 0 bulgularını yeniden sınıflandırmak.

## Daha eski kayıtlar

12–20 Eylül 2026 oturum günlüğü, eski "Güncel Durum Özeti" ve ilk teslim
notları [`docs/PROJECT_STATUS-ARSIV-2026-09.md`](docs/PROJECT_STATUS-ARSIV-2026-09.md)
dosyasına değiştirilmeden taşındı.
