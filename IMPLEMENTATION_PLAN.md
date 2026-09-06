# AdaDöviz — Ürün Yol Haritası Uygulama Planı

Kaynak: `PRODUCT_GAPS_2026-09-06.md` · Dal: `audit-fixes-2026-09-06`
Tasarım kuralı: her ekleme mevcut sisteme uyar — `brand`/`ink`/`success`/`warning`/`danger` renkleri,
`rounded-card`/`rounded-control`, `shadow-card`/`shadow-card-dark`/`shadow-neon`, `duration-{press,instant,fast,base,slow}`,
`ease-out-strong`/`ease-in-out-strong`, `.btn`/`.btn-primary`/`.btn-ghost`/`.surface-card`/`.surface-neon`/`.float-field`,
`z-{sticky,dropdown,overlay,modal,toast}`. Framer yalnızca `animated-search-bar.jsx`'te (`m` + `LazyMotion`).
Yeni string → `LanguageContext.jsx` (TR+EN). Yeni tablo → `backend/migrations/000N_*.sql` (idempotent, checksum'lı).

Durum: ☐ yapılacak · ◐ kısmi · ☑ bitti

---

## FAZ 1 — sürtünmeyi kes (küçük, izole)

### ☑ P1.1 — WhatsApp iletişimi (C7)
`ExchangeOfficePage.jsx`, `BusinessDetailModal.jsx`: `branch.whatsapp` (varsa, yoksa `branch.phone`) için
`https://wa.me/<intl>` linki, telefon ikonunun yanına yeşil WhatsApp aksiyonu. `lib/contact.js`'e
`whatsappHref(raw)` helper (numara normalizasyonu: KKTC `+90`/`0` → `90...`).

### ☑ P1.2 — "Kuru paylaş" (C10)
`V0BankCard` / dashboard başlığına paylaş butonu: `navigator.share` (mobil) + fallback pano kopyala.
Metin: "AdaDöviz — <tarih> · USD alış X / satış Y · adadoviz.tunahangul.com". OG görseli sonraki fazda.

### ☑ P1.3 — Düz-dil trend cümlesi (C12)
`lib/rateNarrative.js` (`rateTrendSentence`/`rateBuyHint`, TR/EN, yerele göre yüzde). `MarketSummaryCard`
kompakt kart + genişletilmiş modal başlığında, `aria-live` bölgesinde. (Opsiyonel ileride: dashboard
3-döviz roll-up cümlesi — 3 lazy kartın verisini yukarı taşımayı gerektirir.)

### ☑ P1.4 — id-bazlı analitik (S7)
`migrations/0003` + SQLite `visitor_sessions.clicked_business_ids` (initDb ALTER). `updateVisitorSession`
`business_id`/`clicked_business_ids` kabul edip yazıyor; `getClicksByBusiness` id-birincil, isim yedek;
`syncVisitorSession` yeni kolonu da gönderiyor. Frontend `trackBusinessClick(name, id)` +
`V0FinancialDashboard` `biz.institutionId` geçiyor. (İleride: büro-detay/ExchangeOfficePage doğrudan
ziyaretlerini de olay olarak say — P2.5.)

### ☑ P1.5 — Bildirim omurgası + abonelik-bitiş bildirimi (B4, kısmen S10/S13)

**Yapıldı** (commit `3218f96`): `admin_notifications` (SQLite) + CRUD/dedup (`hasRecentBusinessNotification`);
`src/notifications.js` (`emitBusinessNotification` in-app+e-posta hata-yutan / `emitAdminNotification`);
`email.js` `sendGenericNotificationEmail` (minimal inline — P1.6 `renderEmailShell` ile değişecek);
`src/jobs/subscriptionReminders.js` (7/3/1/0-gün + 7-gün grace `subscription_expired`, günlük dedup,
koşu-başı operatör özeti sadece yeni bildirim varsa); `server.js` günlük setInterval + boot+30sn ilk koşu
+ `GET /api/admin/notifications`, `POST .../mark-read`, `POST .../run-reminders` (superadmin).
Frontend: `lib/auth.js` `fetchAdminNotifications`/`markAdminNotificationsRead`; `SuperAdminDashboard`
`AdminNotificationBell` (işletme çanının aynısı, mevcut `notifications*` i18n key'leri).
Not: bildirim metinleri backend'de düz TR string (mevcut şube-bildirimi deseniyle aynı) — ayrı i18n eklenmedi.
Supabase `admin_notifications` senkronu bilinçli atlandı (kritik-kalıcı değil).

**Karar:** `business_notifications` iyi çalışıyor (şema: `business_id`=institutions.id NUMERİK PK,
`type,title,message,related_request_id,is_read,created_at`; `createBusinessNotification({...})`;
`GET /api/business/notifications` → `{notifications, unread}`; frontend çanı `InstitutionAdminPage.jsx`
zaten tüketiyor). Yeniden yazma YOK. Yanına eş şemalı `admin_notifications` ekle.

**Backend:**
1. `db.js`:
   - `CREATE TABLE IF NOT EXISTS admin_notifications` — `business_notifications` ile aynı sütunlar,
     `business_id` yerine sadece PK+meta (recipient hep superadmin). initDb'de sırf `CREATE IF NOT EXISTS`.
   - `createAdminNotification({type,title,message,data_json?})`, `listAdminNotifications({limit,unreadOnly})`,
     `countUnreadAdminNotifications()`, `markAdminNotificationsRead(ids)` — `business_notifications`
     eşdeğerlerini kopyala. `module.exports`'a ekle.
   - `hasRecentBusinessNotification(businessId, type, withinHours)` — dedup için
     (`SELECT 1 ... WHERE business_id=? AND type=? AND created_at > datetime('now', ?)`).
2. `backend/src/notifications.js` (yeni): ince sarmalayıcı.
   - `emitBusinessNotification(businessNumericId, {type,title,message,email})` → `createBusinessNotification`
     + `email` verildiyse `sendGenericNotificationEmail` (P1.6'da gelen `renderEmailShell`; P1.5'te
     minimal inline şablon yeterli). Hata yutma: e-posta patlarsa in-app kaydı yine dursun.
   - `emitAdminNotification({type,title,message})` → `createAdminNotification`.
3. `backend/src/jobs/subscriptionReminders.js` (yeni):
   - `runSubscriptionReminders()` — `listExpiringSubscriptions(8)` (institution_id=slug döndürüyor;
     numerik id + email için `findAdminByUsername`/`listBusinesses()` ile eşle — `listBusinesses()`
     satırında `.id` + `.email` var).
   - Eşik: `days_remaining` ∈ {7,3,1,0} → `type = 'subscription_reminder'`,
     dedup `hasRecentBusinessNotification(id,'subscription_reminder',-20h)` (günde bir).
     `days_remaining < 0` (süresi geçmiş, hâlâ aktif) → ilk kez `type='subscription_expired'`.
   - Her tetiklemede `emitAdminNotification` ile operatöre özet ("3 abonelik 7 gün içinde bitiyor").
4. `server.js`:
   - Scheduler bloğuna (≈ satır 3538, `REFRESH_INTERVAL_MS` `setInterval`'in yanına):
     `setInterval(runSubscriptionReminders, 24*60*60*1000)` + boot'tan ~30 sn sonra bir kez çalıştır.
   - `GET /api/admin/notifications` + `POST /api/admin/notifications/mark-read` (requireSuperAdmin).
   - `POST /api/admin/notifications/run-reminders` (requireSuperAdmin, manuel tetik — test için).
5. `supabaseSync.js`: `admin_notifications` opsiyonel — Supabase'e senkronlamak istersen `0004` migration
   + `syncAdminNotification`. İlk sürümde atlanabilir (superadmin bildirimleri kritik-kalıcı değil);
   NOT olarak bırak.

**Frontend:**
- `SuperAdminDashboard.jsx`: `InstitutionAdminPage`'deki çan bileşeninin birebir kopyası —
  `GET /api/admin/notifications`, unread rozet, panel, "tümünü okundu işaretle". Aynı i18n key'leri
  (`notificationsTitle`, `notificationsMarkAllRead`, …) yeniden kullan; eksikse ekle.
- Yeni i18n: `subscriptionReminderTitle/Body` (TR+EN), abonelik-bitiş bildirim metinleri.

**Doğrulama:** `node --check`; initDb temiz; `runSubscriptionReminders()` elle çağrılıp
`business_notifications`/`admin_notifications` satırları + dedup kontrol; `npm run build`.

### ☐ P1.6 — İşlemsel e-postalar (S13)
`email.js`: `sendWelcomeEmail` (hesap onaylanınca), `sendSubscriptionReminderEmail`, `sendPaymentReceiptEmail`,
`sendBranchRequestResultEmail`, `sendSignupReceivedEmail` (başvuru alındı) + `sendSignupApproved/RejectedEmail`.
Ortak HTML şablonu (`renderEmailShell(title, bodyHtml, cta?)`) — mevcut inline stiller yerine tek yerden.
Marka: mat siyah başlık, `#55555f` buton (gradyan token'ıyla uyumlu).

### ☐ P1.7 — Panel-içi destek / bildirim (B11)
`/admin` + `/super-admin`: "Yardım / Sorun bildir" — `POST /api/support-tickets` (konu, mesaj, otomatik
hesap bağlamı) → `support_tickets` tablosu (`0003`) + `emitAdminNotification` + e-posta. Superadmin panelinde
liste + durum (açık/yanıtlandı/kapalı).

### ☐ P1.8 — Onboarding checklist (B13)
`/admin` üstünde ilerleme kartı: logo yüklendi mi · saatler girildi mi · en az 1 şube · marjlar ayarlandı mı ·
telefon/adres tam mı. `computeOnboardingState(profile, branches, adjustments)` — `surface-card`, tik/daire,
tamamlanınca gizlenir (`localStorage: adadoviz:onboarding-dismissed`).

### ☐ P1.9 — Operatör durum sayfası (S14)
`/super-admin` "Sistem" sekmesi: `system-health` + scraper son başarı/yaş · dual-write hata kuyruğu
(`getDualWriteErrors`) · Supabase drift (`compareInstitutionDrift`) · migration durumu · son hydrate ·
expiring sayısı · audit-zinciri OK. Tek `GET /api/admin/ops-overview` toplayıcı. Kırmızı/amber/yeşil rozetler
(`success`/`warning`/`danger`).

---

## FAZ 2 — çekirdek ürün

### ☐ P2.1 — "Bugünkü en iyi kur" + tutar (C1 + C5)
Yeni `/en-iyi-kur` veya ana sayfaya sekme: para birimi + işlem (alış/satış) + opsiyonel tutar → tüm bürolar
**anlık** kur sırasına dizili liste (tutar verilirse "alacağın TRY" ile). Backend: `/api/kurlar` zaten tüm
büroların anlık kurunu veriyor — sıralama + tutar çarpımı frontend'de. Kademeli kur ileride.
Tasarım: mevcut `V0BankCard` grid'i yeniden kullan, üstüne sıralama kontrolü (`SlidingTabs` / `BuySellToggle` dili).

### ☐ P2.2 — Genel harita (C2)
`/kiyasla` veya ana sayfada harita sekmesi: leaflet (zaten dep + admin'de kullanılıyor, `vendor-map` chunk),
lazy route. Şube pinleri (`/api/branches` lat/lng), popup: büro adı + anlık USD/EUR/GBP + "yol tarifi" + WhatsApp.
"Açık" filtresi (çalışma saatleri). Kullanıcı konumu (izinle) → "en yakın". `index.css`'te leaflet stilleri var.

### ☐ P2.3 — PWA (C4)
`vite-plugin-pwa` (CDN değil, dev dep) veya elle `manifest.webmanifest` + hafif service worker
(`public/sw.js`, network-first `/api/kurlar` cache). İkonlar `public/`'te SVG var → PNG maskable üret.
`index.html` manifest link + tema rengi (`#08080a`). "Ana ekrana ekle" ipucu (bir kez, `localStorage`).

### ☐ P2.4 — Hızlı marj girişi (B2)
`/admin` marj ekranı: "Dünküyle aynı" butonu · toplu (tüm para birimlerine aynı yüzde) · "yayınlanan kuru
göster" canlı önizleme (zaten var mı kontrol) · mobil-öncelikli düzen (büyük dokunma hedefleri, sayısal
klavye) · opsiyonel "şu saatte uygula" (zamanlanmış — `scheduled_adjustments` tablosu, job).

### ☐ P2.5 — İşletme analitik paneli (B3)
Olay tablosu (`analytics_events`: `institution_id`, `event` [view|call|directions|whatsapp|search_impression],
`session_id`, `created_at`). Frontend büro detay + kartlarda bu olayları `POST /api/analytics/event`.
`/admin` "Analiz" sekmesi: 7/30 gün zaman serisi (görüntüleme, tıklama türleri), şehir+para-birimi bazlı
sıralaman, "USD'de Girne'de #3", dönüşüm. Recharts (lazy, zaten var).

### ☐ P2.6 — Pazar yeri sağlığı UI (S2 + S3)
`/super-admin` "Pazar Sağlığı": N gündür kur güncellemeyen bürolar · kur sanity-band dışı kalanlar ·
bürosu olmayan şehirler · her büro için "son marj güncellemesi" · manuel kur düzeltme aksiyonu.
`GET /api/admin/market-health`.

---

## FAZ 3 — büyüme motorları

### ☐ P3.1 — Self-signup (superadmin ONAYLI) (B1)  ⚠️ kullanıcı özellikle istedi
- Public `/kayit` sayfası: kurum adı, yetkili, e-posta, telefon, şehir, (opsiyonel) mevcut kur bilgisi,
  KVKK onayı. `POST /api/signup` → `signup_requests` tablosu (`durum: beklemede`), rate-limit,
  `sendSignupReceivedEmail` + `emitAdminNotification`. **Hesap OLUŞTURULMAZ.**
- `/super-admin` "Başvurular" kuyruğu (partnerlik başvuruları ekranının yanına / birleşik): incele →
  **Onayla** (`createBusiness` + rastgele parola + `sendSignupApprovedEmail` parola-belirleme linkiyle
  [reset token akışını yeniden kullan] + `branch_limit`/plan seç) · **Reddet** (sebep + e-posta).
- Anti-abuse: aynı e-posta/telefon/kurum-adı için tekrar başvuru engeli, honeypot alan, basit soru.
- Audit: `signup_approved` / `signup_rejected` (strict).
- Tasarım: `/partnerlik` sayfasının form dilini birebir kullan (`FloatingInput`, `role="alert"`).

### ☐ P3.2 — Kur alarmı sistemi (C3)
- `rate_alerts` tablosu: `email`, `currency`, `side`, `direction` (above|below), `threshold`, `active`,
  `verified` (çift-opt-in), `last_fired_at`, `unsubscribe_token`.
- Public: ana sayfada / kur kartında "alarm kur" → e-posta + eşik. Doğrulama e-postası.
- Job: her `refreshRatesCacheWithChangeDetection` sonrası eşleşen alarmları kontrol et → `sendRateAlertEmail`
  (debounce: aynı alarm 12 saatte bir). Unsubscribe linki.
- Frontend: hafif modal (`Sheet` dili), "alarmlarım" yönetimi token'lı sayfa (`/alarm/:token`).
- Değer sinyali: superadmin panelinde "X aktif alarm (USD<Y en popüler eşik)".

### ☐ P3.3 — Gelir paneli (S1)
`/super-admin` "Gelir": MRR (aktif aboneliklerden), bu ay tahsil edilen, gecikmiş (bitmiş + ödemesiz),
plan dağılımı, churn (son 90 gün pasifleşen), basit LTV. Makbuz PDF (`sendPaymentReceiptEmail` + indirilebilir).
Dunning: bitişe 7/3/0/-3 gün otomatik hatırlatma (P1.5 job'ına bağla). İndirim kodu (`discount_codes`).
Muhasebe CSV export.

### ☐ P3.4 — Lead CRM + talep analitiği (S5 + S6)
`signup_requests` + `partnership_applications` birleşik "Lead" görünümü: durum (yeni/iletişimde/kazanıldı/kayıp),
not, hatırlatma tarihi, atanan. Dönüşüm hunisi: ziyaret → büro tıklama → lead → onay.
Talep analitiği: en çok aranan büro/şehir/para-birimi, **eşleşmeyen aramalar** (`search_misses` — `OfficeSearch`
sonuç bulamadığında logla), şehir bazlı talep ısı haritası.

### ☐ P3.5 — İçerik / landing sayfaları (C9)
- Statik ilk sürüm: `/rehber/kktc-doviz-bozdurma`, `/kur/usd-try`, `/sehir/girne` — `SeoHead` + JSON-LD
  (FAQPage, Article). İçerik markdown → build-time.
- SSS bileşeni (accordion, `ease-out-strong`).
- `sitemap.xml`'e ekle. `llms.txt` (AEO).
- Sonra: superadmin'den düzenlenebilir (CMS-lite) — `content_pages` tablosu.

### ☐ P3.6 — Self-servis ödeme / dekont (B5)
Panelden "Yenile / Yükselt" → plan seç → havale bilgileri + "dekont yükle" (`payment_proofs`) →
superadmin "onayla" → `createPayment` + abonelik uzat + `sendPaymentReceiptEmail`. (Online ödeme sağlayıcısı
KKTC'de sınırlı — havale-öncelikli.)

---

## FAZ 4 — sonra

☐ C8 ALTIN/gram altın (scraper + kart + çevirici) · ☐ C11 RU (belki AR) dil · ☐ B8 şube-bazlı kur ·
☐ B9 şube personel rolleri · ☐ B10 banka kur API (`POST /api/partner/rates` + API key) ·
☐ S9 ekip rolleri (analist/fatura/destek) + admin 2FA · ☐ S8 CMS-lite / duyuru bandı ·
☐ S11 CSV toplu içe aktarma · ☐ B12 işletme 2FA · ☐ S12 plan→özellik gating motoru
