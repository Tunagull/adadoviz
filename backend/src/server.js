require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const bcrypt = require("bcryptjs");
const axios = require("axios");

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * S-M5 / S-H2: Üretimde istemciye içsel ayrıntı (error.message / error.stack /
 * DB constraint metni) SIZDIRILMAZ. Ayrıntı sunucu log'unda kalır; istemci
 * jenerik bir mesaj alır. Bilinen doğrulama hataları güvenli stringlere maplenir.
 */
function clientErrorMessage(error, genericMsg = "Beklenmeyen bir hata oluştu.") {
  const raw = String(error?.message || error || "");
  // Bilinen, kullanıcının görmesi güvenli doğrulama hataları:
  const safePatterns = [
    /zorunlu/i, /geçersiz/i, /bulunamadı/i, /en az \d+ karakter/i,
    /negatif olamaz/i, /çok büyük/i, /kabul edilmez/i, /uyuşmuyor/i,
    /zaten (kayıtlı|mevcut|işleme)/i, /ters kotasyon/i, /limit/i, /pasif/i,
  ];
  if (safePatterns.some((re) => re.test(raw))) return raw;
  return IS_PRODUCTION ? genericMsg : raw || genericMsg;
}
const { buildBanksFromCentralRates, emptyPayloadForServerError, BANK_DEFINITIONS } = require("./scraper");
const {
  initDb,
  seedAdminsIfNeeded,
  seedCatalogInstitutionsIfNeeded,
  seedAdjustmentsIfNeeded,
  getDb,
  findAdminByUsername,
  listBusinesses,
  createBusiness,
  updateBusiness,
  updateBusinessStatus,
  resetBusinessSubscription,
  deleteBusiness,
  listBranchesByBusiness,
  listBranchesByInstitutionKey,
  createBranch,
  updateBranch,
  deleteBranch,
  createBranchRequest,
  listBranchRequests,
  countUnreadBranchRequests,
  markBranchRequestsRead,
  getBranchRequestById,
  updateBranchRequestStatus,
  createBusinessNotification,
  listBusinessNotifications,
  countUnreadBusinessNotifications,
  markBusinessNotificationsRead,
  getInstitutionsMetaById,
  getInstitutionCreatedAtMs,
  getMarginHistoryForInstitution,
  getInstitutionFullById,
  getInstitutionFullBySlug,
  updateInstitutionProfile,
  listAllInstitutionsForSync,
  listAllBranchesForSync,
  listAllAdjustmentsForSync,
  applySupabaseInstitutionRow,
  applySupabaseAdjustmentRow,
  applySupabaseBranchRow,
  applySupabaseBranchRequestRow,
  applySupabaseMarginHistoryRow,
  applySupabaseHistoricalRatesRows,
  applySupabasePlanRow,
  applySupabasePaymentRow,
  listAllBranchRequestsForSync,
  listAllPaymentsForSync,
  getPaymentById,
  hashResetToken,
  purgeOrphanBranches,
  replaceBusinessBranchesFromSupabase,
  getAdjustmentsForInstitution,
  getAllAdjustmentsMap,
  upsertAdjustments,
  recordHistoricalRates,
  getBusinessRateHistory,
  bulkInsertHistoricalRates,
  getHistoricalRates,
  getHistoricalRatesCount,
  getLatestHistoricalRatesSnapshot,
  listPlans,
  updatePlan,
  createPayment,
  deletePayment,
  listPayments,
  getPaymentsForInstitution,
  getRevenueSummary,
  listExpiringSubscriptions,
  backfillPaymentsFromSubscriptions,
  getClicksByBusiness,
  getClicksForInstitution,
  listPartnershipApplications,
  planCodeFromSubscriptionType,
  listPublicBranches,
  getPublicExchangeOfficeBySlug,
  listPublicExchangeOfficeSlugs,
  getVisitorStats,
  incrementVisitorCount,
  startVisitorSession,
  updateVisitorSession,
  getAdminAnalytics,
  findInstitutionForPasswordReset,
  createPasswordResetToken,
  findValidPasswordReset,
  markPasswordResetUsed,
  updateInstitutionPassword,
  getSeoSettings,
  updateSeoSettings,
  touchLastLogin,
  insertAuditLog,
  verifyAuditChain,
  listAuditLogs,
  listAuditLogsFiltered,
  listAuditActions,
  applySupabaseAuditRow,
} = require("./db");
const { signToken, requireAuth, requireSuperAdmin, requireWritableBusiness } = require("./auth");
const { findInstitutionByName, findInstitutionById, CURRENCIES } = require("./institutions");
const { applyAdjustmentsToBanksPayload, applyMarginToValue, enforceSellGteBuy } = require("./rateMath");
const { normalizeKind } = require("./marginSchema");
const { getRates: getCentralBankRates } = require("./services/ratesService");
const { sendPartnershipEmail, sendPasswordResetEmail, buildPartnershipDefaultMessage, isMailConfigured, getFrontendBaseUrl, logMailConfigOnBoot } = require("./email");
const { buildBusinessSlug } = require("./slug");
const crypto = require("crypto");
const {
  insertHistoricalRate,
  bulkInsertSupabaseHistoricalRates,
  getMarketHistoricalRates,
  getLatestSupabaseRatesSnapshot,
  getBusinessRateHistory: getSupabaseBusinessRateHistory,
  insertMarginHistory,
  fetchMarginHistory,
} = require("./config/supabaseClient");
const {
  syncInstitutionUpsert,
  syncInstitutionDelete,
  syncBranchUpsert,
  syncBranchDelete,
  syncRateAdjustmentsMap,
  syncPartnershipApplication,
  syncBranchRequestUpsert,
  syncPasswordReset,
  syncPaymentUpsert,
  syncPaymentDelete,
  syncPlanUpsert,
  syncVisitorSession,
  syncSiteStats,
  checkSupabaseHasInstitutions,
  hydrateAdminDataFromSupabase,
  bootstrapAdminDataToSupabase,
  getDualWriteErrors,
  syncAuditLog,
  compareInstitutionDrift,
} = require("./config/supabaseSync");

const app = express();
const PORT = process.env.PORT || 5000;
app.set("trust proxy", 1);

/** Scrape edilmiş ham KUR verisi (marj uygulanmadan önce). */
let ratesHealth = {
  lastAttemptAt: null,
  lastOkAt: null,
  lastErrorAt: null,
  lastError: null,
  source: null,
  sourceName: "KKTC Merkez Bankası",
  bulletinNo: null,
  validRange: null,
};

async function recordAudit(entry, { strict = false } = {}) {
  let row = null;
  try {
    row = insertAuditLog(entry);
  } catch (err) {
    console.error("[AUDIT] Yerel audit yazımı başarısız:", err.message);
    // S-M4: yüksek değerli işlemlerde (ödeme, şifre, silme) audit yazımı
    // başarısızsa çağıran taraf hata döndürsün.
    if (strict) throw new Error("İşlem kaydedilemedi (audit).");
    return null;
  }
  if (row) {
    try {
      await syncAuditLog(row);
    } catch (err) {
      // Supabase audit sync başarısızlığı ana işlemi düşürmez (SQLite kaydı var).
      console.warn("[AUDIT] Supabase audit sync başarısız:", err.message);
    }
  }
  return row;
}

let cachedRates = {
  updatedAt: null,
  /** Kur veya kâr marjında son gerçek değişim zamanı (UI "Son Güncelleme") */
  ratesChangedAt: null,
  totalBanks: 0,
  banks: [],
  centralBankUpdatedAt: null,
  centralBankRates: null,
  centralBankXmlDate: null,
  centralBankBulletinNo: null,
  centralBankValidRange: null,
  centralBankSourceName: "KKTC Merkez Bankası",
};

/** ✅ ADIM 1: SSE istemcilerini yönet */
const sseClients = [];

/** ✅ ADIM 1: Bir önceki kurları hafızada tut (değişim tespiti için) */
let previousRates = null;

/** CORS: local Vite + production origin'ler. CORS_ORIGINS ile genişletilir. */
const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  "https://adadoviz.tunahangul.com",
  "https://www.adadoviz.tunahangul.com",
];

const extraCors = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const frontendUrl = String(process.env.FRONTEND_URL || "").trim().replace(/\/$/, "");

const corsAllowList = new Set([
  ...DEFAULT_CORS_ORIGINS,
  ...extraCors,
  ...(frontendUrl ? [frontendUrl] : []),
]);

/**
 * S-M2: `*.vercel.app` wildcard KALDIRILDI — herhangi bir saldırganın
 * deploy edebileceği bir domain "güvenilir origin" sayılıyordu. Artık yalnızca
 * açık allowlist (DEFAULT + CORS_ORIGINS + FRONTEND_URL). Preview domain'ler
 * CORS_ORIGINS env'ine AÇIKÇA eklenmeli.
 */
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (process.env.CORS_ALLOW_ALL === "1") return true;
  return corsAllowList.has(origin);
}

function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) {
      if (now - rec.start > windowMs * 2) hits.delete(ip);
    }
  }, windowMs);
  if (typeof timer.unref === "function") timer.unref();
  return (req, res, next) => {
    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || now - rec.start > windowMs) {
      rec = { count: 0, start: now };
    }
    rec.count += 1;
    hits.set(ip, rec);
    if (rec.count > max) {
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }
    return next();
  };
}

/**
 * S-M1: Per-hesap (username) giriş kilidi. IP-bazlı limiter dağıtık credential
 * stuffing'i durdurmuyordu. Bu in-memory'dir; ⚠️ çok-instance'lı deploy'da her
 * instance kendi sayacını tutar (Render free tek instance olduğu için bugün
 * yeterli). Kalıcı çözüm: sayaç durumunu Supabase tablosuna taşımak.
 */
const LOGIN_LOCKOUT = {
  maxFails: 8,
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
  map: new Map(),
};
function loginLockoutState(username) {
  const key = String(username || "").toLowerCase();
  const rec = LOGIN_LOCKOUT.map.get(key);
  if (!rec) return { locked: false };
  if (rec.until && rec.until > Date.now()) {
    return { locked: true, retryAfterSec: Math.ceil((rec.until - Date.now()) / 1000) };
  }
  return { locked: false };
}
function registerLoginFailure(username) {
  const key = String(username || "").toLowerCase();
  const now = Date.now();
  const rec = LOGIN_LOCKOUT.map.get(key) || { fails: 0, first: now, until: 0 };
  if (now - rec.first > LOGIN_LOCKOUT.windowMs) {
    rec.fails = 0;
    rec.first = now;
  }
  rec.fails += 1;
  if (rec.fails >= LOGIN_LOCKOUT.maxFails) {
    rec.until = now + LOGIN_LOCKOUT.lockMs;
    console.warn(`[AUTH] Hesap kilitlendi (çok fazla başarısız giriş): ${key}`);
  }
  LOGIN_LOCKOUT.map.set(key, rec);
}
function clearLoginFailures(username) {
  LOGIN_LOCKOUT.map.delete(String(username || "").toLowerCase());
}
setInterval(() => {
  const now = Date.now();
  for (const [k, rec] of LOGIN_LOCKOUT.map) {
    if ((!rec.until || rec.until < now) && now - rec.first > LOGIN_LOCKOUT.windowMs) {
      LOGIN_LOCKOUT.map.delete(k);
    }
  }
}, 10 * 60 * 1000).unref?.();

/** S-L2: kullanıcı bulunamadığında da sabit maliyetli bcrypt karşılaştırması. */
const DUMMY_BCRYPT_HASH = bcrypt.hashSync("__never_matches__", 10);

/** P-05: şifre alt sınırı. İşletme hesapları ücretli listelemeleri yönetiyor. */
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_TOO_SHORT_MSG = `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalıdır.`;

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Çok fazla giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin.",
});
const forgotLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Çok fazla şifre sıfırlama isteği. Lütfen 15 dakika sonra tekrar deneyin.",
});

/**
 * ⚠️ GÜVENLİK DÜZELTMESİ (denetim bulgusu Y-04): Login/forgot dışındaki public
 * yazma uçları korumasızdı. /api/track-visitor ve /api/analytics/* sayaçları
 * dışarıdan sınırsız şişirilebiliyor (ölçüm: 10 istekte sayaç 26 → 36),
 * /api/partnership-apply ise HER İSTEKTE e-posta gönderiyordu (spam vektörü).
 */
const partnershipLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: "Çok fazla başvuru gönderildi. Lütfen bir saat sonra tekrar deneyin.",
});
const analyticsLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin.",
});
const visitorLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Çok fazla istek. Lütfen daha sonra tekrar deneyin.",
});

/**
 * Yanıt sıkıştırma — CORS'tan ÖNCE, ki her yanıt kapsansın.
 *
 * Sıkıştırma hiç yoktu. `/api/historical-rates` tek para birimi için 227 KB
 * ham JSON gönderiyordu (ana sayfa üçünü birden istiyor → ~680 KB). Aynı
 * gövde gzip ile 20.7 KB: yaklaşık %91 azalma. Alanlar tekrarlı sayı ve
 * tarih olduğu için oran bu kadar yüksek.
 *
 * SSE (`/api/rates-stream`) hariç: sıkıştırma akışı tamponlar ve olaylar
 * istemciye ancak tampon dolunca ulaşırdı.
 */
app.use(
  compression({
    filter: (req, res) =>
      req.path === "/api/rates-stream" ? false : compression.filter(req, res),
  })
);

/**
 * S-H2: Güvenlik başlıkları (helmet). Bu bir JSON API'si — CSP `default-src 'none'`
 * (JSON gövde için yeterli), COEP kapalı (logo gibi kaynaklar başka origin'e
 * gömülebilsin), HSTS üretimde açık. `crossOriginResourcePolicy` cross-site'a
 * izin verir (frontend farklı origin'den /api/logos çeker).
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: IS_PRODUCTION
      ? { maxAge: 15552000, includeSubDomains: true }
      : false,
    referrerPolicy: { policy: "no-referrer" },
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.json({
    service: "AdaDöviz API",
    status: "ok",
    health: "/api/health",
    rates: "/api/kurlar",
    stream: "/api/rates-stream",
  });
});

app.get("/api/health", (_req, res) => {
  // Y-02: Supabase hydrate arka planda sürerken bile bu uç hemen cevap verir.
  res.json({
    status: "ok",
    source: "KKTC Merkez Bankası",
    centralBankUpdatedAt: cachedRates.centralBankUpdatedAt || null,
    centralBankXmlDate: cachedRates.centralBankXmlDate || null,
    centralBankBulletinNo: cachedRates.centralBankBulletinNo || null,
    ratesPrimed: Boolean(cachedRates.centralBankRates),
    boot: bootState,
  });
});

/**
 * ✅ ADIM 1: Server-Sent Events (SSE) Endpoint
 * Frontend bu endpoint'e bağlanır ve kur değişikliklerini canlı alır
 * 
 * ✅ SECURITY: Memory Leak Koruması Eklendi
 * - req.on('close') ile düzgün cleanup
 * - req.on('error') ile hata durumunda temizlik
 * - res.on('finish') ile yazma bitişinde kontrol
 */
app.get("/api/rates-stream", (req, res) => {
  // SSE Header'ları ayarla
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const sseOrigin = req.headers.origin;
  if (sseOrigin && isAllowedOrigin(sseOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", sseOrigin);
  }

  // İstemciyi listeye ekle
  const clientId = Date.now() + Math.random();
  const client = { id: clientId, res };
  sseClients.push(client);
  console.log(`[SSE] ✅ İstemci bağlandı. Toplam: ${sseClients.length}`);

  /**
   * ✅ CLEANUP HANDLER: Bellek sızıntısı koruması
   * - Client bağlantı kesilerse
   * - Error olursa
   * - Response biterse
   */
  const cleanup = () => {
    const index = sseClients.findIndex((c) => c.id === clientId);
    if (index !== -1) {
      sseClients.splice(index, 1);
      console.log(`[SSE] ✅ İstemci temizlendi (ID: ${clientId}). Kalan: ${sseClients.length}`);
    }
  };

  // Heartbeat interval reference
  let heartbeat = null;

  // Bağlantı kesilirse istemciyi kaldır
  req.on("close", () => {
    if (heartbeat) clearInterval(heartbeat);
    cleanup();
  });
  
  // Error durumunda temizle
  req.on("error", (err) => {
    console.warn(`[SSE] ⚠️ Request error: ${err.message}`);
    if (heartbeat) clearInterval(heartbeat);
    cleanup();
  });

  // Response biterse temizle
  res.on("finish", () => {
    if (heartbeat) clearInterval(heartbeat);
    cleanup();
  });
  res.on("error", (err) => {
    console.warn(`[SSE] ⚠️ Response error: ${err.message}`);
    if (heartbeat) clearInterval(heartbeat);
  });

  // İlk kurları gönder
  if (cachedRates.centralBankRates) {
    try {
      res.write(`data: ${JSON.stringify({
        type: "initial",
        rates: cachedRates.centralBankRates,
        timestamp: new Date().toISOString(),
      })}\n\n`);
    } catch (err) {
      console.warn(`[SSE] ⚠️ İlk veri yazma hatası: ${err.message}`);
      cleanup();
    }
  }

  /**
   * ✅ ADIM 3: SSE Keep-Alive (Heartbeat / Ping) Mekanizması
   * 
   * Problem: 
   * - Load balancers / proxies bağlantı timeout'ını set edebilir (genelde 60-90s)
   * - Idle SSE bağlantısı "hang" kabul edilip kapatılabilir
   * - Browser hiç aktivite görmezse, bağlantı "dead" olabilir
   * 
   * Solution: Periyodik heartbeat/ping gönder
   * - Interval: 25 saniye (timeout'ın altında, genelde 60s)
   * - Format: ":ping\n\n" (SSE comment, client tarafından ignore edilir)
   * - Benefit: Keep-alive signal, bağlantı "alive" kalır
   * 
   * Timing:
   * - 25s heartbeat interval
   * - 30s heartbeat + buffer = safety margin
   * - Önerilen timeout: 60s+ (heartbeat'ten en az 2x)
   */
  
  // ✅ Set heartbeat interval
  heartbeat = setInterval(() => {
    try {
      // ✅ Send heartbeat comment (SSE format)
      // Format: :<comment>\n\n (colon ile başlar, client tarafından ignore edilir)
      // Bu veri "keep-alive" amacı taşır, data değildir
      client.res.write(":ping\n\n");
      // console.log(`[SSE] ❤️ Heartbeat gönderildi (Client ID: ${clientId})`);
    } catch (err) {
      // ✅ Heartbeat hatası = bağlantı koptu, cleanup yap
      console.warn(`[SSE] ⚠️ Heartbeat yazma hatası (${clientId}): ${err.message}`);
      cleanup();
    }
  }, 25000); // 25 saniyede bir (SSL timeout'ı için güvenli)
});

/**
 * ⚠️ PERF (soğuk başlatma): Render ücretsiz katmanında instance 15 dk boştan
 * sonra uyuyor; uyanınca `refreshRatesCacheWithChangeDetection()` arka planda
 * başlıyor ama bitene kadar `/api/kurlar` 503 dönüyordu ve frontend boş ekran
 * gösteriyordu. Artık: önbellek soğuksa isteği bekletip TEK bir prime çalıştır,
 * eşzamanlı istekler aynı promise'i paylaşır.
 */
let primingRatesPromise = null;
function primeRatesOnce() {
  if (!primingRatesPromise) {
    primingRatesPromise = refreshRatesCacheWithChangeDetection().finally(() => {
      primingRatesPromise = null;
    });
  }
  return primingRatesPromise;
}

app.get("/api/kurlar", async (_req, res) => {
  try {
    // MERKEZ BANKASI kurlarını base olarak kullan
    if (!cachedRates.centralBankRates || Object.keys(cachedRates.centralBankRates).length === 0) {
      console.warn("[KURLAR] Merkez Bankası kurları hazır değil — senkron prime deneniyor");
      try {
        await primeRatesOnce();
      } catch (primeErr) {
        console.warn("[KURLAR] Prime başarısız:", primeErr.message);
      }
    }
    if (!cachedRates.centralBankRates || Object.keys(cachedRates.centralBankRates).length === 0) {
      return res.status(503).json({ error: "Merkez Bankası kurları henüz yüklenmedi." });
    }

    const adjustmentsMap = getAllAdjustmentsMap();
    const isBankVisible = (bank) => {
      const active = bank.is_active === true || bank.is_active === 1 || bank.is_active === "1";
      if (!active) return false;
      if (bank.subscription_end_date) {
        const end = new Date(bank.subscription_end_date).getTime();
        if (Number.isFinite(end) && end <= Date.now()) return false;
      }
      return true;
    };

    // Favicon / kaynak URL eşlemesi (katalog)
    const sourceByName = new Map(
      BANK_DEFINITIONS.map((d) => [
        String(d.name)
          .toLocaleLowerCase("tr-TR")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, ""),
        d.sourceUrl,
      ])
    );

    /**
 * Tek kaynak: Super Admin'deki aktif + süresi dolmamış işletmeler.
 * Kart kuru = Merkez Bankası kuru + o işletmenin kâr marjı (fixed/percent).
 * Not: branch_count filtresi KALDIRILDI — Dashboard ile Super Admin aktif
 * listesi tutarlı olsun (şubesi olmayan aktif işletmeler de görünür).
 */
    const banks = listBusinesses()
      .filter((biz) =>
        isBankVisible({
          is_active: biz.is_active,
          subscription_end_date: biz.subscription_end_date,
        })
      )
      .map((biz) => {
        const institutionId = biz.institution_id;
        const adj = adjustmentsMap.get(institutionId) || {};
        const rates = {};
        for (const currency of ["EUR", "USD", "GBP"]) {
          const kur = cachedRates.centralBankRates[currency];
          const buyAdj = adj[`${currency}_buy`] || { margin_type: "fixed", margin_value: 0 };
          const sellAdj = adj[`${currency}_sell`] || { margin_type: "fixed", margin_value: 0 };
          rates[currency] = enforceSellGteBuy(
            applyMarginToValue(kur?.buy, buyAdj.margin_value, buyAdj.margin_type),
            applyMarginToValue(kur?.sell, sellAdj.margin_value, sellAdj.margin_type)
          );
        }
        const nameKey = String(biz.institution_name || "")
          .toLocaleLowerCase("tr-TR")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        return {
          bank: biz.institution_name,
          bankName: biz.institution_name,
          institutionId,
          sourceUrl: sourceByName.get(nameKey) || null,
          rates,
          exchangeRates: [
            { currency: "EUR", buy: rates.EUR.buy, sell: rates.EUR.sell },
            { currency: "USD", buy: rates.USD.buy, sell: rates.USD.sell },
            { currency: "GBP", buy: rates.GBP.buy, sell: rates.GBP.sell },
          ],
          depositRate: null,
          loans: { tasit: null, konut: null, ihtiyac: null },
          interestRates: [],
          subscription_type: biz.subscription_type || null,
          subscription_end_date: biz.subscription_end_date || null,
          days_remaining: biz.days_remaining != null ? biz.days_remaining : null,
          has_logo: Boolean(biz.logo_url),
          logo_url: biz.logo_url
            ? `/api/logos/${encodeURIComponent(institutionId)}`
            : null,
          working_hours: biz.working_hours || null,
          branch_count: Number(biz.branch_count) || 0,
          slug: buildBusinessSlug({
            institution_id: institutionId,
            institution_name: biz.institution_name,
          }),
          is_active: true,
        };
      });

    res.json({
      updatedAt: cachedRates.ratesChangedAt || cachedRates.centralBankUpdatedAt || cachedRates.updatedAt,
      ratesChangedAt: cachedRates.ratesChangedAt || cachedRates.centralBankUpdatedAt || cachedRates.updatedAt,
      totalBanks: banks.length,
      banks,
      centralBankUpdatedAt: cachedRates.centralBankUpdatedAt,
      centralBankXmlDate: cachedRates.centralBankXmlDate,
      centralBankBulletinNo: cachedRates.centralBankBulletinNo,
      centralBankValidRange: cachedRates.centralBankValidRange,
      centralBankSourceName: cachedRates.centralBankSourceName,
      rawCentralBankRates: cachedRates.centralBankRates,
    });
  } catch (error) {
    console.error("[KURLAR] Endpoint hata:", error.message, error.stack);
    res.status(500).json({
      success: false,
      error: "Kurlar alınamadı.",
    });
  }
});

/** Public: işletme logosunu base64 yerine ayrı endpoint'ten sun */
app.get("/api/logos/:institutionId", (req, res) => {
  try {
    const institutionId = decodeURIComponent(String(req.params.institutionId || "").trim());
    if (!institutionId) {
      return res.status(400).json({ error: "Geçersiz kurum." });
    }
    const row = getInstitutionFullBySlug(institutionId);
    if (!row?.logo_url) {
      return res.status(404).json({ error: "Logo bulunamadı." });
    }
    const logoUrl = String(row.logo_url);
    const dataMatch = logoUrl.match(
      /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([\s\S]+)$/i
    );
    if (dataMatch) {
      const declared = String(dataMatch[1] || "").toLowerCase();
      // S-H3: SVG asla servis edilmez (stored XSS).
      const allowed = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
      if (!allowed.has(declared)) {
        return res.status(415).json({ error: "Desteklenmeyen logo türü." });
      }
      const buf = Buffer.from(dataMatch[2], "base64");
      // S-H3: MIME-sniffing kapalı + bu yanıt hiçbir alt kaynak yükleyemez.
      res.setHeader("Content-Type", declared === "image/jpg" ? "image/jpeg" : declared);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(buf);
    }
    // S-L6: legacy http(s) logo_url redirect KALDIRILDI (açık yönlendirme vektörü).
    return res.status(404).json({ error: "Logo bulunamadı." });
  } catch (err) {
    console.error("[LOGO] Error:", err.message);
    return res.status(500).json({ error: "Logo alınamadı." });
  }
});

/**
 * Super Admin: tüm işletmelerin kâr marjları.
 *
 * ⚠️ GÜVENLİK DÜZELTMESİ (denetim bulgusu K-02): Bu uç önceden PUBLIC'ti ve
 * 20 kurumun alış/satış marjını (pasif olanlar dahil) kimlik doğrulaması olmadan
 * dönüyordu — bir rakip döviz bürosu diğerinin fiyatlama stratejisini tek istekle
 * çekebiliyordu. Marj ticari olarak hassas veridir; artık superadmin'e kapalıdır.
 *
 * Müşteri panosu nihai kuru zaten /api/kurlar'dan alır (marja ihtiyacı yoktur).
 */
app.get("/api/margins", requireSuperAdmin, (_req, res) => {
  try {
    const adjustmentsMap = getAllAdjustmentsMap();
    const margins = {};
    
    for (const [institutionId, adjustments] of adjustmentsMap.entries()) {
      margins[institutionId] = adjustments;
    }
    
    return res.json({
      success: true,
      margins,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[MARGINS] Error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Marjlar alınamadı.",
    });
  }
});

/**
 * Public: KKTC MB günlük bülteni (işletme paneli "salt okunur" bloğu).
 *
 * ⚠️ K-03 sonrası: Bu uç artık KENDİ XML isteğini/parser'ını çalıştırmıyor.
 * Fiyatlama ile aynı önbelleği (cachedRates) kullanır — böylece işletme panelinin
 * gördüğü kur ile müşteri panosundaki kur tanım gereği aynı olur. Önbellek henüz
 * dolmadıysa kaynağa bir kez doğrudan gidilir.
 */
app.get("/api/kktc-kurlar", async (_req, res) => {
  try {
    let rates = cachedRates.centralBankRates;
    let tarih = cachedRates.centralBankXmlDate;
    let duyuruNo = cachedRates.centralBankBulletinNo;
    let gecerlilik = cachedRates.centralBankValidRange;

    if (!rates || Object.keys(rates).length === 0) {
      const fresh = await getCentralBankRates();
      if (fresh.source === "error" || !fresh.rates) {
        throw new Error(fresh.error || "KKTC MB kaynağına ulaşılamadı.");
      }
      rates = fresh.rates;
      tarih = fresh.xmlDate;
      duyuruNo = fresh.bulletinNo;
      gecerlilik = fresh.validRange;
    }

    const kurlar = ["USD", "EUR", "GBP"]
      .filter((sembol) => rates[sembol])
      .map((sembol) => ({
        sembol,
        alis: rates[sembol].buy,
        satis: rates[sembol].sell,
        efektif_alis: rates[sembol].efektif_buy,
        efektif_satis: rates[sembol].efektif_sell,
      }));

    return res.json({
      success: true,
      kaynak: "KKTC Merkez Bankası",
      tarih,
      duyuru_no: duyuruNo,
      gecerlilik,
      kurlar,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[KKTC-KURLAR] Bülten alınamadı:", error.message);
    return res.status(503).json({
      success: false,
      error: "KKTC Merkez Bankası kurları şu anda alınamıyor.",
      message: error.message,
    });
  }
});

app.post("/api/auth/login", loginLimiter, (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!username || !password) {
      return res.status(400).json({ error: "Giriş ID ve şifre zorunludur." });
    }
    if (username.includes("@")) {
      return res.status(400).json({
        error: "E-posta ile giriş yapılamaz. Lütfen Giriş ID kullanın.",
      });
    }

    // S-M1: hesap kilitli mi?
    const lock = loginLockoutState(username);
    if (lock.locked) {
      res.setHeader("Retry-After", String(lock.retryAfterSec || 900));
      return res.status(429).json({
        error: "Çok fazla başarısız giriş denemesi. Lütfen bir süre sonra tekrar deneyin.",
      });
    }

    console.log(`[AUTH] Login attempt: ${username}`);
    const admin = findAdminByUsername(username);
    // S-L2: kullanıcı yoksa da bcrypt.compareSync çalıştır — timing ile
    // kullanıcı-varlığı sızmasın (sabit maliyet).
    const passwordOk = bcrypt.compareSync(
      password,
      admin?.password_hash || DUMMY_BCRYPT_HASH
    );
    if (!admin || !passwordOk) {
      registerLoginFailure(username);
      return res.status(401).json({ error: "Geçersiz Giriş ID veya şifre." });
    }

    const role = admin.role || "business";
    const isActive = !(admin.is_active === 0 || admin.is_active === false);

    // S-H4: pasif işletme hesabı token ALAMAZ (profil/şifre uçları da kapansın).
    if (!isActive && role !== "superadmin") {
      registerLoginFailure(username);
      return res.status(403).json({
        error: "Hesabınız pasif durumda. Lütfen yönetici ile iletişime geçin.",
        code: "BUSINESS_INACTIVE",
      });
    }

    clearLoginFailures(username);

    const token = signToken({
      username: admin.username,
      institution_id: admin.institution_id,
      institution_name: admin.institution_name,
      role,
    });

    touchLastLogin(admin.username);

    // Panele giriş de aktivite günlüğüne düşer (işletme kendi geçmişinde görür).
    recordAudit({
      action: role === "superadmin" ? "superadmin_login" : "business_login",
      actor: admin.username,
      institution_id: admin.institution_id,
      institution_name: admin.institution_name,
      detail: "Panele giriş yapıldı",
    }).catch(() => {});

    const fullAfterLogin = getInstitutionFullById(admin.id);
    if (fullAfterLogin) {
      syncInstitutionUpsert(fullAfterLogin).catch((err) => {
        console.warn("[AUTH] last_login sync:", err?.message || err);
      });
    }

    return res.json({
      success: true,
      token,
      username: admin.username,
      institution_id: admin.institution_id,
      institution_name: admin.institution_name,
      role,
      subscription: admin.subscription || "Test",
      subscription_type: admin.subscription_type || "Test",
      subscription_end_date: admin.subscription_end_date || null,
      days_remaining: admin.days_remaining != null ? admin.days_remaining : null,
      is_active: isActive,
    });
  } catch (err) {
    console.error("[AUTH] login:", err.message);
    return res.status(500).json({ error: "Giriş yapılamadı." });
  }
});

/** Genel mesaj — hesap varlığını sızdırmaz */
const FORGOT_PASSWORD_OK_MSG =
  "Eğer bu hesap sistemde kayıtlıysa, şifre sıfırlama bağlantısı e-posta adresinize gönderildi.";

app.post("/api/forgot-password", forgotLimiter, async (req, res) => {
  try {
    const emailOrUsername = String(req.body?.email || req.body?.username || "").trim();
    if (!emailOrUsername) {
      return res.status(400).json({ error: "E-posta veya Giriş ID zorunludur." });
    }

    const institution = findInstitutionForPasswordReset(emailOrUsername);
    if (!institution || institution.role === "superadmin") {
      console.warn(
        `[AUTH] forgot-password: hesap bulunamadı veya superadmin — identifier=${emailOrUsername.slice(0, 48)}`
      );
      return res.json({ success: true, message: FORGOT_PASSWORD_OK_MSG });
    }

    // Sıfırlama maili yalnızca kayıtlı iletişim e-postasına gider (e-posta ile giriş yok)
    const destination =
      institution.email && String(institution.email).includes("@")
        ? String(institution.email).trim()
        : null;

    if (!destination) {
      // Hesapta e-posta yoksa yine genel mesaj dön (güvenlik)
      console.warn(
        `[AUTH] forgot-password: kayıtlı e-posta yok — institution=${institution.institution_id || institution.username}`
      );
      return res.json({ success: true, message: FORGOT_PASSWORD_OK_MSG });
    }

    if (!isMailConfigured()) {
      // S-L3: sunucu durumunu sızdırma — jenerik OK dön, ayrıntıyı sadece logla.
      console.error("[AUTH] forgot-password: GMAIL_USER / GMAIL_PASS tanımlı değil (e-posta gönderilmedi).");
      return res.json({ success: true, message: FORGOT_PASSWORD_OK_MSG });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    createPasswordResetToken({
      institutionId: institution.id,
      email: destination,
      token,
      expiresAt,
    });
    // S-H1: Supabase'e YALNIZCA sha256(token) yansıtılır, ham token asla.
    await syncPasswordReset({
      institution_id: institution.id,
      institution_slug: institution.institution_id,
      email: destination,
      token: hashResetToken(token),
      expires_at: expiresAt,
      used: false,
    });

    const frontendBase = getFrontendBaseUrl();
    const resetUrl = `${frontendBase}/reset-password?token=${token}`;

    await sendPasswordResetEmail({
      to: destination,
      resetUrl,
      institutionName: institution.institution_name,
    });
    await recordAudit({
      action: "password_reset_requested",
      actor: institution.username,
      institution_id: institution.institution_id,
      institution_name: institution.institution_name,
      detail: destination,
    });

    return res.json({ success: true, message: FORGOT_PASSWORD_OK_MSG });
  } catch (err) {
    console.error("[AUTH] forgot-password:", err.message);
    return res.status(500).json({
      error: "Şifre sıfırlama e-postası gönderilemedi. Lütfen daha sonra tekrar deneyin.",
    });
  }
});

app.post("/api/reset-password", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.password || req.body?.newPassword || "");

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token ve yeni şifre zorunludur." });
    }
    // P-05: hesaplar para kazandıran listelemeleri yönetiyor — 4 karakter yetersizdi.
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: PASSWORD_TOO_SHORT_MSG });
    }

    const resetRow = findValidPasswordReset(token);
    if (!resetRow) {
      return res.status(400).json({ error: "Geçersiz veya kullanılmış sıfırlama bağlantısı." });
    }

    const expiresMs = new Date(resetRow.expires_at).getTime();
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
      markPasswordResetUsed(resetRow.id);
      return res.status(400).json({ error: "Sıfırlama bağlantısının süresi dolmuş." });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    updateInstitutionPassword(resetRow.institution_id, passwordHash);
    markPasswordResetUsed(resetRow.id);

    const full = getInstitutionFullById(resetRow.institution_id);
    if (full) await syncInstitutionUpsert(full);
    await syncPasswordReset({
      institution_id: resetRow.institution_id,
      institution_slug: full?.institution_id || null,
      email: resetRow.email,
      token: resetRow.token,
      expires_at: resetRow.expires_at,
      used: true,
    });
    await recordAudit({
      action: "password_reset",
      actor: full?.username || null,
      institution_id: full?.institution_id || null,
      institution_name: full?.institution_name || null,
      detail: "Şifre sıfırlama bağlantısı ile güncellendi",
    }, { strict: true });

    return res.json({
      success: true,
      message: "Şifreniz başarıyla güncellendi. Giriş yapabilirsiniz.",
    });
  } catch (err) {
    console.error("[AUTH] reset-password:", err.message);
    return res.status(500).json({ error: clientErrorMessage(err, "Şifre güncellenemedi.") });
  }
});

app.get("/api/admin/me", requireAuth, (req, res) => {
  const admin = findAdminByUsername(req.user.username);
  const isActive = admin
    ? !(admin.is_active === 0 || admin.is_active === false)
    : true;

  res.json({
    username: req.user.username,
    institution_id: req.user.institution_id,
    institution_name: req.user.institution_name,
    role: req.user.role || admin?.role || "business",
    subscription: admin?.subscription || "Test",
    subscription_type: admin?.subscription_type || "Test",
    subscription_end_date: admin?.subscription_end_date || null,
    days_remaining: admin?.days_remaining != null ? admin.days_remaining : null,
    is_active: isActive,
  });
});

app.put("/api/business/change-password", requireAuth, async (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Bu işlem yalnızca işletme hesapları için geçerlidir." });
    }

    const oldPassword = String(req.body?.oldPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: "Eski ve yeni şifre zorunludur." });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: PASSWORD_TOO_SHORT_MSG });
    }

    const admin = findAdminByUsername(req.user.username);
    if (!admin) {
      return res.status(404).json({ error: "Hesap bulunamadı." });
    }

    if (!bcrypt.compareSync(oldPassword, admin.password_hash)) {
      return res.status(401).json({ error: "Mevcut şifre hatalı." });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    updateInstitutionPassword(admin.id, passwordHash);
    const full = getInstitutionFullById(admin.id);
    if (full) {
      const synced = await syncInstitutionUpsert(full);
      if (!synced) {
        console.error(
          `[AUTH] Şifre SQLite'ta güncellendi ama Supabase sync başarısız: ${full.institution_id}`
        );
      }
    }
    await recordAudit({
      action: "password_change",
      actor: admin.username,
      institution_id: admin.institution_id,
      institution_name: admin.institution_name,
      detail: "İşletme panelinden şifre değiştirildi",
    }, { strict: true });

    return res.json({ success: true, message: "Şifre başarıyla değiştirildi." });
  } catch (err) {
    console.error("[AUTH] change-password:", err.message);
    return res.status(500).json({ error: err.message || "Şifre değiştirilemedi." });
  }
});

/** İşletme kendi profilini okur (logo, telefon, çalışma saatleri) */
app.get("/api/business/profile", requireAuth, (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Yalnızca işletme hesapları." });
    }
    const row = getInstitutionFullBySlug(req.user.institution_id);
    if (!row) return res.status(404).json({ error: "İşletme bulunamadı." });
    const branches = listBranchesByBusiness(row.id);
    return res.json({
      profile: {
        institution_id: row.institution_id,
        institution_name: row.institution_name,
        logo_url: row.logo_url || null,
        phone: row.phone || null,
        email: row.email || null,
        branch_limit: Number(row.branch_limit) || 1,
        branch_count: branches.length,
        working_hours: row.working_hours
          ? (() => {
              try {
                return JSON.parse(row.working_hours);
              } catch (_e) {
                return null;
              }
            })()
          : null,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Profil alınamadı." });
  }
});

/** İşletme profil güncelle (logo / telefon / çalışma saatleri) → SQLite + Supabase */
app.put("/api/business/profile", requireAuth, async (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Yalnızca işletme hesapları." });
    }
    // Değişiklik günlüğü, güncellemeden ÖNCEKİ değerlerle karşılaştırılarak
    // yazılır; böylece "neyi neyle değiştirdi" bilgisi loga girer.
    const before = getInstitutionFullBySlug(req.user.institution_id);

    const business = updateInstitutionProfile(req.user.institution_id, {
      logo_url: req.body?.logo_url,
      phone: req.body?.phone,
      working_hours: req.body?.working_hours,
    });
    const full = getInstitutionFullBySlug(req.user.institution_id);
    if (full) await syncInstitutionUpsert(full);

    if (before && full) {
      const changes = [];
      if ((before.logo_url || "") !== (full.logo_url || "")) changes.push("logo_url");
      if ((before.phone || "") !== (full.phone || "")) changes.push("phone");
      if ((before.working_hours || "") !== (full.working_hours || "")) changes.push("working_hours");

      if (changes.includes("logo_url")) {
        await recordAudit({
          action: "business_logo_update",
          actor: req.user.username || req.user.institution_id,
          institution_id: full.institution_id,
          institution_name: full.institution_name,
          detail: "Profil fotoğrafı değiştirildi",
        });
      }
      const rest = changes.filter((f) => f !== "logo_url");
      if (rest.length > 0) {
        const labels = { phone: "Telefon numarası", working_hours: "Çalışma saatleri" };
        await recordAudit({
          action: "business_profile_update",
          actor: req.user.username || req.user.institution_id,
          institution_id: full.institution_id,
          institution_name: full.institution_name,
          detail: rest.map((f) => labels[f] || f).join(", ") + " güncellendi",
        });
      }
    }

    return res.json({ ok: true, business });
  } catch (err) {
    const status = err.message === "İşletme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Profil güncellenemedi." });
  }
});

/** İşletme kendi şubelerini listeler */
app.get("/api/business/branches", requireAuth, (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Yalnızca işletme hesapları." });
    }
    const full = getInstitutionFullBySlug(req.user.institution_id);
    if (!full) return res.status(404).json({ error: "İşletme bulunamadı." });
    return res.json({ branches: listBranchesByBusiness(full.id) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Şubeler alınamadı." });
  }
});

/** İşletme kendi şubesinin telefon/whatsapp/konum bilgisini günceller */
app.put("/api/business/branches/:id", requireAuth, requireWritableBusiness, async (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Yalnızca işletme hesapları." });
    }
    const full = getInstitutionFullBySlug(req.user.institution_id);
    if (!full) return res.status(404).json({ error: "İşletme bulunamadı." });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz şube ID." });
    }

    const existing = listBranchesByBusiness(full.id).find((b) => b.id === id);
    if (!existing) {
      return res.status(404).json({ error: "Şube bulunamadı veya bu işletmeye ait değil." });
    }

    const branch = updateBranch(id, {
      name: req.body?.name !== undefined ? req.body.name : existing.name,
      phone: req.body?.phone !== undefined ? req.body.phone : existing.phone,
      whatsapp: req.body?.whatsapp !== undefined ? req.body.whatsapp : existing.whatsapp,
      address: req.body?.address !== undefined ? req.body.address : existing.address,
      lat: req.body?.lat !== undefined ? req.body.lat : existing.lat,
      lng: req.body?.lng !== undefined ? req.body.lng : existing.lng,
    });
    await syncBranchUpsert(branch, full.institution_id);

    // Hangi alanın değiştiğini loga yaz (telefon, whatsapp, adres, konum...).
    const branchFields = { name: "Şube adı", phone: "Telefon", whatsapp: "WhatsApp", address: "Adres" };
    const changed = Object.keys(branchFields).filter(
      (field) => String(existing[field] ?? "") !== String(branch[field] ?? "")
    );
    if (Number(existing.lat) !== Number(branch.lat) || Number(existing.lng) !== Number(branch.lng)) {
      changed.push("konum");
    }
    if (changed.length > 0) {
      await recordAudit({
        action: "business_branch_update",
        actor: req.user.username || req.user.institution_id,
        institution_id: full.institution_id,
        institution_name: full.institution_name,
        detail: `${branch.name}: ${changed
          .map((f) => branchFields[f] || f)
          .join(", ")} güncellendi`,
      });
    }

    return res.json({ branch });
  } catch (err) {
    const status = err.message === "Şube bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Şube güncellenemedi." });
  }
});

/** İşletme, şube limiti dolmadıysa doğrudan şube ekler */
app.post("/api/business/branches", requireAuth, requireWritableBusiness, async (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Yalnızca işletme hesapları." });
    }
    const full = getInstitutionFullBySlug(req.user.institution_id);
    if (!full) return res.status(404).json({ error: "İşletme bulunamadı." });

    const name = String(req.body?.branch_name || req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const address = String(req.body?.address || "").trim();
    const lat = req.body?.lat == null || req.body?.lat === "" ? null : Number(req.body.lat);
    const lng = req.body?.lng == null || req.body?.lng === "" ? null : Number(req.body.lng);

    if (!name) return res.status(400).json({ error: "Şube adı zorunludur." });
    if (!phone) return res.status(400).json({ error: "Telefon numarası zorunludur." });
    if (!address) return res.status(400).json({ error: "Adres / konum zorunludur." });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "Haritadan konum seçilmesi zorunludur." });
    }

    const branch = createBranch({
      business_id: full.id,
      name,
      phone,
      whatsapp: String(req.body?.whatsapp || phone).trim(),
      address,
      lat,
      lng,
    });
    await syncBranchUpsert(branch, full.institution_id);
    const branches = listBranchesByBusiness(full.id);
    return res.status(201).json({
      branch,
      branch_limit: Number(full.branch_limit) || 1,
      branch_count: branches.length,
    });
  } catch (err) {
    const status = err.statusCode || (err.code === "BRANCH_LIMIT_REACHED" ? 403 : 400);
    return res.status(status).json({
      error: err.message || "Şube oluşturulamadı.",
      code: err.code || undefined,
    });
  }
});

/** İşletme yeni şube talebi oluşturur */
app.post("/api/business/branch-requests", requireAuth, async (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Yalnızca işletme hesapları." });
    }
    const full = getInstitutionFullBySlug(req.user.institution_id);
    if (!full) return res.status(404).json({ error: "İşletme bulunamadı." });

    const request = createBranchRequest({
      business_id: full.id,
      institution_id: full.institution_id,
      business_name: full.institution_name,
      branch_name: req.body?.branch_name || req.body?.name,
      phone: req.body?.phone,
      address: req.body?.address,
      lat: req.body?.lat,
      lng: req.body?.lng,
      request_type: req.body?.request_type,
      branch_id: req.body?.branch_id,
    });
    const synced = await syncBranchRequestUpsert(request);
    if (!synced) {
      console.error(
        `[BRANCH-REQUEST] SQLite'a yazıldı ama Supabase sync başarısız: ${full.institution_id}`
      );
    }
    return res.status(201).json({ request });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Talep oluşturulamadı." });
  }
});

/** İşletme bildirimleri */
app.get("/api/business/notifications", requireAuth, (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Yalnızca işletme hesapları." });
    }
    const full = getInstitutionFullBySlug(req.user.institution_id);
    if (!full) return res.status(404).json({ error: "İşletme bulunamadı." });
    return res.json({
      notifications: listBusinessNotifications(full.id),
      unread: countUnreadBusinessNotifications(full.id),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Bildirimler alınamadı." });
  }
});

app.post("/api/business/notifications/mark-read", requireAuth, (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Yalnızca işletme hesapları." });
    }
    const full = getInstitutionFullBySlug(req.user.institution_id);
    if (!full) return res.status(404).json({ error: "İşletme bulunamadı." });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
    return res.json(markBusinessNotificationsRead(full.id, ids));
  } catch (err) {
    return res.status(400).json({ error: err.message || "Okundu işaretlenemedi." });
  }
});

/** Super Admin: şube talepleri */
app.get("/api/admin/branch-requests", requireSuperAdmin, (req, res) => {
  try {
    const status = req.query?.status || undefined;
    return res.json({
      requests: listBranchRequests({ status }),
      unread: countUnreadBranchRequests(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Talepler alınamadı." });
  }
});

app.get("/api/admin/branch-requests/unread-count", requireSuperAdmin, (_req, res) => {
  try {
    return res.json({ unread: countUnreadBranchRequests() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Bildirim sayısı alınamadı." });
  }
});

app.post("/api/admin/branch-requests/mark-read", requireSuperAdmin, (_req, res) => {
  try {
    return res.json(markBranchRequestsRead());
  } catch (err) {
    return res.status(500).json({ error: err.message || "Okundu işaretlenemedi." });
  }
});

app.put("/api/admin/branch-requests/:id", requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz talep ID." });
    }

    const existing = getBranchRequestById(id);
    if (!existing) return res.status(404).json({ error: "Talep bulunamadı." });

    const nextStatus = String(req.body?.status || "").trim();
    if (!["approved", "rejected", "pending"].includes(nextStatus)) {
      return res.status(400).json({ error: "Geçersiz talep durumu." });
    }

    /**
     * ⚠️ MANTIK DÜZELTMESİ (denetim bulgusu U-11): Durum kontrolü yoktu; zaten
     * onaylanmış bir talep tekrar onaylanınca createBranch YENİDEN çalışıyordu.
     * Bunu şu ana kadar yalnızca şube limiti durduruyordu — limiti yüksek bir
     * işletmede aynı talep birden çok şube üretebiliyordu. Ayrıca yöneticiye
     * alakasız bir "Şube limitine ulaşıldı" hatası gösteriliyordu.
     */
    if (existing.status !== "pending") {
      return res.status(409).json({
        error: `Bu talep zaten işleme alınmış (${
          existing.status === "approved" ? "onaylandı" : "reddedildi"
        }). Tekrar işlenemez.`,
        code: "REQUEST_ALREADY_PROCESSED",
        request: existing,
      });
    }

    let createdBranch = null;
    let renewedBranch = null;

    if (nextStatus === "approved") {
      if (existing.request_type === "reactivate" && existing.branch_id) {
        // S-L7: talep sahibinin gönderdiği branch_id GERÇEKTEN o işletmeye ait mi?
        const ownBranch = listBranchesByBusiness(existing.business_id).find(
          (b) => Number(b.id) === Number(existing.branch_id)
        );
        if (!ownBranch) {
          return res.status(400).json({
            error: "Talepteki şube bu işletmeye ait değil.",
            code: "BRANCH_OWNERSHIP_MISMATCH",
          });
        }
        renewedBranch = updateBranch(existing.branch_id, {
          is_active: true,
          subscription_type: "Aylık",
          remaining_days: 30,
        });
        const biz = getInstitutionFullById(existing.business_id);
        if (biz) await syncBranchUpsert(renewedBranch, biz.institution_id);
      } else {
        createdBranch = createBranch({
          business_id: existing.business_id,
          name: existing.branch_name,
          phone: existing.phone,
          address: existing.address,
          lat: existing.lat,
          lng: existing.lng,
        });
        const biz = getInstitutionFullById(existing.business_id);
        if (biz) await syncBranchUpsert(createdBranch, biz.institution_id);
      }
    }

    const request = updateBranchRequestStatus(id, {
      status: nextStatus,
      admin_note: req.body?.admin_note,
    });

    if (nextStatus === "approved" || nextStatus === "rejected") {
      const branchLabel = existing.branch_name || "şube";
      const isRenew = existing.request_type === "reactivate";
      try {
        createBusinessNotification({
          business_id: existing.business_id,
          type:
            nextStatus === "approved"
              ? isRenew
                ? "branch_renewal_approved"
                : "branch_request_approved"
              : isRenew
                ? "branch_renewal_rejected"
                : "branch_request_rejected",
          title:
            nextStatus === "approved"
              ? isRenew
                ? "Şube yenileme onaylandı"
                : "Şube talebi onaylandı"
              : isRenew
                ? "Şube yenileme reddedildi"
                : "Şube talebi reddedildi",
          message:
            nextStatus === "approved"
              ? isRenew
                ? `Yönetici "${branchLabel}" şubesinin yenileme talebini onayladı (30 gün).`
                : `Yönetici "${branchLabel}" şube başvurunuzu onayladı.`
              : isRenew
                ? `Yönetici "${branchLabel}" şubesinin yenileme talebini reddetti.`
                : `Yönetici "${branchLabel}" şube başvurunuzu reddetti.`,
          related_request_id: existing.id,
        });
      } catch (notifyErr) {
        console.warn("[NOTIFICATIONS] branch request notify:", notifyErr.message);
      }
    }

    await syncBranchRequestUpsert(request);
    await recordAudit({
      action: nextStatus === "approved" ? "branch_request_approved" : "branch_request_rejected",
      actor: req.user?.username || "superadmin",
      institution_id: existing.institution_id || null,
      institution_name: existing.business_name || null,
      detail: `"${existing.branch_name || "şube"}" ${
        existing.request_type === "reactivate" ? "yenileme" : "şube"
      } talebi ${nextStatus === "approved" ? "onaylandı" : "reddedildi"} (talep #${id})`,
    });
    return res.json({ request, branch: createdBranch || renewedBranch });
  } catch (err) {
    const status =
      err.statusCode ||
      (err.message === "Talep bulunamadı." || err.message === "İşletme bulunamadı."
        ? 404
        : 400);
    return res.status(status).json({
      error: err.message || "Talep güncellenemedi.",
      code: err.code || undefined,
    });
  }
});

app.get("/api/admin/businesses", requireSuperAdmin, (_req, res) => {
  try {
    return res.json({ businesses: listBusinesses() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "İşletmeler alınamadı." });
  }
});

app.post("/api/admin/businesses", requireSuperAdmin, async (req, res) => {
  try {
    // Yeni kayıtta is_active varsayılan true (1); yalnızca açıkça false/0 ise pasif
    const rawActive = req.body?.is_active;
    const isActive =
      rawActive === false || rawActive === 0 || rawActive === "0" || rawActive === "false"
        ? false
        : true;

    const business = createBusiness({
      username: req.body?.username,
      password: req.body?.password,
      institution_name: req.body?.institution_name,
      contact_person: req.body?.contact_person,
      email: req.body?.email,
      subscription_type: req.body?.subscription_type || "Test",
      remaining_days: req.body?.remaining_days,
      is_active: isActive,
      logo_url: req.body?.logo_url,
      branch_limit: req.body?.branch_limit,
    });
    const full = getInstitutionFullById(business.id);
    if (full) {
      const synced = await syncInstitutionUpsert(full);
      if (!synced) {
        console.error(
          `[ADMIN] İşletme SQLite'a yazıldı ama Supabase sync başarısız: ${full.institution_id}`
        );
      }
    }
    await recordAudit({
      action: "business_create",
      actor: req.user?.username || "superadmin",
      institution_id: business.institution_id || null,
      institution_name: business.institution_name || null,
      detail: `Yeni işletme oluşturuldu (paket=${business.subscription_type || "Test"}, şube limiti=${business.branch_limit ?? 1})`,
    });
    return res.status(201).json({ business });
  } catch (err) {
    return res.status(400).json({ error: clientErrorMessage(err, "İşletme oluşturulamadı.") });
  }
});

app.put("/api/admin/businesses/:id", requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz işletme ID." });
    }
    const business = updateBusiness(id, {
      username: req.body?.username,
      password: req.body?.password,
      institution_name: req.body?.institution_name,
      contact_person: req.body?.contact_person,
      email: req.body?.email,
      subscription_type: req.body?.subscription_type,
      remaining_days: req.body?.remaining_days,
      is_active: req.body?.is_active,
      logo_url: req.body?.logo_url,
      branch_limit: req.body?.branch_limit,
    });
    const full = getInstitutionFullById(id);
    if (full) {
      const synced = await syncInstitutionUpsert(full);
      if (!synced) {
        console.error(
          `[ADMIN] İşletme güncellendi ama Supabase sync başarısız: ${full.institution_id}`
        );
      }
    }
    await recordAudit({
      action: "business_update",
      actor: req.user?.username || "superadmin",
      institution_id: business.institution_id || null,
      institution_name: business.institution_name || null,
      detail: `İşletme güncellendi (paket=${business.subscription_type}, bitiş=${business.subscription_end_date || "—"}, şube limiti=${business.branch_limit}, durum=${business.is_active ? "aktif" : "pasif"}${req.body?.password ? ", şifre değiştirildi" : ""})`,
    });
    return res.json({ business });
  } catch (err) {
    const status = err.message === "İşletme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: clientErrorMessage(err, "İşletme güncellenemedi.") });
  }
});

app.put("/api/admin/businesses/:id/reset-subscription", requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz işletme ID." });
    }
    const business = resetBusinessSubscription(id);
    const full = getInstitutionFullById(id);
    if (full) await syncInstitutionUpsert(full);
    await recordAudit({
      action: "subscription_reset",
      actor: req.user?.username || "superadmin",
      institution_id: business.institution_id || null,
      institution_name: business.institution_name || null,
      detail: "Abonelik sıfırlandı",
    });
    return res.json({ business });
  } catch (err) {
    const status = err.message === "İşletme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Abonelik sıfırlanamadı." });
  }
});

app.put("/api/admin/businesses/:id/status", requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz işletme ID." });
    }
    if (req.body?.is_active === undefined) {
      return res.status(400).json({ error: "is_active zorunludur." });
    }
    const business = updateBusinessStatus(id, req.body.is_active);
    const full = getInstitutionFullById(id);
    if (full) await syncInstitutionUpsert(full);
    await recordAudit({
      action: business.is_active ? "business_activate" : "business_deactivate",
      actor: req.user?.username || "superadmin",
      institution_id: business.institution_id || null,
      institution_name: business.institution_name || null,
      detail: business.is_active ? "İşletme aktife alındı" : "İşletme pasife alındı",
    });
    return res.json({ business });
  } catch (err) {
    const status = err.message === "İşletme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Durum güncellenemedi." });
  }
});

app.delete("/api/admin/businesses/:id", requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz işletme ID." });
    }
    const full = getInstitutionFullById(id);
    await recordAudit({
      action: "business_delete",
      actor: req.user?.username || "superadmin",
      institution_id: full?.institution_id || null,
      institution_name: full?.institution_name || null,
      detail: `İşletme silindi (id=${id})`,
    }, { strict: true });
    const result = deleteBusiness(id);
    if (full?.institution_id) {
      const synced = await syncInstitutionDelete(full.institution_id);
      if (!synced) {
        console.error(
          `[ADMIN] İşletme SQLite'tan silindi ama Supabase sync başarısız: ${full.institution_id}`
        );
      }
    }
    return res.json(result);
  } catch (err) {
    const status = err.message === "İşletme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "İşletme silinemedi." });
  }
});

app.get("/api/admin/businesses/:id/branches", requireSuperAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz işletme ID." });
    }
    return res.json({ branches: listBranchesByBusiness(id) });
  } catch (err) {
    const status = err.message === "İşletme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Şubeler alınamadı." });
  }
});

/** Public: aktif abonelik paketleri (fiyatlandırma sayfası). */
app.get("/api/plans", (_req, res) => {
  try {
    const plans = listPlans({ onlyActive: true }).map((p) => ({
      code: p.code,
      ad: p.ad,
      sure_gun: p.sure_gun,
      fiyat: p.fiyat,
      sira: p.sira,
    }));
    return res.json({ plans });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Paketler alınamadı." });
  }
});

/** Public: SEO meta ayarları (anasayfa head) */
app.get("/api/seo", (_req, res) => {
  try {
    return res.json({ seo: getSeoSettings() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "SEO ayarları alınamadı." });
  }
});

/** Public: dinamik sitemap */
app.get("/sitemap.xml", (_req, res) => {
  try {
    const seo = getSeoSettings();
    const base = String(seo.canonical_url || "https://adadoviz.tunahangul.com/")
      .replace(/\/$/, "");
    const lastmod = new Date().toISOString().slice(0, 10);
    const officeUrls = listPublicExchangeOfficeSlugs()
      .map(
        (item) => `  <url>
    <loc>${base}${item.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${item.type === "business" ? "0.9" : "0.8"}</priority>
  </url>`
      )
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${base}/kiyasla</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${base}/iletisim</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>${base}/paketler</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
${officeUrls}
</urlset>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    return res.send(xml);
  } catch (err) {
    return res.status(500).send("<!-- sitemap error -->");
  }
});

/** Public: döviz bürosu slug listesi (SEO / keşif) */
app.get("/api/doviz-burosu", (_req, res) => {
  try {
    return res.json({ offices: listPublicExchangeOfficeSlugs() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Liste alınamadı." });
  }
});

/** Public: slug ile döviz bürosu detayı (örn. lefkosa-merkez-doviz) */
app.get("/api/doviz-burosu/:slug", (req, res) => {
  try {
    const found = getPublicExchangeOfficeBySlug(req.params.slug);
    if (!found) {
      return res.status(404).json({ error: "Döviz bürosu bulunamadı." });
    }

    const biz = found.business;
    const institutionId = biz.institution_id;
    let exchangeRates = [];
    if (cachedRates.centralBankRates && Object.keys(cachedRates.centralBankRates).length) {
      const adjustmentsMap = getAllAdjustmentsMap();
      const adj = adjustmentsMap.get(institutionId) || {};
      exchangeRates = ["EUR", "USD", "GBP"].map((currency) => {
        const kur = cachedRates.centralBankRates[currency];
        const buyAdj = adj[`${currency}_buy`] || { margin_type: "fixed", margin_value: 0 };
        const sellAdj = adj[`${currency}_sell`] || { margin_type: "fixed", margin_value: 0 };
        const priced = enforceSellGteBuy(
          applyMarginToValue(kur?.buy, buyAdj.margin_value, buyAdj.margin_type),
          applyMarginToValue(kur?.sell, sellAdj.margin_value, sellAdj.margin_type)
        );
        return { currency, buy: priced.buy, sell: priced.sell };
      });
    }

    const displayName = String(biz.institution_name || "")
      .replace(/\s*\([Tt]est\)\s*/g, "")
      .trim();

    return res.json({
      slug: found.slug,
      businessSlug: found.businessSlug,
      matchedBranchId: found.matchedBranchId,
      matchedVia: found.matchedVia,
      path: `/doviz-burosu/${found.slug}`,
      business: {
        id: biz.id,
        name: displayName,
        institutionId,
        logo_url: biz.logo_url
          ? `/api/logos/${encodeURIComponent(institutionId)}`
          : null,
        phone: biz.phone || null,
        workingHours: biz.working_hours || null,
        working_hours: biz.working_hours || null,
        exchangeRates,
        subscription_type: biz.subscription_type || null,
        branch_count: Number(biz.branch_count) || found.branches.length,
      },
      branches: (found.branches || []).map((b) => ({
        id: b.id,
        name: b.name,
        phone: b.phone || null,
        whatsapp: b.whatsapp || null,
        address: b.address || null,
        lat: b.lat,
        lng: b.lng,
        city: b.city || null,
        slug: b.slug || null,
        is_active: b.is_active !== false,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Döviz bürosu alınamadı." });
  }
});

/** Public: robots.txt */
app.get("/robots.txt", (_req, res) => {
  try {
    const seo = getSeoSettings();
    const base = String(seo.canonical_url || "https://adadoviz.tunahangul.com/")
      .replace(/\/$/, "");
    const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /super-admin
Disallow: /reset-password

Sitemap: ${base}/sitemap.xml
`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.send(body);
  } catch (err) {
    return res.status(500).send("User-agent: *\nAllow: /\n");
  }
});

app.get("/api/admin/seo", requireSuperAdmin, (_req, res) => {
  try {
    return res.json({ seo: getSeoSettings() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "SEO ayarları alınamadı." });
  }
});

app.put("/api/admin/seo", requireSuperAdmin, async (req, res) => {
  try {
    const seo = updateSeoSettings(req.body || {});
    await recordAudit({
      action: "seo_update",
      actor: req.user?.username || "superadmin",
      institution_id: null,
      institution_name: null,
      detail: `SEO ayarları güncellendi (başlık="${String(seo.title || "").slice(0, 60)}")`,
    });
    return res.json({ success: true, seo });
  } catch (err) {
    return res.status(400).json({ error: err.message || "SEO ayarları kaydedilemedi." });
  }
});

/** Public: dashboard modal — işletmenin şubeleri (institution_id slug) */
app.get("/api/institutions/:institutionId/branches", (req, res) => {
  try {
    const institutionId = String(req.params.institutionId || "").trim();
    if (!institutionId) {
      return res.status(400).json({ error: "Geçersiz kurum kimliği." });
    }
    return res.json({
      institutionId,
      branches: listBranchesByInstitutionKey(institutionId),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Şubeler alınamadı." });
  }
});

/** Public: konum sıralaması için tüm şube koordinatları */
app.get("/api/branches", (_req, res) => {
  try {
    return res.json({ branches: listPublicBranches() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Şubeler alınamadı." });
  }
});

/** GDPR: çerez onayı sonrası tekil ziyaretçi sayacı (+1) — geriye uyumluluk */
app.post("/api/track-visitor", visitorLimiter, (_req, res) => {
  try {
    const stats = incrementVisitorCount();
    syncSiteStats(stats.total_visitors);
    return res.json({ ok: true, ...stats });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Ziyaretçi kaydı başarısız." });
  }
});

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || "";
}

async function resolveApproxLocation(ip) {
  const clean = String(ip || "")
    .replace(/^::ffff:/, "")
    .trim();
  if (
    !clean ||
    clean === "::1" ||
    clean === "127.0.0.1" ||
    clean.startsWith("192.168.") ||
    clean.startsWith("10.")
  ) {
    return "Yerel / Bilinmiyor";
  }
  try {
    const { data } = await axios.get(`http://ip-api.com/json/${encodeURIComponent(clean)}`, {
      timeout: 2500,
      params: { fields: "status,country,city,regionName" },
    });
    if (data?.status === "success") {
      const city = data.city || data.regionName || "";
      const country = data.country || "";
      const label = [city, country].filter(Boolean).join(" / ");
      return label || "Bilinmiyor";
    }
  } catch (err) {
    console.warn("[ANALYTICS] Geo-IP:", err.message);
  }
  return "Bilinmiyor";
}

/**
 * S-L4: İstemciden gelen session_id / location güvenilmez. session_id sıkı
 * biçime zorlanır (yalnızca base64url benzeri, <=64), location düz metne ve 80
 * karaktere indirilir; boşsa sunucu Geo-IP'den üretir. (Tam çözüm — sunucu
 * imzalı session_id — frontend ile koordineli bir sonraki adım.)
 */
function sanitizeSessionId(raw) {
  const s = String(raw || "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(s)) return null;
  return s;
}
function sanitizeLocationLabel(raw) {
  // İzin verilen: harf (unicode), rakam, boşluk, / , . - ( )
  return String(raw || "")
    .replace(/[^\p{L}\p{N}\s/.,()-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Anonim oturum başlat (çerez kabulü) */
app.post("/api/analytics/start", analyticsLimiter, async (req, res) => {
  try {
    const session_id = sanitizeSessionId(req.body?.session_id);
    if (!session_id) {
      return res.status(400).json({ error: "Geçersiz session_id." });
    }
    const ip = getClientIp(req);
    const clientLoc = sanitizeLocationLabel(req.body?.location);
    const location = clientLoc || (await resolveApproxLocation(ip));
    const session = startVisitorSession({ session_id, location });
    syncVisitorSession(session);
    return res.status(201).json({ ok: true, session });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Oturum başlatılamadı." });
  }
});

/** Anonim etkileşim güncelle */
app.put("/api/analytics/update", analyticsLimiter, (req, res) => {
  try {
    const session_id = String(req.body?.session_id || "").trim();
    if (!session_id) {
      return res.status(400).json({ error: "session_id zorunludur." });
    }
    const session = updateVisitorSession(session_id, {
      clicked_businesses: req.body?.clicked_businesses,
      clicked_business_ids: req.body?.clicked_business_ids,
      viewed_currencies: req.body?.viewed_currencies,
      business: req.body?.business,
      business_id: req.body?.business_id,
      currency: req.body?.currency,
    });
    syncVisitorSession(session);
    return res.json({ ok: true, session });
  } catch (err) {
    const status = err.message === "Oturum bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Güncelleme başarısız." });
  }
});

/** Super Admin: MB kurları, dual-write, SQLite↔Supabase drift, audit log */
app.get("/api/admin/system-health", requireSuperAdmin, async (_req, res) => {
  try {
    const sqliteRows = listAllInstitutionsForSync();
    const drift = await compareInstitutionDrift(sqliteRows);
    const dualWrite = getDualWriteErrors(20);
    return res.json({
      rates: {
        lastAttemptAt: ratesHealth.lastAttemptAt,
        lastOkAt: ratesHealth.lastOkAt,
        lastErrorAt: ratesHealth.lastErrorAt,
        lastError: ratesHealth.lastError,
        source: ratesHealth.source,
        sourceName: ratesHealth.sourceName || "KKTC Merkez Bankası",
        bulletinNo: ratesHealth.bulletinNo || cachedRates.centralBankBulletinNo || null,
        validRange: ratesHealth.validRange || cachedRates.centralBankValidRange || null,
        centralBankUpdatedAt: cachedRates.centralBankUpdatedAt || null,
        centralBankXmlDate: cachedRates.centralBankXmlDate || null,
        ratesChangedAt: cachedRates.ratesChangedAt || null,
      },
      boot: bootState,
      dualWrite: {
        recent: dualWrite,
        count: dualWrite.length,
      },
      drift,
      sqlite: { institutions: sqliteRows.length },
      audit: listAuditLogs(80),
      auditChain: (() => {
        try {
          return verifyAuditChain();
        } catch (e) {
          return { ok: null, error: e.message };
        }
      })(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Sağlık raporu alınamadı." });
  }
});

/** S-M4: audit zinciri bütünlük doğrulaması. */
app.get("/api/admin/audit-verify", requireSuperAdmin, (_req, res) => {
  try {
    return res.json(verifyAuditChain());
  } catch (err) {
    return res.status(500).json({ error: "Zincir doğrulanamadı." });
  }
});

/**
 * B-M1: Süper admin elle yeniden hydrate tetikler (Supabase → SQLite).
 * Supabase boot'ta erişilemedi ve pano boş kaldıysa kullanılır.
 */
let rehydrateInFlight = null;
app.post("/api/admin/rehydrate", requireSuperAdmin, async (req, res) => {
  try {
    if (rehydrateInFlight) {
      return res.status(202).json({ ok: false, message: "Yeniden hydrate zaten sürüyor." });
    }
    rehydrateInFlight = runHydrateOnce().finally(() => {
      rehydrateInFlight = null;
    });
    const result = await rehydrateInFlight;
    bootState.hydrate = result.ok ? "ok" : "failed";
    if (result.ok) seedPreviousRatesFromDisk();
    await recordAudit({
      action: "admin_rehydrate",
      actor: req.user?.username || "superadmin",
      detail: `Yeniden hydrate (ok=${result.ok}, institutions=${result.institutions}, payments=${result.payments}, marginHistory=${result.marginHistory})`,
    });
    return res.json({ ok: result.ok, result });
  } catch (err) {
    console.error("[REHYDRATE]", err.message);
    return res.status(500).json({ ok: false, error: "Yeniden hydrate başarısız." });
  }
});

/**
 * Süper admin: filtrelenebilir + sayfalanabilir aktivite günlüğü.
 * Query: ?action=margin_update&institution_id=akbank&page=1&limit=50
 */
app.get("/api/admin/audit-logs", requireSuperAdmin, (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const action = req.query.action ? String(req.query.action).trim() : null;
    const institutionId = req.query.institution_id
      ? String(req.query.institution_id).trim().toLowerCase()
      : null;

    const { rows, total } = listAuditLogsFiltered({
      institutionId,
      action,
      limit,
      offset: (page - 1) * limit,
    });

    return res.json({
      logs: rows,
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      actions: listAuditActions(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Loglar alınamadı." });
  }
});

/**
 * İşletme: YALNIZCA kendi aktivite günlüğü.
 * institution_id oturumdan alınır; query'den ASLA okunmaz, aksi hâlde bir
 * işletme başka bir işletmenin logunu isteyebilirdi.
 */
app.get("/api/business/audit-logs", requireAuth, (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Yalnızca işletme hesapları." });
    }
    const institutionId = String(req.user.institution_id || "").toLowerCase();
    if (!institutionId) return res.status(404).json({ error: "İşletme bulunamadı." });

    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const page = Math.max(1, Number(req.query.page) || 1);
    const action = req.query.action ? String(req.query.action).trim() : null;

    const { rows, total } = listAuditLogsFiltered({
      institutionId,
      action,
      limit,
      offset: (page - 1) * limit,
    });

    return res.json({
      logs: rows,
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      actions: listAuditActions(institutionId),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Loglar alınamadı." });
  }
});

app.get("/api/admin/stats", requireSuperAdmin, (_req, res) => {
  try {
    return res.json(getVisitorStats());
  } catch (err) {
    return res.status(500).json({ error: err.message || "İstatistikler alınamadı." });
  }
});

app.get("/api/admin/analytics", requireSuperAdmin, (req, res) => {
  try {
    const limit = Number(req.query?.limit) || 50;
    return res.json(getAdminAnalytics(limit));
  } catch (err) {
    return res.status(500).json({ error: err.message || "Analitik alınamadı." });
  }
});

app.post("/api/admin/branches", requireSuperAdmin, async (req, res) => {
  try {
    const branch = createBranch({
      business_id: req.body?.business_id,
      name: req.body?.name,
      phone: req.body?.phone,
      whatsapp: req.body?.whatsapp,
      address: req.body?.address,
      lat: req.body?.lat,
      lng: req.body?.lng,
      subscription_type: req.body?.subscription_type,
      subscription_start_date: req.body?.subscription_start_date,
      subscription_end_date: req.body?.subscription_end_date,
      remaining_days: req.body?.remaining_days,
    });
    const biz = getInstitutionFullById(branch.business_id);
    if (biz) {
      await syncBranchUpsert(branch, biz.institution_id);
      await syncInstitutionUpsert(biz);
    }
    await recordAudit({
      action: "branch_create",
      actor: req.user?.username || "superadmin",
      institution_id: biz?.institution_id || null,
      institution_name: biz?.institution_name || null,
      detail: `Şube eklendi: "${branch.name}" (id=${branch.id})`,
    });
    return res.status(201).json({ branch });
  } catch (err) {
    const status =
      err.statusCode ||
      (err.message === "İşletme bulunamadı." ? 404 : 400);
    return res.status(status).json({
      error: err.message || "Şube oluşturulamadı.",
      code: err.code || undefined,
    });
  }
});

app.put("/api/admin/branches/:id", requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz şube ID." });
    }
    const branch = updateBranch(id, {
      name: req.body?.name,
      phone: req.body?.phone,
      whatsapp: req.body?.whatsapp,
      address: req.body?.address,
      lat: req.body?.lat,
      lng: req.body?.lng,
      subscription_type: req.body?.subscription_type,
      subscription_start_date: req.body?.subscription_start_date,
      subscription_end_date: req.body?.subscription_end_date,
      remaining_days: req.body?.remaining_days,
      is_active: req.body?.is_active,
    });
    const biz = getInstitutionFullById(branch.business_id);
    if (biz) {
      await syncBranchUpsert(branch, biz.institution_id);
      await syncInstitutionUpsert(biz);
    }
    await recordAudit({
      action: "branch_update",
      actor: req.user?.username || "superadmin",
      institution_id: biz?.institution_id || null,
      institution_name: biz?.institution_name || null,
      detail: `Şube güncellendi: "${branch.name}" (id=${branch.id}, durum=${branch.is_active === false ? "pasif" : "aktif"})`,
    });
    return res.json({ branch });
  } catch (err) {
    const status = err.message === "Şube bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Şube güncellenemedi." });
  }
});

app.delete("/api/admin/branches/:id", requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz şube ID." });
    }
    const before = getDb()
      .prepare(
        `SELECT b.*, i.institution_id FROM branches b
         JOIN institutions i ON i.id = b.business_id WHERE b.id = ?`
      )
      .get(id);
    const result = deleteBranch(id);
    if (before) await syncBranchDelete(before, before.institution_id);
    await recordAudit({
      action: "branch_delete",
      actor: req.user?.username || "superadmin",
      institution_id: before?.institution_id || null,
      institution_name: null,
      detail: `Şube silindi: "${before?.name || "?"}" (id=${id})`,
    }, { strict: true });
    return res.json(result);
  } catch (err) {
    const status = err.message === "Şube bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Şube silinemedi." });
  }
});

function getBaseBankForInstitution(institutionId, institutionName) {
  const banks = Array.isArray(cachedRates.banks) ? cachedRates.banks : [];
  const byName = banks.find((b) => {
    const inst = findInstitutionByName(b.bankName || b.bank);
    return inst?.id === institutionId;
  });
  if (byName) return byName;
  return banks.find((b) => (b.bankName || b.bank) === institutionName) || null;
}

function resolveKurPair(currency, bank) {
  // MERKEZ BANKASI kurlarını ÖNCE kullan (admin panelinde kullanılan single source of truth)
  const fromCentral = cachedRates.centralBankRates?.[currency];
  if (fromCentral && (Number.isFinite(Number(fromCentral.buy)) || Number.isFinite(Number(fromCentral.sell)))) {
    return {
      buy: Number.isFinite(Number(fromCentral.buy)) ? Number(fromCentral.buy) : null,
      sell: Number.isFinite(Number(fromCentral.sell)) ? Number(fromCentral.sell) : null,
      efektif_buy: Number.isFinite(Number(fromCentral.efektif_buy)) ? Number(fromCentral.efektif_buy) : null,
      efektif_sell: Number.isFinite(Number(fromCentral.efektif_sell)) ? Number(fromCentral.efektif_sell) : null,
    };
  }

  // Fallback: banka spesifik kur (şu an kullanılmıyor ama var)
  const basePair =
    bank?.rates?.[currency] ||
    bank?.exchangeRates?.find((r) => r.currency === currency) || { buy: null, sell: null };

  return {
    buy: Number.isFinite(Number(basePair.buy)) ? Number(basePair.buy) : null,
    sell: Number.isFinite(Number(basePair.sell)) ? Number(basePair.sell) : null,
    efektif_buy: Number.isFinite(Number(basePair.efektif_buy)) ? Number(basePair.efektif_buy) : null,
    efektif_sell: Number.isFinite(Number(basePair.efektif_sell)) ? Number(basePair.efektif_sell) : null,
  };
}

function buildCurrencyPayload(institutionId, institutionName) {
  const bank = getBaseBankForInstitution(institutionId, institutionName);
  const adjustments = getAdjustmentsForInstitution(institutionId);

  const result = [];
  for (const currency of ["EUR", "USD", "GBP"]) {
    const kur = resolveKurPair(currency, bank);
    const buyKey = `${currency}_buy`;
    const sellKey = `${currency}_sell`;
    const buyAdj = adjustments[buyKey] || { margin_type: "fixed", margin_value: 0 };
    const sellAdj = adjustments[sellKey] || { margin_type: "fixed", margin_value: 0 };
    const ordered = enforceSellGteBuy(
      applyMarginToValue(kur.buy, buyAdj.margin_value, buyAdj.margin_type),
      applyMarginToValue(kur.sell, sellAdj.margin_value, sellAdj.margin_type)
    );

    result.push({
      currency,
      buy: {
        kur: kur.buy,
        efektif_kur: kur.efektif_buy,
        margin_type: buyAdj.margin_type,
        margin_value: buyAdj.margin_value,
        final: ordered.buy,
      },
      sell: {
        kur: kur.sell,
        efektif_kur: kur.efektif_sell,
        margin_type: sellAdj.margin_type,
        margin_value: sellAdj.margin_value,
        final: ordered.sell,
      },
    });
  }
  return result;
}

app.get("/api/admin/rates", requireAuth, (req, res) => {
  try {
    const { institution_id, institution_name } = req.user;
    const payload = buildCurrencyPayload(institution_id, institution_name);
    res.json({
      institution_id,
      institution_name,
      updatedAt: cachedRates.updatedAt,
      centralBankUpdatedAt: cachedRates.centralBankUpdatedAt,
      centralBankXmlDate: cachedRates.centralBankXmlDate,
      currencies: payload,
    });
  } catch (error) {
    console.error("[ADMIN-RATES] Error:", error.message, error.stack);
    res.status(500).json({
      success: false,
      error: "Admin kurları alınamadı.",
    });
  }
});

app.put("/api/admin/rates", requireAuth, requireWritableBusiness, async (req, res) => {
  const { institution_id, institution_name } = req.user;
  const payload = req.body?.currencies;

  if (!Array.isArray(payload) || payload.length === 0) {
    return res.status(400).json({ error: "currencies dizisi zorunludur." });
  }

  try {
    const adjustments = {};
    
    for (const item of payload) {
      const currency = String(item.currency || "").toUpperCase();
      if (!["EUR", "USD", "GBP"].includes(currency)) {
        return res.status(400).json({ error: `Geçersiz para birimi: ${currency}` });
      }

      const buyMarginType = normalizeKind(item.buy?.margin_type);
      const buyMarginValue = Number(item.buy?.margin_value || 0);
      const sellMarginType = normalizeKind(item.sell?.margin_type);
      const sellMarginValue = Number(item.sell?.margin_value || 0);

      if (!Number.isFinite(buyMarginValue) || !Number.isFinite(sellMarginValue)) {
        return res.status(400).json({ error: `Geçersiz kâr değeri: ${currency}` });
      }
      if (buyMarginValue < 0 || sellMarginValue < 0) {
        return res.status(400).json({ error: `Kâr negatif olamaz: ${currency}` });
      }

      // İş kuralı (project_audit_report.md §1.2): finalSell >= finalBuy
      const kur = cachedRates.centralBankRates?.[currency];
      if (kur) {
        const finalBuy = applyMarginToValue(kur.buy, buyMarginValue, buyMarginType);
        const finalSell = applyMarginToValue(kur.sell, sellMarginValue, sellMarginType);
        if (
          finalBuy != null &&
          finalSell != null &&
          Number.isFinite(finalBuy) &&
          Number.isFinite(finalSell) &&
          finalSell < finalBuy
        ) {
          return res.status(400).json({
            error: `Ters kotasyon engellendi (${currency}): satış kuru alıştan düşük olamaz (alış=${finalBuy.toFixed(4)}, satış=${finalSell.toFixed(4)}).`,
          });
        }
      }

      adjustments[`${currency}_buy`] = {
        margin_type: buyMarginType,
        margin_value: buyMarginValue,
      };
      adjustments[`${currency}_sell`] = {
        margin_type: sellMarginType,
        margin_value: sellMarginValue,
      };
    }

    const { historyWrites } = upsertAdjustments(institution_id, adjustments);
    await syncRateAdjustmentsMap(institution_id, adjustments);
    if (historyWrites.length > 0) {
      await recordAudit({
        action: "margin_update",
        actor: req.user?.username || null,
        institution_id,
        institution_name,
        detail: historyWrites
          .map((w) => `${w.currency} ${w.type}=${w.current.margin_value}${w.current.margin_type === "percent" ? "%" : "₺"}`)
          .join(", "),
      });
    }
    // Public board "Son Güncelleme" — kâr marjı değişince damgayı ilerlet
    if (historyWrites.length > 0) {
      touchRatesChangedAt("margin");
    }

    // Kalıcı marj geçmişi → Supabase (Render ephemeral SQLite'a ek).
    // ⚠️ MANTIK DÜZELTMESİ (bkz. project_audit_report.md, 1.2 Kâr marjı geçmiş
    // boşluğu): Önceden yalnızca YENİ değer Supabase'e yazılıyordu. SQLite
    // tarafında ilk değişiklikte bir "baseline" (eski değer, ~10 yıl öncesine
    // damgalı) satırı da yazılıyordu ama bu Supabase'e hiç yansımıyordu.
    // Redeploy sonrası SQLite sıfırlanıp Supabase'ten hydrate edildiğinde,
    // baseline eksik olduğu için grafik "güncel marjı tüm geçmişe uygula"
    // davranışına düşüyordu. Şimdi SQLite'ta yazılan baseline+current çiftini
    // BİREBİR Supabase'e de yazıyoruz (sırasıyla: varsa baseline, sonra current).
    for (const write of historyWrites) {
      const { currency, type, baseline, current } = write;
      if (baseline) {
        try {
          await insertMarginHistory({
            institution_id,
            currency,
            type,
            margin_type: baseline.margin_type,
            margin_value: baseline.margin_value,
            recorded_at: baseline.recorded_at,
          });
        } catch (err) {
          console.warn("[SUPABASE] margin baseline sync:", err.message);
        }
      }
      try {
        await insertMarginHistory({
          institution_id,
          currency,
          type,
          margin_type: current.margin_type,
          margin_value: current.margin_value,
          recorded_at: current.recorded_at,
        });
      } catch (err) {
        console.warn("[SUPABASE] margin sync:", err.message);
      }
    }

    return res.json({
      ok: true,
      institution_id,
      institution_name,
      centralBankUpdatedAt: cachedRates.centralBankUpdatedAt,
      centralBankXmlDate: cachedRates.centralBankXmlDate,
      currencies: buildCurrencyPayload(institution_id, institution_name),
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Oranlar kaydedilemedi." });
  }
});


/* ==========================================================================
 * ABONELİK, TAHSİLAT VE PERFORMANS
 * Ürün haritası: A-01, A-02, A-03, A-04, A-05, İ-01, İ-02, İ-03
 * ========================================================================== */

/** Super Admin: paketler (fiyat artık veri, kodda sabit değil). */
app.get("/api/admin/plans", requireSuperAdmin, (_req, res) => {
  try {
    return res.json({ plans: listPlans() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Paketler alınamadı." });
  }
});

app.put("/api/admin/plans/:code", requireSuperAdmin, async (req, res) => {
  try {
    const plan = updatePlan(req.params.code, {
      ad: req.body?.ad,
      sure_gun: req.body?.sure_gun,
      fiyat: req.body?.fiyat,
      kdv_orani: req.body?.kdv_orani,
      aktif: req.body?.aktif,
    });
    // B-H1: plan fiyat/süre değişikliği kalıcı — Supabase'e yansıt.
    await syncPlanUpsert(plan);
    await recordAudit({
      action: "plan_update",
      actor: req.user?.username || "superadmin",
      detail: `Paket güncellendi: ${plan.code} → ${plan.fiyat} ₺ / ${plan.sure_gun} gün`,
    });
    return res.json({ plan });
  } catch (err) {
    const status = err.message === "Paket bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Paket güncellenemedi." });
  }
});

/** Super Admin: tahsilat dökümü. */
app.get("/api/admin/payments", requireSuperAdmin, (req, res) => {
  try {
    return res.json({
      payments: listPayments({
        institution_id: req.query?.institution_id || undefined,
        from: req.query?.from || undefined,
        to: req.query?.to || undefined,
        limit: req.query?.limit,
      }),
      summary: getRevenueSummary(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Tahsilat dökümü alınamadı." });
  }
});

/** Super Admin: elle tahsilat kaydı (KKTC gerçeği: havale / nakit). */
app.post("/api/admin/payments", requireSuperAdmin, async (req, res) => {
  try {
    const payment = createPayment({
      institution_id: req.body?.institution_id,
      plan_code: req.body?.plan_code,
      tutar: req.body?.tutar,
      kdv: req.body?.kdv,
      odeme_tarihi: req.body?.odeme_tarihi,
      donem_baslangic: req.body?.donem_baslangic,
      donem_bitis: req.body?.donem_bitis,
      yontem: req.body?.yontem,
      durum: req.body?.durum,
      fatura_no: req.body?.fatura_no,
      aciklama: req.body?.aciklama,
      olusturan: req.user?.username || "superadmin",
    });
    // B-H1: gelir defteri kalıcı — Supabase'e yansıt.
    const paySynced = await syncPaymentUpsert(payment);
    if (!paySynced) {
      console.error(`[ADMIN] Tahsilat SQLite'a yazıldı ama Supabase sync başarısız: id=${payment.id}`);
    }
    await recordAudit({
      action: "payment_create",
      actor: req.user?.username || "superadmin",
      institution_id: payment.institution_id,
      detail: `Tahsilat kaydedildi: ${payment.tutar} ₺ (${payment.plan_code}), dönem ${payment.donem_baslangic} → ${payment.donem_bitis}`,
    }, { strict: true });
    return res.status(201).json({ payment });
  } catch (err) {
    return res.status(400).json({ error: clientErrorMessage(err, "Tahsilat kaydedilemedi.") });
  }
});

app.delete("/api/admin/payments/:id", requireSuperAdmin, async (req, res) => {
  try {
    const result = deletePayment(req.params.id);
    if (result.payment) await syncPaymentDelete(result.payment);
    await recordAudit({
      action: "payment_delete",
      actor: req.user?.username || "superadmin",
      institution_id: result.payment?.institution_id || null,
      detail: `Tahsilat silindi (id=${req.params.id}, ${result.payment?.tutar} ₺)`,
    }, { strict: true });
    return res.json(result);
  } catch (err) {
    const status = err.message === "Ödeme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Tahsilat silinemedi." });
  }
});

/** Super Admin: vade takvimi — önümüzdeki N günde biten abonelikler. */
app.get("/api/admin/expiring", requireSuperAdmin, (req, res) => {
  try {
    return res.json({ expiring: listExpiringSubscriptions(req.query?.days) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Vade takvimi alınamadı." });
  }
});

/** Super Admin: işletme bazında tıklama (ham oturum listesi yerine toplam). */
app.get("/api/admin/analytics/by-business", requireSuperAdmin, (_req, res) => {
  try {
    return res.json({ businesses: getClicksByBusiness() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Analitik alınamadı." });
  }
});

/** Super Admin: partnerlik başvuruları — form yazıyordu, gören ekran yoktu. */
app.get("/api/admin/partnership-applications", requireSuperAdmin, (req, res) => {
  try {
    return res.json({ applications: listPartnershipApplications(req.query?.limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Başvurular alınamadı." });
  }
});

/** Super Admin: mevcut aboneliklerden geriye dönük tahsilat üret (idempotent). */
app.post("/api/admin/payments/backfill", requireSuperAdmin, async (req, res) => {
  try {
    const result = backfillPaymentsFromSubscriptions(req.user?.username || "superadmin");
    await recordAudit({
      action: "payment_backfill",
      actor: req.user?.username || "superadmin",
      detail: `${result.eklenen} geriye dönük tahsilat kaydı üretildi`,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Geriye dönük üretim başarısız." });
  }
});

/**
 * İşletme: kendi aboneliği + ödeme geçmişi + performansı.
 * "Abonelik Durumu" ekranı bunları hiç göstermiyordu (İ-01 / İ-02 / İ-03).
 */
app.get("/api/business/subscription", requireAuth, (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Yalnızca işletme hesapları." });
    }
    const admin = findAdminByUsername(req.user.username);
    const instId = req.user.institution_id;
    const planCode = planCodeFromSubscriptionType(admin?.subscription_type);
    const plans = listPlans();
    return res.json({
      subscription: {
        institution_id: instId,
        institution_name: req.user.institution_name,
        subscription_type: admin?.subscription_type || "Test",
        plan: plans.find((p) => p.code === planCode) || null,
        subscription_end_date: admin?.subscription_end_date || null,
        days_remaining: admin?.days_remaining != null ? admin.days_remaining : null,
        is_active: !(admin?.is_active === 0 || admin?.is_active === false),
      },
      payments: getPaymentsForInstitution(instId, 50),
      performance: getClicksForInstitution(instId),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Abonelik bilgisi alınamadı." });
  }
});

app.post("/api/partnership-apply", partnershipLimiter, async (req, res) => {
  const { institution_name, contact_person, email, phone, message } = req.body;

  if (!institution_name || !contact_person || !email || !phone) {
    return res.status(400).json({ error: "Tüm alanlar zorunludur." });
  }

  const finalMessage =
    String(message || "").trim() ||
    buildPartnershipDefaultMessage({
      institution_name,
      contact_person,
      email,
      phone,
    });

  try {
    // E-posta gönder → tunahan.guul@gmail.com (email.js PARTNERSHIP_INBOX)
    await sendPartnershipEmail({
      institution_name,
      contact_person,
      email,
      phone,
      message: finalMessage,
    });

    // Veritabanına kaydet (opsiyonel)
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO partnership_applications (institution_name, contact_person, email, phone, message)
        VALUES (?, ?, ?, ?, ?)
      `).run(institution_name, contact_person, email, phone, finalMessage);
      syncPartnershipApplication({
        institution_name,
        contact_person,
        email,
        phone,
        message: finalMessage,
      });
    } catch (dbError) {
      console.warn("[PARTNERSHIP] Veritabanına kaydetme başarısız (e-posta gönderildi):", dbError.message);
    }

    return res.json({
      success: true,
      message: "Başvurunuz başarıyla gönderildi. En kısa sürede size dönüş yapacağız.",
    });
  } catch (error) {
    console.error("[PARTNERSHIP] Başvuru işlemi başarısız:", error.message);
    return res.status(500).json({
      error: "Başvuru gönderilemedi. Lütfen daha sonra tekrar deneyin.",
    });
  }
});

/**
 * ✅ ADIM 3: Geçmiş kur verilerini döndür
 * Query: ?period=Günlük&currency=USD
 * Period: 'Günlük', 'Haftalık', 'Aylık'
 */
app.get("/api/historical-rates", async (req, res) => {
  try {
    const { period = "Günlük", currency = "USD" } = req.query;

    if (!["Saatlik", "Günlük", "Haftalık", "Aylık", "Yıllık"].includes(period)) {
      return res.status(400).json({
        error: "Geçersiz periyod. 'Saatlik', 'Günlük', 'Haftalık', 'Aylık', 'Yıllık' olabilir.",
      });
    }

    if (!["USD", "EUR", "GBP"].includes(currency)) {
      return res.status(400).json({ error: "Geçersiz para birimi. 'USD', 'EUR', 'GBP' olabilir." });
    }

    // B-M3: normal render periyodun `fetchHours` derinliğiyle sınırlıdır; derin
    // arşiv yalnızca açık ?from=&to= ile gelir (sol ok navigasyonu).
    const fromParam = req.query.from ? String(req.query.from) : null;
    const toParam = req.query.to ? String(req.query.to) : null;
    const rangeOpts = {};
    if (fromParam && !Number.isNaN(Date.parse(fromParam))) rangeOpts.from = fromParam;
    if (toParam && !Number.isNaN(Date.parse(toParam))) rangeOpts.to = toParam;

    // Kalıcı kaynak: Supabase. Boş/hatalıysa SQLite yedek (lokal + geçici outage).
    let result;
    try {
      result = await getMarketHistoricalRates(period, currency, rangeOpts);
    } catch (supabaseErr) {
      console.warn("[HISTORICAL] Supabase hata, SQLite yedek:", supabaseErr.message);
      result = null;
    }

    if (!result || !result.rows || result.rows.length === 0) {
      try {
        const sqliteFallback = getHistoricalRates(period, currency);
        const rows = Array.isArray(sqliteFallback?.rows) ? sqliteFallback.rows : [];
        if (rows.length > 0) {
          console.log(
            `[HISTORICAL] ${period}/${currency}: Supabase boş — SQLite yedek ${rows.length} satır`
          );
          return res.json({
            period,
            currency,
            count: rows.length,
            rates: rows,
            exactPercentageChange: sqliteFallback.exactPercentageChange ?? 0,
            meta: {
              isLimitedByAvailableData: sqliteFallback.isLimitedByAvailableData ?? true,
              actualSpanDays: sqliteFallback.actualSpanDays ?? 0,
              requestedSpanDays: sqliteFallback.requestedSpanDays ?? 1,
              source: "sqlite-fallback",
            },
          });
        }
      } catch (sqliteErr) {
        console.warn("[HISTORICAL] SQLite yedek de başarısız:", sqliteErr.message);
      }
    }

    if (!result) {
      return res.status(500).json({ error: "Geçmiş veriler alınamadı." });
    }

    if (result.rows.length === 0) {
      console.log(`[HISTORICAL] ${period} / ${currency}: Supabase'de veri yok.`);
    }

    return res.json({
      period,
      currency,
      count: result.rows.length,
      rates: result.rows,
      exactPercentageChange: result.exactPercentageChange,
      message:
        result.rows.length === 0
          ? "Henüz yeterli veri biriktirilmemiş. Sistem kurlarını otomatik olarak kaydeder."
          : undefined,
      meta: {
        isLimitedByAvailableData: result.isLimitedByAvailableData,
        actualSpanDays: result.actualSpanDays,
        requestedSpanDays: result.requestedSpanDays,
        source: "supabase",
      },
    });
  } catch (error) {
    console.error("[HISTORICAL] Endpoint hatası:", error.message);
    return res.status(500).json({ error: "Geçmiş veriler alınamadı." });
  }
});

/**
 * ✅ İŞLETME DETAY GRAFİĞİ — İZOLE ENDPOINT
 * Query: ?institution_id=akbank&period=Saatlik&currency=USD
 *
 * Bu endpoint SADECE BusinessDetailModal (işletme detay grafiği) tarafından kullanılır.
 * Nihai Kur = İlgili Tarihteki MB Kuru + İlgili Tarihteki İşletme Kâr Marjı formülüyle
 * ÖNCEDEN HESAPLANMIŞ veri döner. Global "Piyasa Özeti" grafikleri hâlâ sadece
 * /api/historical-rates uçunu (saf MB kurları) kullanır ve bu endpoint'ten
 * KESİNLİKLE ETKİLENMEZ — veri kaynakları ve hesaplama mantığı tamamen izoledir.
 */
app.get("/api/business-rate-history", async (req, res) => {
  try {
    const { institution_id, period = "Günlük", currency = "USD" } = req.query;

    if (!institution_id || typeof institution_id !== "string" || !institution_id.trim()) {
      return res.status(400).json({ error: "institution_id zorunludur." });
    }
    if (!["Saatlik", "Günlük", "Haftalık", "Aylık", "Yıllık"].includes(period)) {
      return res.status(400).json({ error: "Geçersiz periyod." });
    }
    if (!["USD", "EUR", "GBP"].includes(currency)) {
      return res.status(400).json({ error: "Geçersiz para birimi." });
    }

    const institutionId = institution_id.trim().toLowerCase();

    // Katalog işletmeler: tam MB geçmişi + marj.
    // Super Admin'den yeni eklenen işletmeler: created_at'ten itibaren birikir.
    const rawInception = getInstitutionCreatedAtMs(institutionId);
    const isCatalog = !!findInstitutionById(institutionId);
    const inceptionMs = isCatalog ? 0 : rawInception || 0;

    // Marj geçmişi: önce Supabase, yoksa SQLite
    let buyHistory = await fetchMarginHistory(institutionId, currency, "buy");
    let sellHistory = await fetchMarginHistory(institutionId, currency, "sell");
    if (!buyHistory.length) {
      buyHistory = getMarginHistoryForInstitution(institutionId, currency, "buy");
    }
    if (!sellHistory.length) {
      sellHistory = getMarginHistoryForInstitution(institutionId, currency, "sell");
    }

    // Güncel marj: SQLite; yoksa Supabase rate_adjustments
    let currentAdjustments = getAdjustmentsForInstitution(institutionId);
    const hasLocalMargin =
      currentAdjustments[`${currency}_buy`] || currentAdjustments[`${currency}_sell`];
    if (!hasLocalMargin) {
      try {
        const { supabase } = require("./config/supabaseClient");
        const { data: remoteAdj } = await supabase
          .from("rate_adjustments")
          .select("currency, type, margin_type, margin_value")
          .eq("institution_id", institutionId)
          .eq("currency", currency);
        for (const row of remoteAdj || []) {
          currentAdjustments[`${row.currency}_${row.type}`] = {
            margin_type: row.margin_type || "fixed",
            margin_value: Number(row.margin_value) || 0,
          };
        }
      } catch (err) {
        console.warn("[BUSINESS-RATE-HISTORY] remote margin:", err.message);
      }
    }

    // Nihai Kur = MB Kuru + Kâr Marjı (geçmiş basamak + güncel marj)
    const result = await getSupabaseBusinessRateHistory(
      institutionId,
      currency,
      period,
      {
        inceptionMs: inceptionMs || 0,
        buyHistory,
        sellHistory,
        currentBuyAdj: currentAdjustments[`${currency}_buy`] || {
          margin_type: "fixed",
          margin_value: 0,
        },
        currentSellAdj: currentAdjustments[`${currency}_sell`] || {
          margin_type: "fixed",
          margin_value: 0,
        },
      }
    );

    const rates = result.rows || [];

    return res.json({
      institution_id: institutionId,
      period,
      currency,
      count: rates.length,
      // Frontend BusinessDetailModal `rates` bekler
      rates,
      rows: rates,
      message:
        rates.length === 0
          ? "Bu işletme için henüz yeterli veri birikmemiş. Kurlar kaydedildikçe grafik oluşacaktır."
          : undefined,
      meta: {
        hasAnyData: rates.length > 0,
        requestedSpanDays: result.requestedSpanDays,
        inceptionMs: inceptionMs || null,
        source: "supabase",
      },
    });
  } catch (error) {
    console.error("[BUSINESS-RATE-HISTORY] Endpoint hatası:", error.message);
    return res.status(500).json({ error: "İşletme grafik verisi alınamadı." });
  }
});

/**
 * ✅ TEK SEFERLİK VERİ AKTARIM ENDPOINT'İ (Super Admin)
 * Eski/kullanılmayan Render servisinde (LEGACY_API_BASE) biriken çok yıllık
 * MB kur geçmişini ve işletme kâr marjlarını, bu servisin (ephemeral disk
 * nedeniyle her deploy'da sıfırlanan) veritabanına aktarır.
 * idempotent'tir — birden fazla kez çalıştırılması veri tekrarına yol açmaz.
 */
app.post("/api/admin/migrate-legacy-data", requireSuperAdmin, async (req, res) => {
  const LEGACY_API_BASE = "https://adadoviz-api.onrender.com";
  const summary = { historicalRates: {}, margins: 0, errors: [] };

  try {
    for (const currency of ["USD", "EUR", "GBP"]) {
      try {
        const response = await axios.get(`${LEGACY_API_BASE}/api/historical-rates`, {
          params: { period: "Yıllık", currency },
          timeout: 20000,
        });
        const rows = Array.isArray(response.data?.rates) ? response.data.rates : [];
        const result = bulkInsertHistoricalRates(currency, rows);
        // B-H2: SQLite ephemeral — arşivi Supabase'e de yaz (kalıcı).
        let supa = { attempted: 0, inserted: 0 };
        try {
          supa = await bulkInsertSupabaseHistoricalRates(
            rows.map((r) => ({
              currency,
              buy_rate: r.buy_rate,
              sell_rate: r.sell_rate,
              recorded_at: r.recorded_at,
            }))
          );
        } catch (supaErr) {
          summary.errors.push(`${currency} (supabase): ${supaErr.message}`);
        }
        summary.historicalRates[currency] = { fetched: rows.length, ...result, supabase: supa };
      } catch (err) {
        summary.errors.push(`${currency}: ${err.message}`);
      }
    }

    try {
      const marginsRes = await axios.get(`${LEGACY_API_BASE}/api/margins`, { timeout: 20000 });
      const margins = marginsRes.data?.margins || {};
      for (const [institutionId, adjustments] of Object.entries(margins)) {
        try {
          upsertAdjustments(institutionId, adjustments);
          await syncRateAdjustmentsMap(institutionId, adjustments);
          summary.margins += 1;
        } catch (err) {
          summary.errors.push(`margins/${institutionId}: ${err.message}`);
        }
      }
    } catch (err) {
      summary.errors.push(`margins: ${err.message}`);
    }

    return res.json({ success: true, summary });
  } catch (error) {
    console.error("[MIGRATE-LEGACY-DATA] Hata:", error.message);
    return res.status(500).json({ error: "Veri aktarımı başarısız." });
  }
});

/**
 * ✅ ADIM 1: Kur verilerinde değişim var mı kontrol et ve broadcast yap
 */
function touchRatesChangedAt(reason = "update") {
  const at = new Date().toISOString();
  cachedRates = {
    ...cachedRates,
    ratesChangedAt: at,
    updatedAt: at,
  };
  const message = {
    type: "data_changed",
    ratesChangedAt: at,
    reason,
  };
  sseClients.forEach((client) => {
    try {
      client.res.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch (err) {
      console.warn(`[SSE] data_changed yazma hatası: ${err.message}`);
    }
  });
  console.log(`[RATES] Son değişim damgası güncellendi (${reason}): ${at}`);
  return at;
}

/**
 * B-H3: Değişim tespiti artık TÜM nesneyi JSON.stringify ile karşılaştırmıyor
 * (efektif alanları / obje şekli farkı her boot'ta "değişti" sanıyordu). Yalnızca
 * alış/satış değerleri 4 ondalıkta karşılaştırılır ve `previousRates` bu sade
 * biçimde (kalıcı depo ile aynı şekil) tutulur.
 */
function normalizeRatePairs(rates) {
  const out = {};
  for (const cur of ["USD", "EUR", "GBP"]) {
    const r = rates?.[cur];
    if (!r) continue;
    out[cur] = { buy: Number(r.buy), sell: Number(r.sell) };
  }
  return out;
}
function ratesMateriallyChanged(newRates, prevPairs) {
  if (!prevPairs || Object.keys(prevPairs).length === 0) return true;
  const fx = (n) => Number(n).toFixed(4);
  for (const cur of ["USD", "EUR", "GBP"]) {
    const a = newRates?.[cur];
    const b = prevPairs?.[cur];
    if (!a || !b) return true;
    if (fx(a.buy) !== fx(b.buy) || fx(a.sell) !== fx(b.sell)) return true;
  }
  return false;
}

/**
 * S-M3 / B-M5: Mantık bandı kontrolü — yeni bültenin USD orta kuru son kabul
 * edilen değerden %`RATE_SANITY_BAND` üzerinde saparsa bülten REDDEDİLİR
 * (MITM sahte kur enjeksiyonuna karşı). İlk bültende (prev yok) geçer.
 */
const RATE_SANITY_BAND = Number(process.env.RATE_SANITY_BAND || 0.15);
function passesSanityBand(newRates, prevPairs) {
  const prevUsd = prevPairs?.USD;
  const newUsd = newRates?.USD;
  if (!prevUsd || !newUsd) return { ok: true };
  const prevMid = (Number(prevUsd.buy) + Number(prevUsd.sell)) / 2;
  const newMid = (Number(newUsd.buy) + Number(newUsd.sell)) / 2;
  if (!(prevMid > 0) || !(newMid > 0)) return { ok: true };
  const drift = Math.abs(newMid - prevMid) / prevMid;
  if (drift > RATE_SANITY_BAND) {
    return {
      ok: false,
      reason: `USD orta kuru %${(drift * 100).toFixed(1)} saptı (eşik %${(RATE_SANITY_BAND * 100).toFixed(0)}): ${prevMid.toFixed(4)} → ${newMid.toFixed(4)}`,
    };
  }
  return { ok: true };
}

function broadcastRateChange(newRates) {
  console.log("[SSE] ✅ Kur değişikliği yayınlanıyor...");
  const at = touchRatesChangedAt("central_bank");
  const message = {
    type: "rate_update",
    rates: newRates,
    timestamp: at,
    ratesChangedAt: at,
  };
  sseClients.forEach((client) => {
    try {
      client.res.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch (err) {
      console.warn(`[SSE] İstemciye yazma hatası: ${err.message}`);
    }
  });
}

/**
 * ✅ SADELEŞTIRILMIŞ: Merkez Bankası XML Kurlarının Değişim Kontrolü
 * 
 * Artık sadece Merkez Bankası XML verilerine dayanıyor.
 * Banka scraping ve faiz/kredi API'leri tamamen kaldırıldı.
 */
async function refreshRatesCacheWithChangeDetection() {
  try {
    ratesHealth.lastAttemptAt = new Date().toISOString();
    // Sadece Merkez Bankası kurlarını çek
    const central = await getCentralBankRates();
    const newCentralRates = central.rates || null;

    // ✅ KRİTİK GÜVENLİK: Kaynak erişilemezse bu döngüde hiçbir şey kaydetme /
    // broadcast etme. ratesService artık sahte (mock) kur ÜRETMİYOR (bkz. K-03);
    // hata durumunda { source: "error", rates: null } döner ve son geçerli cache korunur.
    if (central.source === "error" || central.error || !newCentralRates) {
      ratesHealth.lastErrorAt = new Date().toISOString();
      ratesHealth.lastError = central.error || "kaynak erişilemedi";
      ratesHealth.source = central.source || "error";
      console.warn(`[REFRESH] ⚠️  KKTC Merkez Bankası kaynağı geçici olarak erişilemedi (${central.error || "bilinmeyen"}). Bu döngüde kayıt/broadcast YAPILMIYOR.`);
      return;
    }
    // S-M3 / B-M5: Mantık bandı — sapkın bülten (muhtemel MITM) reddedilir,
    // kayıt/broadcast/cache güncellemesi YAPILMAZ, son geçerli cache korunur.
    const sanity = passesSanityBand(newCentralRates, previousRates);
    if (!sanity.ok) {
      ratesHealth.lastErrorAt = new Date().toISOString();
      ratesHealth.lastError = `mantık bandı reddi: ${sanity.reason}`;
      ratesHealth.source = "sanity_rejected";
      console.error(
        `[REFRESH] ⛔ Bülten mantık bandı DIŞINDA — reddedildi. ${sanity.reason}`
      );
      return;
    }

    ratesHealth.lastOkAt = new Date().toISOString();
    ratesHealth.lastError = null;
    ratesHealth.source = central.source;
    ratesHealth.sourceName = central.sourceName || "KKTC Merkez Bankası";
    ratesHealth.bulletinNo = central.bulletinNo || null;
    ratesHealth.validRange = central.validRange || null;

    // B-H3: değişim tespiti sade alış/satış deltası üzerinden; previousRates
    // boot'ta Supabase'ten tohumlandığı için soğuk başlangıç artık "değişti" sayılmaz.
    const ratesChanged = ratesMateriallyChanged(newCentralRates, previousRates);

    if (ratesChanged) {
      console.log("[REFRESH] ✅ Merkez Bankası kurlarında DEĞIŞIM TESPIT EDİLDİ!");

      // Impr-3 / B-H3: her iki depoya AYNI olay için AYNI UTC ISO damgası.
      // Damga bültenin kendi tarihine sabitlenir (redeploy'lar aynı bülteni
      // tekrar yazmaya çalışırsa unique index sessizce atar).
      const recordedAt = central.updatedAt || central.fetchedAt || new Date().toISOString();

      const historicalData = [];
      for (const [currency, data] of Object.entries(newCentralRates)) {
        if (data.buy && data.sell) {
          historicalData.push({
            currency,
            buy_rate: data.buy,
            sell_rate: data.sell,
          });
        }
      }
      if (historicalData.length > 0) {
        recordHistoricalRates(historicalData, recordedAt);
        for (const data of historicalData) {
          try {
            await insertHistoricalRate(data.currency, data.buy_rate, data.sell_rate, recordedAt);
          } catch (err) {
            console.error(`[SUPABASE] Kur kaydetme hatası (${data.currency}):`, err.message);
          }
        }
        console.log(`[HISTORICAL] ${historicalData.length} kur kaydedildi @ ${recordedAt} (SQLite + Supabase).`);
      }

      previousRates = normalizeRatePairs(newCentralRates);
      broadcastRateChange(newCentralRates);
    } else {
      console.log("[REFRESH] Merkez Bankası kurlarında değişim yok.");
    }

    // Merkez Bankası kurlarını kullanarak banka snapshot'ları oluştur
    const banks = buildBanksFromCentralRates(newCentralRates);
    const fetchedAt = new Date().toISOString();

    // Cache güncelle — ratesChangedAt yalnızca gerçek değişimde (broadcast/touch) ilerler
    cachedRates = {
      updatedAt: fetchedAt,
      ratesChangedAt: cachedRates.ratesChangedAt || fetchedAt,
      totalBanks: banks.length,
      banks: banks,
      centralBankUpdatedAt: central.updatedAt || central.fetchedAt || null,
      centralBankXmlDate: central.xmlDate || central.bulletinDate || null,
      centralBankBulletinNo: central.bulletinNo || null,
      centralBankValidRange: central.validRange || null,
      centralBankSourceName: central.sourceName || "KKTC Merkez Bankası",
      centralBankRates: newCentralRates,
    };

    console.log(`[SCRAPER] ✅ Cache güncellendi — totalBanks=${cachedRates.totalBanks}, MB=${cachedRates.centralBankUpdatedAt}, changedAt=${cachedRates.ratesChangedAt}`);
  } catch (error) {
    ratesHealth.lastErrorAt = new Date().toISOString();
    ratesHealth.lastError = error.message;
    ratesHealth.source = "error";
    console.error("[SCRAPER] ❌ Refresh başarısız:", error.message);
    cachedRates = {
      ...emptyPayloadForServerError(),
      centralBankUpdatedAt: cachedRates.centralBankUpdatedAt,
      centralBankXmlDate: cachedRates.centralBankXmlDate,
      centralBankRates: cachedRates.centralBankRates,
    };
    console.log("[SCRAPER] 📦 Fallback verisi yüklendi (varsayılan oranlar)");
  }
}

/**
 * Açılış durumu — /api/health bunu yayınlar.
 * ⚠️ Y-02: Önceden app.listen() Supabase kontrol+hydrate adımlarının ARDINDAN
 * çağrılıyordu; Supabase erişilemezse sunucu ~2 dk 12 sn boyunca /api/health
 * dahil HİÇBİR isteğe cevap vermiyordu ve Render health check'i deploy'u
 * başarısız sayabiliyordu. Artık önce dinlemeye başlıyoruz, ağır işler arkada.
 */
let bootState = {
  listening: false,
  schemaReady: false,
  supabase: "pending",
  hydrate: "pending",
  ratesPrimed: false,
  startedAt: new Date().toISOString(),
  finishedAt: null,
};

/** Tüm hydrate apply fonksiyonları — hem boot hem /api/admin/rehydrate kullanır. */
const HYDRATE_APPLY_FNS = {
  upsertInstitutionRow: applySupabaseInstitutionRow,
  upsertAdjustmentRow: applySupabaseAdjustmentRow,
  upsertBranchRow: applySupabaseBranchRow,
  upsertBranchRequestRow: applySupabaseBranchRequestRow,
  upsertAuditRow: applySupabaseAuditRow,
  upsertMarginHistoryRow: applySupabaseMarginHistoryRow,
  applyHistoricalRatesRows: applySupabaseHistoricalRatesRows,
  upsertPlanRow: applySupabasePlanRow,
  upsertPaymentRow: applySupabasePaymentRow,
  replaceAllBranches: replaceBusinessBranchesFromSupabase,
};

async function runHydrateOnce() {
  const result = await hydrateAdminDataFromSupabase(HYDRATE_APPLY_FNS);
  purgeOrphanBranches();
  return result;
}

/**
 * B-M1: Supabase boot'ta erişilemezse pano süresiz boş kalıyordu. Hydrate en az
 * BİR KEZ başarılı olana dek artan gecikmeyle (max ~5 dk) yeniden dener.
 */
let hydrateRetryActive = false;
async function hydrateWithRetry() {
  if (hydrateRetryActive) return;
  hydrateRetryActive = true;
  const delays = [5000, 15000, 30000, 60000, 120000, 300000];
  let attempt = 0;
  try {
    while (true) {
      try {
        const r = await runHydrateOnce();
        if (r.ok) {
          bootState.hydrate = "ok";
          console.log(
            `[BOOT] Hydrate başarılı (deneme ${attempt + 1}) — institutions=${r.institutions}, ` +
              `marginHistory=${r.marginHistory}, historicalRates=${r.historicalRates}, payments=${r.payments}.`
          );
          // B-H3: previousRates'i taze hydrate edilmiş SQLite'tan da tazele.
          seedPreviousRatesFromDisk();
          return r;
        }
        bootState.hydrate = "failed";
        console.warn(`[BOOT] Hydrate ok=false (deneme ${attempt + 1}) — yeniden denenecek.`);
      } catch (err) {
        bootState.hydrate = "failed";
        console.warn(`[BOOT] Hydrate hatası (deneme ${attempt + 1}): ${err.message}`);
      }
      const wait = delays[Math.min(attempt, delays.length - 1)];
      attempt += 1;
      await new Promise((r) => setTimeout(r, wait));
    }
  } finally {
    hydrateRetryActive = false;
  }
}

/**
 * S-C3: RLS self-check. Anon/publishable anahtarla institutions okunabiliyorsa
 * RLS kilidi uygulanmamış demektir — CRITICAL logla ve (ALLOW_OPEN_RLS=1 yoksa)
 * süreci sonlandır.
 */
async function supabaseRlsSelfCheck() {
  const key = String(process.env.SUPABASE_KEY || "");
  const looksNonService =
    key.startsWith("sb_publishable_") || /anon|publishable/i.test(key);

  if (looksNonService) {
    console.error(
      "[SECURITY][CRITICAL] SUPABASE_KEY publishable/anon görünüyor. Backend service_role " +
        "anahtarı kullanmalı; aksi halde RLS bypass edilemez ve veri dünyaya açık olabilir."
    );
    if (process.env.ALLOW_INSECURE_SUPABASE_KEY !== "1") {
      console.error("[SECURITY][CRITICAL] Başlatma reddedildi. (Geçici bypass: ALLOW_INSECURE_SUPABASE_KEY=1)");
      process.exit(1);
    }
  }

  const anonKey = process.env.SUPABASE_ANON_KEY || (looksNonService ? key : null);
  if (!anonKey || !process.env.SUPABASE_URL) {
    console.log("[SECURITY] RLS self-check atlandı (probe için anon anahtar yok).");
    return;
  }
  try {
    const { createClient } = require("@supabase/supabase-js");
    const probe = createClient(process.env.SUPABASE_URL, anonKey);
    const { data, error } = await probe
      .from("institutions")
      .select("institution_id")
      .limit(1);
    if (!error && Array.isArray(data) && data.length > 0) {
      console.error(
        "[SECURITY][CRITICAL] Anon/publishable anahtarla institutions OKUNABİLİYOR — " +
          "RLS kilidi UYGULANMAMIŞ. backend/supabase_rls_lockdown.sql çalıştırın."
      );
      if (process.env.ALLOW_OPEN_RLS !== "1") {
        console.error("[SECURITY][CRITICAL] Başlatma reddedildi. (Geçici bypass: ALLOW_OPEN_RLS=1)");
        process.exit(1);
      }
    } else {
      console.log("[SECURITY] ✅ Supabase RLS self-check OK (anon institutions okuması engelli).");
    }
  } catch (err) {
    console.warn("[SECURITY] RLS self-check çalıştırılamadı:", err.message);
  }
}

/** Supabase hydrate + seed — app.listen() sonrası arka planda çalışır. */
async function bootstrapPersistence() {
  try {
    await supabaseRlsSelfCheck();

    const supabaseState = await checkSupabaseHasInstitutions();
    const isFreshInstall = supabaseState.ok && !supabaseState.hasInstitutions;
    bootState.supabase = supabaseState.ok ? "ok" : "unreachable";

    if (isFreshInstall) {
      console.log("[BOOT] Supabase'te kurum bulunamadı — gerçek ilk kurulum, katalog seed'i çalıştırılıyor.");
      seedAdminsIfNeeded();
      seedCatalogInstitutionsIfNeeded();
      seedAdjustmentsIfNeeded();
    } else if (!supabaseState.ok) {
      console.warn(
        "[BOOT] ⚠️ Supabase'e ulaşılamadı — güvenlik için katalog seed'i ATLANDI (mevcut kalıcı veri korunur)."
      );
    } else {
      console.log(`[BOOT] Supabase'te ${supabaseState.count} kurum bulundu — seed atlanıyor, SoT=Supabase.`);
    }

    let hydrateResult = { ok: false, institutions: 0, adjustments: 0, branches: 0 };
    try {
      hydrateResult = await runHydrateOnce();
      bootState.hydrate = hydrateResult.ok ? "ok" : "failed";
    } catch (err) {
      bootState.hydrate = "failed";
      console.warn("[SUPABASE-SYNC] Hydrate hatası:", err.message);
    }
    // B-M1: ilk hydrate başarısızsa arka planda backoff'lu yeniden dene.
    if (!hydrateResult.ok && !isFreshInstall) {
      hydrateWithRetry();
    }

    // Bootstrap (SQLite → Supabase) SADECE Supabase tamamen boşken (ilk kurulum).
    // Hydrate başarılı olsa bile geri yazma YOK — aksi halde SoT ihlali.
    if (isFreshInstall) {
      try {
        await bootstrapAdminDataToSupabase({
          institutions: listAllInstitutionsForSync(),
          branches: listAllBranchesForSync(),
          adjustments: listAllAdjustmentsForSync(),
          branchRequests: listAllBranchRequestsForSync(),
          plans: listPlans(),
          payments: listAllPaymentsForSync(),
        });
      } catch (err) {
        console.warn("[SUPABASE-SYNC] Bootstrap hatası:", err.message);
      }
    } else {
      console.log(
        `[SUPABASE-SYNC] Bootstrap ATLANDI — SoT=Supabase (hydrate ok=${hydrateResult.ok}, institutions=${hydrateResult.institutions}).`
      );
    }
  } catch (err) {
    bootState.supabase = "failed";
    console.warn("[BOOT] Kalıcılık hazırlığı başarısız:", err.message);
  } finally {
    bootState.finishedAt = new Date().toISOString();
    console.log(
      `[BOOT] ✅ Hazırlık tamamlandı (supabase=${bootState.supabase}, hydrate=${bootState.hydrate}).`
    );
  }
}

/** B-H3: previousRates'i SQLite historical_rates anlık görüntüsünden tohumla. */
function seedPreviousRatesFromDisk() {
  try {
    const restored = getLatestHistoricalRatesSnapshot();
    if (restored?.rates && Object.keys(restored.rates).length > 0) {
      previousRates = restored.rates;
      if (!cachedRates.ratesChangedAt) cachedRates.ratesChangedAt = restored.recordedAt || null;
      return true;
    }
  } catch (err) {
    console.warn("[BOOT] previousRates disk tohumu başarısız:", err.message);
  }
  return false;
}

/** B-H3: previousRates'i Supabase'in son kur satırlarından tohumla (birincil). */
async function seedPreviousRatesFromSupabase() {
  try {
    const snap = await getLatestSupabaseRatesSnapshot();
    if (snap?.rates && Object.keys(snap.rates).length > 0) {
      previousRates = snap.rates;
      if (snap.recordedAt) cachedRates.ratesChangedAt = snap.recordedAt;
      console.log(
        `[BOOT] previousRates Supabase'ten tohumlandı (${Object.keys(snap.rates).join(", ")} @ ${snap.recordedAt}).`
      );
      return true;
    }
  } catch (err) {
    console.warn("[BOOT] previousRates Supabase tohumu başarısız:", err.message);
  }
  return false;
}

async function startServer() {
  logMailConfigOnBoot();

  // Şema kurulumu senkron ve hızlı — dinlemeden önce yapılmalı.
  // Katalog/işletme seed'i ERTELENİR: Supabase'te veri varsa seed çalışmamalı.
  initDb({ skipBusinessSeed: true });
  bootState.schemaReady = true;

  // Y-05 / B-H3: Değişim tespiti için son bilinen kurları DİSKTEN yükle (fallback).
  seedPreviousRatesFromDisk();

  // ✅ Y-02: ÖNCE dinlemeye başla — health check ve public uçlar hemen ayakta.
  app.listen(PORT, () => {
    bootState.listening = true;
    console.log(`Backend API is running on http://localhost:${PORT}`);
    console.log("Rates endpoint: GET /api/kurlar");
    console.log("Auth endpoint: POST /api/auth/login");
    console.log("SSE Stream: GET /api/rates-stream");
  });

  // Ağır işler arka planda; istekleri bloklamıyor.
  bootstrapPersistence();

  // B-H3: ilk refresh'ten ÖNCE previousRates'i Supabase'ten tohumla — SQLite
  // Render'da boş olduğu için soğuk başlangıç sahte "kur değişti" sanılıyordu.
  await seedPreviousRatesFromSupabase();

  await refreshRatesCacheWithChangeDetection();
  bootState.ratesPrimed = Boolean(cachedRates.centralBankRates);
  console.log(`[BOOT] İlk kur yüklemesi: totalBanks=${cachedRates.totalBanks}`);

  /** KKTC MB bülteni gün içinde nadiren değişir; 60 sn yeterli ve kaynağa nazik. */
  const REFRESH_INTERVAL_MS = 60000;
  setInterval(async () => {
    await refreshRatesCacheWithChangeDetection();
  }, REFRESH_INTERVAL_MS);

  console.log(`[SCHEDULER] ✅ KKTC Merkez Bankası bülten takibi başlatıldı (${REFRESH_INTERVAL_MS / 1000}s aralık)`);
}

/**
 * Impr-1: Yakalanmamış hata / reddedilmiş promise'ler için üst seviye handler.
 * `safe()` dışında kalan bir dual-write yolu ileride bunu sızdırırsa süreç
 * sessizce ölmesin / asılı kalmasın.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[PROCESS] unhandledRejection:", reason instanceof Error ? reason.stack : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[PROCESS] uncaughtException:", err?.stack || err);
  // Bilinmeyen bir durumda çalışmaya devam etmek riskli — temiz çık, Render yeniden başlatır.
  process.exit(1);
});

startServer();
