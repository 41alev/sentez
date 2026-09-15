# Kurulum — Hiç Bilgisayar Bilmeyen Biri İçin, Adım Adım

Bu belge, [SAHA-KURULUM-KARTI.md](SAHA-KURULUM-KARTI.md)'nin aynı adımlarını,
hiçbir bilgisayar terimini bilmediğini varsayarak, tıklama tıklama anlatır.
Aşağıda **Windows** bilgisayar için anlatılıyor (fabrikalarda en sık bu
olur). Eğer sana "sunucumuz Linux/Ubuntu" derlerse, bu belgeyi bırak, bir
bilgisayarcı/IT kişisi çağır ve ona [KURULUM.md](KURULUM.md) dosyasını ver.

Her adımı sırayla, atlamadan yap. Bir yerde takılırsan, en son doğru
çalışan adıma geri dön, oradan devam et.

---

## Önce birkaç kelimeyi öğrenelim

- **"Tıkla"** = fare ile bir kere sol tuşa bas.
- **"Çift tıkla"** = fare ile iki kere hızlıca sol tuşa bas.
- **"Sağ tıkla"** = fare ile sağ tuşa bas (menü açılır).
- **"Yapıştır"** = klavyede aynı anda `Ctrl` ve `V` tuşlarına bas.
- **"Kopyala"** = önce fare ile yazıyı seç (üzerine basılı tutup sürükle),
  sonra `Ctrl` ve `C` tuşlarına aynı anda bas.
- **"Klasör"** = bilgisayardaki bir dosya çekmecesi gibi düşün, içine
  başka dosyalar/klasörler konur.
- **"Siyah pencere / PowerShell / komut satırı"** = yazı yazarak
  bilgisayara komut verdiğin bir pencere. Fare ile tıklamak yerine yazı
  yazıp Enter'a basarsın.

---

## Adım 1 — Node.js'i kur

Bu program, "Node.js" adında başka bir programın bilgisayarda kurulu
olmasını ister. Önce onu kuracaksın.

1. Bilgisayarda internet tarayıcısını aç (Chrome, Edge — masaüstündeki
   mavi/renkli simgeye çift tıkla).
2. Yukarıdaki adres çubuğuna şunu yaz ve Enter'a bas: `nodejs.org`
3. Açılan sayfada, üzerinde **"LTS"** yazan yeşil/büyük butona tıkla. Bir
   dosya inmeye başlar (genelde ekranın altında veya sağ üstte görünür).
4. İnen dosyaya çift tıkla. Açılan pencerede sırayla:
   - "Next" → "Next" → "I accept..." kutucuğuna tık, "Next"
   - "Next" (birkaç kere gelebilir, hepsinde "Next"e bas)
   - En son "Install" butonuna bas, bittiğinde "Finish"e bas.
5. Bilgisayarı **yeniden başlat** (Başlat menüsü → Güç → Yeniden Başlat).
   Bu önemli, atlama.

---

## Adım 2 — Program dosyalarını bilgisayara koy

1. Masaüstünde boş bir yere sağ tıkla → "Yeni" → "Klasör" → adını
   `SentezERP` yap.
2. Sana verilen program dosyasını (bir `.zip` dosyası, USB'den veya
   internetten) bu `SentezERP` klasörünün İÇİNE kopyala.
3. O `.zip` dosyasına sağ tıkla → **"Tümünü Ayıkla..."** (veya
   "Extract All...") → çıkan pencerede "Ayıkla/Extract" butonuna bas.
4. Şimdi `SentezERP` klasörünün içinde, program dosyalarının olduğu bir
   klasör olacak (içinde `server`, `public` gibi klasörler, `package.json`
   diye bir dosya görürsen doğru yerdesin).

---

## Adım 3 — Siyah pencereyi (PowerShell) aç ve doğru klasöre git

1. Klavyede Windows tuşuna bas (bayrak simgesi), `powershell` yaz, Enter'a bas.
   Mavi/siyah bir pencere açılacak, içinde yazılar ve yanıp sönen bir çizgi var.
2. Az önce açtığın program klasörünü Dosya Gezgini'nde bul, üstteki adres
   çubuğuna tıkla — orada klasörün "yolu" (adresi) yazar, o yazının
   tamamını seç ve kopyala (`Ctrl`+`C`).
3. PowerShell penceresine geri dön, şunu yaz (araya boşluk bırak),
   sonra kopyaladığın yolu yapıştır (`Ctrl`+`V`), sonra Enter'a bas:
   ```
   cd
   ```
   (yani: `cd` yaz, boşluk bırak, yapıştır, Enter — örnek görünüm:
   `cd C:\Users\Sen\Desktop\SentezERP\depo-takip-app`)
4. Doğru gittiysen, pencerede en solda o klasörün adı görünür.

**Bundan sonraki her adımda:** aşağıdaki kutulardaki yazıyı olduğu gibi
PowerShell penceresine yapıştırıp Enter'a basacaksın. Ekranda bir sürü
yazı akacak, bu normal — bitince tekrar yazı yazabileceğin bir satır gelir,
o zaman bir sonraki adıma geçebilirsin.

---

## Adım 4 — Programın ihtiyaç duyduğu parçaları indir

Bunu yapıştır, Enter'a bas, bitmesini bekle (birkaç dakika sürebilir,
internet hızına göre):

```
npm install --omit=dev
```

Ekranda kırmızı "error" (hata) yazmıyorsa, sarı "warning" yazıları
normaldir, devam et.

---

## Adım 5 — Ayar dosyasını hazırla (ÖNEMLİ, atlama)

1. Dosya Gezgini'nde program klasörünün içine gir, `.env.example` adlı
   dosyayı bul.
2. Ona sağ tıkla → "Kopyala", sonra boş bir yere sağ tıkla → "Yapıştır".
   Oluşan kopyanın adını `.env` olarak değiştir (sağ tık → "Yeniden
   Adlandır", `.env.example` yazan yeri silip `.env` yaz).
3. `.env` dosyasına sağ tıkla → "Birlikte Aç" → "Not Defteri" (Notepad).
4. Açılan yazının içinde `JWT_SECRET=` diye başlayan bir satır bul.
   `=` işaretinden sonraki yazıyı sil, yerine klavyeden rastgele, kimsenin
   tahmin edemeyeceği uzunca bir yazı yaz (örnek: `xK9mP2vQ8rT5wZ1nL6yB3jH7`).
5. `Ctrl`+`S` tuşlarına basarak kaydet, Notepad'i kapat.

---

## Adım 6 — Kurulumu çalıştır

PowerShell penceresine dön, bunu yapıştır ve Enter'a bas:

```
npm run setup
```

Sana sırayla soru soracak (ekranda İngilizce/Türkçe karışık görebilirsin,
sorulanlar şunlar):

- **Firma unvanı** → müşterinin gerçek şirket adını yaz, Enter.
- **Admin kullanıcı adı** → örnek: `admin`, Enter.
- **Admin şifresi** → güçlü bir şifre yaz (görünmeyebilir, yazdığından
  emin ol), Enter.
- **İlk depo adı** → örnek: `Merkez Depo`, Enter.

Bitince "kurulum tamamlandı" gibi bir yazı görürsün.

---

## Adım 7 — Programı başlat ve dene

Yine PowerShell'e:

```
npm start
```

Bir iki saniye sonra "çalışıyor" gibi bir satır görünür. **Bu pencereyi
kapatma** (şimdilik) — kapatırsan program durur.

Şimdi tarayıcıyı aç, adres çubuğuna şunu yaz:
```
localhost:3000
```
Sentez ERP'nin giriş ekranı açılmalı. Adım 6'da yazdığın kullanıcı
adı/şifre ile giriş yap, panelin göründüğünü kontrol et.

**Buraya kadar çalıştıysa program kurulmuş demektir.** Şimdi tek eksik:
bu pencere kapanınca veya bilgisayar kapanıp açılınca programın
KENDİLİĞİNDEN yeniden açılmasını sağlamak. Bunu bir sonraki adımda yapıyoruz
— aksi halde birisi bilgisayarı kapatırsa (ya da elektrik kesilirse)
program bir daha kendiliğinden açılmaz, senin gidip bu pencereyi tekrar
açman gerekir.

---

## Adım 8 — Programı "her zaman açık" hale getir (NSSM ile)

1. PowerShell'i şimdilik kapatabilirsin (Adım 7'deki `npm start` penceresini
   de kapat, birazdan program başka türlü açılacak).
2. Tarayıcıda `nssm.cc/download` adresine git, en üstteki sürümün yanındaki
   indirme linkine tıkla. Bir `.zip` iner.
3. O `.zip`'e sağ tık → "Tümünü Ayıkla" (Adım 2'deki gibi).
4. Çıkan klasörün içinde `win64` (bilgisayarın 64-bit ise, çoğu öyledir)
   klasörüne gir, içinde `nssm.exe` dosyasını bulacaksın. Bu dosyanın
   bulunduğu klasörü not al (adres çubuğundan yolu kopyala, Adım 3'teki gibi).
5. Windows tuşuna bas, `powershell` yaz, ama bu sefer sağ tıkla üzerine
   ve **"Yönetici olarak çalıştır"** seçeneğine tıkla (bir onay penceresi
   çıkarsa "Evet" de).
6. Bu yönetici PowerShell'inde, önce `nssm.exe`'nin olduğu klasöre git
   (Adım 3'teki `cd` yöntemiyle), sonra sırayla şunları yapıştır, her
   birinden sonra Enter'a bas — ama **`<...>`** yazan kısımları kendi
   klasör yollarınla değiştirmen lazım:

   ```
   .\nssm.exe install SentezERP "C:\Program Files\nodejs\node.exe" "server\index.js"
   ```
   ```
   .\nssm.exe set SentezERP AppDirectory "<PROGRAM KLASÖRÜNÜN TAM YOLU>"
   ```
   (`<PROGRAM KLASÖRÜNÜN TAM YOLU>` = Adım 3'te `cd` yaparken kullandığın
   o adres, örnek: `C:\Users\Sen\Desktop\SentezERP\depo-takip-app`)
   ```
   .\nssm.exe set SentezERP Start SERVICE_AUTO_START
   ```
   ```
   .\nssm.exe start SentezERP
   ```

7. Tarayıcıda tekrar `localhost:3000` yaz — açılıyorsa çalışıyor demektir,
   artık PowerShell penceresi açık kalmasa da program arka planda çalışır.

**Son kontrol (çok önemli):** Bilgisayarı Başlat menüsünden yeniden
başlat. Açıldıktan sonra tekrar `localhost:3000` dene — hiçbir şey
açmadan, kendiliğinden çalışıyor olmalı. Çalışmıyorsa Adım 8'i tekrar
gözden geçir, muhtemelen bir yol (klasör adresi) yanlış yazılmıştır.

---

## Adım 9 — Diğer bilgisayarların da görebilmesi

1. Aynı bilgisayarda Windows tuşuna bas, `cmd` yaz, Enter'a bas.
2. Açılan pencereye `ipconfig` yaz, Enter'a bas.
3. Çıkan yazılar arasında **"IPv4 Address"** diye bir satır bulacaksın,
   yanında `192.168.x.x` gibi bir sayı dizisi var. Bunu bir kenara not al.
4. Fabrikadaki başka bir bilgisayardan/telefondan, aynı Wi-Fi/ağa bağlıyken
   tarayıcıya şunu yaz: `192.168.x.x:3000` (kendi bulduğun sayılarla).
   Giriş ekranı açılmalı.

Açılmazsa: Windows'un güvenlik duvarı engelliyor olabilir. Windows tuşuna
bas, "Güvenlik Duvarı" yaz, "Gelen Kuralları" bölümünden 3000 portuna
izin veren bir kural eklemen gerekebilir — bu kısımda emin değilsen bir
IT kişisinden 2 dakikalık yardım iste, tehlikeli bir işlem değil.

---

## Buradan sonrası

Program artık çalışıyor ve kalıcı. Şimdi [SAHA-KURULUM-KARTI.md](SAHA-KURULUM-KARTI.md)
dosyasının **"5) Kurulum sonrası"** ve **"6) Ayrılmadan önce son kontrol"**
bölümlerine geç — orada firma logosu ekleme, kullanıcı hesapları açma,
yedek alma gibi kalan işler var (o bölüm bu kadar detaylı anlatılmıyor
ama artık en zor kısmı — kurulumu — geçtin, oradan devamı daha kolay).
