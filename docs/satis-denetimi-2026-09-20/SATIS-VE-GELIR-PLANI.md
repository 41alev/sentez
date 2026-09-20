# Dream Plus — sürdürülebilir satış ve gelir planı

20 Eylül 2026. Bu belge bir iş modeli önerisidir; müşteri talebi, fiyat kabulü veya kazanç garantisi değildir. Teknik satış engelleri [güncel denetim raporunda](OKU-ONCE.md) kayıtlıdır. Müşteri grubu ve gelir modeli için kullanıcıya yöneltilen sorular henüz yanıtlanmadığından mevcut ayrı kurulum/masaüstü kararından hareket edilmiştir.

## 1. Satılacak değer

Önerilen ilk konumlandırma:

> **Küçük üretim işletmeleri için hammadde, parti, kalite ve sevkiyat takibini tek yerde toplayan, işletmenin kendi sunucusunda çalışan operasyon yazılımı.**

Bu bir başlangıç hipotezidir. İlk müşteri görüşmelerinde doğrulanmalıdır. En uygun ilk müşteri; Excel/dağınık kayıtla çalışan, lot ve stok uyuşmazlığını yaşayan, mevcut muhasebe programını korumak isteyen ve işletme sahibine doğrudan ulaşabildiğin bir firmadır. İlk aday kümesi olarak tek tesisli metal işleme, plastik parça veya montaj işletmeleri araştırılabilir; bu sektörlerin talebi henüz kanıtlanmış değildir.

Satış vaadini ölçülebilir hale getir: “Bir sevkiyattaki parçanın hangi giriş partisinden geldiğini bulma süresi”, “sayım farklarını açıklamak için harcanan süre”, “manuel çift kayıt adedi”. Başlangıç değerini müşteriyle ölç; pilot sonundaki değişimi göster. Bugün tasarruf yüzdesi uydurma.

Genel ERP rekabetinde ürün sayısı fazla. Logo'nun resmi ürün sayfası sipariş/muhasebe ve daha kapsamlı üretim yönetimi çözümleri sunuyor. Bu nedenle benim önerim, ilk satışta dar ve doğrulanabilir operasyon faydasına odaklanmaktır; bu bir pazar payı iddiası değildir. Kaynak: [Logo ürün ve demo sayfası](https://demo.logo.com.tr/), erişim 20 Eylül 2026.

**Mevcut ürünün satış kapsamı:** depo/parti, sayım, kalite, temel reçete/üretim, satın alma ve sevkiyat; ilgili açıklar kapandıktan sonra. CRM, destek ve ileri planlama ikinci satış argümanı olabilir. Bordro, banka/kasa, tam muhasebe, resmî e-belge, çok kiracılı SaaS ve hukuken geçerli e-imza mevcut ürün yetkinliği gibi sunulmamalı. Muhasebe aktarımı bir çıktı özelliğidir; her muhasebe programıyla hazır entegrasyon demek değildir.

## 2. Gelir modeli önerisi

İlk öneri **müşteri başına ayrı kurulum + ücretli başlangıç hizmeti + yıllık tekrarlayan kullanım/bakım paketi**. Alternatif olarak süresiz kullanım lisansı + isteğe bağlı yıllık bakım sunulabilir; bu iki modelin yenileme ve kullanım hakları sözleşmede açıkça ayrılmalı. Kullanıcı kararı olmadan mevcut teknik lisans davranışı değiştirilmemelidir.

| Gelir kalemi | Müşterinin aldığı sonuç | Sınır |
|---|---|---|
| Kurulum ve başlangıç | Sistem kurulumu, başlangıç veri kontrolü, kullanıcı/rol ayarı, eğitim, kabul | Kaç veri kaynağı, eğitim oturumu ve çalışma günü olduğu teklifte yazılı |
| Yıllık paket | Tanımlı sürüm güncellemeleri, destek, bakım, kararlaştırılmış yedek/kurtarma kontrolleri | Sınırsız destek veya 7/24 müdahale vaadi yok; gerçek kapasiteye göre saatler |
| Ek hizmet | İlave veri aktarımı, yerinde ziyaret, özel rapor/entegrasyon | Ayrı kapsam, tahmin, ücret ve kabul |
| Genişleme | Ek tesis, kullanıcı veya modül | Gerçek lisans/kapsam yönetimi ve ilgili testler tamamlandığında |

Yıllık bakımın müşteriye somut faydası olmalı: sürüm kaydı, destek kayıtları, yeni sürüm kabulü, kararlaştırılmış geri yükleme tatbikatı ve kullanım değerlendirmesi. Yenileme yalnız “lisansın bitecek” mesajına dayanırsa müşteri tutmak zorlaşır.

Piyasada lisans ile devam eden bakım/güncelleme hizmetini ayıran örnek bulunuyor: AKINSOFT resmi lisans sayfasında yıllık bakım ve WOLVOX güncelleme paketi açıklanıyor. Bu, model için referanstır; Dream Plus'ın aynı fiyatı veya koşulları kullanması gerektiğini göstermez. Kaynak: [AKINSOFT lisans sistemi](https://www.akinsoft.com.tr/as/genel/lis-sist/), erişim 20 Eylül 2026.

Lisans teknik borcu: mevcut `LICENSE_FILE` boşken denetim yok; sadece açılış kontrolü var. Yıllık model için yenileme bildirimi, ödeme/süre politikası, geçiş süresi ve müşteri verisini okuma/dışa aktarma hakkı tasarlanmalı. Müşterinin üretimini beklenmedik biçimde kilitleyen davranış destek ilişkisini zedeler. Sözleşme taslağı ve veri işleme sorumlulukları, gerçek hizmet modeline göre uzman incelemesine verilmelidir; bu belge hukuki uygunluk onayı değildir.

## 3. Fiyatı nasıl belirleyeceğiz?

Şu aşamada kesin TL fiyat listesi yayınlamayı önermiyorum: müşteri sayısı, hedef sektör, destek yükü ve ödeme isteği bilinmiyor. Fiyat tabanını kendi maliyetinden; üst sınırını müşteriye sağlanan ölçülmüş fayda ve alternatif tekliflerden çıkar.

1. En az 10 nitelikli işletme görüşmesi yap. Şu anki süreç, yıllık kayıp/iş yükü, karar veren kişi, mevcut yazılım ve satın alma takvimini kaydet.
2. Aynı kapsama sahip 3–5 teklif denemesinde kurulum ile yıllık paketi ayrı göster. İndirim verilecekse nedenini ve normal yenileme fiyatını ilk tekliften açıkla.
3. Pilot ücretini, başarı ölçütünü ve genel kullanıma geçiş şartını yaz. Pilot verisini ve mevcut sistemi koruyan paralel çalışma planı olmadan canlı stok yönetimini devralma.
4. Gerçek kurulum ve destek saatlerini kaydet. Fiyat her yeni müşteride emeğin tamamını tüketiyorsa paket veya hedef müşteri yanlıştır.

Fiyat formülleri:

- Kurulum alt sınırı = veri hazırlama + kurulum + eğitim + kabul işçilik maliyeti + seyahat + risk payı.
- Yıllık müşteri doğrudan maliyeti = yıllık destek saati × tam saat maliyeti + müşteriye özgü barındırma/lisans/ulaşım/tedarik gideri.
- Yıllık katkı = yıllık paket bedeli − müşteriye özgü doğrudan maliyet.
- Başabaş müşteri sayısı = sabit yıllık gider / pozitif yıllık müşteri katkısı, yukarı yuvarlanır.

**Yalnızca hesap örneği — fiyat önerisi veya satış tahmini değildir:** Yıllık paket 48.000 TL, müşteri başına ayda 2 saat destek, destek saat maliyeti 500 TL ve ayda 300 TL diğer doğrudan maliyet varsayalım. Aylık müşteri katkısı 4.000 − 1.000 − 300 = 2.700 TL olur. Destek işçiliği dışında aylık sabit gider 60.000 TL ise başabaş yaklaşık **23 aktif ve ödeme yapan müşteri** gerektirir. Vergi/KDV, finansman, tahsilat kaybı ve ilk kurulum geliri bu örnekte hesaba katılmadı; gerçek bütçede eklenmelidir.

| Aktif, tam yıl yenileyen müşteri | Varsayımsal yıllık paket cirosu | Aylık eşdeğer brüt ciro | Varsayımsal aylık destek yükü |
|---:|---:|---:|---:|
| 10 | 480.000 TL | 40.000 TL | 20 saat |
| 25 | 1.200.000 TL | 100.000 TL | 50 saat |
| 50 | 2.400.000 TL | 200.000 TL | 100 saat |

Bu ciro tablosu kâr değildir. Müşteriler yıl içinde kazanılırsa ilk yıl tahsilatı/geliri farklı olur. Yenilememe, ödeme gecikmesi, ilk kurulum yükü ve beklenmedik destek toplamı belirler. 50 müşteride örnek destek yükü bile tek kişinin geliştirme ve satış zamanını ciddi daraltır; otomasyon ve destek kapasitesi müşteri artışından önce planlanmalı.

## 4. İlk müşteri edinme planı

Takvim bir çalışma önerisidir; teknik çıkış koşullarını öne çekmez. Müşteri görüşmeleri teknik düzeltmelerle eşzamanlı yapılabilir, canlı ürün teslimi kalite kapılarına bağlıdır.

| Dönem | Eylem | Ölçülebilir çıktı |
|---|---|---|
| İlk 2 hafta | Mevcut bağlantılardan 20 aday işletme listesi, 10 ihtiyaç görüşmesi; bir segment seç | En çok tekrar eden 3 sorun, karar veren kişi, mevcut yöntem, bütçe aralığı ve pilot isteği |
| 3–4. hafta | Tek uçtan uca demo akışı; 5 kişiselleştirilmiş demo; 3 kapsamı net teklif | Demo sonrası itirazlar, ödeme isteği ve kabul ölçütleri |
| Teknik kapılar kapanınca | 1–2 kontrollü pilot; gerçek roller ve paralel kayıt; eğitim | Haftalık kullanım, stok/mali mutabakat, destek saati ve kritik hata kaydı |
| Pilot kabulünden sonra | İzinli referans/vaka çalışması; aynı segmentte yeni adaylar | Tavsiye eden müşteri ve tekrarlanabilir kurulum süreci |

İlk kanallar: kendi iş çevren, yerel üretim işletmeleri, kurulum/donanım hizmeti veren küçük IT firmaları ve üretim süreç danışmanlarıyla görüşmeler. Bayilik sistemi, geniş reklam harcaması ve çok sayıda modül vaadi pilot değer kanıtından sonra değerlendirilmeli. İletişim mesajları bu çalışma sırasında kimseye gönderilmedi.

### 20 dakikalık müşteri görüşmesi

1. Stoğu ve üretimi bugün nasıl takip ediyorsunuz? Son ciddi hata neydi?
2. Hata kaç kişiyi, ne kadar süreyi ve hangi maliyeti etkiledi?
3. Lot/kalite/teslimat bilgisini bulmak için bugün hangi adımları izliyorsunuz?
4. Mevcut muhasebe yazılımınız hangisi; değiştirmek mi, yanında operasyon takibi mi istiyorsunuz?
5. Kaç tesis/depo/kullanıcı var; internet ve sunucu koşulları nasıl?
6. Satın alma kararını kim verir; başarılı pilot nasıl ölçülür?
7. Kurulum, eğitim ve yıllık destek için hangi bütçe aralığını değerlendirirsiniz?

### Demo sırası

Tek bir örnek müşteri senaryosu kullan: hammadde girişi → kalite kararı → üretim tüketimi → mamul partisi → sevkiyat → lot izi → stok/maliyet raporu. Ardından “müşterinin bugün yaşadığı sorun burada nasıl çözülüyor?” sorusuna kendi verisiyle cevap ver. Henüz açık hatalı akışları çalışır veya eksiksiz diye tanıtma.

### Teklifte bulunacak alanlar

Müşteri/tesis, kullanıcı kapsamı, modüller, kapsam dışı işler, başlangıç verisi sorumluluğu, donanım ve ağ koşulları, kurulum/eğitim günleri, lisans kullanım hakkı, yıllık hizmet içeriği, çalışma saatleri, ilk yanıt hedefi, yedek sorumluluğu, kabul senaryoları, bedel/vergiler/ödeme planı, yenileme ve ayrılma/veri dışa aktarımı. Boş bedel veya hak sahibi adına kendiliğinden değer yazılmamalı.

## 5. Uzun süreli müşteriyi elde tutma

- **Tek ürün sürümü:** müşteri başına ayrı kod çatalları yerine ortak kod + kontrollü ayar. Özel taleplerin çoğunu ürün ayarı veya standart raporla karşıla; özel geliştirmeyi ayrıca fiyatlandır.
- **Kurulum envanteri:** müşteri, sürüm, destek paketi, yenileme tarihi, yetkili kişi, son başarılı yedek ve son gerçek geri yükleme testi. Sırları bu tabloda tutma.
- **Öngörülebilir destek:** ticket kaydı, önem derecesi, ilk yanıt ve çözümün ayrımı. Tek kişiysen sağlayamayacağın 7/24 hizmeti satma.
- **Sürüm disiplini:** pilotta doğrulanan sürüm, sürüm notu, geriye uyum, yedek, kademeli müşteri geçişi. Her müşteriye kontrolsüz en son kodu kopyalama.
- **Yenileme takvimi önerisi:** 90 gün önce fayda/kullanım değerlendirmesi, 60 gün önce açık kapsam ve teklif, 30 gün önce teyit. Bunlar plan önerisidir; otomasyon kurulmadı.
- **Ayrılma kolaylığı:** müşterinin verisini belgelenmiş biçimde dışa aktarabilmesi güveni artırır. Veriyi rehin tutmaya dayanan gelir modeli kurma.

Her ay izle: nitelikli görüşme→demo→teklif→satış dönüşümü; ilk faydaya ulaşma süresi; müşteri başına destek saati; aktif kullanım; brüt katkı; tahsilat; yenileme oranı; kaybedilen müşteri ve nedeni. İlk birkaç müşteride istatistiksel yüzde yerine ham sayılar ve nedenler daha değerlidir.

## 6. Şimdi karar verilmesi gerekenler

İlk iki ticari karar: ulaşılabilir müşteri segmenti ve süresiz lisans/yıllık kullanım modeli. Sonraki adımda saha/uzaktan kurulum, destek verebileceğin saatler ve geliştirmeye ayıracağın bütçe/zaman netleştirilmeli. Bu cevaplar olmadan kesin gelir, fiyat ve bitiş tarihi sözü verilmemeli.

**Yakın hedef:** satışa hazır olmayan geniş ürün için genel reklam vermek yerine, teknik kritiklerini kapatırken ilk 10 müşteri görüşmesini yapıp bir pilotun ölçülebilir kabul kapsamını çıkarmak. Genel satışa geçişi, denetim raporundaki kalite kapıları belirler.
