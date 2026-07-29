# AdaDöviz / KKTC Fintech Dashboard — Mühendislik Denetim Raporu

| Alan | Değer |
|------|--------|
| **Proje** | `kktc-fintech-dashboard` (AdaDöviz) |
| **Kapsam** | Frontend (Vite/React) + Backend (Express) + SQLite + Supabase |
| **Mod** | Salt okunur analiz — uygulama koduna dokunulmamıştır |
| **Tarih** | 29 Temmuz 2026 |
| **Mimari özet** | Express API + ephemeral SQLite (sıcak yol) + Supabase dual-write (kalıcı katman) + bellek içi MB kur önbelleği + SSE |

Bu rapor, mevcut kod tabanının derinlemesine incelemesine dayanır. Öncelik sıralaması: **Kritik → Yüksek → Orta → İyileştirme**.

---

## 1. Mantık Hataları ve Mimari Kusurlar (Logic Flaws)

### 1.1 Çift yazım (dual-write) ve tek kaynak belirsizliği

Sistem operasyonel olarak SQLite’a yazar (`backend/src/db.js`), ardından fire-and-forget ile Supabase’e senkronlar (`backend/src/config/supabaseSync.js`: `syncInstitutionUpsert`, `syncRateAdjustmentsMap`, vb.).

**Boot sırası** (`startServer` in `backend/src/server.js`):

1. `initDb()` — katalog seed + superadmin seed  
2. `hydrateAdminDataFromSupabase` — Supabase → SQLite  
3. `bootstrapAdminDataToSupabase` — SQLite → Supabase (arka plan)

**Kusur:** Seed, hydrate’den *önce* çalışır. Hydrate kısmen başarısız olursa bootstrap, seed’lenmiş SQLite’ı (varsayılan şifre `123`, varsayılan marjlar) kalıcı Supabase’e geri yazabilir ve iyi veriyi ezer.

**Çözüm odaklı öneri:** Boot’ta “Supabase’te kurum var mı?” kontrolü; varsa seed’i atla, bootstrap’i yalnızca boş hedefte çalıştır. Tek yazım kaynağını (ideal: yalnızca Supabase veya service_role ile backend) netleştir.

### 1.2 Kâr marjı hesaplama tutarlılığı ve geçmiş boşluğu

**Formül** (sabit / yüzde) frontend (`applyMarginToRawRate`), SQLite ve Supabase tarafında aynı:

- `fixed`: `KUR + margin`
- `percent`: `KUR + (KUR * margin / 100)`

**Canlı kartlar** (`GET /api/kurlar`): bellek MB kuru + `getAllAdjustmentsMap()`.  
**İşletme grafikleri** (`GET /api/business-rate-history` → `getBusinessRateHistory`): MB serisi + marj geçmişi birleşimi.

**Kritik boşluk:** SQLite `upsertAdjustments` yerel `margin_history`’ye yaklaşık 10 yıl öncesine sentetik baseline yazar; Supabase `insertMarginHistory` yalnızca *yeni* değeri yazar. Redeploy sonrası soğuk grafikler, baseline olmadan “güncel marjı tüm tarihe uygula” davranışına düşebilir.

**Şema adı çatışması:** SQLite’ta `type` = buy/sell, `margin_type` = fixed/percent; Supabase’te `margin_type` = buy/sell, `margin_type_value` = fixed/percent. Doğrudan SQL veya yanlış mapping ürünü bozar.

**Çözüm:** Marj değişiminde Supabase’e de inception/baseline satırı yaz; tek şema sözlüğü kullan; `finalSell >= finalBuy` iş kuralı ekle (şu an ters kotasyon mümkün).

### 1.3 Periyot penceresi tutarsızlığı

| Periyot | SQLite `periodToHoursBack` | Supabase `VIEW_SPAN_HOURS` (piyasa %) | Supabase `PERIOD_HOURS` (işletme) |
|---------|----------------------------|--------------------------------------|-----------------------------------|
| Günlük | 7 gün | **24 saat** | 7 gün |
| Haftalık | 30 gün | **7 gün** | 30 gün |
| Aylık | 365 gün | **30 gün** | 365 gün |
| Yıllık | 5 yıl | **365 gün** | 5 yıl |

Piyasa özeti tam arşiv çekip kovalar; yüzde meta’sı `VIEW_SPAN_HOURS` ile hesaplanır. UI “Günlük” derken yüzde son 24 saati, noktalar yılları kapsayabilir — kullanıcı/ürün yorumu hatası.

**Çözüm:** Tek `PERIOD_SPEC` sözlüğü (fetch derinliği, görüntü penceresi, agregasyon, yüzde aralığı).

### 1.4 Merkez bankası kaynağı ürünle uyumsuz

- Ana boru: `ratesService.getRates()` → **TCMB** `today.xml`
- Ayrı uç: `GET /api/kktc-kurlar` → KKTC MB XML
- Ürün KKTC odaklı; kartlar/SSE/history **TCMB** üzerine kurulu

Admin önizleme KKTC (`fetchKktcRates`) kullanabilir; kamu kartları `/api/kurlar` `rawCentralBankRates` ile TCMB yolu — **admin ≠ dashboard** riski.

**Çözüm:** Tek FX kaynağı seç (ürün kararı); diğerini açıkça “karşılaştırma” olarak etiketle.

### 1.5 Frontend: döviz çevirici etiket / hesap uyumsuzluğu

`V0FinancialDashboard.jsx` içinde:

- Müşteri **Alış** (TL ver → döviz al): `tutar / sell` — doğru  
- Müşteri **Satış**: `tutar * buy` — doğru  
- Dropdown etiketi ise Alış’ta `buy`, Satış’ta `sell` gösterir → **ekranda görünen kur ≠ kullanılan kur**

**Çözüm:** Alış operasyonunda satırda **satış** kurunu, Satış’ta **alış** kurunu göster; state adını `exchangeAmountTl` yerine operasyona göre netleştir.

### 1.6 SSE ile kart kurları kopuk

Dashboard’da tek `EventSource` var (iyi); `liveRates` state’e yazılıyor. `V0BankCard` flash efekti `bank.exchangeRates` ile karşılaştırıyor ama SSE bu diziyi güncellemiyor. Kartlar fiilen 5 dakikalık poll’a bağlı; SSE maliyeti faydasız.

**Çözüm:** SSE mesajında `rawCentralBankRates` + `marginAdjustments` ile `banks` yeniden hesapla veya flash’i gerçekten güncellenen değere bağla.

### 1.7 Çalışma saatleri modeli parçalı

Admin: güne göre obje (`businessHours`). Dashboard `isOpenNow`: tek string `"HH:MM - HH:MM"`, haftanın günü yok, gece yarısını aşan aralıklar kırılır. API obje dönerse “Kapalı” sayılır.

### 1.8 Silme sonrası yetim veri

`deleteBusiness` SQLite’ta `branches` + `institutions` siler; `rate_adjustments` / `margin_history` kalabilir. Supabase silme yolu ilişkili tabloları temizler — depolar ayrışır.

### 1.9 Negatif marj yasaklı

`Math.max(0, marginValue)` ile MB altına kotasyon yapılamaz; bazı bürolar için bilinçli “daha iyi fiyat” senaryosu engellenir (ürün kararı mı, bug mı netleştirilmeli).

---

## 2. Buglar ve Edge Case’ler (Olası Hatalar)

### 2.1 Kritik: Superadmin şifresi her boot’ta sıfırlanıyor

`seedSuperAdminIfNeeded` (`db.js`): `tuna` kullanıcısı varsa bile `password_hash` → `bcrypt("123")` ile UPDATE edilir. Her Render restart = süper admin şifresi `123`.

### 2.2 Ephemeral disk / soğuk başlangıç

- SQLite `backend/data/*.db` Render’da kaybolur  
- Hydrate bitene kadar boş/seed kurumlar, boş marjlar  
- `GET /api/kurlar` ilk MB çekimine kadar **503**  
- Password reset token’ları SQLite’ta; Supabase’ten rehydrate edilmez → redeploy sonrası reset linkleri ölür  

### 2.3 Pasif işletme JWT alabiliyor

`POST /api/auth/login` `is_active=false` olsa da token üretir. `PUT /api/admin/rates` ve profil uçları `requireAuth` ile açık kalır (frontend engeli yeterli değil).

### 2.4 Mock kur koruması sınırlı

`refreshRatesCacheWithChangeDetection` mock kaynağı history/SSE’ye yazmaz (iyi). İlk boot tamamen fail olursa cache boş → 503. Catch yolu eski `centralBankRates`’i korur (iyi).

### 2.5 SSE edge case’leri

- Kur yokken yalnızca heartbeat  
- `onerror` sonrası frontend **3 sn sabit reconnect**, backoff yok → reconnect storm  
- `JSON.stringify` ile değişim tespiti — anahtar sırası / ALTIN varlığı gürültülü broadcast üretebilir  
- Ölü client’lar bir sonraki yazmaya kadar listede kalabilir  

### 2.6 Frontend edge case’leri

| Alan | Risk |
|------|------|
| Arama | `toLowerCase` vs `normalizeText` — Türkçe İ/I uyumsuzluğu |
| Dedup | Aynı görünen isim farklı `institutionId` → tek kart |
| `logo_url` | Dashboard map’te set edilmiyor → favicon fallback |
| Logout | `localStorage.clear()` cookie consent / analytics session’ı da siler |
| Auth offline | `/api/admin/me` network fail → eski token “giriş yapılmış” görünür |
| Telefon OTP | InstitutionAdmin’de mock; “doğrulandı” iddiası yanıltıcı |
| Tarih input | `formatForInput` timezone kayması (gece yarısı ±1 gün) |
| Grafik forward-fill | Pencereden *sonraki* ilk noktayı geçmişe taşıyabilir → düz çizgi + yanlış % |
| % vs çizgi | Yüzde `(buy+sell)/2`, Area yalnızca `buy` — renk ile eğri çelişebilir |
| Race | Period hızlı değişince eski historical fetch sonucu yenisini ezebilir (AbortController yok) |
| Footer “Son güncelleme” | Tarih `new Date()` (bugün), API `updatedAt` değil |

### 2.7 Sayısal / XML zayıflıkları

- `/api/kktc-kurlar`: parse fail → `0` (null değil) — sahte sıfır kur  
- Kısmi XML → `buy: null` kartlarda  
- `node-cron` import edilmiş, kullanılmıyor  

---

## 3. Güvenlik Açıkları (Security Vulnerabilities)

### 3.1 Kritik — Hardcoded sırlar ve zayıf varsayılanlar

| Konum | Risk |
|-------|------|
| `backend/src/config/supabaseClient.js` | URL + `sb_publishable_...` kaynakta |
| `backend/migrateToSupabase.js` | Aynı anahtar tekrarı |
| `backend/src/auth.js` | `JWT_SECRET \|\| "finsight-dev-secret-change-me"` |
| `db.js` seed | Katalog / banka1–3 / `tuna` şifresi **`123`** |
| Frontend SSE | Production URL hardcoded (`V0FinancialDashboard.jsx`) — env bypass |

### 3.2 Kritik — Supabase RLS fiilen kapalı

`supabase_admin_schema.sql`: RLS enable + `USING (true) WITH CHECK (true)` — institutions, branches, rate_adjustments, margin_history, partnership_applications, password_resets, visitor_sessions, site_stats.

Publishable/anon key + açık politika ⇒ dışarıdan:

- password hash okuma  
- marj / kurum overwrite  
- reset token / e-posta sızıntısı  
- site_stats manipülasyonu  

Backend güvenlik sınırı değildir; `service_role` yalnızca sunucuda, sıkı RLS zorunlu.

### 3.3 Yüksek — CORS ve herkese açık uçlar

- `cors({ origin: "*" })` + SSE `Access-Control-Allow-Origin: *`  
- Auth’suz: `GET /api/margins` (tüm marj haritası), `GET /api/kurlar` (ham MB + abonelik meta), şubeler, analytics yazma (`session_id` saldırgan kontrolünde), rate limit yok  

### 3.4 Auth boşlukları

- JWT role DB’den yeniden doğrulanmıyor  
- Şifre min uzunluk **4**  
- Login / forgot-password rate limit / lockout yok  
- Dual-write ile bcrypt hash’leri açık RLS’li Supabase’e yazılıyor  

### 3.5 Diğer

- KKTC XML: `rejectUnauthorized: false` → MITM  
- Partnership e-posta HTML’de kullanıcı alanları escape edilmeden → HTML injection  
- Geo: `http://ip-api.com` + spoofable `X-Forwarded-For`  
- Frontend: JWT `localStorage` (`finsight_business_auth`) — XSS = hesap ele geçirme  
- `logo_url` / data URL `<img src>` — allowlist tercih edilmeli  
- Prod’da `console.log` ile marj/kur/auth-adjacent sızıntı  

### 3.6 Öncelikli güvenlik yol haritası

1. Tüm sırları env’e taşı; repodaki key’leri rotate et  
2. RLS’i kapat (deny-by-default); backend yalnızca `service_role`  
3. Superadmin seed UPDATE’ini kaldır; varsayılan `123` / JWT fallback yasakla (prod’da process exit)  
4. CORS allowlist (Vercel domain + localhost)  
5. Login rate limit; inactive hesaplara token verme  
6. httpOnly cookie veya kısa ömürlü access + refresh; logout’ta bilinen key’leri sil (`clear()` değil)  
7. SSE’yi `apiUrl("/api/rates-stream")` ile env’e bağla  

---

## 4. Performans ve Optimizasyon (Performance)

### 4.1 Overfetch

- `getMarketHistoricalRates`: her istekte ~6 yıl `historical_rates` sayfalı çekim (`fetchAllPages`, 1000/sayfa) + Node’da kova — HTTP cache yok, sunucu tarafı agregasyon yok  
- `GET /api/business-rate-history`: benzer MB + margin history sayfalaması  
- Anasayfa: 3× historical (USD/EUR/GBP) × 5 dk poll + kurlar + marjlar + şubeler + SSE  

**Öneri:** Supabase’te materialized daily/hourly view veya RPC; `?from=&to=` ile pencere; CDN/ETag; SWR/React Query tek cache.

### 4.2 Sıcak yol

- `GET /api/kurlar`: her istekte tüm kurumlar + tüm adjustments  
- Hydrate/bootstrap: `select("*")` pagination yok → PostgREST ~1000 sessiz kesme riski  
- Dual-write: marj başına sıralı await; rate refresh’te 3 sıralı insert  
- Logo: base64 data URL (yüzlerce KB) DB + sync şişmesi  

### 4.3 Frontend render / SSE

- Her SSE mesajı tüm dashboard re-render (`V0BankCard` memo değil)  
- Reconnect backoff yok  
- God-component: `V0FinancialDashboard.jsx` (chart + converter + grid + SSE + partnership)  
- Interest/loan dead mode hâlâ her render’da hesaplanıyor  
- Admin sayfaları tek büyük component — her keystroke full re-render  

**Öneri:** `memo(V0BankCard)`; SSE’yi throttle + banks’e uygula; AbortController; chart downsample; code-split admin; dead mode kodunu kaldır.

### 4.4 Bellek

- `sseClients[]` unbounded risk  
- Yıllık forward-fill ~365 nokta × 3 kart × modal ikinci chart  

---

## 5. Vizyon ve Mantıksal Eklemeler (Feature Suggestions)

Mimariye uygun, rekabetçi öneriler:

### 5.1 Güven ve operasyon

1. **Tek kalıcı DB** — SQLite’ı cache/local-dev’e indirge; prod’da Supabase (veya Postgres) tek SoT  
2. **Audit log UI** — Super Admin “Loglar”ı gerçek `margin_history` / profil değişikliklerine bağla (şu an mock’a yakın)  
3. **Health dashboard** — MB scrape yaşı, SSE client sayısı, son hydrate süresi, Supabase lag  
4. **Feature flags** — TCMB vs KKTC kaynağı, OTP zorunluluğu  

### 5.2 Ürün / UX

5. **Kur uyarıları** — kullanıcı tanımlı eşik (push/e-posta/Telegram); “USD alış > X”  
6. **Karşılaştırma modu** — seçilen 2–3 büro + MB referans çizgisi aynı grafikte  
7. **CSV/PDF dışa aktarma** — piyasa özeti ve işletme history (B2B rapor)  
8. **Favori bürolar + konum** — “En Yakın” zaten var; favori + harita clustering  
9. **Gerçek OTP** — e-posta/SMS ile telefon doğrulama (mock kaldırılsın)  
10. **Açık/kapalı gerçek zamanlı** — 7 günlük working_hours objesi + timezone (Asia/Nicosia)  

### 5.3 Veri bilimi / grafik

11. **OHLC / mum** — saatlik/günlük open-high-low-close kovaları  
12. **Seyreltme (LTTB / min-max)** — yılllık seride DOM/CPU koruması  
13. **Anomali etiketi** — filtre silmek yerine “şüpheli nokta” olarak işaretle  
14. **Spread göstergesi** — alış-satış makası heatmap  

### 5.4 B2B / gelir

15. **Abonelik yaşam döngüsü** — süre dolmadan e-posta, grace period, otomatik pasifleştirme (login’de enforce)  
16. **Partnerlik CRM** — başvuru durumu pipeline (yeni / görüşüldü / onay)  
17. **White-label widget** — iframe/embed kur tablosu (API key + rate limit)  

### 5.5 Kalite

18. **Sözleşme testleri** — marj formülü, converter, period pencereleri için golden tests  
19. **Contract test** — `/api/kurlar` ve `/api/historical-rates` response shape  
20. **Observability** — structured logging + Sentry (frontend/backend)  

---

## Öncelik Özeti (Severity)

| # | Bulgu | Seviye | Alan |
|---|--------|--------|------|
| 1 | Açık RLS + hardcoded publishable key | **Kritik** | Güvenlik |
| 2 | Superadmin şifresinin her boot’ta `123` olması | **Kritik** | Güvenlik / Bug |
| 3 | Varsayılan JWT secret / CORS `*` / zayıf şifreler | **Kritik** | Güvenlik |
| 4 | Hydrate → bootstrap ile Supabase ezilme riski | **Yüksek** | Mantık |
| 5 | Marj history dual-write / baseline eksikliği | **Yüksek** | Mantık / Grafik |
| 6 | Pasif hesaba JWT + marj yazma | **Yüksek** | Güvenlik |
| 7 | Converter dropdown ≠ hesap kuru | **Yüksek** | Mantık / UX |
| 8 | SSE kartları güncellemiyor; hardcoded URL | **Yüksek** | Bug / Perf |
| 9 | Market history overfetch (6 yıl / istek) | **Orta** | Performans |
| 10 | TCMB vs KKTC kaynak çelişkisi | **Orta** | Mimari / Ürün |
| 11 | Working hours model uyumsuzluğu | **Orta** | Bug |
| 12 | JWT localStorage + logout `clear()` | **Orta** | Güvenlik / UX |
| 13 | God-component ve dead code | **İyileştirme** | Bakım |

---

## Referans Dosya Haritası

| Katman | Dosyalar |
|--------|----------|
| API / SSE | `backend/src/server.js` |
| SQLite / seed | `backend/src/db.js` |
| Auth | `backend/src/auth.js` |
| Supabase rates | `backend/src/config/supabaseClient.js` |
| Dual-write | `backend/src/config/supabaseSync.js` |
| RLS şema | `backend/supabase_admin_schema.sql` |
| Dashboard / chart / converter / SSE | `frontend/src/components/V0FinancialDashboard.jsx` |
| Kart | `frontend/src/components/V0BankCard.jsx` |
| İşletme modal | `frontend/src/components/BusinessDetailModal.jsx` |
| API base | `frontend/src/lib/api.js` |
| Token | `frontend/src/lib/auth.js` |
| Admin | `frontend/src/pages/InstitutionAdminPage.jsx`, `SuperAdminDashboard.jsx` |

---

## Sonuç

Ürün, ephemeral disk gerçeğine karşı dual-write ve Supabase history ile akıllı bir hayatta kalma stratejisi kurmuş; marj formülü ve piyasa/işletme grafik ayrımı doğru yönde. Ancak **güvenlik prototip seviyesinde** (açık RLS, kaynakta key, her boot’ta `123`, CORS `*`), **kaynak-of-truth kırılgan** (seed/bootstrap, marj history gap), ve **frontend’de birkaç kullanıcıya görünen mantık hatası** (çevirici kur etiketi, SSE/poll kopukluğu) üretim kalitesini sınırlıyor.

Önerilen sıra: **(1) güvenlik sertleştirme → (2) boot/hydrate/marj history tutarlılığı → (3) converter + SSE düzeltmeleri → (4) historical API optimizasyonu → (5) ürün özellikleri.**

---

*Bu belge salt okunur denetim sonucunda üretilmiştir; uygulama kaynak dosyalarında değişiklik yapılmamıştır.*
