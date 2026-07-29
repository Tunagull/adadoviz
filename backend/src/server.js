require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const xml2js = require("xml2js");
const https = require("https");
const { buildBanksFromCentralRates, emptyPayloadForServerError, BANK_DEFINITIONS } = require("./scraper");
const {
  initDb,
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
  getAdjustmentsForInstitution,
  getAllAdjustmentsMap,
  upsertAdjustments,
  recordHistoricalRates,
  getBusinessRateHistory,
  bulkInsertHistoricalRates,
  getHistoricalRates,
  getHistoricalRatesCount,
  listPublicBranches,
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
} = require("./db");
const { signToken, requireAuth, requireSuperAdmin } = require("./auth");
const { findInstitutionByName, findInstitutionById, CURRENCIES } = require("./institutions");
const { applyAdjustmentsToBanksPayload, applyMarginToValue } = require("./rateMath");
const { getRates: getCentralBankRates } = require("./services/ratesService");
const { sendPartnershipEmail, sendPasswordResetEmail } = require("./email");
const crypto = require("crypto");
const {
  insertHistoricalRate,
  getMarketHistoricalRates,
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
  syncPasswordReset,
  syncVisitorSession,
  syncSiteStats,
  hydrateAdminDataFromSupabase,
  bootstrapAdminDataToSupabase,
} = require("./config/supabaseSync");

const app = express();
const PORT = process.env.PORT || 5000;

/** Scrape edilmiş ham KUR verisi (marj uygulanmadan önce). */
let cachedRates = {
  updatedAt: null,
  totalBanks: 0,
  banks: [],
  centralBankUpdatedAt: null,
  centralBankRates: null,
  centralBankXmlDate: null,
};

/** ✅ ADIM 1: SSE istemcilerini yönet */
const sseClients = [];

/** ✅ ADIM 1: Bir önceki kurları hafızada tut (değişim tespiti için) */
let previousRates = null;

app.use(cors({ origin: "*" }));
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
  res.json({ status: "ok" });
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
  res.setHeader("Access-Control-Allow-Origin", "*");

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

app.get("/api/kurlar", (_req, res) => {
  try {
    // MERKEZ BANKASI kurlarını base olarak kullan
    if (!cachedRates.centralBankRates || Object.keys(cachedRates.centralBankRates).length === 0) {
      console.warn("[KURLAR] Merkez Bankası kurları hazır değil");
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
     * Tek kaynak: Super Admin'deki aktif işletmeler.
     * Kart kuru = Merkez Bankası kuru + o işletmenin kâr marjı (fixed/percent).
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
          rates[currency] = {
            buy: applyMarginToValue(kur?.buy, buyAdj.margin_value, buyAdj.margin_type),
            sell: applyMarginToValue(kur?.sell, sellAdj.margin_value, sellAdj.margin_type),
          };
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
          logo_url: biz.logo_url || null,
          is_active: true,
        };
      });

    res.json({
      updatedAt: cachedRates.centralBankUpdatedAt || new Date().toISOString(),
      totalBanks: banks.length,
      banks,
      centralBankUpdatedAt: cachedRates.centralBankUpdatedAt,
      centralBankXmlDate: cachedRates.centralBankXmlDate,
      rawCentralBankRates: cachedRates.centralBankRates,
    });
  } catch (error) {
    console.error("[KURLAR] Endpoint hata:", error.message, error.stack);
    res.status(500).json({
      success: false,
      error: "Kurlar alınamadı.",
      details: error.message,
    });
  }
});

/**
 * Public endpoint: Tüm bankaların margin ayarlarını döndür
 * Frontend'de dinamik hesaplama için gerekli
 */
app.get("/api/margins", (_req, res) => {
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

app.get("/api/kktc-kurlar", async (_req, res) => {
  try {
    const xmlUrl = "https://mb.gov.ct.tr/kur/gunluk.xml";
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    
    const response = await axios.get(xmlUrl, {
      timeout: 10000,
      httpsAgent,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const xmlData = response.data;

    const parser = new xml2js.Parser();
    const jsonData = await parser.parseStringPromise(xmlData);

    const root = jsonData.KKTCMB_Doviz_Kurlari || {};
    const tarih = root.Kur_Tarihi?.[0] || null;

    const kurArray = [];
    const currencySymbols = ["USD", "EUR", "GBP"];
    const resmiKurlar = root.Resmi_Kurlar?.[0]?.Resmi_Kur || [];

    for (const kur of resmiKurlar) {
      const sembol = kur.Sembol?.[0];
      if (currencySymbols.includes(sembol)) {
        const alis = Number(kur.Doviz_Alis?.[0]);
        const satis = Number(kur.Doviz_Satis?.[0]);
        
        // Efektif kurları DOĞRUDAN oku - fallback YOK
        const efektif_alis = parseFloat(kur.Efektif_Alis?.[0]?.toString().replace(',', '.')) || 0;
        const efektif_satis = parseFloat(kur.Efektif_Satis?.[0]?.toString().replace(',', '.')) || 0;
        
        if (Number.isFinite(alis) && Number.isFinite(satis)) {
          kurArray.push({
            sembol,
            alis,
            satis,
            efektif_alis,
            efektif_satis,
          });
          console.log(`[KKTC-KURLAR] ${sembol}: alis=${alis}, satis=${satis}, efektif_alis=${efektif_alis}, efektif_satis=${efektif_satis}`);
        }
      }
    }

    console.log(`[KKTC-KURLAR] ${kurArray.length} kur başarıyla parse edildi (Tarih: ${tarih})`);

    return res.json({
      success: true,
      tarih,
      kurlar: kurArray,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[KKTC-KURLAR] Parse başarısız:", error.message);
    return res.status(500).json({
      success: false,
      error: "KKTC kurları alınamadı.",
      message: error.message,
    });
  }
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!username || !password) {
    return res.status(400).json({ error: "Kullanıcı adı ve şifre zorunludur." });
  }

  console.log(`[AUTH] Login attempt: ${username}`);
  const admin = findAdminByUsername(username);
  console.log(`[AUTH] User found: ${!!admin}`);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: "Geçersiz kullanıcı adı veya şifre." });
  }

  const role = admin.role || "business";
  const isActive = !(admin.is_active === 0 || admin.is_active === false);

  const token = signToken({
    username: admin.username,
    institution_id: admin.institution_id,
    institution_name: admin.institution_name,
    role,
  });

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
    is_active: isActive,
  });
});

/** Genel mesaj — hesap varlığını sızdırmaz */
const FORGOT_PASSWORD_OK_MSG =
  "Eğer bu hesap sistemde kayıtlıysa, şifre sıfırlama bağlantısı e-posta adresinize gönderildi.";

app.post("/api/forgot-password", async (req, res) => {
  try {
    const emailOrUsername = String(req.body?.email || req.body?.username || "").trim();
    if (!emailOrUsername) {
      return res.status(400).json({ error: "E-posta veya kullanıcı adı zorunludur." });
    }

    const institution = findInstitutionForPasswordReset(emailOrUsername);
    if (!institution || institution.role === "superadmin") {
      return res.json({ success: true, message: FORGOT_PASSWORD_OK_MSG });
    }

    const destination =
      (institution.email && String(institution.email).includes("@")
        ? String(institution.email).trim()
        : null) ||
      (emailOrUsername.includes("@") ? emailOrUsername : null);

    if (!destination) {
      // Hesapta e-posta yoksa yine genel mesaj dön (güvenlik)
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
    syncPasswordReset({
      institution_id: institution.id,
      institution_slug: institution.institution_id,
      email: destination,
      token,
      expires_at: expiresAt,
      used: false,
    });

    const frontendBase = (
      process.env.FRONTEND_URL || "http://localhost:5173"
    ).replace(/\/$/, "");
    const resetUrl = `${frontendBase}/reset-password?token=${token}`;

    await sendPasswordResetEmail({
      to: destination,
      resetUrl,
      institutionName: institution.institution_name,
    });

    return res.json({ success: true, message: FORGOT_PASSWORD_OK_MSG });
  } catch (err) {
    console.error("[AUTH] forgot-password:", err.message);
    return res.status(500).json({
      error: "Şifre sıfırlama e-postası gönderilemedi. Lütfen daha sonra tekrar deneyin.",
    });
  }
});

app.post("/api/reset-password", (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.password || req.body?.newPassword || "");

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token ve yeni şifre zorunludur." });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: "Şifre en az 4 karakter olmalıdır." });
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
    if (full) syncInstitutionUpsert(full);
    syncPasswordReset({
      institution_id: resetRow.institution_id,
      institution_slug: full?.institution_id || null,
      email: resetRow.email,
      token: resetRow.token,
      expires_at: resetRow.expires_at,
      used: true,
    });

    return res.json({
      success: true,
      message: "Şifreniz başarıyla güncellendi. Giriş yapabilirsiniz.",
    });
  } catch (err) {
    console.error("[AUTH] reset-password:", err.message);
    return res.status(500).json({ error: err.message || "Şifre güncellenemedi." });
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
    is_active: isActive,
  });
});

app.put("/api/business/change-password", requireAuth, (req, res) => {
  try {
    if (req.user?.role === "superadmin") {
      return res.status(403).json({ error: "Bu işlem yalnızca işletme hesapları için geçerlidir." });
    }

    const oldPassword = String(req.body?.oldPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: "Eski ve yeni şifre zorunludur." });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: "Yeni şifre en az 4 karakter olmalıdır." });
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
    if (full) syncInstitutionUpsert(full);

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
    return res.json({
      profile: {
        institution_id: row.institution_id,
        institution_name: row.institution_name,
        logo_url: row.logo_url || null,
        phone: row.phone || null,
        email: row.email || null,
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
    const business = updateInstitutionProfile(req.user.institution_id, {
      logo_url: req.body?.logo_url,
      phone: req.body?.phone,
      working_hours: req.body?.working_hours,
    });
    const full = getInstitutionFullBySlug(req.user.institution_id);
    if (full) await syncInstitutionUpsert(full);
    return res.json({ ok: true, business });
  } catch (err) {
    const status = err.message === "İşletme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Profil güncellenemedi." });
  }
});

app.get("/api/admin/businesses", requireSuperAdmin, (_req, res) => {
  try {
    return res.json({ businesses: listBusinesses() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "İşletmeler alınamadı." });
  }
});

app.post("/api/admin/businesses", requireSuperAdmin, (req, res) => {
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
      subscription_type: req.body?.subscription_type || "Test",
      remaining_days:
        req.body?.remaining_days != null
          ? req.body.remaining_days
          : req.body?.subscription_type === "Test" || !req.body?.subscription_type
            ? 14
            : undefined,
      is_active: isActive,
      logo_url: req.body?.logo_url,
    });
    const full = getInstitutionFullById(business.id);
    if (full) syncInstitutionUpsert(full);
    return res.status(201).json({ business });
  } catch (err) {
    return res.status(400).json({ error: err.message || "İşletme oluşturulamadı." });
  }
});

app.put("/api/admin/businesses/:id", requireSuperAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz işletme ID." });
    }
    const business = updateBusiness(id, {
      username: req.body?.username,
      password: req.body?.password,
      institution_name: req.body?.institution_name,
      subscription_type: req.body?.subscription_type,
      remaining_days: req.body?.remaining_days,
      is_active: req.body?.is_active,
      logo_url: req.body?.logo_url,
    });
    const full = getInstitutionFullById(id);
    if (full) syncInstitutionUpsert(full);
    return res.json({ business });
  } catch (err) {
    const status = err.message === "İşletme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "İşletme güncellenemedi." });
  }
});

app.put("/api/admin/businesses/:id/reset-subscription", requireSuperAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz işletme ID." });
    }
    const business = resetBusinessSubscription(id);
    const full = getInstitutionFullById(id);
    if (full) syncInstitutionUpsert(full);
    return res.json({ business });
  } catch (err) {
    const status = err.message === "İşletme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Abonelik sıfırlanamadı." });
  }
});

app.put("/api/admin/businesses/:id/status", requireSuperAdmin, (req, res) => {
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
    if (full) syncInstitutionUpsert(full);
    return res.json({ business });
  } catch (err) {
    const status = err.message === "İşletme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Durum güncellenemedi." });
  }
});

app.delete("/api/admin/businesses/:id", requireSuperAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz işletme ID." });
    }
    const full = getInstitutionFullById(id);
    const result = deleteBusiness(id);
    if (full?.institution_id) syncInstitutionDelete(full.institution_id);
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
app.post("/api/track-visitor", (_req, res) => {
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

/** Anonim oturum başlat (çerez kabulü) */
app.post("/api/analytics/start", async (req, res) => {
  try {
    const session_id = String(req.body?.session_id || "").trim();
    if (!session_id) {
      return res.status(400).json({ error: "session_id zorunludur." });
    }
    const ip = getClientIp(req);
    const location =
      (req.body?.location && String(req.body.location).trim()) ||
      (await resolveApproxLocation(ip));
    const session = startVisitorSession({ session_id, location });
    syncVisitorSession(session);
    return res.status(201).json({ ok: true, session });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Oturum başlatılamadı." });
  }
});

/** Anonim etkileşim güncelle */
app.put("/api/analytics/update", (req, res) => {
  try {
    const session_id = String(req.body?.session_id || "").trim();
    if (!session_id) {
      return res.status(400).json({ error: "session_id zorunludur." });
    }
    const session = updateVisitorSession(session_id, {
      clicked_businesses: req.body?.clicked_businesses,
      viewed_currencies: req.body?.viewed_currencies,
      business: req.body?.business,
      currency: req.body?.currency,
    });
    syncVisitorSession(session);
    return res.json({ ok: true, session });
  } catch (err) {
    const status = err.message === "Oturum bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Güncelleme başarısız." });
  }
});

/** Super Admin: toplam ziyaretçi + son oturumlar */
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

app.post("/api/admin/branches", requireSuperAdmin, (req, res) => {
  try {
    const branch = createBranch({
      business_id: req.body?.business_id,
      name: req.body?.name,
      phone: req.body?.phone,
      address: req.body?.address,
      lat: req.body?.lat,
      lng: req.body?.lng,
    });
    const biz = getInstitutionFullById(branch.business_id);
    if (biz) syncBranchUpsert(branch, biz.institution_id);
    return res.status(201).json({ branch });
  } catch (err) {
    const status = err.message === "İşletme bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Şube oluşturulamadı." });
  }
});

app.put("/api/admin/branches/:id", requireSuperAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Geçersiz şube ID." });
    }
    const branch = updateBranch(id, {
      name: req.body?.name,
      phone: req.body?.phone,
      address: req.body?.address,
      lat: req.body?.lat,
      lng: req.body?.lng,
    });
    const biz = getInstitutionFullById(branch.business_id);
    if (biz) syncBranchUpsert(branch, biz.institution_id);
    return res.json({ branch });
  } catch (err) {
    const status = err.message === "Şube bulunamadı." ? 404 : 400;
    return res.status(status).json({ error: err.message || "Şube güncellenemedi." });
  }
});

app.delete("/api/admin/branches/:id", requireSuperAdmin, (req, res) => {
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
    if (before) syncBranchDelete(before, before.institution_id);
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

    result.push({
      currency,
      buy: {
        kur: kur.buy,
        efektif_kur: kur.efektif_buy,
        margin_type: buyAdj.margin_type,
        margin_value: buyAdj.margin_value,
        final: applyMarginToValue(kur.buy, buyAdj.margin_value, buyAdj.margin_type),
      },
      sell: {
        kur: kur.sell,
        efektif_kur: kur.efektif_sell,
        margin_type: sellAdj.margin_type,
        margin_value: sellAdj.margin_value,
        final: applyMarginToValue(kur.sell, sellAdj.margin_value, sellAdj.margin_type),
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
      details: error.message,
    });
  }
});

app.put("/api/admin/rates", requireAuth, (req, res) => {
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

      const buyMarginType = item.buy?.margin_type === "percent" ? "percent" : "fixed";
      const buyMarginValue = Number(item.buy?.margin_value || 0);
      const sellMarginType = item.sell?.margin_type === "percent" ? "percent" : "fixed";
      const sellMarginValue = Number(item.sell?.margin_value || 0);

      if (!Number.isFinite(buyMarginValue) || !Number.isFinite(sellMarginValue)) {
        return res.status(400).json({ error: `Geçersiz kâr değeri: ${currency}` });
      }
      if (buyMarginValue < 0 || sellMarginValue < 0) {
        return res.status(400).json({ error: `Kâr negatif olamaz: ${currency}` });
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

    upsertAdjustments(institution_id, adjustments);
    syncRateAdjustmentsMap(institution_id, adjustments);

    // Kalıcı marj geçmişi → Supabase (Render ephemeral SQLite'a ek)
    const nowIso = new Date().toISOString();
    for (const [key, adj] of Object.entries(adjustments)) {
      const [currency, type] = key.split("_");
      if (!currency || !type) continue;
      insertMarginHistory({
        institution_id,
        currency,
        type,
        margin_type: adj.margin_type,
        margin_value: adj.margin_value,
        recorded_at: nowIso,
      }).catch((err) => {
        console.warn("[SUPABASE] margin sync:", err.message);
      });
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

app.post("/api/partnership-apply", async (req, res) => {
  const { institution_name, contact_person, email, phone, message } = req.body;

  if (!institution_name || !contact_person || !email || !phone) {
    return res.status(400).json({ error: "Tüm alanlar zorunludur." });
  }

  try {
    // E-posta gönder
    await sendPartnershipEmail({
      institution_name,
      contact_person,
      email,
      phone,
      message,
    });

    // Veritabanına kaydet (opsiyonel)
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO partnership_applications (institution_name, contact_person, email, phone, message)
        VALUES (?, ?, ?, ?, ?)
      `).run(institution_name, contact_person, email, phone, message || null);
      syncPartnershipApplication({
        institution_name,
        contact_person,
        email,
        phone,
        message,
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

    // Kalıcı kaynak: Supabase (Render ephemeral SQLite DEĞİL)
    const result = await getMarketHistoricalRates(period, currency);

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
        summary.historicalRates[currency] = { fetched: rows.length, ...result };
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
    return res.status(500).json({ error: "Veri aktarımı başarısız.", details: error.message });
  }
});

/**
 * ✅ ADIM 1: Kur verilerinde değişim var mı kontrol et ve broadcast yap
 */
function broadcastRateChange(newRates) {
  // Değişim var mı kontrol et
  const hasChanged = previousRates ? 
    JSON.stringify(newRates) !== JSON.stringify(previousRates) 
    : true; // İlk kez ise değişim var

  if (!hasChanged) {
    console.log("[SSE] Kur değişikliği yok, broadcast yapılmıyor.");
    return;
  }

  console.log("[SSE] ✅ Kur değişikliği YAKALAND! Tüm istemcilere yayınlanıyor...");

  // Değişikliği tespitle önceki kurları güncelle
  previousRates = JSON.parse(JSON.stringify(newRates));

  // Tüm bağlı istemcilere gönder
  const message = {
    type: "rate_update",
    rates: newRates,
    timestamp: new Date().toISOString(),
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
    // Sadece Merkez Bankası kurlarını çek
    const central = await getCentralBankRates();
    const newCentralRates = central.rates || null;

    // ✅ KRİTİK GÜVENLİK: Kaynak "mock" (fallback) ise bu veriyi hiçbir şekilde
    // gerçek veri gibi işleme - kaydetme, broadcast etme. Canlı XML kaynağı geçici
    // olarak erişilemez olduğunda ratesService.js sahte/mock kurlar (örn. USD 38.42)
    // döndürüyor; bunlar geçmiş tabloya ve SSE'ye "gerçek değişim" gibi sızıp
    // grafiklerde ani ve gerçek olmayan sıçramalar/düşüşler yaratıyordu.
    if (central.source === "mock" || central.error) {
      console.warn(`[REFRESH] ⚠️  Merkez Bankası kaynağı geçici olarak erişilemedi (${central.error || "mock fallback"}). Bu döngüde kayıt/broadcast YAPILMIYOR.`);
      return;
    }

    // ✅ Değişim tespiti
    if (newCentralRates && JSON.stringify(newCentralRates) !== JSON.stringify(cachedRates.centralBankRates)) {
      console.log("[REFRESH] ✅ Merkez Bankası kurlarında DEĞIŞIM TESPIT EDİLDİ!");
      
      // Gerçek verileri geçmiş tablosuna kaydet
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
        // Record to SQLite (legacy)
        recordHistoricalRates(historicalData);
        
        // Also save to Supabase
        const now = new Date().toISOString();
        for (const data of historicalData) {
          try {
            await insertHistoricalRate(data.currency, data.buy_rate, data.sell_rate, now);
          } catch (err) {
            console.error(`[SUPABASE] Kur kaydetme hatası (${data.currency}):`, err.message);
          }
        }
        console.log(`[HISTORICAL] ${historicalData.length} kur kaydedildi (SQLite + Supabase).`);
      }

      // SSE ile tüm istemcilere broadcast et
      broadcastRateChange(newCentralRates);
    } else {
      console.log("[REFRESH] Merkez Bankası kurlarında değişim yok.");
    }

    // Merkez Bankası kurlarını kullanarak banka snapshot'ları oluştur
    const banks = buildBanksFromCentralRates(newCentralRates);

    // Cache güncelle
    cachedRates = {
      updatedAt: new Date().toISOString(),
      totalBanks: banks.length,
      banks: banks,
      centralBankUpdatedAt: central.updatedAt || central.fetchedAt || null,
      centralBankXmlDate: central.xmlDate || central.bulletinDate || null,
      centralBankRates: newCentralRates,
    };

    console.log(`[SCRAPER] ✅ Cache güncellendi — totalBanks=${cachedRates.totalBanks}, MB=${cachedRates.centralBankUpdatedAt}`);
  } catch (error) {
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

async function startServer() {
  initDb();

  // 1) Supabase'teki kalıcı admin verisini SQLite'a geri yükle (deploy sonrası)
  try {
    await hydrateAdminDataFromSupabase({
      upsertInstitutionRow: applySupabaseInstitutionRow,
      upsertAdjustmentRow: applySupabaseAdjustmentRow,
      upsertBranchRow: applySupabaseBranchRow,
    });
  } catch (err) {
    console.warn("[SUPABASE-SYNC] Hydrate hatası:", err.message);
  }

  // 2) Güncel SQLite durumunu Supabase'e yansıt
  bootstrapAdminDataToSupabase({
    institutions: listAllInstitutionsForSync(),
    branches: listAllBranchesForSync(),
    adjustments: listAllAdjustmentsForSync(),
  }).catch((err) => {
    console.warn("[SUPABASE-SYNC] Bootstrap hatası:", err.message);
  });
  
  // ✅ ADIM 1: İlk yüklemede kurları çek ve SSE'ye hazırla
  await refreshRatesCacheWithChangeDetection();

  /**
   * ✅ SADELEŞTIRILMIŞ: Merkez Bankası XML Kurlarına Odaklanılmış
   * - Sadece Merkez Bankası XML kurları dinleniyor
   * - Faiz, kredi ve mevduat API'leri tamamen kaldırıldı
   * - 60 saniyeli güncelleme döngüsü
   * - Cache fallback mekanizması aktif
   */
  const REFRESH_INTERVAL_MS = 60000; // 60 saniye - Merkez Bankası güncellemeleri
  
  setInterval(async () => {
    await refreshRatesCacheWithChangeDetection();
  }, REFRESH_INTERVAL_MS);

  console.log(`[SCHEDULER] ✅ Merkez Bankası XML monitoring başlatıldı (${REFRESH_INTERVAL_MS / 1000}s interval)`);
  console.log("[SCHEDULER] 📊 Sadece döviz kurları dinleniyor - Faiz/Kredi/Mevduat kaldırıldı");

  app.listen(PORT, () => {
    console.log(`Backend API is running on http://localhost:${PORT}`);
    console.log("Rates endpoint: GET /api/kurlar");
    console.log("Auth endpoint: POST /api/auth/login");
    console.log("SSE Stream: GET /api/rates-stream");
    console.log(`İlk yüklemede cache: totalBanks=${cachedRates.totalBanks}`);
  });
}

startServer();
