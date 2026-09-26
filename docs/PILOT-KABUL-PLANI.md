# Pilot ve satış kabulü planı

Bu plan ilk müşteride yapılacak pilotun adımlarını, geçme ölçütlerini ve
kabul tutanağını tanımlar. Aynı zincirin otomatik provası
`node test/run-all.js pilot-flow` ile geliştirme ortamında çalışır
(26 Eylül 2026: **Geçti**). Prova müşteri pilotunun yerine geçmez: gerçek
kayıtlar, gerçek kişiler, gerçek ağ ve yedek hedefi yalnız sahada sınanır.

## Ön koşullar

- [ ] Paket `npm run release` ile üretildi; `SHA256SUMS.txt` müşteride
      doğrulandı, `RELEASE.json` sürümü kayda geçti.
- [ ] Temiz Windows bilgisayara kurulum (`docs/SAHA-KURULUM-KARTI.md`),
      servis olarak çalışma ve **bilgisayar yeniden başlatıldıktan sonra
      kendiliğinden açılma** görüldü.
- [ ] Ağdaki ikinci bilgisayardan erişim; HTTPS kullanılıyorsa sertifika
      uyarısız açılıyor. Proxy arkasındaysa `TRUST_PROXY` yalnız proxy
      ağına ayarlı ve uygulama portu dışarı kapalı.
- [ ] Günlük tam yedek zamanlandı; off-site hedef (`BACKUP_OFFSITE_CMD`)
      tanımlı ve ilk kopya hedefe ulaştı.
- [ ] Kullanıcılar gerçek kişilere göre açıldı (en az bir müdür ve bir
      operatör; kalite ayrı kişiyse kalite rolü).

## Pilot senaryosu (müşterinin kendi kayıtlarıyla)

| # | Adım | Rol | Geçme ölçütü |
|---|---|---|---|
| 1 | Açılış stoğu / Excel içe aktarma | Müdür | İçe aktarma raporunda hatalı satır yok; ürün sayısı ve toplam stok müşteri listesiyle aynı |
| 2 | Satın alma siparişi ve onay | Operatör → Müdür | Onay kuralı eşiği doğru rolü istiyor |
| 3 | Mal kabul (muayeneli ürün) | Operatör | Parti karantinada, stok kullanılamaz |
| 4 | Giriş muayenesi, imza parolası | Kalite | Yanlış parola reddedilir; kabul/ret miktarı stoğa doğru yansır |
| 5 | Ret kısmı için tedarikçi iadesi | Operatör | İade yalnız ret partisinden düşer |
| 6 | Alış faturası, mutabakat (eski fatura varsa), onay, kısmi ödeme | Operatör → Müdür | Onaysız fatura ödenemez; ödeme toplamı KDV dahil tutarı aşamaz |
| 7 | Üretim emri ve tamamlama | Operatör | Reçete tüketimi ve mamul birim maliyeti elle hesapla aynı |
| 8 | Satış siparişi, sevkiyat, fatura | Operatör | Kredi limiti çalışır; FEFO/parti seçimi doğru; irsaliye çıktısı doğru |
| 9 | Kısmi tahsilat ve iade faturası | Operatör | Müşteri açık bakiyesi müşterinin kendi hesabıyla aynı |
| 10 | Sayım ve onay | Operatör → Müdür | Fark hareketi oluşur; sayım sırasında hareket varsa onay durur |
| 11 | Raporlar | Müdür | Stok değerleme, kârlılık ve yevmiye dışa aktarımı müşterinin mevcut kayıtlarıyla karşılaştırıldı; farklar açıklandı |
| 12 | Yetki | Tüm roller | Görüntüleyici yazamaz; operatör onaylayamaz |
| 13 | Yedekten boş ortama geri yükleme | Kurulumcu | Ayrı bilgisayarda/klasörde `npm run restore:full` sonrası 1–11'deki rakamlar aynı |

## Kabul ölçütü

- Veri kaybı, stok/para tutarsızlığı veya yetki hatası içeren **kritik
  hata sayısı 0**.
- Kritik olmayan bulgular tarihli bir listeyle kayıt altında ve çözüm
  tarihi üzerinde anlaşılmış.
- 13 adımın her biri **Geçti / Kaldı / Uygulanamaz** olarak işaretli ve
  kanıtı (ekran görüntüsü, rapor çıktısı, belge no) iliştirilmiş.

## Kabul tutanağı

```
DREAM PLUS PİLOT KABUL TUTANAĞI

Müşteri / tesis      : ..............................................
Sürüm (RELEASE.json) : ...............   Commit: ...............
Lisans no            : DPL-.........     Bitiş: ........ / süresiz
Kurulum tarihi       : ..../..../......  Pilot dönemi: ........ – ........

Adım sonuçları (1–13): Geçti ... / Kaldı ... / Uygulanamaz ...
Kritik hata sayısı   : .....
Açık bulgular        : (liste ve hedef tarih ekte)
Yedek geri yükleme   : ..../..../...... tarihinde ........ bilgisayarında denendi — Geçti / Kaldı
Eğitim verilen kişiler: ..............................................

Sonuç: [ ] Kabul   [ ] Şartlı kabul (ekteki bulgular kapanınca)   [ ] Red

Müşteri yetkilisi (ad, imza, tarih): ...............................
Kurulumu yapan (ad, imza, tarih)   : ...............................
```

## İlk sürüm teslim paketi

- `release/dream-plus-<sürüm>/` klasörü ve `SHA256SUMS.txt`
- Müşteriye özel `data/license.json` (süreli satışta) — `docs/LISANS-OPERASYONU.md`
- `docs/KURULUM.md`, `docs/KULLANIM-KILAVUZU.md`, `docs/SAHA-KURULUM-KARTI.md`
- İmzalı kabul tutanağı ve açık bulgu listesi
- Destek iletişim bilgisi ve destek kapsamı (sözleşmede)
