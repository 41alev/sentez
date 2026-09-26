# Kurulum ve Sürüm Yükseltme

Bu belge sistemi kuracak ve işletecek kişi içindir. Günlük kullanım için
[`KULLANIM-KILAVUZU.md`](KULLANIM-KILAVUZU.md) dosyasına bakın.

---

## Gereksinimler

| | Asgari | Önerilen |
|---|---|---|
| Node.js | 22 | 22 LTS veya üstü |
| RAM | 1 GB | 2 GB |
| Disk | 2 GB | 10 GB (yedekler için) |
| İşletim sistemi | Linux, macOS, Windows | Ubuntu 22.04 LTS |

Veritabanı SQLite'tır; ayrıca bir veritabanı sunucusu kurmanız gerekmez.
Dosya olarak `data/` klasöründe durur.

---

## Kurulum

Satıcı müşteri paketini `npm run release` ile üretir; paket
`dream-plus-<sürüm>/` klasörüdür ve içinde `RELEASE.json` ile
`SHA256SUMS.txt` bulunur. Pakette `.env`, özel anahtar, veritabanı veya
yedek bulunmaz — bunlar müşteride oluşturulur.

```bash
# 1. Paketi sunucuya kopyalayın, içine girin ve bağımlılıkları kurun
cd dream-plus-<sürüm>
npm ci --omit=dev

# 2. Ortam ayarlarını hazırlayın
cp .env.example .env
# .env dosyasını açıp JWT_SECRET değerini MUTLAKA değiştirin

# 3. Kurulumu çalıştırın
npm run setup
```

Kurulum size firma unvanını, bir yönetici hesabını ve ilk deponun adını sorar.
**Demo verisi yüklenmez** — kurulum gerçek kullanım içindir.

Otomasyon için parametreli de çalışır:

```bash
ADMIN_PASSWORD='GuclüBirSifre2026!' npm run setup -- \
  --company "Örnek Metal Sanayi A.Ş." \
  --admin-user mehmet \
  --warehouse "Merkez Depo" \
  --tax-no 1234567890
```

> Şifreyi `--admin-pass` ile vermeyin; kabuk geçmişine düşer. `ADMIN_PASSWORD`
> ortam değişkenini kullanın.

Sonra sunucuyu başlatın:

```bash
npm start
```

Tarayıcıdan `http://sunucu-adresi:3000` adresine gidin.

Boş bir veritabanıyla `npm start` çalıştırırsanız sunucu başlamaz ve sizi
kuruluma yönlendirir. Bu kasıtlıdır: sessizce demo verisiyle açılan bir sistem,
fabrikada sahte müşteriler ve herkesin bildiği şifrelerle çalışmak demektir.

---

## Kurulumdan sonra

Sırayla:

1. **JWT_SECRET'ı değiştirdiğinizden emin olun.** Varsayılan değerle çalışan bir
   sistemde token üretmek mümkündür.
2. **Logonuzu ve antet bilgilerinizi girin** — Yönetim > Belge Şablonları.
3. **Verilerinizi aktarın** — Yönetim > Veri Aktarımı. Sıra önemlidir:
   tedarikçiler → ürünler → açılış stoğu → reçeteler → iş merkezleri → rotalar.
4. **Kullanıcıları tanımlayın** — Yönetim > Kullanıcılar. Her kişiye kendi hesabı
   verilmeli; ortak hesap denetim kaydını işe yaramaz hale getirir.
5. **İlk yedeği alın:** `npm run backup`
6. **Yedeği geri yüklemeyi bir kez deneyin.** Denenmemiş yedek, yedek sayılmaz.
7. **Veri sağlığını kontrol edin** — Yönetim > Veri Sağlığı. Aktarılan veride
   tutarsızlık varsa burada görünür.

---

## Ortam ayarları

`.env` dosyasındaki önemli değerler:

| Değişken | Açıklama |
|---|---|
| `JWT_SECRET` | **Mutlaka değiştirin.** Oturum imzalama anahtarı. |
| `PORT` | Varsayılan 3000 |
| `DATA_DIR` | Veritabanı ve yedeklerin yeri (varsayılan `./data`) |
| `BACKUP_KEEP` | Saklanacak rutin yedek sayısı (varsayılan 14) |
| `TRUST_PROXY` | Doğrudan kurulumda boş; yalnız ters vekilin güvenilir IP/CIDR aralığı. Docker Compose uygulama portunu host'a açmaz, `uniquelocal` kullanır ve nginx istemcinin X-Forwarded-For başlığını yeniden yazar. |
| `LOGIN_RATE_LIMIT` | 15 dakikada izin verilen **başarısız** giriş (varsayılan 10) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | E-posta bildirimleri için |
| `NODE_ENV` | Üretimde `production` |

---

## Yedekleme

Sunucu 24 saatte bir otomatik yedek alır ve son 14 kopyayı saklar.

```bash
npm run backup                        # elle yedek
npm run backup:full                   # aynı tam yedek işlemi
npm run backup:full -- --verify data/backups/<paket>.bundle
# Sunucuyu durdurun; doğruladığınız tam paketten DB + belgeleri geri yükleyin:
npm run restore:full -- data/backups/<paket>.bundle
```

Tam yedek `.bundle` dizinidir: `database.sqlite`, `uploads/` ve SHA-256
manifesti içerir. Paketi **dizin olarak, tüm içeriğiyle** taşıyın. Geri yükleme
veritabanı bütünlüğünü, belge referanslarını ve her dosyanın karmasını doğrular;
bozuk veya eksik paketi reddeder. Mevcut DB ve yüklemeler `.pre-restore-<zaman>`
güvenlik kopyalarında tutulur; yer değiştirme yarıda kesilirse eski çift geri
alınır. Eski yalnız-DB `.sqlite` yedekleri için `npm run restore -- ...` komutu
desteklenir; bu komut belgeleri geri getirmez.

> **Sunucuyu durdurmadan geri yükleme yapmayın.** Sunucu, yükseltme ve geri yükleme aynı bakım kilidini kullanır. Çalışan sunucuda geri yükleme/yükseltme `--force` ile bile engellenir. Geri yükleme ayrıca boş olmayan WAL dosyasını reddeder. Beklenmedik kapanıştan sonra önce aynı sürüm sunucuyu açıp normal şekilde kapatarak WAL kurtarmasını tamamlayın. `.maintenance-lock.sqlite` dosyasını çalışan süreç varken silmeyin; süreç kapandığında kilit otomatik bırakılır.

**Yedekleri başka bir makineye kopyalayın.** Aynı diskte duran yedek, disk
arızasında, yangında veya hırsızlıkta işe yaramaz.

### Off-site senkronizasyon (otomatik)

`.env` içinde `BACKUP_OFFSITE_CMD` tanımlanırsa, her başarılı yerel yedekten
hemen sonra bu komut otomatik çalışır (`{file}` paket dizininin tam yoluyla,
`{name}` paket dizininin adıyla
değiştirilir). Başarısız olursa sunucu loguna **açıkça** yazılır — sessizce
yutulmaz (bkz. e-posta bildirimlerinde daha önce bulunan aynı sınıf hata).

```bash
# rclone ile S3-uyumlu depolamaya (Backblaze B2, S3, vb.)
BACKUP_OFFSITE_CMD=rclone copy "{file}" remote:depo-takip-yedek/{name}/

# Windows ağ paylaşımına
BACKUP_OFFSITE_CMD=robocopy /* önce dosyayı kopyalayacak bir .bat/.ps1 script'e yönlendirin */

# Basit rsync (Linux/Mac, SSH anahtarı önceden kurulmuş olmalı)
BACKUP_OFFSITE_CMD=rsync -az "{file}/" yedek-sunucu:/var/backups/depo-takip/{name}/
```

Bu, yerel yedeğin YERİNE geçmez — geri yükleme hâlâ yerel `data/backups/`
klasöründen yapılır (`npm run restore:full`). Off-site kopya yalnızca "sunucunun
kendisi kaybolursa" senaryosu içindir; o durumda dosyayı uzak depodan geri
indirip tam paket dizinini `npm run restore:full -- <indirilen-paket>` ile geri yüklersiniz.

---

## Sürüm yükseltme

```bash
# 1. Sunucuyu durdurun
# 2. Yeni sürümü açın (data/ klasörünü KORUYUN)
# 3. Bağımlılıkları güncelleyin
npm install --omit=dev

# 4. Yükseltmeyi çalıştırın
npm run upgrade
```

Yükseltme şu sırayı garanti eder:

1. Sunucu çalışıyor mu — çalışıyorsa durur
2. Yedek alır ve **doğrular**
3. Bekleyen migration'ları gösterir, onay ister
4. Uygular
5. Sonucu doğrular (bütünlük, yabancı anahtarlar, çekirdek tablolar)
6. Doğrulama başarısızsa **yedeğe geri döner**

Yükseltme öncesi alınan yedek `-pre-upgrade` etiketiyle saklanır ve rutin
rotasyonda silinmez — bir sorun haftalar sonra fark edilebilir.

Ne yapacağını önce görmek için:

```bash
npm run upgrade -- --dry-run     # hiçbir şey değiştirmez
npm run upgrade -- --yes         # onay sormaz (otomasyon için)
```

### Yükseltme başarısız olursa

Script otomatik geri döner ve eski sürümle çalışmaya devam edebilirsiniz.
Otomatik geri dönüş de başarısız olursa tam yedek paketinin yolunu yazar.
Sunucu kapalıyken aynı paketi elle geri yükleyin:

```bash
npm run restore:full -- data/backups/depo-takip-...-pre-upgrade.bundle
```

---

## Lisanslama

Varsayılan satış modeli **ömür boyu lisans**tır — `.env` dosyasında `LICENSE_FILE`
tanımlanmadığı sürece hiçbir kısıtlama uygulanmaz, sunucu her zamanki gibi açılır.
Bu, bugün için yapmanız gereken hiçbir şey olmadığı anlamına gelir.

**Aylık/yıllık lisans kullanılıyorsa**, satıcının verdiği imzalı `.json` lisans
dosyasını müşterinin sunucusuna kopyalayın (ör. `data/license.json`),
`.env` dosyasına `LICENSE_FILE=data/license.json` satırını ekleyin ve sunucuyu
yeniden başlatın. Lisans geçersiz veya süresi dolmuşsa sunucu **kasıtlı olarak
açılmaz** ve nedenini açıkça yazar — tıpkı kurulum yapılmamış boş bir veritabanıyla
karşılaşıldığında olduğu gibi. Lisans durumu (kalan gün dahil) Yönetim > Veri
Sağlığı ekranında da görünür.

---

## Docker ile çalıştırma

```bash
cp .env.example .env     # JWT_SECRET'ı değiştirin
docker compose up -d
docker compose exec app npm run setup
```

`docker-compose.yml` içinde `data/` klasörü kalıcı birim olarak bağlanmıştır;
kapsayıcı silinse bile veri kalır.

`nginx.conf` içinde TLS bloğu hazır ama yorumludur. **Üretimde mutlaka HTTPS
kullanın** — aksi halde şifreler ağda açık gider.

---

## İzleme

`GET /health` kimlik istemez, izleme araçları için uygundur:

```json
{ "status": "ok", "db": "connected", "pendingMigrations": 0, "version": "2.0.0" }
```

`pendingMigrations` sıfırdan büyükse yükseltme yarım kalmış demektir.

Arayüzde Yönetim > Veri Sağlığı sekmesi sistem durumunu da gösterir:
sürüm, migration durumu, veritabanı boyutu ve **son yedeğin üzerinden geçen gün**.

---

## Sorun giderme

**Sunucu başlamıyor, "Veritabanı boş" diyor.**
Kurulum yapılmamış: `npm run setup`

**"pendingMigrations" sıfırdan büyük.**
Yükseltme yarım kalmış: `npm run upgrade`

**Giriş yapılamıyor, şifre unutuldu.**
Başka bir yönetici hesabı varsa oradan sıfırlayın. Hiç yoksa veritabanına
erişimi olan biri yeni bir yönetici oluşturmalıdır; bu işlem için
`npm run setup -- --force` **kullanmayın**, mevcut veriyi kontrol etmeden
çalıştırmak risklidir.

**Disk doluyor.**
Yedekler birikmiştir. `BACKUP_KEEP` değerini düşürün ve eski etiketli
yedekleri başka bir makineye taşıyın.

**Sistem yavaşladı.**
Yönetim > Veri Sağlığı'nı çalıştırın. Genellikle birikmiş açık belgeler veya
tutarsız stok kayıtları sebep olur.
