# Faz 0 doğrulama takımı

> **26 Eylül 2026 güncellemesi:** yedi dosyanın tamamı 0 FAIL / 0 ERROR
> durumuna getirildi ve `node test/run-all.js faz0-verify` ile ana pakete
> (dolayısıyla CI'a) bağlandı. Aşağıdaki "run-all'a eklenmedi" bölümü
> tarihsel gerekçedir. Eski beklentisi geçersizleşen kontroller (LC-01,
> SI-04, AU-06, DH-02/03/03b/09, AC-02) dosyada tarih ve gerekçeyle
> güncellendi; ürün davranışı gevşetilmedi.

20 Eylül 2026'da devir belgesindeki "düzeltildi" iddialarını bağımsız olarak
doğrulamak için yazılan, tek seferlik ama **tekrar çalıştırılabilir** kötü
senaryo testleri. `test/*.js` (asıl regresyon paketi, `test/run-all.js`
tarafından çalıştırılır) ile KARIŞTIRILMASIN — bu klasördekiler `run-all.js`
listesine kayıtlı DEĞİL, elle çalıştırılır:

```bash
node test/faz0-verify/b1a-sales.js
node test/faz0-verify/b1b-stock.js
node test/faz0-verify/b2-purch-auth.js
node test/faz0-verify/b3-sweep.js
node test/faz0-verify/b4a-misc.js
node test/faz0-verify/b4b-crm.js
node test/faz0-verify/b4c-ops.js
```

Her dosya kendi başına çalışır (bağımsız `node` süreci); gerçek `data/`
klasörüne dokunmaz, `test/helpers/sandbox.js` ile OS geçici dizininde kendi
sunucusunu açar/kapatır. Sonuçlar `test/faz0-verify/results/*.json`'a yazılır
(gitignore'da, disk temizliği için).

## Neden `test/*.js`'e eklenmedi

Asıl paket "bu davranış doğrudur, böyle kalmalı" diyen regresyon testleridir.
Buradakilerin çoğu ise **henüz düzeltilmemiş bilinen hataları** kanıtlıyor —
`assert` başarısız olması BEKLENEN durumdur (bkz. aşağıdaki tablo). `npm test`
/ `run-all.js`'e eklenirse CI'ı kalıcı olarak kırmızıya düşürür. Bir madde
düzeltildiğinde ilgili `check(...)` bloğu asıl `test/` paketine (uygun
dosyaya) TAŞINMALI ve buradan silinmelidir — burası kalıcı ev değil.

## Dosya ↔ konu eşlemesi

| Dosya | Kapsam |
|---|---|
| `b1a-sales.js` | Satış siparişi, sevkiyat, iptal, fatura, kuruş yuvarlama |
| `b1b-stock.js` | Stok/parti, sayım, kalite miktarları, üretim, COALESCE alan temizleme |
| `b2-purch-auth.js` | Satın alma (talep/teklif/sipariş/teslim/varış maliyeti/fatura), kimlik doğrulama, yönetim, ayarlar, rol/yetki |
| `b3-sweep.js` | `server/routes/*.js`'ten uç nokta keşfi, tam rol matrisi, fuzz (500/iç bilgi sızıntısı taraması) |
| `b4a-misc.js` | KVKK anonimleştirme kalıntı taraması, doküman, arama, webhook, ZPL etiket, bildirim, firma kimliği/şablon |
| `b4b-crm.js` | CRM fırsat hunisi, destek talepleri, saha ziyaretleri |
| `b4c-ops.js` | MRP, üretim planlama, veri sağlığı (birleştirme/toplu güncelleme), muhasebe dışa aktarımı, raporlar |

## Bulunan sonuçlar

Her `FAIL`/`ERROR`'ın ne anlama geldiği, dosya/satır referanslı kök nedeniyle
birlikte `docs/TAM-LISTE-2026-09-20.md` **§3b Faz 0 — bu oturumda bağımsız
doğrulanan bulgular (V01-V22)** bölümünde ve F21/S08/S14/S16/N-11 satırlarının
güncellenmiş "Not" sütununda yazılı. `INFO` satırları geçti/kaldı değildir —
ürün sahibi kararı (K-01…K-15) bekleyen gözlemlerdir.

## Devam etmek isteyen için

Faz 0'da henüz koşulmayanlar (bkz. TAM-LISTE §3b sonu): masaüstü ekran
taraması (Playwright), varsayılan hız sınırlayıcı + X-Forwarded-For
sahteciliği, yedekleme/geri yükleme script'lerinin gerçek testi, import
kısmi-yazma senaryosu (S15). Aynı desende (`lib.js`'teki `start/api/ok/snap/
check/info/statusIn/finish` yardımcıları + `inv.js`'teki küresel
değişmezler) yeni bir `b5-*.js` dosyası açarak devam edilebilir.
