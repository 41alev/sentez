# Depo Takip ERP — Kullanım Kılavuzu

Bu kılavuz sistemi kullanacak kişiler içindir. Teknik kurulum için `README.md` dosyasına bakın.

---

## İçindekiler

1. [Giriş ve ilk adımlar](#1-giriş-ve-ilk-adımlar)
2. [Kim neyi yapabilir](#2-kim-neyi-yapabilir)
3. [Depo görevlisi: günlük işler](#3-depo-görevlisi-günlük-işler)
4. [Satın alma sorumlusu](#4-satın-alma-sorumlusu)
5. [Üretim sorumlusu](#5-üretim-sorumlusu)
6. [Kalite sorumlusu](#6-kalite-sorumlusu)
7. [Satış sorumlusu](#7-satış-sorumlusu)
8. [Planlama sorumlusu](#8-planlama-sorumlusu)
9. [Müdür: onaylar ve raporlar](#9-müdür-onaylar-ve-raporlar)
10. [Yönetici: sistem ayarları](#10-yönetici-sistem-ayarları)
11. [Sık karşılaşılan durumlar](#11-sık-karşılaşılan-durumlar)
12. [Hata mesajları ne anlama geliyor](#12-hata-mesajları-ne-anlama-geliyor)

---

## 1. Giriş ve ilk adımlar

Tarayıcınızdan sistemin adresini açın, kullanıcı adı ve şifrenizle girin.

İlk girişinizde şifre değiştirmeniz istenebilir. Bu ekranı kapatamazsınız — şifrenizi belirlemeden
devam edemezsiniz. Şifreniz en az 8 karakter olmalı ve harf ile rakam içermelidir.

**Şifrenizi unuttuysanız** kendiniz sıfırlayamazsınız; yöneticinize başvurun. Yönetici şifrenizi
sıfırladığında açık oturumlarınız kapanır ve yeni şifreyle tekrar girmeniz gerekir.

**Beş kez yanlış şifre girerseniz** hesabınız geçici olarak kilitlenir. Bu kaba kuvvet saldırılarına
karşı bir korumadır; yönetici kilidi açabilir.

### Ekranı tanıyalım

Sol taraftaki menü modülleri gösterir. Yetkinizde olmayan modüller görünmez — menüde göremediğiniz
bir bölüm varsa erişiminiz yok demektir, arıza değildir.

Sağ üstteki **zil ikonu** bildirimleri açar: kritik stok, son kullanma tarihi yaklaşan partiler,
geciken siparişler, açık uygunsuzluklar. Zil turuncu yanıyorsa okunmamış bildirim var.

Sol alttaki **TR/EN** kutusundan dili değiştirebilirsiniz. Değişiklik anında uygulanır.

---

## 2. Kim neyi yapabilir

| | Yönetici | Müdür | Operatör | Kalite | Görüntüleyici |
|---|:--:|:--:|:--:|:--:|:--:|
| Görüntüleme, raporlar | ✓ | ✓ | ✓ | ✓ | ✓ |
| Stok girişi, üretim, sipariş oluşturma | ✓ | ✓ | ✓ | — | — |
| Sayım yapma | ✓ | ✓ | ✓ | ✓ | — |
| Muayene, uygunsuzluk, DÖF, kalibrasyon | ✓ | ✓ | — | ✓ | — |
| Lot durumu değiştirme | ✓ | ✓ | ✓ | ✓ | — |
| Onay (sipariş, sayım, talep) | ✓ | ✓ | — | — | — |
| Kayıt silme | ✓ | ✓ | — | — | — |
| Kullanıcı yönetimi, sistem ayarları | ✓ | kısmi | — | — | — |

**Neden onay ayrı bir yetki?** Sipariş açan kişinin kendi siparişini onaylayabilmesi, iç kontrolün
en temel kuralını ihlal eder. Sistem bunu bilerek ayırır.

---

## 3. Depo görevlisi: günlük işler

### Ürün bulmak

**Ürünler** ekranındaki arama kutusuna ürün adı, kodu veya barkodun bir kısmını yazmanız yeterli.
Üstteki filtrelerden kategori, depo, menşei ve ürün tipine göre daraltabilirsiniz.
**Düşük stok** düğmesi kritik seviyenin altındaki ürünleri tek tıkla gösterir.

### Barkod okutmak

**Barkod** düğmesine basın. Üç yolla okutabilirsiniz:

- **USB okuyucu:** Ekran açıkken okutmanız yeterli, alana tıklamanıza gerek yok. Okuyucu klavye
  gibi çalışır ve sistem bunu insan yazışından ayırt eder.
- **Kamera:** Chrome veya Edge kullanıyorsanız kamera açılır ve barkodu görüntüye tutmanız yeterli.
  Safari ve Firefox bunu desteklemez.
- **Elle:** Barkodu yazıp Enter'a basın.

Barkod sistemde kayıtlıysa ürün kartı açılır. Kayıtlı değilse yeni ürün ekleme formu açılır ve
barkod otomatik doldurulur.

### Stok girişi

Ürün satırındaki **+** düğmesine basın. Miktar, depo ve birim maliyeti girin.

- **Parti no** boş bırakılabilir, ancak izlenebilirlik gereken malzemelerde mutlaka girin.
  Bir geri çağırma durumunda bu numara olmadan hangi müşteriye gittiğini bulamazsınız.
- **Son kullanma tarihi** girilirse sistem yaklaştığında uyarır. Ürün kartında raf ömrü tanımlıysa
  tarih otomatik hesaplanır.
- **Karantinaya al** işaretliyse mal, kalite onayı verilene kadar kullanılamaz. Muayene gerektiren
  ürünlerde bu kutu otomatik işaretli gelir.

### Parti (lot) yönetimi

**Partiler** ekranı stoğu parti bazında gösterir. Buradan:

- **Durum değiştir:** Karantinadaki bir partiyi serbest bırakmak veya bir partiyi bloke etmek için.
  Miktarın bir kısmını değiştirirseniz parti ikiye bölünür ve her parça kendi geçmişini korur.
- **Transfer:** Partiyi başka bir depoya taşır. Parti kimliği ve maliyeti korunur.
- **İzlenebilirlik (göz ikonu):** Bu partinin içine ne girdiğini, nereye gittiğini ve geri çağırma
  gerekirse hangi müşterilerin etkileneceğini gösterir. Raporu yazdırabilirsiniz.

### Sayım

**Sayım > Yeni Sayım**, depo seçin. Sistem o depodaki tüm partileri listeler.

Saydığınız miktarları **Sayılan** sütununa girin. Fark ve farkın parasal değeri anında hesaplanır.
Ara verecekseniz **Sayımı Kaydet** deyin, sonra kaldığınız yerden devam edebilirsiniz.

Sayımı **onaylamak müdür yetkisidir** ve onaylandığında farklar stoğa kalıcı olarak işlenir.
Onaydan önce sayımlarınızı bir kez daha kontrol edin.

---

## 4. Satın alma sorumlusu

### Akış

```
Talep  →  Teklif (RFQ)  →  Karşılaştırma  →  Sipariş  →  Onay  →  Teslim alma  →  Fatura
```

Her adım zorunlu değildir; küçük alımlarda doğrudan sipariş açabilirsiniz.

### Teklif karşılaştırma

**Teklifler** sekmesinde teklif talebi açın, kalemleri girin. Tedarikçilerden gelen fiyatları
**Teklif Ekle** ile kaydedin. **Teklifleri Karşılaştır** farklı para birimlerini TL'ye çevirerek
yan yana gösterir ve en iyi fiyatı işaretler.

Not: En ucuz her zaman en iyi değildir. Karşılaştırma ekranı tedarik süresini de gösterir;
üç gün önce lazım olan malzeme için 21 günlük teslimat işe yaramaz.

### Sipariş ve onay

Sipariş oluştururken para birimini doğru seçin. Sistem o günün kuruyla TL karşılığını hesaplar
ve **bu kuru siparişe sabitler** — sonradan kur değişse bile siparişin maliyeti değişmez.

Tutar onay eşiğini aşıyorsa sipariş **Onay bekliyor** durumunda kalır ve teslim alınamaz.
Onay eşikleri Yönetim ekranından tanımlanır.

### Teslim alma

Sipariş satırındaki **Teslim Al** düğmesine basın.

- **Kısmi teslim alabilirsiniz.** Gelen miktarı girin; kalan miktar siparişte açık kalır ve
  sipariş "Kısmi teslim" durumuna geçer.
- Her teslimat için **irsaliye no** girin; sonradan hangi partinin hangi sevkiyatla geldiğini
  bulmanız gerekebilir.
- **Parti no** girerseniz izlenebilirlik zinciri kurulur.
- **Karantinaya al** işaretliyse mal kalite onayına düşer.

### Varış maliyeti (landed cost)

İthalatta malın gerçek maliyeti fatura tutarından fazladır: navlun, gümrük, sigorta, elleçleme.

Teslim alma kaydındaki **Varış Maliyeti Ekle** düğmesiyle bu giderleri girin. Sistem bunları
o irsaliyeyle gelen partilerin birim maliyetine dağıtır. Dağıtımı değere veya miktara göre
yapabilirsiniz — hacimli ama ucuz malzemede miktar, değerli ama küçük malzemede değer daha doğrudur.

**Bunu atlarsanız** kârlılık raporunuz olduğundan iyi görünür.

### Fatura ve 3'lü eşleştirme

**Fatura Gir** ile tedarikçi faturasını kaydedin. Sistem faturayı sipariş ve teslim alınan
miktarla karşılaştırır:

- **Eşleşti:** Fatura, sipariş ve teslimat uyumlu.
- **Fark var:** Bir yerde uyuşmazlık var — ödemeden önce inceleyin.
- **Eşleşmedi:** İlişkilendirilecek teslimat bulunamadı.

---

## 5. Üretim sorumlusu

### Reçete (BOM)

Bir mamulün üretilebilmesi için reçetesi tanımlı olmalıdır. Ürün kartını açın, **Düzenle** deyin,
alttaki **Üretim reçetesi** bölümünden bileşenleri ekleyin.

Her bileşen için **birim başına miktar** ve varsa **fire yüzdesi** girin. Fire yüzdesi, o bileşenden
üretim sırasında kaybedilen oranı ifade eder ve tüketim hesabına eklenir.

### Üretim emri

**Üretim > Yeni Üretim Emri.** Mamulü ve miktarı seçin. Sistem alt tarafta gerekli bileşenleri ve
her birinin yeterli olup olmadığını gösterir. Kırmızı görünen bir bileşen varsa üretim tamamlanamaz.

### Üretimi tamamlama

**Tamamla** düğmesine basın:

- **Üretilen:** Sağlam çıkan miktar.
- **Fire:** Hurdaya ayrılan miktar. Bunu doğru girin; verim raporu buna dayanır.
- **İşçilik maliyeti:** O emre harcanan işçilik. Girilmezse maliyet eksik hesaplanır.
- **Genel gider %:** Malzeme maliyeti üzerinden eklenir.

Onayladığınızda sistem bileşenleri **gerçek partilerden** düşer (son kullanma tarihi en yakın
olandan başlayarak) ve çıkan mamul için yeni bir parti oluşturur. Böylece hangi hammadde
partisinin hangi mamulde kullanıldığı kayıt altına alınır.

**Birim maliyet** = (malzeme + işçilik + genel gider) ÷ üretilen miktar. Bu rakam satış
kârlılığında kullanılır, dolayısıyla girdilerin doğruluğu önemlidir.

---

## 6. Kalite sorumlusu

### Muayene planı

Bir ürünü her muayenede aynı özelliklerin ölçülmesi için önceden plan tanımlayın:
**Kalite > Muayene Planları > Yeni Plan.**

Ölçülebilir özelliklerde alt ve üst limit girin (ör. kalınlık 1,9–2,1 mm). Ölçülemeyen
özelliklerde **Şartname** alanına yazın (ör. "Çizik ve pas olmamalı").

### Muayene sonucu girmek

Bekleyen muayeneler listesinde **Sonucu Kaydet** deyin.

Ölçüm değerini girdiğinizde sistem limitlere göre **uygun/uygunsuz** işaretini otomatik koyar;
gerekirse elle değiştirebilirsiniz. Red miktarını girdiğinizde kabul miktarı ve genel sonuç
kendiliğinden güncellenir.

- **Kabul** verirseniz karantinadaki parti otomatik serbest bırakılır ve kullanılabilir hale gelir.
- **Kabul dışı** bir sonuç verirseniz sistem otomatik olarak bir **uygunsuzluk (NCR)** kaydı açar.

Sonucu onaylamanız **elektronik imza** sayılır: kim, ne zaman onayladı kayıt altına alınır ve
değiştirilemez.

### Uygunsuzluk (NCR)

Uygunsuzluk açıldıktan sonra bir **karar** verilmelidir:

| Karar | Ne olur |
|---|---|
| Olduğu gibi kullan | Parti serbest bırakılır, sapma kayıtta kalır |
| Yeniden işle | Parti bloke kalır, düzeltme sonrası tekrar muayene edilir |
| Tedarikçiye iade | Parti reddedilir, iade süreci başlar |
| Hurdaya ayır | Parti stoktan düşülür |

Karar verilmeden uygunsuzluk kapatılamaz.

### DÖF (Düzeltici/Önleyici Faaliyet)

Tekrar eden veya ciddi uygunsuzluklarda DÖF açın. **Kök neden** ve **aksiyon planı** yazın,
sorumlu ve termin belirleyin.

**DÖF, etkinlik kontrolü yazılmadan kapatılamaz.** Bu kasıtlıdır: "aksiyon aldık" demek yetmez,
aksiyonun işe yaradığının kanıtı istenir. Denetimde ilk sorulacak şey budur.

### Kalibrasyon

Ölçüm cihazlarını **Cihaz / Kalibrasyon** sekmesinden kaydedin. Kalibrasyon periyodunu girin;
sistem tarihi yaklaştığında uyarır ve süresi geçen cihazları kırmızı gösterir.

Kalibrasyonu geçmiş bir cihazla yapılan ölçüm, denetimde geçersiz sayılır.

### İzlenebilirlik ve geri çağırma

**İzlenebilirlik** sekmesinden ürün ve parti seçin. Üç bilgi gelir:

- **Geriye izleme:** Bu partinin içine hangi hammadde partileri girdi.
- **İleriye izleme:** Bu parti hangi üretimlerde kullanıldı, hangi sevkiyatlara girdi.
- **Geri çağırma raporu:** Bu partiden etkilenen tüm müşteriler, sevkiyat numaraları ve tarihleriyle.

Raporu yazdırıp müşteri bilgilendirmesinde kullanabilirsiniz.

---

## 7. Satış sorumlusu

### Müşteri ve kredi limiti

Müşteri kartında **kredi limiti** tanımlarsanız, açık bakiyesi limiti aşan müşteriye yeni sipariş
girilemez. Sistem limiti ve mevcut bakiyeyi göstererek engeller. Limit 0 ise kontrol yapılmaz.

e-Fatura düzenleyecekseniz müşterinin **VKN/TCKN** bilgisi zorunludur.

### Sipariş ve sevkiyat

Sipariş girerken ürün seçtiğinizde satış fiyatı otomatik gelir; değiştirebilirsiniz.

Sevkiyat oluştururken **parti seçimi** iki türlü olur:

- **Otomatik (FEFO):** Sistem son kullanma tarihi en yakın partiden başlayarak seçer. Çoğu durumda
  doğru olan budur — eski mal önce çıkar.
- **Elle:** Belirli bir partiyi sevk etmeniz gerekiyorsa listeden seçin.

**Kasa ölçüleri** girerseniz sevk irsaliyesinde toplam ağırlık ve hacim hesaplanır.
İhracatta bu bilgiler nakliyeci için gereklidir.

### Kârlılık

**Kârlılık** sekmesi ürüne, müşteriye veya siparişe göre marj gösterir.

Buradaki maliyet **gerçekten depodan çıkan partilerin maliyetidir** — standart maliyet tahmini
değil. Bu yüzden aynı ürün farklı siparişlerde farklı marj gösterebilir; bu bir hata değil,
hangi partinin sevk edildiğinin sonucudur.

### e-Belge

Fatura kestikten sonra **e-Belge Oluştur** düğmesiyle e-Fatura veya e-Arşiv üretilir. Hangisinin
düzenleneceğini siz seçmezsiniz: alıcı e-Fatura mükellefiyse e-Fatura, değilse e-Arşiv düzenlenir.
Bu bir tercih değil, GİB kuralıdır.

Belge önce **Taslak** durumunda oluşur. **Gönder** yetkisi müdürdedir.

> **Gönderilmiş bir e-Fatura tek taraflı iptal edilemez.** Yanlış fatura kestiyseniz iade faturası
> düzenlemeniz gerekir. Sistem yanlışlıkla iptal etmenizi engeller.

---

## 8. Planlama sorumlusu

### İş merkezleri ve vardiyalar

**İş merkezi**, üretimin yapıldığı yerdir: bir tezgâh, bir hat, bir kabin.

Kapasite vardiyadan gelir. Bir iş merkezine vardiya atamazsanız sistem o merkezi **hiç çalışmıyor**
sayar ve oraya iş planlamaz. Yeni bir iş merkezi açtığınızda vardiya atamayı unutmayın.

Kapasite hesabı şöyle işler:

```
Günlük kapasite = vardiya süresi − mola
                × paralel istasyon sayısı
                × (1 − planlı duruş %)
                × verimlilik %
```

Tatil günlerini **Tatil Ekle** ile girin; o günlerde kapasite sıfır olur ve çizelgeleme atlar.

### Rota

Reçete **ne** gerektiğini söyler, rota **nasıl** yapıldığını. Çizelgeleme rotasız çalışmaz.

Her operasyon için:
- **Hazırlık süresi:** Parti başına harcanır (tezgâh ayarı gibi).
- **Birim süre:** Her adet için harcanır.
- **Bekleme süresi:** Taşıma/soğuma gibi; kapasite tüketmez ama termini uzatır.

### Çizelgeleme

Üretim emrini açtıktan sonra **Çizelgele** deyin. Sistem her operasyonu ilgili iş merkezinin
**boş kapasitesine** yerleştirir, doluysa sonraki güne kaydırır.

Bu **sonlu kapasiteli** çizelgelemedir. Sonsuz kapasite varsayan bir plan "her şey zamanında biter"
der ve hiçbir işe yaramaz.

Sonuçta emrin planlanan başlangıç ve bitişi çıkar. Termin girdiyseniz gecikme varsa uyarılırsınız.

### MRP

**MRP Çalıştır** deyin ve planlama ufkunu girin (varsayılan 90 gün).

Sistem her ürün için şunu hesaplar:

```
Net ihtiyaç = brüt ihtiyaç + emniyet stoğu − eldeki − yoldaki
```

Brüt ihtiyaç açık satış siparişlerinden ve üst seviye üretim ihtiyaçlarından gelir. Bir mamulün
ihtiyacı, reçetesi üzerinden bileşenlerin ihtiyacına dönüşür — bu **seviye seviye** yapılır.

Öneriler iki türlüdür: **Üret** (üretim emri önerisi) ve **Satın al** (sipariş önerisi).
Ürün kartındaki *tedarik şekli* bunu belirler.

**Bırakma tarihi** = ihtiyaç tarihi − tedarik süresi. Bu tarih bugünden önceyse öneri **gecikmiş**
olarak işaretlenir; hemen sipariş verseniz bile geç kalırsınız demektir.

> **MRP yalnızca hesaplar.** Hiçbir sipariş veya emir otomatik açılmaz. Her öneriyi
> **Belgeye Dönüştür** ile onaylamanız gerekir. Bu kasıtlıdır: MRP bir tavsiyedir, karar sizindir.

### Vardiya kaydı ve OEE

Her vardiya sonunda **Vardiya Kaydı Gir**: çalışılan süre, duruş süresi ve sebebi, üretilen ve
fire miktarı.

Bu kayıtlardan **OEE** hesaplanır:

```
OEE = Kullanılabilirlik × Performans × Kalite
```

- **Kullanılabilirlik:** Planlanan sürenin ne kadarında çalışıldı.
- **Performans:** Çalışılan sürenin ne kadarı verimli geçti.
- **Kalite:** Üretilenin ne kadarı sağlam çıktı.

Tek bir OEE yüzdesi kaybın nerede olduğunu söylemez; üçünü birlikte okuyun. %60 OEE, kalite
sorunundan da kaynaklanabilir sık duruştan da — çözümleri farklıdır.

---

## 9. Müdür: onaylar ve raporlar

### Onay bekleyenler

Sol menüde **Satın Alma** yanındaki turuncu rozet onay bekleyen sipariş sayısını gösterir.
Onaylamadan önce şunlara bakın: tedarikçi doğru mu, fiyat teklifle uyumlu mu, teslim tarihi
ihtiyaca yetiyor mu.

Sayım onayı da sizdedir ve **geri alınamaz** — onayladığınız anda farklar stoğa işlenir.

### Hangi rapor ne işe yarar

| Rapor | Cevapladığı soru |
|---|---|
| Stok Değerleme | Depoda ne kadar param duruyor |
| Ölü Stok | Hangi para hareketsiz bekliyor |
| Devir Hızı | Hangi malzeme çok uzun süre stokta kalıyor |
| ABC Analizi | Hangi %20 ürün cironun %80'ini yapıyor |
| Sipariş Önerileri | Neyi ne zaman sipariş etmeliyim |
| Tedarikçi Performansı | Kim zamanında ve sağlam teslim ediyor |
| Kalite KPI | Fire ve red oranlarım nereye gidiyor |
| Üretim Maliyetleri | Hangi emir ne kadara mal oldu |
| Kârlılık | Hangi ürün/müşteri gerçekten kazandırıyor |

**Ölü stok** raporunu ayda bir açın. Orada duran para, bankada duran paradan farksızdır ama
faiz getirmez ve bozulma riski taşır.

**Tedarikçi performansı** puanı zamanında teslim %50 + kalite %50 ağırlıklıdır. Yeni tedarikçilerde
geçmiş veri olmadığı için puan hesaplanmaz.

---

## 10. Yönetici: sistem ayarları

### Kullanıcılar

Yeni kullanıcı açarken rolü dikkatli seçin; ekranda rolün ne yapabildiği yazar.

**Onay limiti**, o kullanıcının onaylayabileceği azami tutardır. 0 girerseniz onay yetkisi yok
demektir — sınırsız demek değildir.

Bir kullanıcının rolünü değiştirdiğinizde veya şifresini sıfırladığınızda **açık oturumları anında
kapanır**. Bu bilinçlidir: yetkisi düşürülen birinin eski oturumla çalışmaya devam etmesi
güvenlik açığıdır.

Sistem **son yöneticinin** rolünü düşürmenize veya hesabını kapatmanıza izin vermez.

### Döviz kurları

Kurları **tarihiyle birlikte** girin. Sistem geçmiş kurları saklar ve eski alımları kendi
tarihindeki kurla değerler. Aksi halde geçmiş maliyetleriniz her gün değişirdi.

### Onay ve bildirim kuralları

**Onay kuralı:** Belirli tutarın üzerindeki siparişler için hangi rolün onayı gerektiğini belirler.
Örneğin 100.000 TL üzeri müdür, 500.000 TL üzeri yönetici onayı.

**Bildirim kuralı:** Hangi durumda kimin uyarılacağını belirler. E-posta kanalı için SMTP
ayarlarının yapılmış olması gerekir.

### Denetim kaydı

Her değişiklik kim, ne zaman, eski değer ve yeni değeriyle kaydedilir. Bu kayıt **silinemez** —
yönetici bile silemez. Denetimde ilk istenecek şey budur.

### e-Belge ayarları

Gönderici bilgileri (unvan, VKN, vergi dairesi, adres, posta kutusu etiketi) faturanın üzerinde
yer alır. Hatalı olması belgenin GİB tarafından reddedilmesine yol açar.

**Entegratör** seçimi: `Yerel` mod belgeyi üretir ve diske yazar, hiçbir yere göndermez — test için.
Canlıda entegratörünüzün API adresini ve anahtarını girin.

> Canlıya geçmeden önce üretilen XML'i entegratörünüzün doğrulamasından geçirin.

### Yedekleme

Sunucu her 24 saatte bir otomatik yedek alır ve son 14 kopyayı saklar.

**Yedeği bir kez geri yüklemeyi deneyin.** Denenmemiş yedek, yedek sayılmaz. Geri yükleme
komutları README'de anlatılmıştır ve sistem geri yüklemeden önce mevcut veritabanını güvenlik
kopyası olarak saklar.

---

## 11. Sık karşılaşılan durumlar

**Ürün stokta görünüyor ama üretimde "yetersiz" diyor.**
Muhtemelen stok karantinada veya bloke. Sadece *kullanılabilir* durumdaki partiler tüketilebilir.
Ürün kartındaki "Duruma göre stok" satırına bakın.

**Sipariş teslim alınamıyor.**
Sipariş onay bekliyordur. Sol menüdeki turuncu rozete bakın; onay müdürdedir.

**Sayımı onaylayamıyorum.**
Onay müdür yetkisidir. Sayımı kaydedip müdüre bildirin.

**Sevkiyatta istediğim parti çıkmıyor.**
Parti kullanılabilir durumda ve seçtiğiniz depoda değildir. Karantinadaki veya başka depodaki
partiler listelenmez.

**Kârlılık raporunda marj beklediğimden düşük.**
İthalatta varış maliyeti girilmiş olabilir — bu gerçek maliyeti yansıtır. Üretimde işçilik ve
genel gider girilmemişse tam tersine marj olduğundan yüksek görünür.

**Aynı ürün farklı siparişlerde farklı marj gösteriyor.**
Doğru davranış. Maliyet, o sevkiyatta gerçekten çıkan partinin maliyetidir; farklı partilerin
alış fiyatı farklıdır.

**MRP hiç öneri üretmedi.**
İhtiyaçlar eldeki ve yoldaki stokla karşılanıyor demektir. Bu iyi haberdir.

**Çizelgeleme "kapasite bulunamadı" diyor.**
İş merkezine vardiya atanmamış olabilir veya ufuk içindeki tüm günler dolu. İş merkezi ayarlarını
ve kapasite raporunu kontrol edin.

**Bildirim gelmiyor.**
Bildirim kuralı tanımlı mı bakın. E-posta bekliyorsanız SMTP ayarları yapılmamış olabilir;
yönetici Bildirimler panelinden test e-postası gönderebilir.

---

## 12. Hata mesajları ne anlama geliyor

| Mesaj | Anlamı | Ne yapmalı |
|---|---|---|
| Yetersiz stok | İstenen miktar kullanılabilir stoktan fazla | Karantina/bloke stoğa bakın, eksik miktarı mesajda görürsünüz |
| Bu ürün için reçete tanımlı değil | Mamulün BOM'u yok | Ürün kartından reçete ekleyin |
| Bu mamul için rota tanımlı değil | Çizelgeleme için rota gerekli | Planlama > Rotalar'dan tanımlayın |
| Müşteri kredi limiti aşılıyor | Açık bakiye + sipariş > limit | Tahsilat yapın veya limiti gözden geçirin |
| Sipariş onay bekliyor | Tutar onay eşiğini aştı | Müdür onayı gerekiyor |
| Gönderilmiş e-Fatura iptal edilemez | GİB kuralı | İade faturası düzenleyin |
| Bu sayım onaylanmış | Onaylanan sayım değiştirilemez | Yeni sayım açın |
| DÖF etkinlik kontrolü olmadan kapatılamaz | Kanıt isteniyor | Aksiyonun işe yaradığını yazın |
| Son yönetici hesabı pasifleştirilemez | Sistem kilitlenmesin diye | Önce başka bir yönetici tanımlayın |
| Çok fazla giriş denemesi | Kaba kuvvet koruması | 15 dakika bekleyin veya yöneticiye başvurun |
| Oturum sona erdi | Token süresi doldu veya yetkiniz değişti | Tekrar giriş yapın |

---

## Yardım

Bu kılavuzda cevabını bulamadığınız bir durumda önce **denetim kaydına** bakın: bir kaydın ne
zaman, kim tarafından, hangi değerden hangi değere değiştirildiğini orada görebilirsiniz.
Çoğu "bu neden böyle oldu" sorusunun cevabı oradadır.
