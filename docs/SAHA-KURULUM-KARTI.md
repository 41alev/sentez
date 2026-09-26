# Saha Kurulum Kartı

Bu belge, sistemi bir müşteri firmanın kendi sunucusuna (veya onların
gösterdiği bilgisayara) kurarken sahada takip etmen için hazırlandı. Teknik
arka plan/gerekçe için [KURULUM.md](KURULUM.md) — o dosya daha ayrıntılı,
bu kart sadece sırayı ve "sahada unutma" noktalarını taşıyor.

**Kural:** her firma kendi ayrı kurulumunu alır (aynı sunucuyu iki firma
paylaşmaz). Bu kart, tek bir firma kurulumu için baştan sona.

---

## 0) Gitmeden önce yanına al

- [ ] Proje dosyaları (USB'de zip hâlinde, internetten de indirilebilir olsun diye)
- [ ] Node.js kurulum dosyası (22 LTS) — sahada internet olmayabilir, indirilmiş `.msi`
      (Windows) veya `.tar.xz` (Linux) yanında olsun
- [ ] Firmanın önceden verdiği bilgiler: unvan, vergi no, ilk depo adı, admin
      kullanıcı adı olarak ne istiyorlar
- [ ] Bu kart + [KURULUM.md](KURULUM.md) (yazıcıdan çıktı veya telefonda)

---

## 1) Sunucu bilgisayarını belirle

Firma sana "şu bilgisayara/sunucuya kur" diyecek. Kontrol et:

- Sürekli açık kalacak mı? (Kapanan bir bilgisayara kurma — herkes erişemez olur.)
- Aynı yerel ağda mı (Wi-Fi/kablolu) diğer bilgisayarlar? (Mobil el terminali ürünle gelmez; barkod için USB okuyucu kullanılır.)
- İşletim sistemi Windows mu Linux mu? (Aşağıdaki adımlar ikisini de kapsıyor.)

---

## 2) Kurulum (ortak adımlar)

```bash
# Node.js 22 kurulu değilse önce onu kur (nodejs.org veya yanındaki dosyadan)

# Proje klasörünü sunucuya kopyala, içine gir, sonra:
npm install --omit=dev
```

**Windows'ta** (PowerShell):
```powershell
Copy-Item .env.example .env
notepad .env
```
**Linux'ta**:
```bash
cp .env.example .env
nano .env
```

`.env` içinde **JWT_SECRET** satırını mutlaka rastgele/uzun bir değerle
değiştir (varsayılan değerle bırakma — güvenlik açığı olur).

```bash
npm run setup
```

Bu komut sana şunları soracak: **firma unvanı, admin kullanıcı adı/şifresi,
ilk depo adı**. Firmanın gerçek bilgilerini gir — demo veri burada YÜKLENMEZ,
bu gerçek kurulumdur.

> `--tax-no` gibi parametreleri önceden biliyorsan otomatik/parametreli
> kurulum da var, bkz. KURULUM.md — ama sahada tek seferlik kurulumda
> soru-cevap yolu daha az hata yapar.

---

## 3) Sunucuyu sürekli/otomatik çalışır hale getir

`npm start` ile açtığın pencere kapanırsa ya da bilgisayar yeniden başlarsa
(elektrik kesintisi, Windows güncellemesi) sistem durur. Bunu **kurulum
gününde** çöz — geri dönüp ikinci kez gitmek istemezsin.

### Windows — NSSM ile servis yap (önerilen, kod değişikliği gerekmez)

1. [nssm.cc](https://nssm.cc/download) adresinden `nssm.exe` indir (küçük,
   tek dosya, kuruluma gerek yok).
2. Yönetici olarak PowerShell/CMD aç, proje klasörüne git:
   ```powershell
   nssm install DreamPlus "C:\Program Files\nodejs\node.exe" "server\index.js"
   nssm set DreamPlus AppDirectory "C:\yol\proje-klasoru"
   nssm set DreamPlus Start SERVICE_AUTO_START
   nssm start DreamPlus
   ```
3. Kontrol: `http://localhost:3000` açılıyor mu? Bilgisayarı yeniden
   başlatıp tekrar dene — otomatik açılmalı.

Servisi durdurmak/kaldırmak gerekirse: `nssm stop DreamPlus` /
`nssm remove DreamPlus confirm`.

### Linux — systemd ile servis yap

```bash
sudo tee /etc/systemd/system/dream-plus.service > /dev/null <<'EOF'
[Unit]
Description=Dream Plus
After=network.target

[Service]
Type=simple
WorkingDirectory=/yol/proje-klasoru
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
User=dreamplus

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now dream-plus
sudo systemctl status dream-plus
```

(`User=dreamplus` — root ile çalıştırma; yoksa önce `sudo useradd -r dreamplus`
ile bir servis kullanıcısı oluştur ve proje klasörünün sahipliğini ona ver.)

---

## 4) Ağdan erişimi doğrula

Sunucu bilgisayarının yerel IP'sini bul:

- Windows: `ipconfig` → "IPv4 Address"
- Linux: `ip addr` veya `hostname -I`

Başka bir bilgisayardan/telefondan aynı ağdayken tarayıcıda:
`http://<o-ip>:3000` — giriş ekranı açılmalı.

Açılmıyorsa: güvenlik duvarı 3000 portunu engelliyor olabilir (Windows
Defender Güvenlik Duvarı'nda gelen kural ekle, veya `sudo ufw allow 3000`
Linux'ta).

> **Öneri:** Sunucu bilgisayarına sabit (statik) yerel IP ata — DHCP ile
> IP değişirse herkesin yer imi/kısayolu bozulur.

---

## 5) Kurulum sonrası (KURULUM.md'nin "Kurulumdan sonra" bölümüyle aynı, kısaca)

- [ ] Firma logosu + antet bilgileri: Yönetim > Belge Şablonları
- [ ] Gerçek veriler aktarıldı mı (varsa): Yönetim > Veri Aktarımı — sıra
      önemli: tedarikçiler → ürünler → açılış stoğu → reçeteler → iş
      merkezleri → rotalar
- [ ] Her çalışana kendi kullanıcı hesabı açıldı (ortak hesap kullanma —
      denetim kaydı işe yaramaz hale gelir)
- [ ] İlk yedek alındı: `npm run backup`
- [ ] Tam `.bundle` paketi `npm run backup:full -- --verify <paket-yolu>` ile doğrulandı; test makinesinde sunucu kapalıyken `npm run restore:full -- <paket-yolu>` çalıştırılıp veritabanı ve belgeler açıldı (doğrulama komutu tek başına geri yükleme değildir)
- [ ] Yönetim > Veri Sağlığı'nda kırmızı/uyarı yok

---

## 6) Ayrılmadan önce son kontrol

- [ ] Sistem yeniden başlatma sonrası kendiliğinden açılıyor mu (adım 3'ü
      gerçekten test et, bilgisayarı bir kez yeniden başlat)
- [ ] En az bir gerçek kullanıcı, kendi hesabıyla, gerçek bir işlemi uçtan
      uca yapabildi mi (ör. bir sayım kaydı, bir sipariş)
- [ ] Firma yetkilisine admin şifresini nasıl değiştireceğini gösterdin mi
- [ ] Yedeklerin **başka bir makineye/yere** de kopyalanması için bir yol
      var mı (aynı diskte duran yedek, o disk bozulursa işe yaramaz) —
      bkz. KURULUM.md "Off-site senkronizasyon"

---

## Sık karşılaşabileceğin sorunlar

| Belirti | Muhtemel sebep | Çözüm |
|---|---|---|
| Sunucu açılmıyor, "Veritabanı boş" diyor | `npm run setup` çalıştırılmamış | `npm run setup` |
| Başka bilgisayardan siteye ulaşılamıyor | Güvenlik duvarı 3000'i engelliyor, veya yanlış IP | Adım 4'e bak |
| Bilgisayar yeniden başlayınca sistem açılmıyor | Servis kurulmamış, sadece `npm start` ile açılmış | Adım 3 |
| Giriş yapılamıyor, admin şifresi unutuldu | — | Başka bir admin hesabından sıfırla; hiç yoksa `npm run setup -- --force` KULLANMA, mevcut veri riske girer — KURULUM.md'deki "Sorun giderme" bölümüne bak |
