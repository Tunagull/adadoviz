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

### ☑ P1.6 — İşlemsel e-postalar (S13)
`email.js`: ortak `renderEmailShell(title, bodyHtml, cta?)` (mat siyah `#08080a` başlık, `#55555f` buton,
tablo-tabanlı, tr-TR tarih/tutar biçimi) + tek çıkış noktası `sendBrandedMail` ("AdaDöviz — " öneki, CRLF
temizliği). Mevcut `sendPasswordResetEmail` + `sendGenericNotificationEmail` bu şablona taşındı
(`sendPartnershipEmail` dahili operatör kutusu — dokunulmadı). Yeni: `sendWelcomeEmail`,
`sendSubscriptionReminderEmail`, `sendSubscriptionExpiredEmail`, `sendPaymentReceiptEmail`,
`sendBranchRequestResultEmail`, `sendSignupReceivedEmail`/`sendSignupApprovedEmail`/`sendSignupRejectedEmail`
(signup üçlüsü export edildi, P3.1'de bağlanacak).
Bağlantılar: `server.js` `POST /api/admin/businesses` → welcome; `PUT /api/admin/branch-requests/:id` →
sonuç e-postası; `POST /api/admin/payments` (`durum==='odendi'`) → makbuz — hepsi `isMailConfigured()` korumalı,
fire-and-forget (`.catch` yutar). `notifications.js` `emitBusinessNotification`'a opsiyonel `emailFn` eklendi;
`jobs/subscriptionReminders.js` artık genel e-posta yerine dedike `sendSubscription{Reminder,Expired}Email`
kullanıyor. E-postalar backend'de düz TR (P1.5 deseni — ayrı i18n yok).
**Doğrulama:** `node --check` 4 dosya temiz; mock-transport ile 6 sender + `runSubscriptionReminders()`
initDb'li koşu yeşil.

### ☑ P1.7 — Panel-içi destek / bildirim (B11)
`db.js`: `support_tickets` (SQLite, initDb `CREATE IF NOT EXISTS` — P1.5 `admin_notifications` deseni,
Supabase sync yok) + `createSupportTicket`/`listSupportTickets`/`getSupportTicketById`/
`countOpenSupportTickets`/`updateSupportTicket` (statü: `open`→`answered`→`closed`; yanıt yazılınca
`open` ise otomatik `answered`).
`server.js`: `POST /api/support-tickets` (requireAuth + `supportLimiter` 10/sa; hesap bağlamı otomatik) →
`createAdminNotification({type:'support_ticket'})` + `sendSupportTicketEmail` operatör kutusuna + audit;
`GET /api/support-tickets` (kendi talepleri); `GET /api/admin/support-tickets` (`?status`, `open` sayısı);
`PATCH /api/admin/support-tickets/:id` (statü/yanıt → yanıt eklendiyse işletmeye `support_reply` bildirimi +
`sendSupportReplyEmail`).
`email.js`: `sendSupportTicketEmail` (dahili, markasız), `sendSupportReplyEmail` (markalı shell).
Frontend: `auth.js` `submitSupportTicket`/`fetchSupportTickets`/`fetchAdminSupportTickets`/
`updateAdminSupportTicket`; `InstitutionAdminPage` "Yardım / Sorun bildir" butonu + `Sheet` modal
(konu + mesaj + kendi talep listesi statü/yanıtla); `SuperAdminDashboard` yeni "Destek" sekmesi
(liste + statü `<select>` + yanıt `FloatingTextarea`, açık-sayı rozeti). i18n `support*` (TR+EN).
**Doğrulama:** `node --check` 5 dosya temiz; `createSupportTicket`/`updateSupportTicket` + iki e-posta
mock-transport ile yeşil; `npm run build` yeşil (lint: mevcut desenle tek yeni `set-state-in-effect`,
`loadSystemHealth` efektiyle aynı).

### ☑ P1.8 — Onboarding checklist (B13)
`InstitutionAdminPage.jsx`: modül seviyesi `computeOnboardingState({logoUrl, hasWorkingHours, branches,
marginConfig})` → 5 madde (logo · çalışma saatleri · ≥1 şube · şubede telefon+adres · EUR/USD/GBP'den
birinde marj > 0), `{items, doneCount, total, complete}`. Panel üstünde `surface-card` kart:
`CheckCircle2`/`Circle` + tamamlananlar üstü çizili, `doneCount/total`, `X` ile gizle
(`localStorage: adadoviz:onboarding-dismissed`). `complete` veya dismissed ise render edilmez.
`hasWorkingHours` profile-load efektinde set ediliyor; diğer veri zaten mount'ta yüklü
(`profileLogoUrl`, `subscriptionBranches`, `marginConfig`). i18n `onboarding*` (TR+EN).
**Doğrulama:** `npm run build` yeşil; lint yeni hata yok (45→45); `computeOnboardingState` node ile
0/5·5/5·kısmi senaryoları doğrulandı.

### ☑ P1.9 — Operatör durum sayfası (S14)
`supabaseSync.js`: `getMigrationStatus()` — yerel `migrations/*.sql` ↔ Supabase `schema_migrations`
karşılaştırması, erişilemezse `status:'unknown'` (hata yutulur). `server.js`: `GET /api/admin/ops-overview`
(requireSuperAdmin) — 8 sinyal için trafik ışığı (`ok`/`warn`/`down`/`unknown`) + genel özet:
scraper (`ratesHealth`, 6 sa eşiği), dual-write kuyruğu, Supabase drift, Supabase erişimi + son hydrate
(`bootState`), audit zinciri (`verifyAuditChain`), migration, yaklaşan bitişler (`listExpiringSubscriptions(7)`,
bilgi amaçlı). Mevcut sinyaller yeniden kullanıldı — `system-health` değişmedi.
Frontend: `auth.js` `fetchAdminOpsOverview`; `SuperAdminDashboard` "Sistem Sağlığı" sekmesinin üstüne
durum şeridi — genel banner (yeşil/amber/kırmızı) + 8 kontrol kartı (renkli nokta + detay).
`loadSystemHealth` içinde paralel yüklenir. i18n `ops*` (TR+EN).
**Doğrulama:** `node --check` server.js + supabaseSync.js temiz; `getMigrationStatus()` node ile çalıştı
(`schema_migrations` yok → `unknown`, `total:3` doğru — S14'ün yakalaması gereken sinyal); `npm run build`
yeşil; lint yeni hata yok.

---

**FAZ 1 TAMAM** (P1.1–P1.9). Sıra: Faz 2 — çekirdek ürün.

---

## FAZ 2 — çekirdek ürün

### ☑ P2.1 — "Bugünkü en iyi kur" + tutar (C1 + C5)
Yeni lazy rota `/en-iyi-kur` → `frontend/src/pages/BestRatePage.jsx`: para birimi (USD/EUR/GBP pill) +
işlem (`BuySellToggle`) + opsiyonel tutar → tüm bürolar anlık kur sırasına dizili liste (alış → en yüksek,
satış → en düşük). Tutar verilirse her satırda "elinize geçecek" TL/döviz; #1 satır GERÇEK spread varsa
"En iyi" rozeti (`Award`). Satıra tıklama → `exchangeOfficePath` + `trackBusinessClick`. Veri
`fetchRatesWithRetry` ile (`/api/kurlar`, backend değişmedi), sekme görünürken 60 sn tazeleme, SSE yok.
URL state `?birim/?islem/?tutar` (paylaşılabilir). `SiteNav` 5. sekme (`Trophy`) +
`useHomeSectionNav.isBestRateActive`. i18n `bestRate*` + `navBestRate` (TR+EN). `SiteDownbar` (mobil)
dokunulmadı — sekme md+ / URL. Commit `9dffd34`.
**Doğrulama:** `npm run build` yeşil (BestRatePage 8.1 kB lazy chunk); lint yeni hata yok.

### ☑ P2.2 — Genel harita (C2)
Yeni lazy rota `/harita` → `frontend/src/pages/MapPage.jsx`: leaflet `MapContainer` (KKTC merkezli),
şube pinleri `/api/branches`'ten (lat/lng), kurumun anlık kuru `/api/kurlar`'dan `institutionId` ile
eşlenip birleştirilir (backend değişmedi). Popup: logo + kurum/şube adı + açık/kapalı rozeti (çalışma
saati bilinirse) + USD/EUR/GBP alış/satış tablosu + adres + "Yol tarifi" (Google Maps `dir` linki) +
WhatsApp/telefon + "Detay" (`exchangeOfficePath` + `trackBusinessClick`). Filtreler: şehir `FloatingSelect`
(`?sehir`), "Şu an açık" toggle (`?acik=1`, `openState()` — `V0FinancialDashboard.isOpenNow` bağımsız
kopyası; bilinmeyen saat gizlenmez). "Bana en yakın" → `navigator.geolocation` → haritayı `flyTo` +
kullanıcı noktası + yan liste `haversineKm` ile mesafeye göre sıralanır. Yan liste (`lg:` iki kolon):
kurum adı + şehir/mesafe + USD özet, tıklama haritayı o pine odaklar. Kurları sekme görünürken 60 sn
tazeler (SSE yok, BestRatePage döngüsü). `SiteNav` 6. sekme (`MapPinned`, `to="/harita"`) +
`useHomeSectionNav.isMapActive`. `SiteDownbar` (mobil) dokunulmadı — sekme md+ / URL (P2.1 deseni).
i18n `map*` + `navMap` (TR+EN). `vendor-map` chunk zaten vardı (admin kullanıyor).
**Doğrulama:** `npm run build` yeşil (MapPage 11.5 kB lazy chunk); lint yeni hata yok (45→45);
dev sunucuda `/harita` render + pin popup (kur tablosu, yol tarifi, detay) tarayıcıda doğrulandı,
konsol hatasız.

### ☑ P2.3 — PWA (C4)
Elle (plugin yok): `public/manifest.webmanifest` (standalone, `theme/background #08080a`, `any`+`maskable`
ikon, `/en-iyi-kur` + `/harita` shortcut'ları), `public/adadoviz-maskable.svg` (köşe yuvarlamasız,
merkezde güvenli alan — PNG rasterize aracı yok, modern Chrome/Android SVG manifest ikonunu kabul ediyor),
`public/sw.js` hafif SW: shell precache + `install`/`activate` sürüm temizliği, `/api/kurlar` network-first
(10 sn timeout → çevrimdışında bayat kopya), diğer `/api/*` dokunulmuyor, `/assets/*` cache-first, SPA
gezinme network-first → offline'da `index.html`. `main.jsx` yalnızca `import.meta.env.PROD` iken
`/sw.js` register (dev'de HMR çakışması yok). `index.html`: manifest link + `theme-color` + apple-mobile
meta'ları. `components/PwaInstallPrompt.jsx`: `beforeinstallprompt` yakalar, `CookieConsent` dilinde şerit,
"Ekle" → yerleşik diyalog, "Şimdi değil"/`appinstalled` → `localStorage: adadoviz:pwa-dismissed` (bir kez),
standalone açıldıysa render yok. `App.jsx` public rotalarda render. `vercel.json`: `/sw.js` `no-cache` +
`Service-Worker-Allowed`, manifest `Content-Type`. i18n `pwaInstall*` (TR+EN).
**Doğrulama:** `npm run build` yeşil (dist'te `sw.js`+`manifest.webmanifest`+maskable ikon, index'te
manifest link); `node --check public/sw.js` temiz; lint 45→45.

### ◐ P2.4 — Hızlı marj girişi (B2)
`InstitutionAdminPage.jsx` marj sekmesi, form üstünde `!ratesLocked` iken "Hızlı marj girişi" kartı:
taraf segmenti (Alış/Satış/Hepsi) + tip toggle (TL/%) + tek `FloatingInput` (`inputMode="decimal"`) +
"Uygula" → `applyBulkMargin` seçilen tarafın 3 para biriminin `marginConfig`'ini tek tip+değere set eder
(alttan ince ayar hâlâ mümkün). Dokunma hedefleri `min-h-[2.75rem]`, mobilde dikey yığılır.
"Son kayıtlıya dön" (`revertMargins`) — kaydedilmemiş düzenlemeleri son persist edilen `savedMarginConfig`
anlık görüntüsüne geri alır (`marginDirty` memo ile pasif/aktif). `savedMarginConfig` yükleme +
başarılı `saveAdminRates` sonrası `cloneMarginConfig` ile tazelenir. İki granüler marj input'una da
`inputMode="decimal"`. "Yayınlanan kur canlı önizleme" zaten vardı (her kart "Final Kur & Kâr").
Backend değişmedi — mevcut `saveAdminRates` payload'ı aynı. i18n `quickMargin*` (TR+EN).
**Doğrulama:** `npm run build` yeşil; lint 45→45.
**Ertelendi:** "şu saatte uygula" zamanlanmış değişiklik (`scheduled_adjustments` tablosu + job) —
plan zaten "opsiyonel" diyor; backend tablo+job gerektirir, ayrı bir iş olarak bırakıldı.
"Dünküyle aynı" → pratikte "son kayıtlıya dön" olarak yorumlandı (marjlar sunucuda kalıcı; günlük
sıfırlanmıyor, dolayısıyla ayrı gün-bazlı geçmiş saklamaya gerek yok).

### ◐ P2.5 — İşletme analitik paneli (B3)
`migrations/0004_analytics_events.sql` (Supabase) + `db.js` initDb eş tablo (Supabase sync yok —
`admin_notifications` gerekçesi). `db.js`: `recordAnalyticsEvent({institution_id,event,session_id,
currency,city})` (event whitelist: view|call|whatsapp|directions|search_impression; bilinmeyen/geçersiz
id sessiz yok sayılır) + `getBusinessAnalytics(id,{days})` → gün ızgaralı `series` (boş günler 0) +
`totals` + `byCurrency`/`byCity` (top 8). `server.js`: `POST /api/analytics/event` (analyticsLimiter,
genel; `institution_id` numerik ya da slug → slug ise `getInstitutionFullBySlug` ile çözülür; analitik
asla akışı bozmaz, her zaman 200) + `GET /api/business/analytics?days=7|30` (requireAuth,
`req.user.institution_id` slug → `full.id`). Frontend: `lib/analytics.js` `trackEvent(event,{institutionId,
currency,city})` (çerez onayı yoksa sessiz; `keepalive` fetch); `lib/auth.js` `fetchBusinessAnalytics`.
Olay yayını: `ExchangeOfficePage` (kurum başına bir kez `view` + tel/yol-tarifi/WhatsApp linklerinde
`call`/`directions`/`whatsapp`), `MapPage` popup (`directions`/`whatsapp`/`call` + `goToOffice`'te `view`),
`BusinessDetailModal` (şube tel/WhatsApp → `call`/`whatsapp`). `components/BusinessAnalyticsPanel.jsx`:
7/30 gün toggle + 4 toplam kartı + Recharts `ComposedChart` (view alanı + call/whatsapp/directions çizgi,
`chartSkin`) + para-birimi/şehir sıralaması; `InstitutionAdminPage` marj formu ile işlem geçmişi arasında
render. i18n `bizAnalytics*` (TR+EN).
**Doğrulama:** `node --check` db.js + server.js; node ile `recordAnalyticsEvent`/`getBusinessAnalytics`
(totals + gün ızgarası + kırılım) doğrulandı, test satırları temizlendi; `npm run build` yeşil
(InstitutionAdminPage 72→80 kB, vendor-charts ayrı lazy chunk); lint 45→45.
**Ertelendi:** `search_impression` olayı (arama sonucunda büro görünmesi) — V0 dashboard/OfficeSearch'e
gürültülü olay yayını gerektirir; whitelist'te var, yayıncı bağlanmadı. "Dönüşüm hunisi" (ziyaret→lead)
P3.4'e ait.

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
