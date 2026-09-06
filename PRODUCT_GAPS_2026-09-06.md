# AdaDöviz — Ürün / Özellik Boşluğu İncelemesi (3 persona)

2026-09-06 · Dal: `audit-fixes-2026-09-06` · Yöntem: graphify graph + kaynak kod + rota envanteri
Bu **kod kalitesi değil ürün** incelemesidir (kod denetimi: `AUDIT_2026-09-06.md`).
KKTC bağlamı: TRY yüksek enflasyon → USD/EUR/GBP birikim/kira/harç/emlakta kullanılıyor; turizm + yabancı
öğrenci yoğun; nakit + havale kültürü; çoğu döviz bürosu küçük, tek-şube, düşük dijital olgunluk; kur gün
içinde KKTC MB bülteni + TRY oynaklığıyla değişiyor.

Boyut etiketleri: **QW** = hızlı kazanç (≤1 gün), **M** = orta (birkaç gün), **BB** = büyük bahis (hafta+).

---

## 1) MÜŞTERİ (halktan ziyaretçi / turist / öğrenci / expat)

### Ne var
- Ana sayfa (`/`): USD/EUR/GBP için canlı alış/satış kartları (banka + büro), SSE ile canlı güncelleme,
  ilk-görüş roller animasyonu, "Son Güncelleme" damgası.
- **Çevirici** (`currency-converter-row`): büro seç + tutar gir → alacağın TRY (backend hesaplıyor).
- Karşılaştırma (`/kiyasla`): en fazla 4 işletmenin **14 günlük kur geçmişi** grafiği, tek para birimi,
  şehir filtresi.
- Piyasa özeti kartları (`MarketSummaryCard`): dönemsel yüzde değişim + grafik (lazy).
- Büro detay sayfası (`/doviz-burosu/:slug`): şubeler, çalışma saatleri, `tel:` linki, Google Maps yol
  tarifi linki, JSON-LD (LocalBusiness).
- Tarihsel kurlar API'si (`/api/historical-rates`) — dönem bazlı.
- İletişim sayfası (orbital tasarım), paketler sayfası, partnerlik başvuru formu.
- SEO: sitemap, robots, per-office JSON-LD, TR/EN i18n.

### Boşluklar

| # | Boşluk | Kim / neden (KKTC açısı) | Boyut |
|---|---|---|---|
| C1 | **"Şu an en iyi kuru kim veriyor" tek-ekran görünümü yok.** `/kiyasla` geçmiş grafiği; ana sayfa kartları büroya göre sıralanmıyor. "500 EUR'mu en çok TRY veren büro" tek tıkla cevaplanmıyor | Müşterinin ana işi bu; para bozduracak kişi "bugün nereye gideyim" istiyor | M |
| C2 | **Genel harita görünümü yok.** Leaflet yalnızca admin panelinde. Müşteri "bana yakın açık büro" göremiyor | Turist/öğrenci konum bilmiyor; "Girne'de yakınımdaki büro" en sık ihtiyaç | BB |
| C3 | **Kur alarmı / takip listesi yok.** "USD 41 TL altına inince haber ver", günlük özet, watchlist | Geri-dönüş kancası sıfır; birikimini bozacak kişi eşik bekliyor. E-posta/WhatsApp/Telegram/push | BB |
| C4 | **PWA yok** — manifest, service worker, "ana ekrana ekle", offline yok | KKTC'de mobil-ağırlık + değişken bağlantı; kur uygulaması ana ekran ikonu olmalı | M |
| C5 | **Tutar-duyarlı karşılaştırma yok.** Çevirici tek büro; "şu tutar için tüm büroları sırala" yok. Kademeli kur (yüksek tutarda daha iyi kur) kavramı yok | Büyük bozdurma (kira, harç, araba) farklı kur alır; müşteri bunu bilmiyor | M |
| C6 | **Güven sinyalleri zayıf.** Doğrulanmış rozet yok, "kur en son ne zaman güncellendi" büro bazında yok, kullanıcı yorumu/puanı yok, "arayıp teyit et" CTA'sı yok | Yabancı kullanıcı hiç tanımadığı büroya güvenmiyor; sahte/bayat kur riski | M |
| C7 | **WhatsApp iletişimi yok** (sadece `tel:` + Maps). KKTC'de işletme iletişimi ağırlıklı WhatsApp | Turist yerel numarayı aramıyor, WhatsApp yazıyor | QW |
| C8 | **ALTIN / gram altın yok.** (Ölü mock veride vardı.) KKTC'de altın ciddi birikim aracı | Emlak/düğün/birikim; USD kadar sorulur | M |
| C9 | **İçerik / AEO katmanı yok.** "KKTC'de para nasıl bozdurulur", şehir bazlı landing (`/girne-doviz`), para-birimi bazlı sayfa (`/usd-tl-kktc`), SSS, blog | Organik trafik + ChatGPT/Perplexity'de görünürlük; şu an sadece ana sayfa indeksleniyor | M–BB |
| C10 | **"Kuru paylaş" yok** — ekran görüntüsü kartı, WhatsApp/Twitter paylaşım linki, "bugünkü kur" OG görseli | Viral döngü; KKTC toplulukları WhatsApp gruplarında kur paylaşıyor | QW |
| C11 | **Bir de RU / (AR)** dil ihtiyacı olabilir — turist ve öğrenci profiline göre. Şu an TR/EN | Rus + Ortadoğu turist/öğrenci kitlesi | M |
| C12 | **"İyi zaman mı" içgörüsü yok** — grafik var ama "USD 30 günde %4 arttı, son 7 gün düşüşte" gibi düz-dil yorum yok | Sıradan kullanıcı grafiği okumuyor, cümle istiyor | QW |
| C13 | **Bildirim/abonelik e-postası ile geri getirme yok** — hiç e-posta toplama noktası yok (partnerlik formu hariç) | E-posta listesi = en ucuz retention kanalı | M |

### Müşteri — "bir şey eklesem" ilk 5
1. **Genel harita + "yakınımdaki açık büro"** (C2) — çekirdek görevi tamamlar.
2. **"Bugün en iyi kur" sıralı liste + tutar girişi** (C1+C5) — mevcut veriyle, yeni backend'e gerek yok.
3. **Kur alarmı (e-posta ilk sürüm)** (C3) — retention motoru; e-posta altyapısı zaten var.
4. **PWA** (C4) — düşük efor, KKTC mobil kitlesi için yüksek etki.
5. **Şehir + para-birimi landing sayfaları + SSS** (C9) — organik büyüme; pazar yerinin her iki tarafını besler.

---

## 2) İŞLETME (döviz bürosu / banka — `/admin` paneli)

### Ne var
- Giriş (`/api/auth/login`), e-posta ile parola sıfırlama, `/api/admin/me`.
- Profil: ad, logo (kırpma modalı), telefon, adres, çalışma saatleri, e-posta, iletişim kişisi.
- **Marj yönetimi** (`PUT /api/admin/rates`): 6 para birimi × alış/satış, sabit/yüzde, `finalSell ≥ finalBuy`
  doğrulaması, yayınlanan kur önizlemesi.
- Şubeler: CRUD (`branch_limit` kadar), şube-talebi akışı (reaktivasyon/ekleme → superadmin onayı).
- Bildirimler: **yalnızca şube-talebi onay/red** tetikliyor (`server.js:1501` — tek çağrı noktası).
- Abonelik ekranı (`/api/business/subscription`): plan, bitiş tarihi, kalan gün, **ödeme geçmişi**,
  **performans** (tıklama sayısı + sıralama + toplam işletme/ziyaretçi).
- Aktivite günlüğü paneli (`/api/business/audit-logs`).
- Parola değiştir.

### Boşluklar

| # | Boşluk | İşletme ihtiyacı (KKTC açısı) | Boyut |
|---|---|---|---|
| B1 | **Self-signup / "işletmemi talep et" yok.** Hesabı superadmin açıyor; partnerlik formu → e-posta. Yeni büro kendi kaydolamıyor, listeye kendi giremiyor | Pazar yeri arz tarafı elle büyüyor; her yeni büro = Tuna'ya manuel iş. "İlk listeleme süresi" saatlerce | BB |
| B2 | **Mobil marj girişi yok / hantal.** Büro sahibi tezgah arkasında, masaüstünde değil. Günde birkaç kez 12 alan güncellemek zor. "Dünküyle aynı", toplu düzenle, "rakibi eşleştir", zamanlanmış değişiklik yok | Marj = ürün; hızlı güncelleme rekabet avantajı. Hantalsa büro kuru bayatlatır → müşteri güveni düşer | M |
| B3 | **İşletme analitiği çok sığ.** Sadece toplam tıklama + sıralama. Yok: profil görüntüleme, ara-tıkla (tel/yol tarifi), arama gösterimi, "Girne'de USD'de 4. sıraya düştün", zaman serisi, dönüşüm, rakip kıyası | Büro "para veriyorum ne kazanıyorum" göremiyor → yenilemez. Bu doğrudan churn sebebi | M |
| B4 | **Anlamlı bildirim yok.** Abonelik bitişi yaklaşıyor, kur X gündür güncellenmedi, rakip seni geçti, MB bülteni değişti, haftalık performans özeti — hiçbiri yok | Büro sessiz kalıyor, sonra aniden delist oluyor; "neden trafiğim yok" bilmiyor | QW–M |
| B5 | **Self-servis ödeme / yenileme yok.** Ödeme yalnızca superadmin elle giriyor (havale). Büro planını görüyor ama panelden yenileyemiyor, yükseltemeyemiyor. Makbuz/fatura yok, otomatik hatırlatma yok, ödemesiz-süre (grace) belirsiz | Havale kültürü gerçek ama "havale yaptım / dekont" yükleme + otomatik hatırlatma yok → tahsilat elle takip, gecikme | M–BB |
| B6 | **Plan hiçbir şeyi otomatik kısıtlamıyor.** `branch_limit` superadmin elle set ediyor; plan → özellik eşlemesi yok. Ücretsiz vs aylık vs yıllık arasında panelde işlevsel fark yok | Fiyatlandırma kaldıracı yok; "yıllık al çünkü X kazanırsın" diyecek X yok | M |
| B7 | **Profil zenginliği eksik.** Fotoğraf yok, sunulan hizmetler (hangi dövizler, havale, altın, "X alıyoruz") yok, sosyal linkler yok, doğrulanmış rozet yok, yorumlara yanıt yok | Büro kendini farklılaştıramıyor; hepsi aynı görünüyor | M |
| B8 | **Şube bazlı kur yok.** Marj kurum düzeyinde. Farklı şube farklı kur veremiyor | Girne vs Lefkoşa şubesi farklı kur verebiliyor gerçekte | M |
| B9 | **Şube bazlı personel girişi / roller yok.** Kurum başına tek hesap | Şube müdürü kendi şubesini güncellesin isteniyor | M |
| B10 | **Banka için API ile kur besleme yok.** Banka her seferinde elle giriyor | Bankanın kendi kur API'si var; entegrasyon onları platformda tutar | BB |
| B11 | **Panelden destek / hata bildirimi yok.** "Kurum bilgim yanlış", "sahte rakip var", "yardım" — kanal yok | Küçük operatör e-posta/telefon bilmiyor, panelde buton bekliyor | QW |
| B12 | **2FA yok, oturum yönetimi yok.** Parola sıfırlama e-posta bazlı (iyi) ama tek faktör | Kur/marj değiştirilebilen hesap; ele geçirme = yayınlanan fiyat manipülasyonu | M |
| B13 | **Onboarding rehberi yok.** Hesap açılınca boş panel; "önce şunu yap" akışı yok | Düşük dijital olgunluk → kurulumu yarım bırakır, listeleme eksik kalır | QW |

### İşletme — "bir şey eklesem" ilk 5
1. **Self-signup + "işletmemi talep et"** (B1) — arz tarafını otomatikleştirir, Tuna'yı ölçekler.
2. **Gerçek işletme analitiği paneli** (B3) — churn'ün #1 panzehiri, "para veriyorum ne alıyorum".
3. **Abonelik bitiş + kur-bayat bildirimleri + otomatik hatırlatma e-postası** (B4+B5) — sessiz churn'ü durdurur.
4. **Hızlı marj girişi** (B2) — "dünküyle aynı" + toplu + mobil; günlük kullanım sürtünmesini keser.
5. **Havale dekont yükleme + "ödeme bekliyor" durumu** (B5) — KKTC gerçeğine uygun yarı-otomatik tahsilat.

---

## 3) SUPER ADMIN (operatör — Tuna)

### Ne var
- İşletme CRUD (`/api/admin/businesses`), durum (aktif/pasif), abonelik sıfırlama, `branch_limit`, silme.
- Şube-talebi kuyruğu (onay/red, okunmadı sayacı), şube CRUD.
- Ödemeler: listeleme, ekleme (elle), silme, **abonelikten geriye-dönük tahsilat üretme** (`backfill`).
- Planlar: listeleme + fiyat düzenleme (`PUT /api/admin/plans/:code`).
- Marjlar (`/api/margins` — artık superadmin-only), kur override (`PUT /api/admin/rates`).
- SEO ayarları (site adı, başlık, açıklama, canonical).
- Analitik: ziyaretçi sayısı, oturumlar + konumlar, **işletme bazlı tıklama** (isim eşleşmesiyle), expiring listesi.
- **Partnerlik başvuruları ekranı** (`/api/admin/partnership-applications` — form vardı, ekran yeni eklenmiş).
- Sistem sağlığı (`/api/admin/system-health`), audit-zinciri doğrulama (`/api/admin/audit-verify`),
  manuel rehydrate (`/api/admin/rehydrate`), legacy veri migrasyonu.
- Audit log (filtreli), aktivite paneli.

### Boşluklar

| # | Boşluk | Operatör ihtiyacı / iş gerekçesi | Boyut |
|---|---|---|---|
| S1 | **Gelir operasyon paneli yok.** MRR, churn, bu hafta bitecekler (var), gecikmiş, LTV, plan dağılımı yok bir arada. Ödeme→abonelik→plan bağlantısı zayıf. Fatura/makbuz üretimi yok, dunning otomasyonu yok, indirim kodu yok, muhasebe export yok | Bu bir gelir işi; operatör "bu ay ne kazandım, kim ödemedi" tek ekranda görmeli | M–BB |
| S2 | **Pazar yeri sağlığı görünmüyor.** "N gündür kur güncellemeyen bürolar", kapsama boşluğu (bürosu olmayan şehirler), bayat/yanlış kur tespiti, katılmayan büroyu placeholder listeleme | Veri kalitesi = ürün güveni; kötü kur sessizce yayında kalıyor | M |
| S3 | **Kur/veri ops izleme UI'si yok.** Scraper son başarı/başarısızlık alarmı, `getDualWriteErrors` kuyruğu, `compareInstitutionDrift` sonucu — hiçbiri panelde görünmüyor (kodda var). Manuel kur düzeltme UI'si yok | Sessiz dual-write hataları (bkz. AUDIT — migration hiç çalışmamış olabilir) tam da bu yüzden fark edilmez | M |
| S4 | **"İşletme olarak giriş yap" (impersonate) yok.** Destek için operatör bürodaki sorunu göremiyor | Düşük-olgunluk kullanıcıya destek vermek imkânsız; "ekranında ne var" bilinmiyor | M |
| S5 | **Talep/lead yönetimi yok.** Partnerlik başvuruları listeleniyor ama durum (yeni/arandı/kazanıldı/kayıp), not, hatırlatma, dönüşüm hunisi yok | Satış hunisi = büyüme; her lead elle takip | M |
| S6 | **Talep sinyali analitiği yok.** En çok aranan büro/şehir/para birimi, **eşleşmeyen aramalar** (talep var arz yok), ziyaret→tıklama→lead hunisi, şehir/para-birimi bazlı talep | "Nereye büro lazım" ve "hangi büroya satış yapayım" verisi yok | M |
| S7 | **Analitik isimle eşleşiyor** (`getClicksByBusiness` `institution_name` string). Kurum adı değişince tıklama geçmişi kopuyor; iki benzer isim karışıyor | Ölçüm bütünlüğü; `institution_id` ile eşleşmeli | QW |
| S8 | **İçerik / duyuru yönetimi yok.** Blog/CMS yok, SSS yönetimi yok, duyuru bandı yok, per-şehir/para-birimi meta yok, changelog yok | SEO/AEO ve kullanıcı iletişimi tamamen kod deploy'a bağlı | M |
| S9 | **Ekip / rol yok.** Tek superadmin sınıfı. Salt-okunur analist, sadece-fatura, sadece-destek rolü yok. Admin için 2FA yok | Büyüyünce yardımcı alınamıyor; audit "kim yaptı" var ama erişim hepsi-ya-hiç | M |
| S10 | **Operatöre bildirim yok.** Yeni lead, ödeme gecikti, scraper düştü, büro churn oldu, hata artışı — e-posta/push yok | Operatör paneli açmadan olan biteni bilmiyor | QW–M |
| S11 | **Toplu işlem yok.** İşletme/şube toplu içe aktarma (CSV), toplu abonelik uzatma, toplu bildirim gönderme | 50 büro elle girilmiş; ölçek elle | M |
| S12 | **Plan → özellik gating motoru yok** (B6 ile aynı kök). Operatör "yıllık planda şu açık" diyemiyor çünkü mekanizma yok | Fiyatlandırmayı üründen ayırıyor | M |
| S13 | **Onboarding e-postaları yok.** Sadece partnerlik + parola sıfırlama gidiyor. Hoş geldin, onay, bitiş hatırlatma, makbuz yok | İletişim = elle; profesyonel görünmüyor | QW |
| S14 | **Tek "her şey yolunda mı" durum sayfası** — system-health var ama scraper tazeliği, dual-write kuyruğu, migration durumu, son başarılı hydrate, expiring sayısı bir arada değil | Sabah 30 saniyede "sorun var mı" kontrolü | QW |

### Super admin — "bir şey eklesem" ilk 5
1. **Gelir paneli: MRR / churn / gecikmiş / makbuz + otomatik hatırlatma** (S1) — işi işletmeye çevirir.
2. **Pazar yeri sağlığı: bayat-kur & kapsama boşluğu tespiti** (S2+S3) — ürün güvenini korur, sessiz hataları yüzeye çıkarır.
3. **Lead/CRM hunisi (partnerlik başvurusu → kazanıldı)** (S5+S6) — arz tarafı büyümesi ölçülebilir olur.
4. **"İşletme olarak giriş" + operatör bildirimleri** (S4+S10) — destek ve farkındalık.
5. **CSV toplu içe aktarma + isim yerine `institution_id` analitiği** (S11+S7) — ölçek ve ölçüm hijyeni.

---

## Personalar arası ortak temalar (en yüksek kaldıraç)

1. **Kur alarmı + e-posta yakalama** — müşteri retention'ı (C3/C13), işletmeye "X kişi USD alarmı kurdu" sinyali,
   operatöre talep verisi. Tek özellik, üç persona.
2. **Self-signup + lead CRM** — arz tarafını otomatikleştirir (B1), operatörü ölçekler (S5), müşteriye daha
   fazla büro gösterir.
3. **Gerçek analitik (id-bazlı, zaman serisi, huni)** — işletmeye değer kanıtı (B3, churn↓), operatöre
   büyüme/talep verisi (S6), isimle-eşleşme hatasını çözer (S7).
4. **Bildirim omurgası** (e-posta + in-app + opsiyonel WhatsApp) — şu an tek tetikleyici var (şube onayı);
   B4/B5/S10/S13 hepsi bunun üstüne biner.
5. **Genel harita + "bugün en iyi kur"** — müşterinin çekirdek işi (C1/C2), aynı zamanda işletme trafiğini
   ve dolayısıyla abonelik değerini artırır.

---

## Önerilen sıra (ürün yol haritası taslağı)

**Faz 1 — sürtünmeyi kes (1-2 hafta, çoğu QW):**
C7 WhatsApp · C10 kuru paylaş · C12 düz-dil trend · S7 id-bazlı analitik · S14 durum sayfası ·
B4 abonelik-bitiş bildirimi · B11 panel-içi destek · B13 onboarding checklist · S13 işlem e-postaları

**Faz 2 — çekirdek ürün (2-4 hafta):**
C1+C5 "bugün en iyi kur" + tutar · C2 genel harita · C4 PWA · B2 hızlı marj girişi ·
B3 işletme analitik paneli · S2+S3 pazar yeri sağlığı UI'si

**Faz 3 — büyüme motorları (BB):**
C3 kur alarmı sistemi · B1 self-signup · S1 gelir paneli · S5+S6 lead CRM + talep analitiği ·
C9 içerik/landing sayfaları · B5 self-servis ödeme

**Sonra:** C8 altın · C11 ek dil · B8 şube-bazlı kur · B9 personel rolleri · B10 banka API · S9 ekip rolleri
