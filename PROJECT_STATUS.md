# PROJECT_STATUS.md

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
