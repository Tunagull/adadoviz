require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const { INSTITUTIONS, CURRENCIES, findInstitutionByName } = require("./institutions");
const { periodToHoursBack } = require("./periodSpec");
const {
  enforceSellGteBuy,
  normalizeKind,
  normalizeSide,
  baselineRecordedAtIso,
  fromSupabaseMarginHistoryRow,
} = require("./marginSchema");

/**
 * B-H4: Karışık zaman damgası formatlarını (yerel "YYYY-MM-DD HH:MM:SS" vs
 * ISO-Zulu) tek biçime indirger. Boşluklu form UTC kabul edilir (Render zaten
 * UTC çalışır; eski datetime('now') yazımları bu varsayımı doğrular).
 * @returns {string|null} ISO-8601 UTC dizesi
 */
function toIsoUtc(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  const hasTz = /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  const candidate = s.includes("T") || hasTz ? s : `${s.replace(" ", "T")}Z`;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * S-C1: Seed hesapları için parola çözümü.
 *  - superadmin: SUPERADMIN_INITIAL_PASSWORD varsa onu kullan; yoksa
 *    crypto.randomBytes(12) üret ve BİR KEZ WARN logla (asla "123").
 *  - katalog / varsayılan işletme: bilinemez rastgele bir hash — giriş fiilen
 *    KAPALIDIR. Ofis "şifremi unuttum" akışıyla (kayıtlı e-posta) veya superadmin
 *    panelden yeni şifre atar. Böylece taze deploy'da <slug>/123 diye bir
 *    kimlik bilgisi hiç oluşmaz.
 */
let _superadminSeedPasswordLogged = false;
function resolveSuperadminSeedPassword() {
  const env = String(process.env.SUPERADMIN_INITIAL_PASSWORD || "").trim();
  if (env) return env;
  const generated = crypto.randomBytes(12).toString("base64url");
  if (!_superadminSeedPasswordLogged) {
    console.warn(
      `[SECURITY] SUPERADMIN_INITIAL_PASSWORD tanımlı değil — geçici superadmin şifresi üretildi: ${generated}`
    );
    console.warn(
      "[SECURITY] Bu şifre YALNIZCA şimdi loglanır. Giriş yapıp panelden derhal değiştirin."
    );
    _superadminSeedPasswordLogged = true;
  }
  return generated;
}
function disabledLoginHash() {
  // Kimsenin bilmediği rastgele parolanın bcrypt hash'i → compareSync daima false.
  return bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10);
}

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "finsight.db");

let db;

function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

function runInTransaction(fn) {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (_rollbackError) {
      // ignore
    }
    throw error;
  }
}

function columnExists(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => row.name === column);
}

/**
 * Y-03: Mükerrer (currency, recorded_at) satırlarını temizler — her çift için
 * en yüksek rowid'li (en son yazılan) kayıt tutulur. Tekillik indeksi ancak
 * bundan sonra kurulabilir. Idempotent: temiz tabloda hiçbir şey yapmaz.
 */
function dedupeHistoricalRates() {
  try {
    const before = db.prepare(`SELECT COUNT(*) AS c FROM historical_rates`).get()?.c || 0;
    if (before === 0) return { removed: 0 };

    const dupes =
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM (
             SELECT currency, recorded_at FROM historical_rates
             GROUP BY currency, recorded_at HAVING COUNT(*) > 1
           )`
        )
        .get()?.c || 0;
    if (dupes === 0) return { removed: 0 };

    runInTransaction(() => {
      db.exec(`
        DELETE FROM historical_rates
        WHERE rowid NOT IN (
          SELECT MAX(rowid) FROM historical_rates GROUP BY currency, recorded_at
        )
      `);
    });

    const after = db.prepare(`SELECT COUNT(*) AS c FROM historical_rates`).get()?.c || 0;
    const removed = before - after;
    console.log(
      `[DB] ✅ Mükerrer kur kaydı temizlendi: ${removed} satır silindi (${before} → ${after}, ${dupes} çakışan grup).`
    );
    return { removed };
  } catch (err) {
    console.warn("[DB] Mükerrer kur temizliği başarısız:", err.message);
    return { removed: 0, error: err.message };
  }
}

/**
 * B-H4: historical_rates.recorded_at içindeki yerel-biçim ("YYYY-MM-DD HH:MM:SS")
 * satırlarını UTC ISO'ya çevirir. SQLite ephemeral olduğu için bu bir kerelik
 * onarımdır; tekillik indeksinden ve dedupe'den ÖNCE çalışır ki karşılaştırma
 * tek biçim üzerinden yapılsın.
 */
function normalizeHistoricalRateTimestamps() {
  try {
    const rows = db
      .prepare(
        `SELECT id, recorded_at FROM historical_rates
         WHERE recorded_at NOT LIKE '%T%' OR recorded_at NOT LIKE '%Z'`
      )
      .all();
    if (!rows.length) return;
    const upd = db.prepare(`UPDATE historical_rates SET recorded_at = ? WHERE id = ?`);
    let fixed = 0;
    runInTransaction(() => {
      for (const row of rows) {
        const iso = toIsoUtc(row.recorded_at);
        if (iso && iso !== row.recorded_at) {
          upd.run(iso, row.id);
          fixed += 1;
        }
      }
    });
    if (fixed > 0) console.log(`[DB] ✅ ${fixed} historical_rates damgası UTC ISO'ya normalize edildi.`);
  } catch (err) {
    console.warn("[DB] historical_rates damga normalizasyonu başarısız:", err.message);
  }
}

/** B-H4: margin_history.recorded_at için aynı bir kerelik ISO onarımı. */
function normalizeMarginHistoryTimestamps() {
  try {
    const rows = db
      .prepare(
        `SELECT id, recorded_at FROM margin_history
         WHERE recorded_at NOT LIKE '%T%' OR recorded_at NOT LIKE '%Z'`
      )
      .all();
    if (!rows.length) return;
    const upd = db.prepare(`UPDATE margin_history SET recorded_at = ? WHERE id = ?`);
    let fixed = 0;
    runInTransaction(() => {
      for (const row of rows) {
        const iso = toIsoUtc(row.recorded_at);
        if (iso && iso !== row.recorded_at) {
          upd.run(iso, row.id);
          fixed += 1;
        }
      }
    });
    if (fixed > 0) console.log(`[DB] ✅ ${fixed} margin_history damgası UTC ISO'ya normalize edildi.`);
  } catch (err) {
    console.warn("[DB] margin_history damga normalizasyonu başarısız:", err.message);
  }
}

/**
 * Y-05: Sunucu açılışında değişim tespitini beslemek için diskteki EN SON kur
 * anlık görüntüsü. Önceden previousRates yalnızca bellekteydi; her restart'ta
 * null olduğundan ilk döngü "değişim var" sayılıyor ve müşteri panosundaki
 * "Son Güncelleme" kur hiç değişmemişken tazeleniyordu.
 *
 * @returns {{rates: Record<string,{buy:number,sell:number}>, recordedAt: string|null}|null}
 */
function getLatestHistoricalRatesSnapshot(currencies = ["USD", "EUR", "GBP"]) {
  try {
    const rates = {};
    let newestMs = -Infinity;
    let newest = null;
    for (const currency of currencies) {
      // B-H4: recorded_at karışık formatlı olabilir; lexical ORDER BY yanlış
      // "en yeni" seçebilir. Son birkaç satırı çekip SAYISAL olarak karşılaştır.
      const candidates = db
        .prepare(
          `SELECT currency, buy_rate, sell_rate, recorded_at
           FROM historical_rates
           WHERE currency = ?
           ORDER BY recorded_at DESC
           LIMIT 8`
        )
        .all(currency);
      let best = null;
      let bestMs = -Infinity;
      for (const row of candidates) {
        const ms = Date.parse(toIsoUtc(row.recorded_at) || row.recorded_at);
        if (Number.isFinite(ms) && ms > bestMs) {
          bestMs = ms;
          best = row;
        }
      }
      if (!best) continue;
      rates[currency] = { buy: Number(best.buy_rate), sell: Number(best.sell_rate) };
      if (bestMs > newestMs) {
        newestMs = bestMs;
        newest = toIsoUtc(best.recorded_at) || best.recorded_at;
      }
    }
    if (Object.keys(rates).length === 0) return null;
    return { rates, recordedAt: newest };
  } catch (err) {
    console.warn("[DB] Kur anlık görüntüsü okunamadı:", err.message);
    return null;
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.skipBusinessSeed] - true ise katalog/varsayılan işletme
 *   seed'i atlanır (bkz. yukarıdaki açıklama). server.js, Supabase'te kurum olup
 *   olmadığını kontrol ettikten sonra bu değeri belirler.
 */
function initDb({ skipBusinessSeed = false } = {}) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new DatabaseSync(DB_PATH);

  /**
   * ✅ ADIM 1: SQLite WAL (Write-Ahead Logging) Mode
   * 
   * Purpose: Eşzamanlı okuma/yazma performansını artır
   * Benefit: SQLITE_BUSY errors'ı önle, concurrent requests'i handle et
   * 
   * How it works:
   * - Normal mode: Write locks the entire DB
   * - WAL mode: Writes go to WAL file, reads can still happen
   * - Readers don't block writers, writers don't block readers
   * 
   * Performance Impact:
   * - Read speed: +10-20% (no exclusive lock)
   * - Write speed: -5% (extra WAL overhead)
   * - Concurrency: +300% (parallel readers)
   * 
   * Files generated:
   * - finsight.db (main database)
   * - finsight.db-wal (write-ahead log)
   * - finsight.db-shm (shared memory)
   */
  
  // Enable WAL mode for concurrent access
  db.exec('PRAGMA journal_mode = WAL;');
  console.log('[DB] ✅ WAL mode aktifleştirildi - eşzamanlı okuma/yazma enable');

  /**
   * ✅ ADDITIONAL: SQLite Performance Pragmas
   */
  
  // Increase busy timeout (default: 0ms, new: 5000ms)
  // If DB is locked, retry for 5 seconds instead of immediate fail
  db.exec('PRAGMA busy_timeout = 5000;');
  console.log('[DB] ✅ Busy timeout: 5000ms (lock retry duration)');

  // Synchronous mode: NORMAL (default: FULL, slower but safer)
  // NORMAL = fsync after commit (good balance of safety/speed)
  db.exec('PRAGMA synchronous = NORMAL;');
  console.log('[DB] ✅ Synchronous mode: NORMAL (balanced safety)');

  // Foreign key constraints
  db.exec('PRAGMA foreign_keys = ON;');
  console.log('[DB] ✅ Foreign keys enabled');

  db.exec(`
    CREATE TABLE IF NOT EXISTS institutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      institution_id TEXT NOT NULL UNIQUE,
      institution_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'business',
      subscription TEXT NOT NULL DEFAULT 'Deneme',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bank_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      institution_id TEXT NOT NULL UNIQUE,
      institution_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rate_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      type TEXT NOT NULL,
      margin_type TEXT NOT NULL DEFAULT 'fixed',
      margin_value REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(institution_id, currency, type)
    );

    CREATE TABLE IF NOT EXISTS partnership_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_name TEXT NOT NULL,
      contact_person TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS historical_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      currency TEXT NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS margin_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      type TEXT NOT NULL,
      margin_type TEXT NOT NULL DEFAULT 'fixed',
      margin_value REAL NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      lat REAL,
      lng REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES institutions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS site_stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_visitors INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS visitor_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      location TEXT NOT NULL DEFAULT 'Bilinmiyor',
      clicked_businesses TEXT NOT NULL DEFAULT '[]',
      clicked_business_ids TEXT NOT NULL DEFAULT '[]',
      viewed_currencies TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS branch_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      institution_id TEXT NOT NULL,
      business_name TEXT NOT NULL DEFAULT '',
      branch_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      lat REAL,
      lng REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      is_read INTEGER NOT NULL DEFAULT 0,
      admin_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES institutions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS business_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      related_request_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES institutions(id) ON DELETE CASCADE
    );
  `);

  // Tek satırlık ziyaretçi sayacı (yoksa oluştur)
  try {
    const statsRow = db.prepare(`SELECT id FROM site_stats WHERE id = 1`).get();
    if (!statsRow) {
      db.prepare(
        `INSERT INTO site_stats (id, total_visitors, updated_at) VALUES (1, 0, datetime('now'))`
      ).run();
    }
  } catch (err) {
    console.warn("[DB] site_stats init:", err.message);
  }

  // ✅ Eski (legacy) Render servisinden veri aktarımı sırasında aynı kaydın
  // tekrar tekrar eklenmesini önlemek için (idempotent migrate endpoint).
  /**
   * ⚠️ VERİ DÜZELTMESİ (denetim bulgusu Y-03): Index oluşturma, tabloda ZATEN
   * çakışan kayıtlar olduğu için her açılışta sessizce başarısız oluyordu; kimse
   * temizlemediği için de kalıcı hale gelmişti (ölçüm: 19.306 satırın 5.779
   * (currency, recorded_at) grubu mükerrer → grafikler aynı damgada birden çok
   * nokta çiziyordu). Artık önce dedupe ediliyor, sonra index kuruluyor.
   */
  /**
   * ABONELİK VE TAHSİLAT (ürün haritası A-01 / A-02 / A-04)
   * Abonelik daha önce tek bir alanla temsil ediliyordu
   * (institutions.subscription_end_date) ve uzatılınca eski değer kayboluyordu —
   * yani "kim, ne zaman, ne kadar ödedi" sorusu cevaplanamıyordu.
   * plans: fiyat artık veri (kodda sabit değil). payments: tahsilat hareketi.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      code       TEXT PRIMARY KEY,
      ad         TEXT NOT NULL,
      sure_gun   INTEGER NOT NULL,
      fiyat      REAL NOT NULL DEFAULT 0,
      kdv_orani  REAL NOT NULL DEFAULT 0,
      aktif      INTEGER NOT NULL DEFAULT 1,
      sira       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS payments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id  TEXT NOT NULL,
      plan_code       TEXT NOT NULL,
      tutar           REAL NOT NULL DEFAULT 0,
      kdv             REAL NOT NULL DEFAULT 0,
      para_birimi     TEXT NOT NULL DEFAULT 'TRY',
      odeme_tarihi    TEXT NOT NULL,
      donem_baslangic TEXT NOT NULL,
      donem_bitis     TEXT NOT NULL,
      yontem          TEXT,
      durum           TEXT NOT NULL DEFAULT 'odendi',
      fatura_no       TEXT,
      aciklama        TEXT,
      olusturan       TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_inst ON payments(institution_id, odeme_tarihi DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_donem ON payments(donem_bitis)`);
  seedPlansIfNeeded();

  normalizeHistoricalRateTimestamps();
  dedupeHistoricalRates();
  normalizeMarginHistoryTimestamps();
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_rates_unique
      ON historical_rates(currency, recorded_at)
    `);
    console.log("[DB] ✅ idx_historical_rates_unique aktif — mükerrer kur kaydı artık imkânsız.");
  } catch (err) {
    console.warn("[DB] idx_historical_rates_unique oluşturulamadı:", err.message);
  }

  if (!columnExists("rate_adjustments", "margin_type")) {
    db.exec(`ALTER TABLE rate_adjustments ADD COLUMN margin_type TEXT NOT NULL DEFAULT 'fixed'`);
  }

  if (!columnExists("rate_adjustments", "type")) {
    db.exec(`ALTER TABLE rate_adjustments ADD COLUMN type TEXT`);
  }

  if (!columnExists("rate_adjustments", "margin_value")) {
    db.exec(`ALTER TABLE rate_adjustments ADD COLUMN margin_value REAL NOT NULL DEFAULT 0`);
  }

  if (!columnExists("institutions", "role")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN role TEXT NOT NULL DEFAULT 'business'`);
  }
  if (!columnExists("institutions", "subscription")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN subscription TEXT NOT NULL DEFAULT 'Test'`);
  }
  if (!columnExists("institutions", "subscription_type")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN subscription_type TEXT NOT NULL DEFAULT 'Test'`);
  }
  if (!columnExists("institutions", "subscription_end_date")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN subscription_end_date TEXT`);
  }
  if (!columnExists("institutions", "is_active")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  }
  if (!columnExists("institutions", "logo_url")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN logo_url TEXT`);
  }
  if (!columnExists("institutions", "email")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN email TEXT`);
  }
  if (!columnExists("institutions", "phone")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN phone TEXT`);
  }
  if (!columnExists("institutions", "working_hours")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN working_hours TEXT`);
  }
  if (!columnExists("institutions", "created_at")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN created_at TEXT`);
    db.exec(
      `UPDATE institutions SET created_at = datetime('now') WHERE created_at IS NULL`
    );
  }
  if (!columnExists("institutions", "branch_limit")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN branch_limit INTEGER NOT NULL DEFAULT 1`);
  }
  // P1.4 / S7: id-bazli tiklama esleme (isim yerine institution_id).
  if (!columnExists("visitor_sessions", "clicked_business_ids")) {
    db.exec(
      `ALTER TABLE visitor_sessions ADD COLUMN clicked_business_ids TEXT NOT NULL DEFAULT '[]'`
    );
  }
  if (!columnExists("institutions", "contact_person")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN contact_person TEXT`);
  }
  if (!columnExists("institutions", "last_login_at")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN last_login_at TEXT`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT,
      institution_id TEXT,
      institution_name TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // S-M4: tamper-evident zincir — her satırın row_hash'i bir öncekinin
  // row_hash'ini (prev_hash) içerir. Bir satır eklen, silinir veya değiştirilirse
  // zincir kopar ve verifyAuditChain() bunu tespit eder.
  if (!columnExists("audit_log", "prev_hash")) {
    db.exec(`ALTER TABLE audit_log ADD COLUMN prev_hash TEXT`);
  }
  if (!columnExists("audit_log", "row_hash")) {
    db.exec(`ALTER TABLE audit_log ADD COLUMN row_hash TEXT`);
  }
  if (!columnExists("branch_requests", "request_type")) {
    db.exec(
      `ALTER TABLE branch_requests ADD COLUMN request_type TEXT NOT NULL DEFAULT 'new'`
    );
  }
  if (!columnExists("branch_requests", "branch_id")) {
    db.exec(`ALTER TABLE branch_requests ADD COLUMN branch_id INTEGER`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  if (!columnExists("branches", "whatsapp")) {
    db.exec(`ALTER TABLE branches ADD COLUMN whatsapp TEXT NOT NULL DEFAULT ''`);
  }
  if (!columnExists("branches", "subscription_type")) {
    db.exec(`ALTER TABLE branches ADD COLUMN subscription_type TEXT NOT NULL DEFAULT 'Test'`);
  }
  if (!columnExists("branches", "subscription_start_date")) {
    db.exec(`ALTER TABLE branches ADD COLUMN subscription_start_date TEXT`);
  }
  if (!columnExists("branches", "subscription_end_date")) {
    db.exec(`ALTER TABLE branches ADD COLUMN subscription_end_date TEXT`);
  }
  if (!columnExists("branches", "is_active")) {
    db.exec(`ALTER TABLE branches ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  }
  backfillBranchSubscriptionsIfNeeded();
  backfillInstitutionCreatedAtIfNeeded();

  db.exec(`
    CREATE TABLE IF NOT EXISTS branch_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      institution_id TEXT NOT NULL,
      business_name TEXT NOT NULL DEFAULT '',
      branch_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      lat REAL,
      lng REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      is_read INTEGER NOT NULL DEFAULT 0,
      admin_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES institutions(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS business_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      related_request_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES institutions(id) ON DELETE CASCADE
    )
  `);

  // P1.5: superadmin (operatör) bildirimleri — business_notifications ile eş şema,
  // alıcı hep superadmin olduğu için business_id yerine serbest data_json.
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      data_json TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // P1.7: panel-içi destek / sorun bildirimi (B11). Kaydı işletme (veya
  // superadmin) açar; operatör statü/yanıt yönetir. Supabase sync yok
  // (admin_notifications ile aynı gerekçe — operasyonel, kritik-kalıcı değil).
  db.exec(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id TEXT,
      business_id INTEGER,
      business_name TEXT NOT NULL DEFAULT '',
      reporter_username TEXT NOT NULL DEFAULT '',
      reporter_role TEXT NOT NULL DEFAULT 'business',
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_reply TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // P2.5: işletme analitik olayları (B3). visitor_sessions oturum-özeti tutar;
  // bu tablo tekil zaman damgalı olayları tutar (7/30 gün seri + kırılım).
  // migrations/0004 ile eş şema; Supabase sync yok (admin_notifications gerekçesi).
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id INTEGER,
      event TEXT NOT NULL,
      session_id TEXT,
      currency TEXT,
      city TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS analytics_events_inst_created_idx
       ON analytics_events (institution_id, created_at)`
  );

  // P3.1: self-signup başvuruları (B1). /kayit → başvuru kaydı; hesap YOK.
  // Superadmin Onayla → createBusiness. migrations/0005 ile eş şema.
  // Supabase sync yok (admin_notifications/support_tickets gerekçesi —
  // e-posta + emitAdminNotification zaten operatörü haberdar eder).
  db.exec(`
    CREATE TABLE IF NOT EXISTS signup_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_name TEXT NOT NULL,
      contact_person TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      city TEXT,
      current_rate_info TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reject_reason TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_business_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS signup_requests_status_idx
       ON signup_requests (status, created_at)`
  );

  // P3.2: kur alarmları (C3). Public ziyaretçi bir e-posta + eşik girer;
  // çift-opt-in (verified) sonrası her kur yenilemesinde job kontrol eder.
  // migrations/0006 ile eş şema. Supabase sync yok (signup_requests gerekçesi).
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      currency TEXT NOT NULL,
      side TEXT NOT NULL,
      direction TEXT NOT NULL,
      threshold REAL NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      armed INTEGER NOT NULL DEFAULT 1,
      last_fired_at TEXT,
      manage_token TEXT NOT NULL,
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS rate_alerts_token_idx ON rate_alerts (manage_token)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS rate_alerts_active_idx ON rate_alerts (active, verified)`
  );

  // P3.3: indirim kodları (S1 — gelir paneli). Superadmin tahsilat kaydederken
  // uygulayabilir. migrations/0007 ile eş şema. Supabase sync yok (rate_alerts
  // gerekçesi — makbuz + audit kalıcıyı kayıt altına alıyor).
  db.exec(`
    CREATE TABLE IF NOT EXISTS discount_codes (
      code            TEXT PRIMARY KEY,
      tur             TEXT NOT NULL DEFAULT 'percent',
      deger           REAL NOT NULL DEFAULT 0,
      para_birimi     TEXT NOT NULL DEFAULT 'TRY',
      max_kullanim    INTEGER NOT NULL DEFAULT 0,
      kullanim_sayisi INTEGER NOT NULL DEFAULT 0,
      gecerlilik_bitis TEXT,
      aktif           INTEGER NOT NULL DEFAULT 1,
      aciklama        TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS discount_codes_aktif_idx ON discount_codes (aktif)`);
  if (!columnExists("payments", "indirim_kodu")) {
    db.exec(`ALTER TABLE payments ADD COLUMN indirim_kodu TEXT`);
  }
  if (!columnExists("payments", "indirim_tutari")) {
    db.exec(`ALTER TABLE payments ADD COLUMN indirim_tutari REAL NOT NULL DEFAULT 0`);
  }

  // P3.4: lead CRM + talep analitiği (S5 + S6). lead_meta signup_requests /
  // partnership_applications üstüne CRM alanları bindirir (kaynak şemaya
  // dokunmaz); search_misses anasayfa aramasının boş döndüğü sorguları tutar.
  // migrations/0008 ile eş şema. Supabase sync yok (discount_codes gerekçesi).
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_meta (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source        TEXT NOT NULL,
      source_id     INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'new',
      note          TEXT,
      reminder_date TEXT,
      assignee      TEXT,
      updated_by    TEXT,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, source_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS lead_meta_status_idx ON lead_meta (status)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_misses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      query      TEXT NOT NULL,
      query_norm TEXT NOT NULL,
      city       TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS search_misses_norm_idx ON search_misses (query_norm)`);
  db.exec(`CREATE INDEX IF NOT EXISTS search_misses_created_idx ON search_misses (created_at)`);

  // P3.6: self-servis ödeme / dekont (B5). İşletme plan seçip havale dekontu
  // yükler; superadmin onayında createPayment + abonelik uzatma tetiklenir.
  // migrations/0009 ile eş şema. Supabase sync yok (onaydaki createPayment
  // kalıcı tahsilatı zaten senkronluyor).
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_proofs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_id TEXT NOT NULL,
      plan_code      TEXT NOT NULL,
      amount         REAL,
      method         TEXT,
      note           TEXT,
      proof_image    TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      reviewed_by    TEXT,
      reviewed_at    TEXT,
      reject_reason  TEXT,
      payment_id     INTEGER,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS payment_proofs_status_idx ON payment_proofs (status, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS payment_proofs_inst_idx ON payment_proofs (institution_id)`);

  migrateBankAdminsToInstitutions();

  // ⚠️ GÜVENLİK/MANTIK DÜZELTMESİ (bkz. project_audit_report.md, 1.1):
  // seedAdminsIfNeeded / seedCatalogInstitutionsIfNeeded, ephemeral SQLite disk
  // sıfırlandığında (Render redeploy) varsayılan şifreli ("123") satırları
  // INSERT OR IGNORE ile geri ekliyordu. Supabase henüz hydrate edilmeden bu
  // seed'ler çalışırsa, sonrasında çalışan bootstrap bu geçici/varsayılan veriyi
  // Supabase'e YAZARAK gerçek (kalıcı) veriyi ezebiliyordu.
  //
  // Çözüm: Katalog/varsayılan işletme seed'i artık burada OTOMATİK çalışmaz.
  // server.js → startServer() bu seed'i yalnızca Supabase'te HİÇ kurum
  // olmadığı doğrulandığında (gerçek ilk kurulum) tetikler; aksi halde
  // hydrateAdminDataFromSupabase() tek veri kaynağıdır.
  if (skipBusinessSeed !== true) {
    seedAdminsIfNeeded();
    seedCatalogInstitutionsIfNeeded();
    seedAdjustmentsIfNeeded();
  }

  seedSuperAdminIfNeeded();
  backfillSubscriptionFieldsIfNeeded();
  // ✅ KALDIRANDI: resetAllMarginsToZero();  // Var olan marjları silmemelidir!
  migrateAkbankMargins();
  purgeOrphanBranches();
  console.log(`[DB] SQLite hazır: ${DB_PATH}`);
  return db;
}

function migrateBankAdminsToInstitutions() {
  const institutionsCount = db.prepare("SELECT COUNT(*) AS c FROM institutions").get().c;
  const adminsCount = db.prepare("SELECT COUNT(*) AS c FROM bank_admins").get().c;
  if (institutionsCount > 0 || adminsCount === 0) return;

  const rows = db
    .prepare(
      `SELECT username, password_hash, institution_id, institution_name, created_at FROM bank_admins`
    )
    .all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO institutions (username, password_hash, institution_id, institution_name, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  runInTransaction(() => {
    for (const row of rows) {
      insert.run(
        row.username,
        row.password_hash,
        row.institution_id,
        row.institution_name,
        row.created_at || new Date().toISOString()
      );
    }
  });
}

function seedAdminsIfNeeded() {
  const customInsts = [
    { username: "banka1", institution_id: "akbank", name: "Akbank" },
    { username: "banka2", institution_id: "banka2", name: "Banka 2" },
    { username: "banka3", institution_id: "banka3", name: "Banka 3" },
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO institutions (username, password_hash, institution_id, institution_name)
    VALUES (?, ?, ?, ?)
  `);
  const insertLegacy = db.prepare(`
    INSERT OR IGNORE INTO bank_admins (username, password_hash, institution_id, institution_name)
    VALUES (?, ?, ?, ?)
  `);

  // S-C1: her kurum için ayrı, bilinemez rastgele hash → giriş kapalı.
  runInTransaction(() => {
    for (const inst of customInsts) {
      const passwordHash = disabledLoginHash();
      insert.run(inst.username, passwordHash, inst.institution_id, inst.name);
      insertLegacy.run(inst.username, passwordHash, inst.institution_id, inst.name);
    }
  });

  const count = db.prepare("SELECT COUNT(*) AS c FROM institutions WHERE username IN ('banka1', 'banka2', 'banka3')").get().c;
  if (count === 3) {
    console.log("[DB] Banka 1, 2, 3 zaten mevcut.");
  } else {
    console.log("[DB] Custom institutions eklendi (giriş kapalı — şifre reset/panel ile atanır).");
  }

  // MIGRATION: banka1 -> akbank institution_id
  try {
    const banka1 = db.prepare("SELECT * FROM institutions WHERE username = 'banka1'").get();
    if (banka1 && banka1.institution_id !== 'akbank') {
      db.prepare("UPDATE institutions SET institution_id = 'akbank', institution_name = 'Akbank' WHERE username = 'banka1'").run();
      db.prepare("UPDATE bank_admins SET institution_id = 'akbank', institution_name = 'Akbank' WHERE username = 'banka1'").run();
      console.log("[DB] banka1 -> akbank institution_id güncellendi");
    }
  } catch (err) {
    console.warn("[DB] banka1 migration hatası:", err.message);
  }
}

/**
 * Dashboard'da görünen tüm katalog işletmelerini Super Admin listesine de ekler.
 * Böylece panel ↔ dashboard tek kaynaktan beslenir.
 * Mevcut kayıtlar (username/password) korunur — INSERT OR IGNORE.
 */
function seedCatalogInstitutionsIfNeeded() {
  const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO institutions
      (username, password_hash, institution_id, institution_name, role, subscription,
       subscription_type, subscription_end_date, is_active, created_at)
    VALUES (?, ?, ?, ?, 'business', 'Yıllık', 'Yıllık', ?, 1, '2020-01-01T00:00:00.000Z')
  `);

  let added = 0;
  runInTransaction(() => {
    for (const inst of INSTITUTIONS) {
      // akbank zaten banka1 username ile var — institution_id çakışmasında IGNORE
      const username = inst.id === "akbank" ? "banka1" : inst.id;
      // S-C1: her katalog ofisi bilinemez rastgele hash ile eklenir → giriş kapalı.
      const info = insert.run(username, disabledLoginHash(), inst.id, inst.name, endDate);
      if (info.changes > 0) added += 1;
    }
  });

  if (added > 0) {
    console.log(
      `[DB] Katalog işletmeleri eklendi: +${added} (giriş kapalı — şifre reset/panel ile atanır)`
    );
  } else {
    console.log("[DB] Katalog işletmeleri zaten mevcut.");
  }
}

/**
 * Super admin hesabını hazırlar (yalnızca hesap YOKSA).
 * Kullanıcı adı: SUPERADMIN_USERNAME (varsayılan "tuna").
 * Şifre: SUPERADMIN_INITIAL_PASSWORD; boşsa rastgele üretilir ve BİR KEZ
 * WARN log'una yazılır (S-C1). Mevcut hesabın şifresine boot'ta dokunulmaz.
 */
function seedSuperAdminIfNeeded() {
  const username = process.env.SUPERADMIN_USERNAME || "tuna";
  const existing = db
    .prepare("SELECT id FROM institutions WHERE username = ?")
    .get(username);

  if (existing) {
    // Mevcut hesabın şifresine dokunma — env şifresi yalnızca ilk oluşturmada kullanılır.
    db.prepare(`
      UPDATE institutions
      SET role = 'superadmin',
          institution_id = 'superadmin',
          institution_name = COALESCE(NULLIF(institution_name, ''), 'FinSight Super Admin')
      WHERE username = ?
    `).run(username);
    console.log(`[DB] Super admin (${username}) doğrulandı (şifre korunuyor).`);
    return;
  }

  const password = resolveSuperadminSeedPassword();
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO institutions (username, password_hash, institution_id, institution_name, role, subscription)
    VALUES (?, ?, 'superadmin', 'FinSight Super Admin', 'superadmin', 'Enterprise')
  `).run(username, passwordHash);

  console.log(`[DB] Super admin oluşturuldu (${username}).`);
}

function seedAdjustmentsIfNeeded() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO rate_adjustments (institution_id, currency, type, margin_type, margin_value)
    VALUES (?, ?, ?, 'fixed', 0)
  `);

  const rows = db
    .prepare(
      `SELECT institution_id FROM institutions
       WHERE COALESCE(role, 'business') != 'superadmin'`
    )
    .all();

  let added = 0;
  runInTransaction(() => {
    for (const row of rows) {
      for (const currency of ["EUR", "USD", "GBP"]) {
        for (const type of ["buy", "sell"]) {
          const info = insert.run(row.institution_id, currency, type);
          if (info.changes > 0) added += 1;
        }
      }
    }
  });

  if (added > 0) {
    console.log(`[DB] Rate adjustments seeded (+${added} satır, varsayılan 0)`);
  }
}

function resetAllMarginsToZero() {
  try {
    db.prepare(`DELETE FROM rate_adjustments`).run();
    console.log("[DB] Tüm rate_adjustments silinmiş ve sıfırlanmıştır");
    
    // Yeniden seed et - temiz
    const insert = db.prepare(`
      INSERT INTO rate_adjustments (institution_id, currency, type, margin_type, margin_value)
      VALUES (?, ?, ?, 'fixed', 0)
    `);
    
    const customInsts = [
      { id: "akbank", name: "Akbank" },
      { id: "banka2", name: "Banka 2" },
      { id: "banka3", name: "Banka 3" },
      { id: "sun_doviz", name: "Sun Döviz" },
    ];
    
    runInTransaction(() => {
      for (const inst of customInsts) {
        for (const currency of ["EUR", "USD", "GBP"]) {
          insert.run(inst.id, currency, "buy");
          insert.run(inst.id, currency, "sell");
        }
      }
    });
  } catch (err) {
    console.warn(`[DB] resetAllMarginsToZero error: ${err.message}`);
  }
}

function migrateAkbankMargins() {
  try {
    // banka1 instance_id'si akbank ise, marjları da akbank'a migrate et
    const banka1Margins = db.prepare("SELECT COUNT(*) AS c FROM rate_adjustments WHERE institution_id = 'banka1'").get();
    if (banka1Margins?.c > 0) {
      db.prepare("UPDATE rate_adjustments SET institution_id = 'akbank' WHERE institution_id = 'banka1'").run();
      console.log("[DB] Akbank marjları migrate edildi (banka1 -> akbank)");
    }
  } catch (err) {
    console.warn("[DB] Akbank margin migration hatası:", err.message);
  }
}

/** K-04: Test artık SÜRELİ bir deneme paketidir (eskiden sınırsızdı). */
const TEST_TRIAL_DAYS = 14;

function packageDays(subscriptionType, subscriptionDuration) {
  if (subscriptionType === "Test") return TEST_TRIAL_DAYS;
  if (subscriptionType === "Yıllık" || subscriptionDuration === "Yıllık") return 365;
  if (subscriptionType === "Aylık" || subscriptionDuration === "Aylık") return 30;
  return 30;
}

function endDateFromRemainingDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, Number(days) || 0));
  return d.toISOString();
}

function normalizeSubscriptionType(raw) {
  const t = String(raw || "Test");
  // "Ücretsiz": kalıcı, süresiz ve bilinçli listeleme (K-04 sonrası Test'in yerini almaz).
  if (t === "Test" || t === "Aylık" || t === "Yıllık" || t === "Manuel" || t === "Ücretsiz") return t;
  if (t === "Abonelik") return "Yıllık";
  return "Test";
}

/** @deprecated additive extend — prefer remaining_days */
function computeSubscriptionEndDate(subscriptionType, subscriptionDuration) {
  const d = new Date();
  d.setDate(d.getDate() + packageDays(subscriptionType, subscriptionDuration));
  return d.toISOString();
}

function buildSubscriptionLabel(subscriptionType) {
  return normalizeSubscriptionType(subscriptionType);
}

function daysRemainingFrom(endDateIso) {
  if (!endDateIso) return null;
  const end = new Date(endDateIso).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
}

/** Mevcut şubelere işletme aboneliğinden başlangıç/bitiş kopyala (yalnızca start boşsa) */
function backfillBranchSubscriptionsIfNeeded() {
  try {
    const rows = db
      .prepare(
        `SELECT b.id, b.created_at,
                i.subscription_type AS biz_type,
                i.subscription_end_date AS biz_end
         FROM branches b
         JOIN institutions i ON i.id = b.business_id
         WHERE b.subscription_start_date IS NULL OR b.subscription_start_date = ''`
      )
      .all();
    if (!rows.length) return;

    const upd = db.prepare(
      `UPDATE branches
       SET subscription_type = ?, subscription_start_date = ?, subscription_end_date = ?
       WHERE id = ?`
    );
    for (const row of rows) {
      const type = normalizeSubscriptionType(row.biz_type);
      upd.run(
        type,
        row.created_at || new Date().toISOString(),
        type === "Test" ? null : row.biz_end || null,
        row.id
      );
    }
    console.log(`[DB] ${rows.length} şube aboneliği işletmeden backfill edildi.`);
  } catch (err) {
    console.warn("[DB] branch subscription backfill:", err.message);
  }
}

/**
 * Kayıt tarihi düzeltmesi: migration sırasında datetime('now') yazılmış
 * veya Supabase hydrate sırasında kaybolmuş created_at değerlerini,
 * şube/abonelik başlangıç tarihlerinden en eskiye çeker.
 */
function backfillInstitutionCreatedAtIfNeeded() {
  try {
    const rows = db
      .prepare(
        `SELECT i.id, i.created_at,
                (SELECT MIN(COALESCE(b.subscription_start_date, b.created_at))
                 FROM branches b WHERE b.business_id = i.id) AS earliest_branch
         FROM institutions i
         WHERE COALESCE(i.role, 'business') != 'superadmin'`
      )
      .all();

    const upd = db.prepare(`UPDATE institutions SET created_at = ? WHERE id = ?`);
    let fixed = 0;
    for (const row of rows) {
      const candidates = [];
      if (row.created_at) candidates.push(row.created_at);
      if (row.earliest_branch) candidates.push(row.earliest_branch);
      if (!candidates.length) continue;

      const toMs = (v) => {
        const s = String(v).trim();
        const d = new Date(s.includes("T") || s.includes("Z") ? s : s.replace(" ", "T") + "Z");
        return d.getTime();
      };
      let best = null;
      let bestMs = Infinity;
      for (const c of candidates) {
        const ms = toMs(c);
        if (Number.isFinite(ms) && ms < bestMs) {
          bestMs = ms;
          best = c;
        }
      }
      if (!best) continue;
      const currentMs = row.created_at ? toMs(row.created_at) : NaN;
      // created_at yoksa veya şube tarihlerinden belirgin şekilde sonraysa düzelt
      if (!row.created_at || !Number.isFinite(currentMs) || currentMs > bestMs + 60_000) {
        const iso =
          String(best).includes("T") || String(best).includes("Z")
            ? new Date(best).toISOString()
            : new Date(String(best).replace(" ", "T") + "Z").toISOString();
        if (Number.isFinite(new Date(iso).getTime()) && iso !== row.created_at) {
          upd.run(iso, row.id);
          fixed += 1;
        }
      }
    }
    if (fixed > 0) {
      console.log(`[DB] ${fixed} işletme kayıt tarihi şube/başlangıç tarihinden düzeltildi.`);
    }
  } catch (err) {
    console.warn("[DB] created_at backfill:", err.message);
  }
}

/** Süresi bitmiş işletmeleri otomatik pasife alır (Test = sınırsız, hariç) */
/**
 * ⚠️ İŞ KURALI DÜZELTMESİ (denetim bulgusu K-04): Burada "Test" tipi daha ilk
 * satırda atlanıyordu — yani deneme hesapları HİÇ sona ermiyordu. Sonuç: parasını
 * ödeyen "Aylık"/"Yıllık" hesap süresi dolunca panodan kalkarken, ücretsiz "Test"
 * hesap sonsuza kadar kalıyordu (ölçüm: Albaraka Türk ve Dablöz, end_date
 * 2026-08-07 dolmuş olmasına rağmen panoda görünüyordu).
 *
 * Artık Test de süreli bir pakettir (TEST_TRIAL_DAYS) ve aynı deaktivasyon
 * yolundan geçer. Süresiz ücretsiz listeleme gerekiyorsa bunun için ayrı ve
 * açıkça adlandırılmış "Ücretsiz" tipi kullanılmalıdır.
 */
function deactivateIfExpired(row) {
  if (!row || row.role === "superadmin") return row;
  const type = normalizeSubscriptionType(row.subscription_type);
  if (type === "Ücretsiz") return row; // kalıcı ücretsiz listeleme — bilinçli istisna
  const days = daysRemainingFrom(row.subscription_end_date);
  if (days != null && days <= 0 && !(row.is_active === 0 || row.is_active === false)) {
    db.prepare(`UPDATE institutions SET is_active = 0 WHERE id = ?`).run(row.id);
    return { ...row, is_active: 0 };
  }
  return row;
}

function normalizeBranchLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function countBranchesForBusiness(businessId) {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM branches WHERE business_id = ?`)
    .get(businessId);
  return Number(row?.c) || 0;
}

/**
 * Aktif şubeler arasında en uzun kalan süreli aboneliği seç.
 * Kurum hâlâ "Test" iken şube Manuel/Aylık/Yıllık ise public/admin rozeti için kullanılır.
 */
function pickBestTimedBranchForBusiness(businessId) {
  const id = Number(businessId);
  if (!Number.isFinite(id)) return null;
  const rows = db
    .prepare(
      `SELECT ${BRANCH_SELECT_SQL}
       FROM branches
       WHERE business_id = ? AND COALESCE(is_active, 1) = 1`
    )
    .all(id);

  let best = null;
  for (const raw of rows) {
    const branch = mapBranchRow(raw);
    if (!branch || normalizeSubscriptionType(branch.subscription_type) === "Test") continue;
    if (branch.days_remaining != null && branch.days_remaining <= 0) continue;
    if (!best) {
      best = branch;
      continue;
    }
    const bestScore =
      best.days_remaining == null ? Number.POSITIVE_INFINITY : Number(best.days_remaining);
    const curScore =
      branch.days_remaining == null ? Number.POSITIVE_INFINITY : Number(branch.days_remaining);
    if (curScore > bestScore) best = branch;
  }
  return best;
}

/** Kurum satırı + şube aboneliklerinden efektif tip / bitiş / kalan gün. */
function resolveEffectiveBusinessSubscription(synced) {
  let subscription_type = synced.subscription_type || "Test";
  let subscription_end_date = synced.subscription_end_date || null;
  let days_remaining = daysRemainingFrom(subscription_end_date);

  // Kurum Test kalmış ama şubede daha uzun süreli abonelik varsa onu kullan
  if (normalizeSubscriptionType(subscription_type) === "Test" && synced.id != null) {
    const best = pickBestTimedBranchForBusiness(synced.id);
    if (best && (days_remaining == null || best.days_remaining > days_remaining)) {
      subscription_type = best.subscription_type;
      subscription_end_date = best.subscription_end_date;
      days_remaining = best.days_remaining;
    }
  }

  /**
   * ⚠️ MANTIK DÜZELTMESİ (denetim bulguları K-01 + K-04): Burada Test hesapların
   * subscription_end_date'i null'a çekiliyordu. Bunun iki yıkıcı sonucu vardı:
   *
   *  1) /api/kurlar'daki isBankVisible hiçbir zaman süre sonu göremiyordu →
   *     süresi dolmuş deneme hesapları panoda kalıcı hale geliyordu (K-04).
   *  2) Listeleme ucu bu "temizlenmiş" satırı, detay ucu ise HAM satırı
   *     görünürlük kontrolüne veriyordu → aynı işletme listede var ama detay
   *     sayfası 404 dönüyordu (K-01; ölçüm: albaraka ve dabloz 404, banka2/3
   *     ve denizbank 200).
   *
   * Artık gerçek bitiş tarihi olduğu gibi taşınıyor; yalnızca bilinçli
   * "Ücretsiz" tipi süresiz kalıyor.
   */
  if (normalizeSubscriptionType(subscription_type) === "Ücretsiz") {
    return {
      subscription_type: "Ücretsiz",
      subscription: buildSubscriptionLabel("Ücretsiz"),
      subscription_end_date: null,
      days_remaining: null,
    };
  }

  return {
    subscription_type,
    subscription: buildSubscriptionLabel(subscription_type),
    subscription_end_date,
    days_remaining,
  };
}

/**
 * Şube aboneliği güncellenince kurum kaydını Test'ten süreliye yükselt
 * (dashboard / login ile Super Admin şube aboneliği tutarlı kalsın).
 */
function syncInstitutionSubscriptionFromBranches(businessId) {
  const id = Number(businessId);
  if (!Number.isFinite(id)) return null;
  const best = pickBestTimedBranchForBusiness(id);
  if (!best) return null;

  const row = db
    .prepare(
      `SELECT id, subscription_type, subscription_end_date FROM institutions WHERE id = ?`
    )
    .get(id);
  if (!row) return null;

  const currentType = normalizeSubscriptionType(row.subscription_type || "Test");
  const currentDays = daysRemainingFrom(row.subscription_end_date);
  const bestDays = best.days_remaining;
  const shouldPromoteFromTest = currentType === "Test";
  const shouldExtend =
    bestDays != null && (currentDays == null || bestDays > currentDays);

  if (!shouldPromoteFromTest && !shouldExtend) return best;

  db.prepare(
    `UPDATE institutions
     SET subscription_type = ?, subscription = ?, subscription_end_date = ?, is_active = 1
     WHERE id = ?`
  ).run(
    best.subscription_type,
    buildSubscriptionLabel(best.subscription_type),
    best.subscription_end_date,
    id
  );
  return best;
}

function mapBusinessRow(row) {
  if (!row) return null;
  const synced = deactivateIfExpired(row);
  const eff = resolveEffectiveBusinessSubscription(synced);

  let working_hours = null;
  if (synced.working_hours) {
    try {
      working_hours =
        typeof synced.working_hours === "string"
          ? JSON.parse(synced.working_hours)
          : synced.working_hours;
    } catch (_e) {
      working_hours = null;
    }
  }
  const branch_limit = normalizeBranchLimit(synced.branch_limit ?? 1);
  const branch_count = synced.id != null ? countBranchesForBusiness(synced.id) : 0;
  return {
    ...synced,
    is_active: synced.is_active === 0 || synced.is_active === false ? false : true,
    subscription_type: eff.subscription_type,
    subscription: eff.subscription,
    subscription_end_date: eff.subscription_end_date,
    logo_url: synced.logo_url || null,
    phone: synced.phone || null,
    contact_person: synced.contact_person || null,
    email: synced.email || null,
    working_hours,
    days_remaining: eff.days_remaining,
    branch_limit,
    branch_count,
    last_login_at: synced.last_login_at || null,
  };
}

/**
 * S-H3: Logo yalnızca RASTER görsel olabilir. `image/svg+xml` reddedilir
 * (stored XSS vektörü); MIME etiketine güvenilmez — base64 gövdesinin ilk
 * baytları (magic number) beklenen türle eşleşmelidir.
 */
const LOGO_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function sanitizeLogoUrl(raw) {
  if (raw === undefined) return undefined; // güncellemede dokunma
  if (raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  // ~900KB base64 sınırı
  if (s.length > 900_000) {
    throw new Error("Logo dosyası çok büyük. Lütfen daha küçük bir görsel kullanın.");
  }
  const m = s.match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([\s\S]+)$/i);
  if (!m) {
    throw new Error("Logo yalnızca base64 kodlu görsel (data:image/...;base64,) olabilir.");
  }
  const declaredMime = String(m[1] || "").toLowerCase().trim();
  if (declaredMime === "image/svg+xml" || declaredMime.includes("svg")) {
    throw new Error("SVG logo kabul edilmez. PNG, JPEG, WEBP veya GIF kullanın.");
  }
  if (!LOGO_ALLOWED_MIME.has(declaredMime)) {
    throw new Error("Desteklenmeyen logo türü. PNG, JPEG, WEBP veya GIF kullanın.");
  }
  let buf;
  try {
    buf = Buffer.from(m[2], "base64");
  } catch (_e) {
    throw new Error("Logo verisi çözülemedi.");
  }
  const sniffed = sniffImageMime(buf);
  if (!sniffed) {
    throw new Error("Logo içeriği geçerli bir görsel değil (PNG/JPEG/WEBP/GIF).");
  }
  const norm = (x) => (x === "image/jpg" ? "image/jpeg" : x);
  if (norm(sniffed) !== norm(declaredMime)) {
    throw new Error("Logo türü ile içeriği uyuşmuyor.");
  }
  return `data:${norm(sniffed)};base64,${buf.toString("base64")}`;
}

function backfillSubscriptionFieldsIfNeeded() {
  try {
    const missing = db
      .prepare(
        `SELECT id, institution_name, subscription_end_date
         FROM institutions
         WHERE COALESCE(role, 'business') != 'superadmin'
           AND (subscription_end_date IS NULL OR subscription_type IS NULL OR subscription_type = '')`
      )
      .all();

    const updateMissing = db.prepare(`
      UPDATE institutions
      SET subscription_type = ?, subscription = ?, subscription_end_date = ?, is_active = COALESCE(is_active, 1)
      WHERE id = ?
    `);

    for (const row of missing) {
      const nameIsTest = /\(test\)/i.test(String(row.institution_name || ""));
      const type = nameIsTest ? "Test" : "Yıllık";
      updateMissing.run(
        type,
        buildSubscriptionLabel(type),
        row.subscription_end_date || endDateFromRemainingDays(type === "Test" ? 14 : 365),
        row.id
      );
    }
  } catch (err) {
    console.warn("[DB] subscription backfill hatası:", err.message);
  }
}

function findAdminByUsername(username) {
  const clean = String(username || "").trim();
  // E-posta ile giriş engeli — yalnızca Giriş ID
  if (!clean || clean.includes("@")) return null;

  const row = db
    .prepare(
      `SELECT id, username, password_hash, institution_id, institution_name,
              COALESCE(role, 'business') AS role,
              COALESCE(subscription, 'Test') AS subscription,
              COALESCE(subscription_type, 'Test') AS subscription_type,
              subscription_end_date,
              COALESCE(is_active, 1) AS is_active
       FROM institutions WHERE username = ?`
    )
    .get(clean);

  if (!row) return null;
  const synced = deactivateIfExpired(row);
  const eff = resolveEffectiveBusinessSubscription(synced);
  return {
    ...synced,
    ...eff,
    is_active: synced.is_active === 0 || synced.is_active === false ? 0 : 1,
  };
}

function listBusinesses() {
  return db
    .prepare(
      `SELECT id, username, institution_id, institution_name,
              COALESCE(role, 'business') AS role,
              COALESCE(subscription, 'Test') AS subscription,
              COALESCE(subscription_type, 'Test') AS subscription_type,
              subscription_end_date,
              COALESCE(is_active, 1) AS is_active,
              COALESCE(branch_limit, 1) AS branch_limit,
              logo_url,
              phone,
              email,
              contact_person,
              working_hours,
              created_at,
              last_login_at
       FROM institutions
       WHERE COALESCE(role, 'business') != 'superadmin'
       ORDER BY institution_name COLLATE NOCASE ASC`
    )
    .all()
    .map(mapBusinessRow);
}

function getInstitutionsMetaById() {
  const rows = db
    .prepare(
      `SELECT institution_id, institution_name,
              COALESCE(subscription_type, 'Test') AS subscription_type,
              subscription_end_date,
              COALESCE(is_active, 1) AS is_active,
              logo_url
       FROM institutions
       WHERE COALESCE(role, 'business') != 'superadmin'`
    )
    .all();

  const map = {};
  for (const row of rows) {
    map[row.institution_id] = {
      subscription_type: row.subscription_type || "Test",
      subscription_end_date: row.subscription_end_date || null,
      is_active: !(row.is_active === 0 || row.is_active === false),
      logo_url: row.logo_url || null,
    };
  }
  return map;
}

/** İşletme oluşturulma zamanı (ms). Yoksa null. */
function getInstitutionCreatedAtMs(institutionId) {
  const id = String(institutionId || "").trim().toLowerCase();
  if (!id) return null;
  const row = db
    .prepare(
      `SELECT created_at FROM institutions
       WHERE lower(institution_id) = ? AND COALESCE(role, 'business') != 'superadmin'
       LIMIT 1`
    )
    .get(id);
  if (!row?.created_at) return null;
  const ms = new Date(row.created_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** SQLite margin_history satırları (buy|sell) */
function getMarginHistoryForInstitution(institutionId, currency, type) {
  const id = String(institutionId || "").trim().toLowerCase();
  return db
    .prepare(
      `SELECT margin_type, margin_value, recorded_at FROM margin_history
       WHERE institution_id = ? AND currency = ? AND type = ?
       ORDER BY recorded_at ASC`
    )
    .all(id, currency, type);
}

function normalizeLoginId(username) {
  const clean = String(username || "").trim();
  if (!clean) throw new Error("Giriş ID zorunludur.");
  if (clean.includes("@") || /^.+@.+\..+$/.test(clean)) {
    throw new Error("Giriş ID e-posta olamaz. E-posta alanını ayrı kullanın.");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(clean)) {
    throw new Error("Giriş ID yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir.");
  }
  return clean;
}

function normalizeContactEmail(email, { required = false } = {}) {
  const clean = String(email || "").trim();
  if (!clean) {
    if (required) throw new Error("E-posta zorunludur.");
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    throw new Error("Geçerli bir e-posta adresi girin.");
  }
  return clean.toLowerCase();
}

/**
 * U-14: Aynı işletme adının iki kez kaydedilmesini engeller (büyük/küçük harf ve
 * Türkçe karakter duyarsız). excludeId verilirse o kayıt kendisiyle çakışmaz.
 */
function assertInstitutionNameAvailable(name, excludeId = null) {
  const key = String(name || "").trim().toLocaleLowerCase("tr-TR");
  if (!key) return;
  const rows = db
    .prepare(
      `SELECT id, institution_name FROM institutions
       WHERE COALESCE(role, 'business') != 'superadmin'`
    )
    .all();
  const clash = rows.find(
    (r) =>
      String(r.institution_name || "").trim().toLocaleLowerCase("tr-TR") === key &&
      (excludeId == null || Number(r.id) !== Number(excludeId))
  );
  if (clash) {
    throw new Error(`"${name}" adında bir işletme zaten kayıtlı (ID ${clash.id}).`);
  }
}

function createBusiness({
  username,
  password,
  institution_name,
  contact_person,
  email,
  subscription_type = "Test",
  remaining_days,
  is_active = true,
  logo_url,
  branch_limit = 1,
}) {
  const cleanUsername = normalizeLoginId(username);
  const cleanEmail = normalizeContactEmail(email, { required: true });
  const cleanName = String(institution_name || "").trim();
  const cleanContactPerson = String(contact_person || "").trim() || null;
  const type = normalizeSubscriptionType(subscription_type);
  const label = buildSubscriptionLabel(type);
  const limit = normalizeBranchLimit(branch_limit);
  // K-04: Yalnızca "Ücretsiz" süresizdir. Test artık TEST_TRIAL_DAYS günlük denemedir.
  let endDate = null;
  if (type !== "Ücretsiz") {
    let days =
      remaining_days != null
        ? Math.max(0, Number(remaining_days) || 0)
        : packageDays(type);
    if (!Number.isFinite(days) || days <= 0) {
      days = packageDays(type);
    }
    endDate = endDateFromRemainingDays(days);
  }
  // Yeni işletme varsayılan AKTİF (1); yalnızca açıkça false/0 gelirse pasif
  const active = is_active === false || is_active === 0 || is_active === "0" ? 0 : 1;
  const passwordHash = bcrypt.hashSync(String(password || ""), 10);
  const logo = sanitizeLogoUrl(logo_url === undefined ? null : logo_url);

  if (!password || !cleanName) {
    throw new Error("İşletme adı, giriş ID, e-posta ve şifre zorunludur.");
  }

  /**
   * U-14: İşletme adında tekillik kontrolü yoktu; veritabanında aynı adla iki
   * kayıt oluşabiliyordu (ölçüm: "Sun Döviz" hem sundoviz hem sun_doviz olarak).
   * Süper admin listesinde bunlar birbirinden ayırt edilemiyordu.
   */
  assertInstitutionNameAvailable(cleanName, null);

  // Bilinen banka adına eşleşirse dashboard kartıyla aynı institution_id kullan
  const known = findInstitutionByName(cleanName);
  const userSlug =
    cleanUsername
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "";
  const nameSlug =
    cleanName
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "";
  // Çok kısa giriş ID (örn. "x") institution_id olmasın — isim slug'ı tercih et
  const slug =
    (userSlug.length >= 3 ? userSlug : null) ||
    (nameSlug.length >= 3 ? nameSlug : null) ||
    userSlug ||
    nameSlug ||
    `biz_${Date.now()}`;
  const institutionId = known?.id || slug;

  const selectAfterInsert = `SELECT id, username, institution_id, institution_name, role, subscription, subscription_type, subscription_end_date, is_active, COALESCE(branch_limit, 1) AS branch_limit, logo_url, email, contact_person, created_at
           FROM institutions WHERE id = ?`;

  try {
    const result = db
      .prepare(
        `INSERT INTO institutions
          (username, password_hash, institution_id, institution_name, role, subscription, subscription_type, subscription_end_date, is_active, logo_url, branch_limit, contact_person, email)
         VALUES (?, ?, ?, ?, 'business', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        cleanUsername,
        passwordHash,
        institutionId,
        cleanName,
        label,
        type,
        endDate,
        active,
        logo,
        limit,
        cleanContactPerson,
        cleanEmail
      );

    return mapBusinessRow(
      db.prepare(selectAfterInsert).get(result.lastInsertRowid)
    );
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) {
      // Bilinen banka ID çakışırsa username slug ile tekrar dene
      if (known?.id && institutionId === known.id) {
        try {
          const result = db
            .prepare(
              `INSERT INTO institutions
                (username, password_hash, institution_id, institution_name, role, subscription, subscription_type, subscription_end_date, is_active, logo_url, branch_limit, contact_person, email)
               VALUES (?, ?, ?, ?, 'business', ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              cleanUsername,
              passwordHash,
              slug,
              cleanName,
              label,
              type,
              endDate,
              active,
              logo,
              limit,
              cleanContactPerson,
              cleanEmail
            );
          return mapBusinessRow(
            db.prepare(selectAfterInsert).get(result.lastInsertRowid)
          );
        } catch (err2) {
          if (String(err2.message || "").includes("UNIQUE")) {
            throw new Error("Bu giriş ID veya kurum ID zaten kayıtlı.");
          }
          throw err2;
        }
      }
      throw new Error("Bu giriş ID veya kurum ID zaten kayıtlı.");
    }
    throw err;
  }
}

function updateBusiness(id, {
  username,
  password,
  institution_name,
  contact_person,
  email,
  subscription_type,
  remaining_days,
  is_active,
  logo_url,
  branch_limit,
}) {
  const row = db
    .prepare(
      `SELECT id, username, institution_id, institution_name, role, subscription, subscription_type, subscription_end_date, is_active, logo_url, email, contact_person, COALESCE(branch_limit, 1) AS branch_limit
       FROM institutions WHERE id = ?`
    )
    .get(id);

  if (!row) throw new Error("İşletme bulunamadı.");
  if (row.role === "superadmin") throw new Error("Super admin hesabı bu uçtan düzenlenemez.");

  const nextUsername =
    username != null ? normalizeLoginId(username) : normalizeLoginId(row.username);
  const nextName = institution_name != null ? String(institution_name).trim() : row.institution_name;
  const nextContactPerson =
    contact_person === undefined
      ? row.contact_person || null
      : String(contact_person || "").trim() || null;
  /**
   * ⚠️ MANTIK DÜZELTMESİ (denetim bulgusu Y-01): E-posta her güncellemede zorunlu
   * tutuluyordu. Düzenleme formu alanı `biz.email || ""` ile doldurduğu için,
   * e-postası olmayan ESKİ kayıtlarda boş string gidiyor ve yönetici hiçbir
   * değişikliği (abonelik uzatma, şube limiti, durum) kaydedemiyordu —
   * 22 işletmenin 21'i bu durumdaydı.
   *
   * Yeni kural: e-posta yalnızca GERÇEKTEN bir değer girildiğinde doğrulanır.
   * Kayıtta zaten e-posta varsa boşaltılmasına izin verilmez (veri kaybı olmaz);
   * hiç yoksa boş bırakmak serbesttir.
   */
  const emailProvided =
    email !== undefined && email !== null && String(email).trim() !== "";
  let nextEmail;
  if (emailProvided) {
    nextEmail = normalizeContactEmail(email, { required: true });
  } else if (email === undefined) {
    nextEmail = row.email || null; // alan hiç gönderilmedi → dokunma
  } else if (row.email) {
    throw new Error(
      "Bu işletmenin kayıtlı e-postası var; e-posta alanı boş bırakılarak silinemez."
    );
  } else {
    nextEmail = null; // kayıtta da yok, girilmedi de → serbest
  }
  const typeChanged = subscription_type != null || remaining_days != null;
  const nextType = typeChanged
    ? normalizeSubscriptionType(subscription_type ?? row.subscription_type)
    : normalizeSubscriptionType(row.subscription_type);
  const nextLabel = typeChanged ? buildSubscriptionLabel(nextType) : (row.subscription || buildSubscriptionLabel(nextType));
  let endDate = row.subscription_end_date;
  if (typeChanged) {
    // K-04: yalnızca "Ücretsiz" süresizdir; Test dahil diğerleri bitiş tarihi alır.
    if (nextType === "Ücretsiz") {
      endDate = null;
    } else {
      endDate = endDateFromRemainingDays(
        remaining_days != null ? remaining_days : packageDays(nextType)
      );
    }
  } else if (!endDate && nextType !== "Ücretsiz") {
    endDate = endDateFromRemainingDays(packageDays(nextType));
  }
  const active =
    is_active === undefined || is_active === null
      ? (row.is_active === 0 ? 0 : 1)
      : (is_active === false || is_active === 0 ? 0 : 1);

  const nextLogo =
    logo_url === undefined ? row.logo_url || null : sanitizeLogoUrl(logo_url);
  const nextBranchLimit =
    branch_limit === undefined || branch_limit === null
      ? normalizeBranchLimit(row.branch_limit)
      : normalizeBranchLimit(branch_limit);

  if (!nextUsername || !nextName) {
    throw new Error("Giriş ID ve işletme adı zorunludur.");
  }
  assertInstitutionNameAvailable(nextName, id); // U-14


  const passwordHash =
    password && String(password).trim()
      ? bcrypt.hashSync(String(password).trim(), 10)
      : null;

  try {
    if (passwordHash) {
      db.prepare(
        `UPDATE institutions
         SET username = ?, institution_name = ?, subscription = ?, subscription_type = ?,
             subscription_end_date = ?, is_active = ?, logo_url = ?, branch_limit = ?, contact_person = ?, email = ?, password_hash = ?
         WHERE id = ?`
      ).run(
        nextUsername,
        nextName,
        nextLabel,
        nextType,
        endDate,
        active,
        nextLogo,
        nextBranchLimit,
        nextContactPerson,
        nextEmail,
        passwordHash,
        id
      );
    } else {
      db.prepare(
        `UPDATE institutions
         SET username = ?, institution_name = ?, subscription = ?, subscription_type = ?,
             subscription_end_date = ?, is_active = ?, logo_url = ?, branch_limit = ?, contact_person = ?, email = ?
         WHERE id = ?`
      ).run(
        nextUsername,
        nextName,
        nextLabel,
        nextType,
        endDate,
        active,
        nextLogo,
        nextBranchLimit,
        nextContactPerson,
        nextEmail,
        id
      );
    }
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) {
      throw new Error("Bu giriş ID zaten kullanılıyor.");
    }
    throw err;
  }

  return mapBusinessRow(
    db
      .prepare(
        `SELECT id, username, institution_id, institution_name, role, subscription, subscription_type, subscription_end_date, is_active, COALESCE(branch_limit, 1) AS branch_limit, logo_url, email, contact_person, created_at
         FROM institutions WHERE id = ?`
      )
      .get(id)
  );
}

function resetBusinessSubscription(id) {
  const row = db.prepare(`SELECT id, role FROM institutions WHERE id = ?`).get(id);
  if (!row) throw new Error("İşletme bulunamadı.");
  if (row.role === "superadmin") throw new Error("Super admin hesabı bu uçtan düzenlenemez.");

  db.prepare(
    `UPDATE institutions
     SET subscription_end_date = ?, is_active = 0
     WHERE id = ?`
  ).run(new Date().toISOString(), id);

  return mapBusinessRow(
    db
      .prepare(
        `SELECT id, username, institution_id, institution_name, role, subscription, subscription_type, subscription_end_date, is_active, created_at
         FROM institutions WHERE id = ?`
      )
      .get(id)
  );
}

function updateBusinessStatus(id, is_active) {
  const row = db
    .prepare(
      `SELECT id, role, subscription_type, subscription_end_date, is_active FROM institutions WHERE id = ?`
    )
    .get(id);

  if (!row) throw new Error("İşletme bulunamadı.");
  if (row.role === "superadmin") throw new Error("Super admin hesabı bu uçtan düzenlenemez.");

  const wantActive = !(is_active === false || is_active === 0);
  if (wantActive) {
    const type = normalizeSubscriptionType(row.subscription_type);
    if (type !== "Test") {
      const days = daysRemainingFrom(row.subscription_end_date);
      if (days != null && days <= 0) {
        throw new Error("Süresi bitmiş işletme aktif edilemez. Önce abonelik süresini uzatın.");
      }
    }
  }

  const active = wantActive ? 1 : 0;
  db.prepare(`UPDATE institutions SET is_active = ? WHERE id = ?`).run(active, id);

  return mapBusinessRow(
    db
      .prepare(
        `SELECT id, username, institution_id, institution_name, role, subscription, subscription_type, subscription_end_date, is_active, created_at
         FROM institutions WHERE id = ?`
      )
      .get(id)
  );
}

function deleteBusiness(id) {
  const row = db
    .prepare(`SELECT id, role, institution_id FROM institutions WHERE id = ?`)
    .get(id);
  if (!row) throw new Error("İşletme bulunamadı.");
  if (row.role === "superadmin") throw new Error("Super admin hesabı silinemez.");

  const slug = String(row.institution_id || "").trim();
  runInTransaction(() => {
    db.prepare(`DELETE FROM branches WHERE business_id = ?`).run(id);
    db.prepare(`DELETE FROM branch_requests WHERE business_id = ?`).run(id);
    db.prepare(`DELETE FROM business_notifications WHERE business_id = ?`).run(id);
    db.prepare(`DELETE FROM password_resets WHERE institution_id = ?`).run(id);
    if (slug) {
      db.prepare(`DELETE FROM rate_adjustments WHERE institution_id = ?`).run(slug);
      db.prepare(`DELETE FROM margin_history WHERE institution_id = ?`).run(slug);
    }
    db.prepare(`DELETE FROM institutions WHERE id = ?`).run(id);
  });
  return { ok: true, id, institution_id: slug || null };
}

function assertBusinessExists(businessId) {
  const row = db
    .prepare(
      `SELECT id, institution_name, role FROM institutions WHERE id = ?`
    )
    .get(businessId);
  if (!row) throw new Error("İşletme bulunamadı.");
  if (row.role === "superadmin") throw new Error("Super admin için şube eklenemez.");
  return row;
}

const BRANCH_SELECT_SQL = `id, business_id, name, phone, COALESCE(whatsapp, '') AS whatsapp, address, lat, lng,
  COALESCE(subscription_type, 'Test') AS subscription_type,
  subscription_start_date, subscription_end_date,
  COALESCE(is_active, 1) AS is_active,
  created_at, updated_at`;

function deactivateBranchIfExpired(row) {
  if (!row) return row;
  if (normalizeSubscriptionType(row.subscription_type) === "Test") return row;
  const days = daysRemainingFrom(row.subscription_end_date);
  if (days != null && days <= 0 && !(row.is_active === 0 || row.is_active === false)) {
    db.prepare(`UPDATE branches SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(
      row.id
    );
    return { ...row, is_active: 0 };
  }
  return row;
}

function mapBranchRow(row) {
  if (!row) return null;
  const synced = deactivateBranchIfExpired(row);
  const subscription_type = normalizeSubscriptionType(synced.subscription_type || "Test");
  const subscription_end_date =
    subscription_type === "Test" ? null : synced.subscription_end_date || null;
  return {
    id: synced.id,
    business_id: synced.business_id,
    name: synced.name,
    phone: synced.phone || "",
    whatsapp: synced.whatsapp || "",
    address: synced.address || "",
    lat: synced.lat == null ? null : Number(synced.lat),
    lng: synced.lng == null ? null : Number(synced.lng),
    subscription_type,
    subscription_start_date: synced.subscription_start_date || synced.created_at || null,
    subscription_end_date,
    is_active: !(synced.is_active === 0 || synced.is_active === false),
    days_remaining:
      subscription_type === "Test" ? null : daysRemainingFrom(subscription_end_date),
    created_at: synced.created_at,
    updated_at: synced.updated_at,
  };
}

function resolveBranchSubscriptionFields(
  {
    subscription_type,
    subscription_start_date,
    subscription_end_date,
    remaining_days,
  } = {},
  fallback = {}
) {
  const type = normalizeSubscriptionType(
    subscription_type !== undefined ? subscription_type : fallback.subscription_type || "Test"
  );
  const start =
    subscription_start_date !== undefined && subscription_start_date !== null
      ? String(subscription_start_date).trim() || null
      : fallback.subscription_start_date || new Date().toISOString();

  let end;
  if (type === "Test") {
    end = null;
  } else if (remaining_days !== undefined && remaining_days !== null && remaining_days !== "") {
    end = endDateFromRemainingDays(remaining_days);
  } else if (subscription_end_date !== undefined) {
    end =
      subscription_end_date == null || subscription_end_date === ""
        ? null
        : String(subscription_end_date);
  } else {
    end = fallback.subscription_end_date || null;
  }

  return {
    subscription_type: type,
    subscription_start_date: start,
    subscription_end_date: end,
  };
}

function listBranchesByBusiness(businessId) {
  assertBusinessExists(businessId);
  return db
    .prepare(
      `SELECT ${BRANCH_SELECT_SQL}
       FROM branches
       WHERE business_id = ?
       ORDER BY name COLLATE NOCASE ASC`
    )
    .all(businessId)
    .map(mapBranchRow);
}

/** Public görünürlük: aktif + abonelik süresi dolmamış */
/**
 * Bir kurumun public yüzeyde (pano, slug listesi, sitemap, detay sayfası)
 * görünüp görünmeyeceğine karar veren TEK yer.
 *
 * ⚠️ MANTIK DÜZELTMESİ (denetim bulgusu K-01): Bu fonksiyon iki farklı biçimde
 * besleniyordu — listeleme ucu mapBusinessRow'dan geçmiş satırı, detay ucu ise
 * ham tablo satırını veriyordu. İkisi farklı sonuç verince aynı işletme listede
 * görünüp detayında 404 dönüyordu. Artık girdi ne olursa olsun önce
 * mapBusinessRow ile normalize ediliyor; çağıranlar arasında fark kalmıyor.
 */
function isInstitutionPubliclyVisible(row) {
  if (!row) return false;
  if (row.role === "superadmin") return false;

  // Ham satır geldiyse (id + username var, days_remaining yok) normalize et.
  const normalized =
    row.days_remaining === undefined && row.id != null ? mapBusinessRow(row) : row;
  if (!normalized) return false;
  if (normalized.is_active === 0 || normalized.is_active === false) return false;

  if (normalized.subscription_end_date) {
    const end = new Date(normalized.subscription_end_date).getTime();
    if (Number.isFinite(end) && end <= Date.now()) return false;
  }
  return true;
}

/** Public: institution_id slug (örn. akbank) ile şubeleri getir — yalnızca aktif işletme */
function listBranchesByInstitutionKey(institutionKey) {
  const key = String(institutionKey || "").trim();
  if (!key) return [];

  const business = db
    .prepare(
      `SELECT id, role, COALESCE(is_active, 1) AS is_active, subscription_end_date
       FROM institutions
       WHERE institution_id = ? AND COALESCE(role, 'business') != 'superadmin'
       LIMIT 1`
    )
    .get(key);

  if (!business || !isInstitutionPubliclyVisible(business)) return [];

  return db
    .prepare(
      `SELECT ${BRANCH_SELECT_SQL}
       FROM branches
       WHERE business_id = ?
         AND COALESCE(is_active, 1) = 1
       ORDER BY name COLLATE NOCASE ASC`
    )
    .all(business.id)
    .map(mapBranchRow);
}

const {
  slugify,
  buildBusinessSlug,
  buildBranchSlug,
  extractCitySlug,
  CITY_RULES,
} = require("./slug");

/**
 * Public SEO: slug ile döviz bürosu + şubeler.
 * Eşleşme: institution_id, işletme adı slug'ı veya şube slug'ı (örn. lefkosa-merkez-doviz).
 */
function getPublicExchangeOfficeBySlug(rawSlug) {
  const slug = slugify(rawSlug);
  if (!slug) return null;

  const rows = db
    .prepare(
      `SELECT id, username, institution_id, institution_name,
              COALESCE(role, 'business') AS role,
              COALESCE(subscription, 'Test') AS subscription,
              COALESCE(subscription_type, 'Test') AS subscription_type,
              subscription_end_date,
              COALESCE(is_active, 1) AS is_active,
              COALESCE(branch_limit, 1) AS branch_limit,
              logo_url, email, phone, contact_person, working_hours, created_at
       FROM institutions
       WHERE COALESCE(role, 'business') != 'superadmin'`
    )
    .all()
    .filter((row) => isInstitutionPubliclyVisible(row));

  let matched = null;
  let matchedBranchId = null;
  let matchedVia = null;

  for (const row of rows) {
    const businessSlug = buildBusinessSlug({
      institution_id: row.institution_id,
      institution_name: row.institution_name,
    });
    const nameSlug = slugify(
      String(row.institution_name || "")
        .replace(/\s*\([Tt]est\)\s*/g, " ")
        .trim()
    );

    if (businessSlug === slug || nameSlug === slug || slugify(row.institution_id) === slug) {
      matched = row;
      matchedVia = "business";
      break;
    }

    const branches = listBranchesByBusiness(row.id);
    for (const branch of branches) {
      if (!branch.is_active) continue;
      const bSlug = buildBranchSlug(branch, row.institution_name);
      if (bSlug === slug) {
        matched = row;
        matchedBranchId = branch.id;
        matchedVia = "branch";
        break;
      }
    }
    if (matched) break;
  }

  if (!matched) return null;

  const business = mapBusinessRow(matched);
  const branches = listBranchesByBusiness(matched.id)
    .filter((b) => b.is_active)
    .map((branch) => {
      const city = extractCitySlug(branch.address);
      return {
        ...branch,
        city,
        slug: buildBranchSlug(branch, matched.institution_name),
      };
    });

  const canonicalSlug =
    matchedVia === "branch" && matchedBranchId
      ? branches.find((b) => b.id === matchedBranchId)?.slug ||
        buildBusinessSlug({
          institution_id: matched.institution_id,
          institution_name: matched.institution_name,
        })
      : buildBusinessSlug({
          institution_id: matched.institution_id,
          institution_name: matched.institution_name,
        });

  return {
    business,
    branches,
    matchedBranchId,
    matchedVia,
    slug: canonicalSlug,
    businessSlug: buildBusinessSlug({
      institution_id: matched.institution_id,
      institution_name: matched.institution_name,
    }),
  };
}

/** Sitemap / liste: tüm public işletme + şube slug'ları */
function listPublicExchangeOfficeSlugs() {
  const rows = listBusinesses().filter((biz) =>
    isInstitutionPubliclyVisible({
      role: biz.role,
      is_active: biz.is_active,
      subscription_end_date: biz.subscription_end_date,
    })
  );

  const items = [];
  for (const biz of rows) {
    const businessSlug = buildBusinessSlug({
      institution_id: biz.institution_id,
      institution_name: biz.institution_name,
    });
    items.push({
      type: "business",
      slug: businessSlug,
      name: biz.institution_name,
      institution_id: biz.institution_id,
      path: `/doviz-burosu/${businessSlug}`,
    });

    const branches = listBranchesByBusiness(biz.id).filter((b) => b.is_active);
    for (const branch of branches) {
      const bSlug = buildBranchSlug(branch, biz.institution_name);
      items.push({
        type: "branch",
        slug: bSlug,
        name: branch.name,
        institution_id: biz.institution_id,
        institution_name: biz.institution_name,
        address: branch.address,
        city: extractCitySlug(branch.address),
        path: `/doviz-burosu/${bSlug}`,
        branch_id: branch.id,
      });
    }
  }
  return items;
}

/**
 * Hayalet / yetim şubeleri temizler:
 * - business_id kurum tablosunda yok
 * - bağlı kurum pasif veya süresi dolmuş (public SoT ile uyum)
 * Not: Super Admin şube yönetimi için pasif işletme şubeleri silinmez —
 * yalnızca gerçekten orphan (FK kırık) satırlar silinir.
 */
function purgeOrphanBranches() {
  const orphaned = db
    .prepare(
      `DELETE FROM branches
       WHERE business_id NOT IN (SELECT id FROM institutions)`
    )
    .run();
  if (orphaned.changes > 0) {
    console.log(`[DB] Yetim şube temizlendi: ${orphaned.changes}`);
  }
  return orphaned.changes;
}

/**
 * Supabase SoT hydrate sonrası: yerel şubeleri Supabase listesiyle değiştir.
 * Böylece yalnızca SQLite'ta kalan "hayalet" şubeler (örn. silinmiş Akbank şubeleri) kalkar.
 */
function replaceBusinessBranchesFromSupabase(branchRows) {
  const rows = Array.isArray(branchRows) ? branchRows : [];
  runInTransaction(() => {
    db.prepare(
      `DELETE FROM branches
       WHERE business_id IN (
         SELECT id FROM institutions WHERE COALESCE(role, 'business') != 'superadmin'
       )`
    ).run();
    for (const row of rows) {
      applySupabaseBranchRow(row);
    }
  });
  console.log(`[DB] Şubeler Supabase SoT ile değiştirildi (${rows.length} satır).`);
}

function createBranch({
  business_id,
  name,
  phone,
  whatsapp,
  address,
  lat,
  lng,
  subscription_type,
  subscription_start_date,
  subscription_end_date,
  remaining_days,
}) {
  const businessId = Number(business_id);
  if (!Number.isFinite(businessId)) throw new Error("business_id zorunludur.");
  assertBusinessExists(businessId);

  const biz = db
    .prepare(
      `SELECT COALESCE(branch_limit, 1) AS branch_limit,
              COALESCE(subscription_type, 'Test') AS subscription_type,
              subscription_end_date
       FROM institutions WHERE id = ?`
    )
    .get(businessId);
  const limit = normalizeBranchLimit(biz?.branch_limit);
  const currentCount = countBranchesForBusiness(businessId);
  if (currentCount >= limit) {
    const err = new Error(
      "Şube limitine ulaşıldı. Yeni şube eklemek için limit artırın veya iletişime geçin."
    );
    err.statusCode = 403;
    err.code = "BRANCH_LIMIT_REACHED";
    throw err;
  }

  const branchName = String(name || "").trim();
  if (!branchName) throw new Error("Şube adı zorunludur.");

  const sub = resolveBranchSubscriptionFields(
    {
      subscription_type,
      subscription_start_date,
      subscription_end_date,
      remaining_days,
    },
    {
      subscription_type: biz?.subscription_type,
      subscription_start_date: new Date().toISOString(),
      subscription_end_date: biz?.subscription_end_date,
    }
  );

  const info = db
    .prepare(
      `INSERT INTO branches (
         business_id, name, phone, whatsapp, address, lat, lng,
         subscription_type, subscription_start_date, subscription_end_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      businessId,
      branchName,
      String(phone || "").trim(),
      String(whatsapp || "").trim(),
      String(address || "").trim(),
      lat == null || lat === "" ? null : Number(lat),
      lng == null || lng === "" ? null : Number(lng),
      sub.subscription_type,
      sub.subscription_start_date,
      sub.subscription_end_date
    );

  syncInstitutionSubscriptionFromBranches(businessId);

  return mapBranchRow(
    db.prepare(`SELECT ${BRANCH_SELECT_SQL} FROM branches WHERE id = ?`).get(info.lastInsertRowid)
  );
}

function updateBranch(
  id,
  {
    name,
    phone,
    whatsapp,
    address,
    lat,
    lng,
    subscription_type,
    subscription_start_date,
    subscription_end_date,
    remaining_days,
    is_active,
  }
) {
  const row = db.prepare(`SELECT id FROM branches WHERE id = ?`).get(id);
  if (!row) throw new Error("Şube bulunamadı.");

  const existing = db
    .prepare(`SELECT ${BRANCH_SELECT_SQL} FROM branches WHERE id = ?`)
    .get(id);

  const branchName =
    name !== undefined ? String(name || "").trim() : String(existing.name || "").trim();
  if (!branchName) throw new Error("Şube adı zorunludur.");

  const nextPhone = phone !== undefined ? String(phone || "").trim() : existing.phone || "";
  const nextWhatsapp =
    whatsapp !== undefined ? String(whatsapp || "").trim() : existing.whatsapp || "";
  const nextAddress =
    address !== undefined ? String(address || "").trim() : existing.address || "";
  const nextLat =
    lat !== undefined
      ? lat == null || lat === ""
        ? null
        : Number(lat)
      : existing.lat;
  const nextLng =
    lng !== undefined
      ? lng == null || lng === ""
        ? null
        : Number(lng)
      : existing.lng;

  const subTouched =
    subscription_type !== undefined ||
    subscription_start_date !== undefined ||
    subscription_end_date !== undefined ||
    remaining_days !== undefined;

  const sub = subTouched
    ? resolveBranchSubscriptionFields(
        {
          subscription_type,
          subscription_start_date,
          subscription_end_date,
          remaining_days,
        },
        existing
      )
    : {
        subscription_type: existing.subscription_type || "Test",
        subscription_start_date: existing.subscription_start_date || existing.created_at,
        subscription_end_date: existing.subscription_end_date,
      };

  const nextActive =
    is_active === undefined
      ? existing.is_active === 0 || existing.is_active === false
        ? 0
        : 1
      : is_active === false || is_active === 0 || is_active === "0"
        ? 0
        : 1;

  db.prepare(
    `UPDATE branches
     SET name = ?, phone = ?, whatsapp = ?, address = ?, lat = ?, lng = ?,
         subscription_type = ?, subscription_start_date = ?, subscription_end_date = ?,
         is_active = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    branchName,
    nextPhone,
    nextWhatsapp,
    nextAddress,
    nextLat,
    nextLng,
    sub.subscription_type,
    sub.subscription_start_date,
    sub.subscription_type === "Test" ? null : sub.subscription_end_date,
    nextActive,
    id
  );

  if (subTouched) {
    syncInstitutionSubscriptionFromBranches(existing.business_id);
  }

  return mapBranchRow(db.prepare(`SELECT ${BRANCH_SELECT_SQL} FROM branches WHERE id = ?`).get(id));
}

function deleteBranch(id) {
  const row = db.prepare(`SELECT id FROM branches WHERE id = ?`).get(id);
  if (!row) throw new Error("Şube bulunamadı.");
  db.prepare(`DELETE FROM branches WHERE id = ?`).run(id);
  return { ok: true, id };
}

function getAdjustmentsForInstitution(institutionId) {
  const result = {};
  for (const currency of ["EUR", "USD", "GBP"]) {
    result[`${currency}_buy`] = { margin_type: "fixed", margin_value: 0 };
    result[`${currency}_sell`] = { margin_type: "fixed", margin_value: 0 };
  }

  try {
    const rows = db
      .prepare(
        `SELECT currency, type, margin_type, margin_value, updated_at
         FROM rate_adjustments WHERE institution_id = ?`
      )
      .all(institutionId);

    for (const row of rows) {
      if (!row.type) continue;
      const key = `${row.currency}_${row.type}`;
      result[key] = {
        margin_type: row.margin_type === "percent" ? "percent" : "fixed",
        margin_value: Math.max(0, Number(row.margin_value) || 0),
        updated_at: row.updated_at,
      };
    }
  } catch (err) {
    console.warn(`[DB] getAdjustments error: ${err.message}, using defaults`);
  }

  return result;
}

function getAllAdjustmentsMap() {
  const map = new Map();

  try {
    const rows = db
      .prepare(
        `SELECT institution_id, currency, type, margin_type, margin_value FROM rate_adjustments`
      )
      .all();

    for (const row of rows) {
      if (!row.type) continue;
      if (!map.has(row.institution_id)) {
        map.set(row.institution_id, {});
      }
      const key = `${row.currency}_${row.type}`;
      map.get(row.institution_id)[key] = {
        margin_type: row.margin_type === "percent" ? "percent" : "fixed",
        margin_value: Math.max(0, Number(row.margin_value) || 0),
      };
    }
  } catch (err) {
    console.warn(`[DB] getAllAdjustments error: ${err.message}, returning empty map`);
  }

  return map;
}

/**
 * ✅ SECURITY: institution_id ve transaction güvenliği eklendi
 */
function upsertAdjustments(institutionId, adjustments) {
  // ✅ VALIDATION: institution_id kontrolü
  if (!institutionId || typeof institutionId !== 'string' || institutionId.trim() === '') {
    throw new Error(`Geçersiz institution_id: ${institutionId}`);
  }

  const trimmedInstitutionId = institutionId.trim().toLowerCase();

  // Supabase margin_history dual-write'ında da AYNI baseline mantığının
  // uygulanabilmesi için (bkz. project_audit_report.md, 1.2), bu SQLite
  // tarafında yazılan baseline/yeni-değer çiftlerini çağırana geri döndürüyoruz.
  const historyWrites = [];

  runInTransaction(() => {
    for (const key in adjustments) {
      const item = adjustments[key];
      const [currency, type] = key.split("_");
      const marginValue = Number(item.margin_value);
      const marginType = normalizeKind(item.margin_type);
      
      // ✅ VALIDATION: Marj değeri kontrolü
      if (!Number.isFinite(marginValue) || marginValue < 0) {
        throw new Error(`Geçersiz kâr değeri (negatif olamaz): ${key}`);
      }

      // ✅ VALIDATION: Currency ve type kontrolü
      if (!currency || !type) {
        throw new Error(`Geçersiz key format: ${key}`);
      }

      // ✅ VALIDATION: Allowed currencies
      if (!['USD', 'EUR', 'GBP'].includes(currency)) {
        throw new Error(`Geçersiz currency: ${currency}`);
      }

      // ✅ VALIDATION: Allowed types
      if (!['buy', 'sell'].includes(type)) {
        throw new Error(`Geçersiz type: ${type}`);
      }

      // Kontrol: kayıt var mı?
      const existing = db.prepare(`
        SELECT id, margin_type, margin_value FROM rate_adjustments 
        WHERE institution_id = ? AND currency = ? AND type = ?
      `).get(trimmedInstitutionId, currency, type);

      // ✅ Değişim tespiti: sadece gerçekten değişen marjlar için tarihçe (margin_history)
      // kaydı oluşturulur. Böylece işletme grafiği, marj güncellendiği ANDA yeni bir
      // zaman damgalı kırılım noktası kazanır (aynı değerle tekrar kaydetmek spam yaratmaz).
      const previousMarginType = existing ? existing.margin_type : null;
      const previousMarginValue = existing ? Number(existing.margin_value) : null;
      const hasChanged =
        !existing ||
        previousMarginType !== marginType ||
        previousMarginValue !== marginValue;

      if (existing) {
        // ✅ UPDATE: Parametreleri doğru sırada geç
        const updateStmt = db.prepare(`
          UPDATE rate_adjustments 
          SET margin_type = ?, margin_value = ?, updated_at = datetime('now')
          WHERE institution_id = ? AND currency = ? AND type = ?
        `);
        updateStmt.run(marginType, marginValue, trimmedInstitutionId, currency, type);
        console.log(`[DB] ✅ Marj güncellendi: ${trimmedInstitutionId}/${currency}/${type} = ${marginValue}`);
      } else {
        // ✅ INSERT: Yeni marj kaydı
        const insertStmt = db.prepare(`
          INSERT INTO rate_adjustments (institution_id, currency, type, margin_type, margin_value, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `);
        insertStmt.run(trimmedInstitutionId, currency, type, marginType, marginValue);
        console.log(`[DB] ✅ Marj eklendi: ${trimmedInstitutionId}/${currency}/${type} = ${marginValue}`);
      }

      if (hasChanged) {
        // ✅ KRİTİK: Bu institution/currency/type için İLK KEZ tarihçe kaydı oluşuyorsa,
        // önce ESKİ değeri (değişiklikten önce ne olduğunu) geçmişe damgalanmış çok eski
        // bir zaman ile kaydet. Aksi halde grafik birleştirme fonksiyonu (getBusinessRateHistory)
        // elinde SADECE yeni değeri bulur ve bunu geçmişe doğru sabitleyip TÜM eski noktaları
        // da yeni değermiş gibi göstererek grafikte hiçbir kırılım oluşmamasına sebep olur.
        const hasPriorHistory = db.prepare(`
          SELECT id FROM margin_history WHERE institution_id = ? AND currency = ? AND type = ? LIMIT 1
        `).get(trimmedInstitutionId, currency, type);

        let baselineWrite = null;
        if (!hasPriorHistory) {
          const baselineType = normalizeKind(previousMarginType);
          const baselineValue = previousMarginValue != null ? previousMarginValue : 0;
          const baselineRecordedAt = baselineRecordedAtIso();
          db.prepare(`
            INSERT INTO margin_history (institution_id, currency, type, margin_type, margin_value, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(trimmedInstitutionId, currency, type, baselineType, baselineValue, baselineRecordedAt);
          baselineWrite = { margin_type: baselineType, margin_value: baselineValue, recorded_at: baselineRecordedAt };
        }

        const newRecordedAt = new Date().toISOString();
        db.prepare(`
          INSERT INTO margin_history (institution_id, currency, type, margin_type, margin_value, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(trimmedInstitutionId, currency, type, marginType, marginValue, newRecordedAt);
        console.log(`[DB] 🕒 Marj tarihçesi kaydedildi: ${trimmedInstitutionId}/${currency}/${type} = ${marginValue} (${marginType})`);

        historyWrites.push({
          currency,
          type,
          baseline: baselineWrite,
          current: { margin_type: marginType, margin_value: marginValue, recorded_at: newRecordedAt },
        });
      }
    }
  });

  return { adjustments: getAdjustmentsForInstitution(trimmedInstitutionId), historyWrites };
}

/**
 * Gerçek kur verilerini geçmiş veriler tablosuna kaydet
 * @param {Array} rates - { currency, buy_rate, sell_rate } formatında kurlar
 */
/**
 * @param {Array} rates - { currency, buy_rate, sell_rate }
 * @param {string} [recordedAt] - Impr-3 / B-H4: her iki depoda (SQLite + Supabase)
 *   AYNI olay için AYNI UTC ISO zaman damgası. Verilmezse now() ISO.
 */
function recordHistoricalRates(rates, recordedAt) {
  if (!Array.isArray(rates) || rates.length === 0) return;
  const stamp = toIsoUtc(recordedAt) || new Date().toISOString();

  runInTransaction(() => {
    // B-H3: idx_historical_rates_unique(currency, recorded_at) ile birlikte
    // aynı bülten damgası tekrar yazılmaya çalışılırsa sessizce atlanır.
    const insert = db.prepare(`
      INSERT OR IGNORE INTO historical_rates (currency, buy_rate, sell_rate, recorded_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const rate of rates) {
      if (rate.currency && typeof rate.buy_rate === 'number' && typeof rate.sell_rate === 'number') {
        insert.run(rate.currency, rate.buy_rate, rate.sell_rate, stamp);
      }
    }
  });
}

/**
 * Belirtilen periyod için geçmiş kur verilerini getir
 * @param {String} period - 'Günlük' | 'Haftalık' | 'Aylık'
 * @param {String} currency - 'USD' | 'EUR' | 'GBP'
 * @returns {Array} Gerçek kur kayıtları
 */
/**
 * ✅ ADIM 1 (UPDATED): Geçmiş kur verilerini periyoda göre getir - MACRO LEVEL
 * 
 * Desteklenen Periyotlar:
 * - "Saatlik": Son 24 saat (organik 30sn interval veriler)
 * - "Günlük": Son 7 Gün (7 veri noktası)
 * - "Haftalık": Son 14 Gün (14 veri noktası)
 * - "Aylık": Son 1 Yıl (365 veri noktası) ✅ GÜNCEL
 * - "Yıllık": Son 6 Yıl (yaklaşık 2200 veri noktası) ✅ GÜNCEL
 */
function getHistoricalRates(period = 'Günlük', currency = 'USD') {
  // Tek sözlük: periodSpec.js
  const hoursBack = periodToHoursBack(period);
  const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  let query;

  if (period === 'Saatlik') {
    // ✅ Saatlik: SSE'den gelen tüm ham veri noktalarını getir (yığılma sorunu yok, sadece 24 saat)
    query = `
      SELECT 
        currency, 
        buy_rate, 
        sell_rate, 
        recorded_at
      FROM historical_rates
      WHERE currency = ? AND recorded_at >= ?
      ORDER BY recorded_at ASC
    `;
  } else {
    // ✅ Diğer periyotlar: Günde SADECE 1 kayıt (günün kapanış/son değeri) - yığılma ve zikzak önlenir
    query = `
      SELECT 
        currency, 
        buy_rate, 
        sell_rate, 
        MAX(recorded_at) as recorded_at
      FROM historical_rates
      WHERE currency = ? AND recorded_at >= ?
      GROUP BY date(recorded_at)
      ORDER BY recorded_at ASC
    `;
  }
  
  const rows = db.prepare(query).all(currency, cutoffTime);

  // ✅ GÖREV 2: Gerçek veri derinliğini hesapla (kullanıcıya "yeterli veri yok" bilgisini vermek için)
  const earliestRow = db.prepare(
    `SELECT MIN(recorded_at) AS earliest FROM historical_rates WHERE currency = ?`
  ).get(currency);

  const earliest = earliestRow?.earliest || null;
  const actualSpanHours = earliest ? (Date.now() - new Date(earliest).getTime()) / 3600000 : 0;
  const isLimitedByAvailableData = actualSpanHours < hoursBack;

  console.log(`[DB] ${currency} (${period}): ${rows.length} veri noktası (yeterli_veri=${!isLimitedByAvailableData})`);

  // ✅ Nokta Atışı Yüzde Hesaplama: grafikteki filtrelenmiş/gruplanmış ilk veriden DEĞİL,
  // seçilen periyodun tam başlangıcındaki (cutoffTime) en yakın ham veri ile şu anki
  // en güncel ham veri kıyaslanarak hesaplanır.
  // Tam olarak 'hoursBack' kadar önceki en yakın veriyi bul (Kıyaslama için)
  const pastRate = db.prepare(`
    SELECT buy_rate, sell_rate 
    FROM historical_rates 
    WHERE currency = ? AND recorded_at <= ? 
    ORDER BY recorded_at DESC LIMIT 1
  `).get(currency, cutoffTime);

  // Şu anki (en güncel) veriyi bul
  const currentRate = db.prepare(`
    SELECT buy_rate, sell_rate 
    FROM historical_rates 
    WHERE currency = ? 
    ORDER BY recorded_at DESC LIMIT 1
  `).get(currency);

  let exactPercentageChange = 0;
  if (pastRate && currentRate) {
    const pastMid = (pastRate.buy_rate + pastRate.sell_rate) / 2;
    const currentMid = (currentRate.buy_rate + currentRate.sell_rate) / 2;
    exactPercentageChange = ((currentMid - pastMid) / pastMid) * 100;
  }

  return {
    rows: rows || [],
    exactPercentageChange,
    isLimitedByAvailableData,
    actualSpanDays: Math.floor(actualSpanHours / 24),
    requestedSpanDays: Math.floor(hoursBack / 24),
  };
}

/**
 * Veritabanındaki geçmiş veri sayısını döndür (debug için)
 */
function getHistoricalRatesCount() {
  const result = db.prepare(`SELECT COUNT(*) as count FROM historical_rates`).get();
  return result?.count || 0;
}

/**
 * ✅ TEK SEFERLİK VERİ AKTARIMI (migrate endpoint tarafından kullanılır)
 * Orijinal recorded_at zaman damgalarını KORUYARAK geçmiş kur satırlarını ekler.
 * idx_historical_rates_unique sayesinde aynı (currency, recorded_at) çifti
 * tekrar eklenmeye çalışılırsa sessizce atlanır (idempotent — güvenle tekrar çalıştırılabilir).
 */
function bulkInsertHistoricalRates(currency, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0, skipped: 0 };
  let inserted = 0;
  let skipped = 0;

  runInTransaction(() => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO historical_rates (currency, buy_rate, sell_rate, recorded_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const row of rows) {
      const buy = Number(row.buy_rate);
      const sell = Number(row.sell_rate);
      // B-H4: gelen damgayı tek biçime (UTC ISO) indir.
      const recordedAt = toIsoUtc(row.recorded_at);
      if (!(buy > 0) || !(sell > 0) || !recordedAt) {
        skipped += 1;
        continue;
      }
      const result = insert.run(currency, buy, sell, recordedAt);
      if (result.changes > 0) inserted += 1;
      else skipped += 1;
    }
  });

  return { inserted, skipped };
}

/**
 * ✅ İŞLETME DETAY GRAFİĞİ — İZOLE VERİ HATTI
 * ------------------------------------------------------------------
 * Bu fonksiyon SADECE BusinessDetailModal (işletme detay grafiği) tarafından
 * kullanılır. Global "Piyasa Özeti" grafikleri getHistoricalRates() üzerinden
 * beslenir ve bu fonksiyondan TAMAMEN bağımsızdır — kesinlikle etkilenmez.
 *
 * Nihai Kur = İlgili Tarihteki MB Kuru + İlgili Tarihteki İşletme Kâr Marjı
 *
 * MB kuru sadece değiştiğinde, kâr marjı da sadece işletme onu güncellediğinde
 * (margin_history) kaydedilir; bu yüzden bu iki zaman serisi ayrı ayrı tutulur
 * Periyot derinliği: periodSpec.js (tek sözlük).
 */
function lastRowAtOrBefore(sortedRows, tsMs, tsKey = "recorded_at") {
  let result = null;
  for (const row of sortedRows) {
    const rowMs = new Date(row[tsKey]).getTime();
    if (rowMs <= tsMs) {
      result = row;
    } else {
      break;
    }
  }
  return result;
}

function mbRateValueAt(sortedMbRows, tsMs) {
  const found = lastRowAtOrBefore(sortedMbRows, tsMs);
  if (found) return found;
  return sortedMbRows.length > 0 ? sortedMbRows[0] : null;
}

function marginValueAt(sortedHistoryRows, currentAdjustment, tsMs) {
  const found = lastRowAtOrBefore(sortedHistoryRows, tsMs);
  if (found) {
    return {
      margin_type: normalizeKind(found.margin_type),
      margin_value: Number(found.margin_value),
    };
  }
  if (sortedHistoryRows.length > 0) {
    const first = sortedHistoryRows[0];
    return {
      margin_type: normalizeKind(first.margin_type),
      margin_value: Number(first.margin_value),
    };
  }
  return {
    margin_type: normalizeKind(currentAdjustment?.margin_type),
    margin_value: Math.max(0, Number(currentAdjustment?.margin_value) || 0),
  };
}

/**
 * Marjı referans kura uygular. `side='buy'` → referansın ALTINDA (kâr = referans
 * − ilan), `side='sell'` → ÜSTÜNDE. Bkz. rateMath.js applyMarginToValue kâr-yönü
 * notu (2026-09 düzeltmesi). `side` verilmezse geriye dönük uyum için toplama.
 */
function applyMarginToRate(rawRate, marginType, marginValue, side = "sell") {
  const base = Number(rawRate);
  const m = Math.max(0, Number(marginValue) || 0);
  if (!Number.isFinite(base)) return null;
  const delta = normalizeKind(marginType) === "percent" ? (base * m) / 100 : m;
  const result = String(side).toLowerCase() === "buy" ? base - delta : base + delta;
  return result < 0 ? 0 : result;
}

/**
 * İşletmenin belirtilen para birimi + periyot için "Nihai Kur" (MB kuru + kâr marjı)
 * zaman serisini döndürür. Sadece BusinessDetailModal tarafından kullanılır.
 */
function getBusinessRateHistory(institutionId, currency, period = "Günlük") {
  const trimmedInstitutionId = String(institutionId || "").trim().toLowerCase();
  const hoursBack = periodToHoursBack(period);
  const nowMs = Date.now();
  const windowStartMs = nowMs - hoursBack * 60 * 60 * 1000;

  // Tüm MB kur değişim olayları (tablo zaten sadece değişince kayıt alıyor — küçük veri seti)
  const allMbRows = db
    .prepare(
      `SELECT buy_rate, sell_rate, recorded_at FROM historical_rates
       WHERE currency = ? ORDER BY recorded_at ASC`
    )
    .all(currency);

  if (allMbRows.length === 0) {
    return { rows: [], hasAnyData: false, requestedSpanDays: Math.floor(hoursBack / 24) };
  }

  const buyHistory = db
    .prepare(
      `SELECT margin_type, margin_value, recorded_at FROM margin_history
       WHERE institution_id = ? AND currency = ? AND type = 'buy' ORDER BY recorded_at ASC`
    )
    .all(trimmedInstitutionId, currency);
  const sellHistory = db
    .prepare(
      `SELECT margin_type, margin_value, recorded_at FROM margin_history
       WHERE institution_id = ? AND currency = ? AND type = 'sell' ORDER BY recorded_at ASC`
    )
    .all(trimmedInstitutionId, currency);

  const currentAdjustments = getAdjustmentsForInstitution(trimmedInstitutionId);
  const currentBuyAdj = currentAdjustments[`${currency}_buy`];
  const currentSellAdj = currentAdjustments[`${currency}_sell`];

  // Olay zaman damgaları: pencere başlangıcı + pencere içindeki tüm MB/marj değişimleri + "şu an"
  const eventTimestamps = new Set([windowStartMs, nowMs]);
  for (const row of allMbRows) {
    const t = new Date(row.recorded_at).getTime();
    if (Number.isFinite(t) && t >= windowStartMs && t <= nowMs) eventTimestamps.add(t);
  }
  for (const row of buyHistory) {
    const t = new Date(row.recorded_at).getTime();
    if (Number.isFinite(t) && t >= windowStartMs && t <= nowMs) eventTimestamps.add(t);
  }
  for (const row of sellHistory) {
    const t = new Date(row.recorded_at).getTime();
    if (Number.isFinite(t) && t >= windowStartMs && t <= nowMs) eventTimestamps.add(t);
  }

  const sortedTimestamps = Array.from(eventTimestamps).sort((a, b) => a - b);

  const rows = [];
  for (const tsMs of sortedTimestamps) {
    const mbRow = mbRateValueAt(allMbRows, tsMs);
    if (!mbRow) continue;
    const buyRate = Number(mbRow.buy_rate);
    const sellRate = Number(mbRow.sell_rate);
    if (!(buyRate > 0) || !(sellRate > 0)) continue;

    const buyMargin = marginValueAt(buyHistory, currentBuyAdj, tsMs);
    const sellMargin = marginValueAt(sellHistory, currentSellAdj, tsMs);

    const finalBuy = applyMarginToRate(buyRate, buyMargin.margin_type, buyMargin.margin_value, "buy");
    const finalSell = applyMarginToRate(sellRate, sellMargin.margin_type, sellMargin.margin_value, "sell");
    if (finalBuy == null || finalSell == null) continue;

    const ordered = enforceSellGteBuy(finalBuy, finalSell);
    rows.push({
      recorded_at: new Date(tsMs).toISOString(),
      buy_rate: buyRate,
      sell_rate: sellRate,
      margin_buy_type: buyMargin.margin_type,
      margin_buy_value: buyMargin.margin_value,
      margin_sell_type: sellMargin.margin_type,
      margin_sell_value: sellMargin.margin_value,
      final_buy: Math.round(ordered.buy * 10000) / 10000,
      final_sell: Math.round(ordered.sell * 10000) / 10000,
    });
  }

  return {
    rows,
    hasAnyData: true,
    requestedSpanDays: Math.floor(hoursBack / 24),
  };
}

/** Public: tüm şubeler (konum sıralaması için) — yalnızca aktif + geçerli işletmeler */
function listPublicBranches() {
  return db
    .prepare(
      `SELECT b.id, b.business_id, b.name, b.phone, b.address, b.lat, b.lng,
              i.institution_id, i.institution_name,
              i.role, COALESCE(i.is_active, 1) AS is_active, i.subscription_end_date
       FROM branches b
       INNER JOIN institutions i ON i.id = b.business_id
       WHERE COALESCE(i.role, 'business') != 'superadmin'
         AND COALESCE(i.is_active, 1) = 1
         AND COALESCE(b.is_active, 1) = 1
         AND b.lat IS NOT NULL AND b.lng IS NOT NULL
       ORDER BY i.institution_name COLLATE NOCASE ASC, b.name COLLATE NOCASE ASC`
    )
    .all()
    .filter((row) => isInstitutionPubliclyVisible(row))
    .map((row) => ({
      ...mapBranchRow(row),
      institution_id: row.institution_id,
      institution_name: row.institution_name,
      // Şehir filtresi için: adresten türetilir, ayrı bir kolon gerektirmez.
      city: extractCitySlug(row.address),
    }));
}

function getVisitorStats() {
  const row = db
    .prepare(`SELECT total_visitors, updated_at FROM site_stats WHERE id = 1`)
    .get();
  return {
    total_visitors: row?.total_visitors ?? 0,
    updated_at: row?.updated_at || null,
  };
}

function incrementVisitorCount() {
  db.prepare(
    `UPDATE site_stats
     SET total_visitors = total_visitors + 1, updated_at = datetime('now')
     WHERE id = 1`
  ).run();
  return getVisitorStats();
}

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mergeUniqueStrings(existing, incoming) {
  const set = new Set(existing.map((v) => String(v).trim()).filter(Boolean));
  for (const item of incoming || []) {
    const v = String(item || "").trim();
    if (v) set.add(v);
  }
  return Array.from(set);
}

function startVisitorSession({ session_id, location }) {
  const sid = String(session_id || "").trim();
  if (!sid) throw new Error("session_id zorunludur.");

  const loc = String(location || "Bilinmiyor").trim() || "Bilinmiyor";
  const existing = db
    .prepare(`SELECT session_id FROM visitor_sessions WHERE session_id = ?`)
    .get(sid);

  if (existing) {
    return mapVisitorSession(
      db
        .prepare(
          `SELECT session_id, location, clicked_businesses, clicked_business_ids, viewed_currencies, created_at, updated_at
           FROM visitor_sessions WHERE session_id = ?`
        )
        .get(sid)
    );
  }

  db.prepare(
    `INSERT INTO visitor_sessions (session_id, location, clicked_businesses, viewed_currencies)
     VALUES (?, ?, '[]', '[]')`
  ).run(sid, loc);

  // Tekil ziyaretçi sayacını da artır
  incrementVisitorCount();

  return mapVisitorSession(
    db
      .prepare(
        `SELECT session_id, location, clicked_businesses, clicked_business_ids, viewed_currencies, created_at, updated_at
         FROM visitor_sessions WHERE session_id = ?`
      )
      .get(sid)
  );
}

function mapVisitorSession(row) {
  if (!row) return null;
  return {
    session_id: row.session_id,
    location: row.location || "Bilinmiyor",
    clicked_businesses: parseJsonArray(row.clicked_businesses),
    clicked_business_ids: parseJsonArray(row.clicked_business_ids),
    viewed_currencies: parseJsonArray(row.viewed_currencies),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function updateVisitorSession(
  session_id,
  { clicked_businesses, clicked_business_ids, viewed_currencies, business, business_id, currency }
) {
  const sid = String(session_id || "").trim();
  if (!sid) throw new Error("session_id zorunludur.");

  const row = db
    .prepare(
      `SELECT session_id, location, clicked_businesses, clicked_business_ids, viewed_currencies, created_at, updated_at
       FROM visitor_sessions WHERE session_id = ?`
    )
    .get(sid);

  if (!row) throw new Error("Oturum bulunamadı.");

  let businesses = parseJsonArray(row.clicked_businesses);
  let businessIds = parseJsonArray(row.clicked_business_ids);
  let currencies = parseJsonArray(row.viewed_currencies);

  if (Array.isArray(clicked_businesses)) {
    businesses = mergeUniqueStrings(businesses, clicked_businesses);
  }
  if (business) {
    businesses = mergeUniqueStrings(businesses, [business]);
  }
  if (Array.isArray(clicked_business_ids)) {
    businessIds = mergeUniqueStrings(businessIds, clicked_business_ids.map((v) => String(v)));
  }
  if (business_id != null && String(business_id).trim()) {
    businessIds = mergeUniqueStrings(businessIds, [String(business_id).trim()]);
  }
  if (Array.isArray(viewed_currencies)) {
    currencies = mergeUniqueStrings(currencies, viewed_currencies);
  }
  if (currency) {
    currencies = mergeUniqueStrings(currencies, [currency]);
  }

  db.prepare(
    `UPDATE visitor_sessions
     SET clicked_businesses = ?, clicked_business_ids = ?, viewed_currencies = ?, updated_at = datetime('now')
     WHERE session_id = ?`
  ).run(
    JSON.stringify(businesses),
    JSON.stringify(businessIds),
    JSON.stringify(currencies),
    sid
  );

  return mapVisitorSession(
    db
      .prepare(
        `SELECT session_id, location, clicked_businesses, clicked_business_ids, viewed_currencies, created_at, updated_at
         FROM visitor_sessions WHERE session_id = ?`
      )
      .get(sid)
  );
}

function listVisitorSessions(limit = 50) {
  const rows = db
    .prepare(
      `SELECT session_id, location, clicked_businesses, clicked_business_ids, viewed_currencies, created_at, updated_at
       FROM visitor_sessions
       ORDER BY datetime(created_at) DESC
       LIMIT ?`
    )
    .all(Math.min(100, Math.max(1, Number(limit) || 50)));

  return rows.map(mapVisitorSession);
}

function getAdminAnalytics(limit = 50) {
  const stats = getVisitorStats();
  return {
    total_visitors: stats.total_visitors,
    updated_at: stats.updated_at,
    sessions: listVisitorSessions(limit),
  };
}

/** Kullanıcı adı veya e-posta ile işletme bul (şifre sıfırlama) */
function findInstitutionForPasswordReset(identifier) {
  const value = String(identifier || "").trim().toLowerCase();
  if (!value) return null;

  // Önce kayıtlı e-posta, yoksa Giriş ID ile hesabı bul (şifre maili yalnızca email alanına gider)
  return (
    db
      .prepare(
        `SELECT id, username, email, institution_id, institution_name, role, password_hash
         FROM institutions
         WHERE (email IS NOT NULL AND lower(email) = ?)
            OR lower(username) = ?
         LIMIT 1`
      )
      .get(value, value) || null
  );
}

/**
 * S-H1: Şifre sıfırlama token'ı DÜZ METİN saklanmaz. Yalnızca sha256(token)
 * saklanır ve karşılaştırılır; ham token yalnızca e-posta linkinde yaşar.
 */
function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token || "").trim()).digest("hex");
}

function createPasswordResetToken({ institutionId, email, token, expiresAt }) {
  db.prepare(
    `UPDATE password_resets SET used = 1
     WHERE institution_id = ? AND used = 0`
  ).run(institutionId);

  const result = db
    .prepare(
      `INSERT INTO password_resets (institution_id, email, token, expires_at, used)
       VALUES (?, ?, ?, ?, 0)`
    )
    .run(institutionId, email, hashResetToken(token), expiresAt);

  return result.lastInsertRowid;
}

function findValidPasswordReset(token) {
  const value = String(token || "").trim();
  if (!value) return null;

  return (
    db
      .prepare(
        `SELECT id, institution_id, email, token, expires_at, used
         FROM password_resets
         WHERE token = ? AND used = 0
         LIMIT 1`
      )
      .get(hashResetToken(value)) || null
  );
}

function markPasswordResetUsed(id) {
  db.prepare(`UPDATE password_resets SET used = 1 WHERE id = ?`).run(id);
}

function updateInstitutionPassword(institutionId, passwordHash) {
  db.prepare(`UPDATE institutions SET password_hash = ? WHERE id = ?`).run(
    passwordHash,
    institutionId
  );
}

/** Sync / profil için tam satır (password_hash dahil) */
function getInstitutionFullById(id) {
  return (
    db
      .prepare(
        `SELECT id, username, password_hash, institution_id, institution_name,
                COALESCE(role, 'business') AS role,
                COALESCE(subscription, 'Test') AS subscription,
                COALESCE(subscription_type, 'Test') AS subscription_type,
                subscription_end_date,
                COALESCE(is_active, 1) AS is_active,
                COALESCE(branch_limit, 1) AS branch_limit,
                logo_url, email, phone, contact_person, working_hours, created_at, last_login_at
         FROM institutions WHERE id = ?`
      )
      .get(id) || null
  );
}

function getInstitutionFullBySlug(institutionId) {
  const id = String(institutionId || "").trim().toLowerCase();
  if (!id) return null;
  return (
    db
      .prepare(
        `SELECT id, username, password_hash, institution_id, institution_name,
                COALESCE(role, 'business') AS role,
                COALESCE(subscription, 'Test') AS subscription,
                COALESCE(subscription_type, 'Test') AS subscription_type,
                subscription_end_date,
                COALESCE(is_active, 1) AS is_active,
                COALESCE(branch_limit, 1) AS branch_limit,
                logo_url, email, phone, contact_person, working_hours, created_at, last_login_at
         FROM institutions
         WHERE lower(institution_id) = ? AND COALESCE(role, 'business') != 'superadmin'
         LIMIT 1`
      )
      .get(id) || null
  );
}

/**
 * İşletme kendi profilini günceller (logo / telefon / çalışma saatleri).
 */
function updateInstitutionProfile(institutionSlug, { logo_url, phone, working_hours } = {}) {
  const row = getInstitutionFullBySlug(institutionSlug);
  if (!row) throw new Error("İşletme bulunamadı.");

  let nextLogo = row.logo_url;
  if (logo_url !== undefined) {
    nextLogo = sanitizeLogoUrl(logo_url);
  }

  let nextPhone = row.phone;
  if (phone !== undefined) {
    nextPhone = phone === null || phone === "" ? null : String(phone).trim();
  }

  let nextHours = row.working_hours;
  if (working_hours !== undefined) {
    if (working_hours === null) {
      nextHours = null;
    } else {
      nextHours =
        typeof working_hours === "string"
          ? working_hours
          : JSON.stringify(working_hours);
    }
  }

  db.prepare(
    `UPDATE institutions
     SET logo_url = ?, phone = ?, working_hours = ?
     WHERE id = ?`
  ).run(nextLogo, nextPhone, nextHours, row.id);

  return mapBusinessRow(getInstitutionFullById(row.id));
}

/** Bootstrap sync için tüm satırlar */
function listAllInstitutionsForSync() {
  return db
    .prepare(
      `SELECT id, username, password_hash, institution_id, institution_name,
              COALESCE(role, 'business') AS role,
              COALESCE(subscription, 'Test') AS subscription,
              COALESCE(subscription_type, 'Test') AS subscription_type,
              subscription_end_date,
              COALESCE(is_active, 1) AS is_active,
              COALESCE(branch_limit, 1) AS branch_limit,
              logo_url, email, phone, contact_person, working_hours, created_at, last_login_at
       FROM institutions
       WHERE COALESCE(role, 'business') != 'superadmin'`
    )
    .all();
}

function listAllBranchesForSync() {
  return db
    .prepare(
      `SELECT b.id, b.business_id, b.name, b.phone, COALESCE(b.whatsapp, '') AS whatsapp, b.address, b.lat, b.lng,
              COALESCE(b.subscription_type, 'Test') AS subscription_type,
              b.subscription_start_date, b.subscription_end_date,
              b.created_at, b.updated_at, i.institution_id
       FROM branches b
       JOIN institutions i ON i.id = b.business_id`
    )
    .all();
}

function listAllAdjustmentsForSync() {
  return db
    .prepare(
      `SELECT institution_id, currency, type, margin_type, margin_value, updated_at
       FROM rate_adjustments`
    )
    .all();
}

/** Supabase hydrate: institution satırını SQLite'a yaz (slug eşleşmesi) */
function applySupabaseInstitutionRow(row) {
  if (!row?.institution_id || row.role === "superadmin") return;
  const existing = db
    .prepare(`SELECT id FROM institutions WHERE institution_id = ?`)
    .get(row.institution_id);

  const isActive = row.is_active === false || row.is_active === 0 ? 0 : 1;
  if (existing) {
    db.prepare(
      `UPDATE institutions SET
         username = COALESCE(?, username),
         password_hash = COALESCE(?, password_hash),
         institution_name = COALESCE(?, institution_name),
         subscription = COALESCE(?, subscription),
         subscription_type = COALESCE(?, subscription_type),
         subscription_end_date = COALESCE(?, subscription_end_date),
         is_active = ?,
         logo_url = COALESCE(?, logo_url),
         email = COALESCE(?, email),
         phone = COALESCE(?, phone),
         contact_person = COALESCE(?, contact_person),
         working_hours = COALESCE(?, working_hours),
         branch_limit = COALESCE(?, branch_limit),
         last_login_at = COALESCE(?, last_login_at),
         created_at = COALESCE(created_at, ?)
       WHERE institution_id = ?`
    ).run(
      row.username || null,
      row.password_hash || null,
      row.institution_name || null,
      row.subscription || null,
      row.subscription_type || null,
      row.subscription_end_date || null,
      isActive,
      row.logo_url || null,
      row.email || null,
      row.phone || null,
      row.contact_person || null,
      row.working_hours || null,
      row.branch_limit != null ? normalizeBranchLimit(row.branch_limit) : null,
      row.last_login_at || null,
      row.created_at || null,
      row.institution_id
    );
  } else {
    // Impr-5: password_hash olmadan gelen bir Supabase satırı için "123" gibi
    // zayıf bir kimlik ÜRETME — satırı atla ve logla (kolon Supabase'te NOT NULL
    // olduğundan bu yol normalde tetiklenmez).
    if (!row.password_hash) {
      console.warn(
        `[HYDRATE] institutions satırı password_hash olmadan geldi — INSERT atlandı: ${row.institution_id}`
      );
      return;
    }
    db.prepare(
      `INSERT INTO institutions
        (username, password_hash, institution_id, institution_name, role, subscription,
         subscription_type, subscription_end_date, is_active, logo_url, email, phone, contact_person, working_hours, branch_limit, last_login_at, created_at)
       VALUES (?, ?, ?, ?, 'business', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.username || row.institution_id,
      row.password_hash,
      row.institution_id,
      row.institution_name || row.institution_id,
      row.subscription || "Yıllık",
      row.subscription_type || "Yıllık",
      row.subscription_end_date || null,
      isActive,
      row.logo_url || null,
      row.email || null,
      row.phone || null,
      row.contact_person || null,
      row.working_hours || null,
      normalizeBranchLimit(row.branch_limit ?? 1),
      row.last_login_at || null,
      row.created_at || new Date().toISOString()
    );
  }
}

function applySupabaseBranchRequestRow(row) {
  if (!row?.institution_id || !row?.branch_name) return;
  const biz = db
    .prepare(
      `SELECT id FROM institutions
       WHERE institution_id = ? AND COALESCE(role, 'business') != 'superadmin'`
    )
    .get(row.institution_id);
  if (!biz) return;

  const requestType = row.request_type === "reactivate" ? "reactivate" : "new";
  const status = row.status || "pending";
  let linkedBranchId = row.branch_id == null ? null : Number(row.branch_id);
  if (requestType === "reactivate" || linkedBranchId != null) {
    const byName = db
      .prepare(`SELECT id FROM branches WHERE business_id = ? AND name = ? LIMIT 1`)
      .get(biz.id, row.branch_name);
    if (byName) linkedBranchId = byName.id;
  }

  const existing = db
    .prepare(
      `SELECT id FROM branch_requests
       WHERE institution_id = ?
         AND branch_name = ?
         AND COALESCE(request_type, 'new') = ?
         AND COALESCE(status, 'pending') = ?
       LIMIT 1`
    )
    .get(row.institution_id, row.branch_name, requestType, status);

  const isRead = row.is_read === true || row.is_read === 1 ? 1 : 0;
  const lat = row.lat == null || row.lat === "" ? null : Number(row.lat);
  const lng = row.lng == null || row.lng === "" ? null : Number(row.lng);

  if (existing) {
    db.prepare(
      `UPDATE branch_requests SET
         business_id = ?, business_name = ?, phone = ?, address = ?, lat = ?, lng = ?,
         request_type = ?, branch_id = ?, status = ?, is_read = ?, admin_note = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      biz.id,
      row.business_name || "",
      row.phone || "",
      row.address || "",
      Number.isFinite(lat) ? lat : null,
      Number.isFinite(lng) ? lng : null,
      requestType,
      linkedBranchId,
      status,
      isRead,
      row.admin_note || null,
      existing.id
    );
    return;
  }

  db.prepare(
    `INSERT INTO branch_requests (
       business_id, institution_id, business_name, branch_name, phone, address, lat, lng,
       request_type, branch_id, status, is_read, admin_note, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    biz.id,
    row.institution_id,
    row.business_name || "",
    row.branch_name,
    row.phone || "",
    row.address || "",
    Number.isFinite(lat) ? lat : null,
    Number.isFinite(lng) ? lng : null,
    requestType,
    linkedBranchId,
    status,
    isRead,
    row.admin_note || null,
    row.created_at || new Date().toISOString(),
    row.updated_at || new Date().toISOString()
  );
}

function listAllBranchRequestsForSync() {
  return db.prepare(`SELECT * FROM branch_requests`).all().map(mapBranchRequestRow);
}

function applySupabaseAdjustmentRow(row) {
  if (!row?.institution_id || !row?.currency || !row?.type) return;
  db.prepare(
    `INSERT INTO rate_adjustments (institution_id, currency, type, margin_type, margin_value, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(institution_id, currency, type) DO UPDATE SET
       margin_type = excluded.margin_type,
       margin_value = excluded.margin_value,
       updated_at = datetime('now')`
  ).run(
    row.institution_id,
    row.currency,
    row.type,
    row.margin_type || "fixed",
    Number(row.margin_value) || 0
  );
}

/**
 * B-C1: Supabase margin_history satırını SQLite'a yaz (dedupe'li).
 * Böylece redeploy sonrası `upsertAdjustments` içindeki `hasPriorHistory`
 * kontrolü DOĞRU çalışır ve sahte ~10 yıl öncesi baseline ASLA yazılmaz.
 */
function applySupabaseMarginHistoryRow(row) {
  const canonical = fromSupabaseMarginHistoryRow(row);
  if (!row?.institution_id || !row?.currency || !canonical?.side) return;
  const instId = String(row.institution_id).trim().toLowerCase();
  const currency = String(row.currency).toUpperCase();
  const recordedAt = toIsoUtc(canonical.recorded_at) || canonical.recorded_at;
  if (!recordedAt) return;
  const dup = db
    .prepare(
      `SELECT id FROM margin_history
       WHERE institution_id = ? AND currency = ? AND type = ? AND recorded_at = ?
       LIMIT 1`
    )
    .get(instId, currency, canonical.side, recordedAt);
  if (dup) return;
  db.prepare(
    `INSERT INTO margin_history (institution_id, currency, type, margin_type, margin_value, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    instId,
    currency,
    canonical.side,
    normalizeKind(canonical.kind),
    Number(canonical.margin_value) || 0,
    recordedAt
  );
}

/**
 * B-H2/B-H3: Supabase historical_rates satırlarını (para birimine göre gruplu)
 * SQLite'a yükler. INSERT OR IGNORE + idx_historical_rates_unique → idempotent.
 */
function applySupabaseHistoricalRatesRows(rows) {
  const byCurrency = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const cur = String(row?.currency || "").toUpperCase();
    if (!cur) continue;
    if (!byCurrency.has(cur)) byCurrency.set(cur, []);
    byCurrency.get(cur).push(row);
  }
  let inserted = 0;
  for (const [currency, list] of byCurrency) {
    const res = bulkInsertHistoricalRates(currency, list);
    inserted += res.inserted;
  }
  return { inserted };
}

/** B-H1: Supabase plans satırını SQLite'a yaz (code birincil anahtar). */
function applySupabasePlanRow(row) {
  if (!row?.code) return;
  db.prepare(
    `INSERT INTO plans (code, ad, sure_gun, fiyat, kdv_orani, aktif, sira)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       ad = excluded.ad, sure_gun = excluded.sure_gun, fiyat = excluded.fiyat,
       kdv_orani = excluded.kdv_orani, aktif = excluded.aktif, sira = excluded.sira`
  ).run(
    String(row.code),
    String(row.ad || row.code),
    Math.max(0, parseInt(row.sure_gun, 10) || 0),
    Math.max(0, Number(row.fiyat) || 0),
    Math.max(0, Number(row.kdv_orani) || 0),
    row.aktif === false || row.aktif === 0 ? 0 : 1,
    parseInt(row.sira, 10) || 0
  );
}

/** B-H1: Supabase payments satırını SQLite'a yaz (dedupe'li). */
function applySupabasePaymentRow(row) {
  if (!row?.institution_id || !row?.plan_code) return;
  const odeme = toIsoUtc(row.odeme_tarihi) || row.odeme_tarihi;
  if (!odeme) return;
  const tutar = Number(row.tutar) || 0;
  // local_id varsa onunla, yoksa doğal anahtarla dedupe et.
  if (row.local_id != null) {
    const dup = db.prepare(`SELECT id FROM payments WHERE id = ?`).get(Number(row.local_id));
    if (dup) return;
  } else {
    const dup = db
      .prepare(
        `SELECT id FROM payments
         WHERE institution_id = ? AND plan_code = ? AND odeme_tarihi = ? AND tutar = ?
         LIMIT 1`
      )
      .get(String(row.institution_id), String(row.plan_code), odeme, tutar);
    if (dup) return;
  }
  db.prepare(
    `INSERT INTO payments
       (institution_id, plan_code, tutar, kdv, para_birimi, odeme_tarihi, donem_baslangic,
        donem_bitis, yontem, durum, fatura_no, aciklama, olusturan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(row.institution_id),
    String(row.plan_code),
    tutar,
    Number(row.kdv) || 0,
    row.para_birimi || "TRY",
    odeme,
    String(row.donem_baslangic || "").slice(0, 10) || isoDay(odeme),
    String(row.donem_bitis || "").slice(0, 10) || isoDay(odeme),
    row.yontem || null,
    row.durum || "odendi",
    row.fatura_no || null,
    row.aciklama || null,
    row.olusturan || null,
    toIsoUtc(row.created_at) || new Date().toISOString()
  );
}

function applySupabaseBranchRow(row) {
  if (!row?.institution_id || !row?.name) return;
  const biz = db
    .prepare(`SELECT id FROM institutions WHERE institution_id = ?`)
    .get(row.institution_id);
  if (!biz) return;

  const existing = db
    .prepare(`SELECT id FROM branches WHERE business_id = ? AND name = ?`)
    .get(biz.id, row.name);

  if (existing) {
    const cur = db.prepare(`SELECT ${BRANCH_SELECT_SQL} FROM branches WHERE id = ?`).get(existing.id);
    const nextType =
      row.subscription_type != null
        ? normalizeSubscriptionType(row.subscription_type)
        : normalizeSubscriptionType(cur.subscription_type || "Test");
    const nextStart =
      row.subscription_start_date != null
        ? String(row.subscription_start_date)
        : cur.subscription_start_date || cur.created_at || new Date().toISOString();
    const nextEnd =
      nextType === "Test"
        ? null
        : row.subscription_end_date !== undefined
          ? row.subscription_end_date || null
          : cur.subscription_end_date || null;
    const nextActive =
      row.is_active === undefined
        ? cur.is_active === 0 || cur.is_active === false
          ? 0
          : 1
        : row.is_active === false || row.is_active === 0
          ? 0
          : 1;

    db.prepare(
      `UPDATE branches SET phone = ?, whatsapp = COALESCE(?, whatsapp), address = ?, lat = ?, lng = ?,
         subscription_type = ?, subscription_start_date = ?, subscription_end_date = ?,
         is_active = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      row.phone || "",
      row.whatsapp != null ? String(row.whatsapp) : null,
      row.address || "",
      row.lat,
      row.lng,
      nextType,
      nextStart,
      nextEnd,
      nextActive,
      existing.id
    );
  } else {
    const subType = normalizeSubscriptionType(row.subscription_type || "Test");
    const subStart = row.subscription_start_date || row.created_at || new Date().toISOString();
    const subEnd = subType === "Test" ? null : row.subscription_end_date || null;
    const nextActive = row.is_active === false || row.is_active === 0 ? 0 : 1;
    db.prepare(
      `INSERT INTO branches (
         business_id, name, phone, whatsapp, address, lat, lng,
         subscription_type, subscription_start_date, subscription_end_date, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      biz.id,
      row.name,
      row.phone || "",
      row.whatsapp || "",
      row.address || "",
      row.lat,
      row.lng,
      subType,
      subStart,
      subEnd,
      nextActive
    );
  }
}

function mapBranchRequestRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    business_id: row.business_id,
    institution_id: row.institution_id,
    business_name: row.business_name || "",
    branch_name: row.branch_name,
    phone: row.phone || "",
    address: row.address || "",
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng),
    request_type: row.request_type === "reactivate" ? "reactivate" : "new",
    branch_id: row.branch_id == null ? null : Number(row.branch_id),
    status: row.status || "pending",
    is_read: row.is_read === 1 || row.is_read === true,
    admin_note: row.admin_note || null,
    created_at: toIsoTimestamp(row.created_at),
    updated_at: toIsoTimestamp(row.updated_at),
  };
}

/** SQLite datetime / ISO → tutarlı ISO UTC (frontend Absolute tarih için) */
function toIsoTimestamp(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return s.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`;
  }
  // "YYYY-MM-DD HH:MM:SS" (SQLite UTC) → ISO
  if (/^\d{4}-\d{2}-\d{2} /.test(s)) {
    return `${s.replace(" ", "T")}Z`;
  }
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : s;
}

function createBranchRequest({
  business_id,
  institution_id,
  business_name,
  branch_name,
  phone,
  address,
  lat,
  lng,
  request_type = "new",
  branch_id = null,
}) {
  const businessId = Number(business_id);
  if (!Number.isFinite(businessId)) throw new Error("business_id zorunludur.");
  assertBusinessExists(businessId);

  const type = String(request_type || "new").trim() === "reactivate" ? "reactivate" : "new";
  let linkedBranchId = null;
  let name = String(branch_name || "").trim();
  let nextPhone = String(phone || "").trim();
  let nextAddress = String(address || "").trim();
  let nextLat = lat == null || lat === "" ? null : Number(lat);
  let nextLng = lng == null || lng === "" ? null : Number(lng);

  if (type === "reactivate") {
    const bid = Number(branch_id);
    if (!Number.isFinite(bid)) throw new Error("Yenileme talebi için şube seçilmelidir.");
    const existingBranch = db
      .prepare(`SELECT ${BRANCH_SELECT_SQL} FROM branches WHERE id = ? AND business_id = ?`)
      .get(bid, businessId);
    if (!existingBranch) throw new Error("Şube bulunamadı veya bu işletmeye ait değil.");
    const mapped = mapBranchRow(existingBranch);
    if (mapped.is_active && (mapped.days_remaining == null || mapped.days_remaining > 0)) {
      throw new Error("Bu şube zaten aktif; yenileme talebi gönderilemez.");
    }
    const pending = db
      .prepare(
        `SELECT id FROM branch_requests
         WHERE branch_id = ? AND request_type = 'reactivate' AND status = 'pending'
         LIMIT 1`
      )
      .get(bid);
    if (pending) throw new Error("Bu şube için zaten bekleyen bir yenileme talebi var.");

    linkedBranchId = bid;
    name = name || String(existingBranch.name || "").trim();
    nextPhone = nextPhone || String(existingBranch.phone || "").trim();
    nextAddress = nextAddress || String(existingBranch.address || "").trim();
    if (!Number.isFinite(nextLat)) {
      nextLat = existingBranch.lat == null ? null : Number(existingBranch.lat);
    }
    if (!Number.isFinite(nextLng)) {
      nextLng = existingBranch.lng == null ? null : Number(existingBranch.lng);
    }
  }

  if (!name) throw new Error("Şube adı zorunludur.");
  if (!nextPhone) throw new Error("Telefon numarası zorunludur.");
  if (type === "new") {
    if (!nextAddress) throw new Error("Adres / konum zorunludur.");
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
      throw new Error("Haritadan konum seçilmesi zorunludur.");
    }
  } else {
    // Yenileme: mevcut şube verisi yeterli; konum yoksa varsayılan KKTC merkezi
    if (!nextAddress) nextAddress = name;
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
      nextLat = 35.1856;
      nextLng = 33.3823;
    }
  }

  const nowIso = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO branch_requests (
         business_id, institution_id, business_name, branch_name, phone, address, lat, lng,
         request_type, branch_id, status, is_read, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
    )
    .run(
      businessId,
      String(institution_id || "").trim(),
      String(business_name || "").trim(),
      name,
      nextPhone,
      nextAddress,
      nextLat,
      nextLng,
      type,
      linkedBranchId,
      nowIso,
      nowIso
    );

  return mapBranchRequestRow(
    db.prepare(`SELECT * FROM branch_requests WHERE id = ?`).get(info.lastInsertRowid)
  );
}

function listBranchRequests({ status } = {}) {
  let rows;
  if (status) {
    rows = db
      .prepare(
        `SELECT * FROM branch_requests WHERE status = ? ORDER BY datetime(created_at) DESC`
      )
      .all(String(status));
  } else {
    rows = db
      .prepare(`SELECT * FROM branch_requests ORDER BY datetime(created_at) DESC`)
      .all();
  }
  return rows.map(mapBranchRequestRow);
}

function countUnreadBranchRequests() {
  // Onay/red verilmemiş tüm talepler bildirimde kalsın (görülmüş olsa bile)
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM branch_requests WHERE status = 'pending'`
    )
    .get();
  return Number(row?.c) || 0;
}

function markBranchRequestsRead() {
  db.prepare(
    `UPDATE branch_requests
     SET is_read = 1, updated_at = datetime('now')
     WHERE status = 'pending' AND COALESCE(is_read, 0) = 0`
  ).run();
  return { ok: true, unread: countUnreadBranchRequests() };
}

function getBranchRequestById(id) {
  return mapBranchRequestRow(
    db.prepare(`SELECT * FROM branch_requests WHERE id = ?`).get(id)
  );
}

function updateBranchRequestStatus(id, { status, admin_note }) {
  const existing = getBranchRequestById(id);
  if (!existing) throw new Error("Talep bulunamadı.");

  const nextStatus = String(status || "").trim();
  if (!["pending", "approved", "rejected"].includes(nextStatus)) {
    throw new Error("Geçersiz talep durumu.");
  }

  db.prepare(
    `UPDATE branch_requests
     SET status = ?, admin_note = ?, is_read = 1, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    nextStatus,
    admin_note !== undefined ? String(admin_note || "").trim() || null : existing.admin_note,
    id
  );

  return getBranchRequestById(id);
}

function mapBusinessNotificationRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    business_id: row.business_id,
    type: row.type,
    title: row.title || "",
    message: row.message || "",
    related_request_id: row.related_request_id == null ? null : Number(row.related_request_id),
    is_read: row.is_read === 1 || row.is_read === true,
    created_at: toIsoTimestamp(row.created_at),
  };
}

function createBusinessNotification({
  business_id,
  type,
  title,
  message,
  related_request_id = null,
}) {
  const businessId = Number(business_id);
  if (!Number.isFinite(businessId)) throw new Error("business_id zorunludur.");
  const nowIso = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO business_notifications
         (business_id, type, title, message, related_request_id, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    )
    .run(
      businessId,
      String(type || "info").trim(),
      String(title || "").trim(),
      String(message || "").trim(),
      related_request_id == null ? null : Number(related_request_id),
      nowIso
    );
  return mapBusinessNotificationRow(
    db.prepare(`SELECT * FROM business_notifications WHERE id = ?`).get(info.lastInsertRowid)
  );
}

function listBusinessNotifications(businessId, { limit = 50 } = {}) {
  const id = Number(businessId);
  if (!Number.isFinite(id)) return [];
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return db
    .prepare(
      `SELECT * FROM business_notifications
       WHERE business_id = ?
       ORDER BY datetime(created_at) DESC
       LIMIT ?`
    )
    .all(id, lim)
    .map(mapBusinessNotificationRow);
}

function countUnreadBusinessNotifications(businessId) {
  const id = Number(businessId);
  if (!Number.isFinite(id)) return 0;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM business_notifications
       WHERE business_id = ? AND COALESCE(is_read, 0) = 0`
    )
    .get(id);
  return Number(row?.c) || 0;
}

function markBusinessNotificationsRead(businessId, ids) {
  const id = Number(businessId);
  if (!Number.isFinite(id)) throw new Error("business_id zorunludur.");
  if (Array.isArray(ids) && ids.length > 0) {
    const clean = ids.map((n) => Number(n)).filter((n) => Number.isFinite(n));
    if (!clean.length) return { ok: true, unread: countUnreadBusinessNotifications(id) };
    const placeholders = clean.map(() => "?").join(",");
    db.prepare(
      `UPDATE business_notifications
       SET is_read = 1
       WHERE business_id = ? AND id IN (${placeholders})`
    ).run(id, ...clean);
  } else {
    db.prepare(
      `UPDATE business_notifications SET is_read = 1 WHERE business_id = ? AND COALESCE(is_read, 0) = 0`
    ).run(id);
  }
  return { ok: true, unread: countUnreadBusinessNotifications(id) };
}

/**
 * P1.5 — dedup yardımcısı: belirli bir işletmeye, verilen türde bir bildirim
 * son `withinHours` saat içinde zaten yazılmış mı? (abonelik hatırlatması günde
 * bir çalışsın diye).
 */
function hasRecentBusinessNotification(businessId, type, withinHours = 20) {
  const id = Number(businessId);
  if (!Number.isFinite(id)) return false;
  const hrs = Math.max(1, Math.min(24 * 365, Number(withinHours) || 20));
  const row = db
    .prepare(
      `SELECT 1 AS hit FROM business_notifications
       WHERE business_id = ? AND type = ?
         AND datetime(created_at) > datetime('now', ?)
       LIMIT 1`
    )
    .get(id, String(type || "").trim(), `-${hrs} hours`);
  return Boolean(row?.hit);
}

function mapAdminNotificationRow(row) {
  if (!row) return null;
  let data = null;
  if (row.data_json) {
    try {
      data = JSON.parse(row.data_json);
    } catch (_e) {
      data = null;
    }
  }
  return {
    id: row.id,
    type: row.type,
    title: row.title || "",
    message: row.message || "",
    data,
    is_read: row.is_read === 1 || row.is_read === true,
    created_at: toIsoTimestamp(row.created_at),
  };
}

function createAdminNotification({ type, title, message, data = null }) {
  const nowIso = new Date().toISOString();
  let dataJson = null;
  if (data != null) {
    try {
      dataJson = JSON.stringify(data);
    } catch (_e) {
      dataJson = null;
    }
  }
  const info = db
    .prepare(
      `INSERT INTO admin_notifications
         (type, title, message, data_json, is_read, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    )
    .run(
      String(type || "info").trim(),
      String(title || "").trim(),
      String(message || "").trim(),
      dataJson,
      nowIso
    );
  return mapAdminNotificationRow(
    db.prepare(`SELECT * FROM admin_notifications WHERE id = ?`).get(info.lastInsertRowid)
  );
}

function listAdminNotifications({ limit = 50, unreadOnly = false } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const where = unreadOnly ? `WHERE COALESCE(is_read, 0) = 0` : ``;
  return db
    .prepare(
      `SELECT * FROM admin_notifications
       ${where}
       ORDER BY datetime(created_at) DESC
       LIMIT ?`
    )
    .all(lim)
    .map(mapAdminNotificationRow);
}

function countUnreadAdminNotifications() {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM admin_notifications WHERE COALESCE(is_read, 0) = 0`
    )
    .get();
  return Number(row?.c) || 0;
}

function markAdminNotificationsRead(ids) {
  if (Array.isArray(ids) && ids.length > 0) {
    const clean = ids.map((n) => Number(n)).filter((n) => Number.isFinite(n));
    if (!clean.length) return { ok: true, unread: countUnreadAdminNotifications() };
    const placeholders = clean.map(() => "?").join(",");
    db.prepare(
      `UPDATE admin_notifications SET is_read = 1 WHERE id IN (${placeholders})`
    ).run(...clean);
  } else {
    db.prepare(
      `UPDATE admin_notifications SET is_read = 1 WHERE COALESCE(is_read, 0) = 0`
    ).run();
  }
  return { ok: true, unread: countUnreadAdminNotifications() };
}

// ---------------------------------------------------------------------------
// P1.7 — destek talepleri (support_tickets)
// ---------------------------------------------------------------------------

const SUPPORT_STATUSES = new Set(["open", "answered", "closed"]);

function mapSupportTicketRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    institution_id: row.institution_id || null,
    business_id: row.business_id == null ? null : Number(row.business_id),
    business_name: row.business_name || "",
    reporter_username: row.reporter_username || "",
    reporter_role: row.reporter_role || "business",
    subject: row.subject || "",
    message: row.message || "",
    status: SUPPORT_STATUSES.has(row.status) ? row.status : "open",
    admin_reply: row.admin_reply || null,
    is_read: row.is_read === 1 || row.is_read === true,
    created_at: toIsoTimestamp(row.created_at),
    updated_at: toIsoTimestamp(row.updated_at),
  };
}

function createSupportTicket({
  institution_id = null,
  business_id = null,
  business_name = "",
  reporter_username = "",
  reporter_role = "business",
  subject,
  message,
}) {
  const cleanSubject = String(subject || "").trim().slice(0, 200);
  const cleanMessage = String(message || "").trim().slice(0, 5000);
  if (!cleanSubject || !cleanMessage) {
    throw new Error("Konu ve mesaj zorunludur.");
  }
  const info = db
    .prepare(
      `INSERT INTO support_tickets
         (institution_id, business_id, business_name, reporter_username,
          reporter_role, subject, message, status, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 0)`
    )
    .run(
      institution_id ? String(institution_id) : null,
      business_id != null ? Number(business_id) : null,
      String(business_name || "").trim(),
      String(reporter_username || "").trim(),
      String(reporter_role || "business").trim(),
      cleanSubject,
      cleanMessage
    );
  return mapSupportTicketRow(
    db.prepare(`SELECT * FROM support_tickets WHERE id = ?`).get(info.lastInsertRowid)
  );
}

function listSupportTickets({ status, institution_id, limit = 100 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const clauses = [];
  const args = [];
  if (status && SUPPORT_STATUSES.has(String(status))) {
    clauses.push(`status = ?`);
    args.push(String(status));
  }
  if (institution_id) {
    clauses.push(`institution_id = ?`);
    args.push(String(institution_id));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(
      `SELECT * FROM support_tickets
       ${where}
       ORDER BY datetime(created_at) DESC
       LIMIT ?`
    )
    .all(...args, lim)
    .map(mapSupportTicketRow);
}

function getSupportTicketById(id) {
  return mapSupportTicketRow(
    db.prepare(`SELECT * FROM support_tickets WHERE id = ?`).get(Number(id))
  );
}

function countOpenSupportTickets() {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM support_tickets WHERE status = 'open'`)
    .get();
  return Number(row?.c) || 0;
}

function updateSupportTicket(id, { status, admin_reply } = {}) {
  const existing = getSupportTicketById(id);
  if (!existing) throw new Error("Destek talebi bulunamadı.");

  let nextStatus = existing.status;
  if (status !== undefined) {
    const s = String(status || "").trim();
    if (!SUPPORT_STATUSES.has(s)) throw new Error("Geçersiz talep durumu.");
    nextStatus = s;
  }
  let nextReply = existing.admin_reply;
  if (admin_reply !== undefined) {
    nextReply = String(admin_reply || "").trim().slice(0, 5000) || null;
    // Yanıt yazıldıysa ve statü hâlâ 'open' ise otomatik 'answered'.
    if (nextReply && status === undefined && nextStatus === "open") {
      nextStatus = "answered";
    }
  }

  db.prepare(
    `UPDATE support_tickets
     SET status = ?, admin_reply = ?, is_read = 1, updated_at = datetime('now')
     WHERE id = ?`
  ).run(nextStatus, nextReply, Number(id));

  return getSupportTicketById(id);
}

const DEFAULT_SEO_SETTINGS = {
  site_name: "AdaDöviz",
  title: "AdaDöviz | KKTC Döviz Kurları, Dolar TL, Euro Kur ve Döviz Bürosu",
  description:
    "Kuzey Kıbrıs (KKTC) güncel döviz kurları: dolar TL, euro, sterlin. Lefkoşa, Girne ve Gazimağusa döviz bürolarını karşılaştırın. Canlı exchange rates.",
  keywords:
    "kktc döviz, dolar tl, döviz bürosu, exchange, kktc exchange, lefkoşa döviz, girne döviz, gazimağusa döviz, euro kuru, sterlin kuru, kuzey kıbrıs döviz, adadöviz, ada döviz",
  canonical_url: "https://adadoviz.tunahangul.com/",
  og_image: "https://adadoviz.tunahangul.com/adadoviz-og.svg",
  robots: "index, follow, max-image-preview:large",
  geo_region: "CY-Nicosia",
  geo_placename: "Northern Cyprus, KKTC",
  locale: "tr_TR",
  focus_queries:
    "döviz, dolar tl, döviz bürosu, exchange, kktc döviz, lefkoşa exchange, euro tl",
  structured_data_enabled: true,
};

function touchLastLogin(username) {
  const clean = String(username || "").trim();
  if (!clean) return null;
  const at = new Date().toISOString();
  db.prepare(`UPDATE institutions SET last_login_at = ? WHERE username = ?`).run(at, clean);
  return at;
}

/** S-M4: audit zinciri için sunucu-özel HMAC anahtarı. */
const AUDIT_HMAC_KEY =
  process.env.AUDIT_HMAC_KEY || process.env.JWT_SECRET || "adadoviz-audit-local-key";

function auditRowHash({ prev_hash, action, actor, institution_id, institution_name, detail, created_at }) {
  const material = [
    prev_hash || "",
    action || "",
    actor || "",
    institution_id || "",
    institution_name || "",
    detail || "",
    created_at || "",
  ].join("|");
  return crypto.createHmac("sha256", AUDIT_HMAC_KEY).update(material).digest("hex");
}

function lastAuditRowHash() {
  const row = db.prepare(`SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1`).get();
  return row?.row_hash || "GENESIS";
}

function insertAuditLog({
  action,
  actor = null,
  institution_id = null,
  institution_name = null,
  detail = null,
  created_at = null,
  prev_hash = null,
  row_hash = null,
} = {}) {
  if (!action) return null;
  const createdAt = created_at || new Date().toISOString();
  // S-M4: hydrate sırasında Supabase satırı kendi hash'lerini taşır; yerelde
  // yeni satır için zinciri buradan hesapla.
  const prevHash = prev_hash || lastAuditRowHash();
  const base = {
    action: String(action),
    actor: actor || null,
    institution_id: institution_id || null,
    institution_name: institution_name || null,
    detail: detail || null,
    created_at: createdAt,
  };
  const rowHash = row_hash || auditRowHash({ ...base, prev_hash: prevHash });

  const info = db
    .prepare(
      `INSERT INTO audit_log (action, actor, institution_id, institution_name, detail, created_at, prev_hash, row_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      base.action,
      base.actor,
      base.institution_id,
      base.institution_name,
      base.detail,
      base.created_at,
      prevHash,
      rowHash
    );
  return {
    id: Number(info.lastInsertRowid),
    ...base,
    prev_hash: prevHash,
    row_hash: rowHash,
  };
}

/**
 * S-M4: Zincir bütünlüğü doğrulaması. Herhangi bir satır eklenmiş, silinmiş veya
 * değiştirilmişse `ok:false` ve ilk kırılma noktasını döndürür.
 */
function verifyAuditChain(limit = 5000) {
  const rows = db
    .prepare(
      `SELECT id, action, actor, institution_id, institution_name, detail, created_at, prev_hash, row_hash
       FROM audit_log ORDER BY id ASC LIMIT ?`
    )
    .all(Math.max(1, Math.min(50000, Number(limit) || 5000)));
  let prev = "GENESIS";
  for (const row of rows) {
    // Eski (migrasyon öncesi) satırlarda hash yok — zincir onlardan sonra başlar.
    if (row.row_hash == null) {
      prev = "GENESIS";
      continue;
    }
    if ((row.prev_hash || "GENESIS") !== prev) {
      return { ok: false, brokenAt: row.id, reason: "prev_hash zincirle uyuşmuyor" };
    }
    const expected = auditRowHash(row);
    if (expected !== row.row_hash) {
      return { ok: false, brokenAt: row.id, reason: "row_hash içerikle uyuşmuyor (satır değiştirilmiş)" };
    }
    prev = row.row_hash;
  }
  return { ok: true, checked: rows.length };
}

function listAuditLogs(limit = 100) {
  const n = Math.min(200, Math.max(1, Number(limit) || 100));
  return db
    .prepare(
      `SELECT id, action, actor, institution_id, institution_name, detail, created_at
       FROM audit_log
       ORDER BY datetime(created_at) DESC
       LIMIT ?`
    )
    .all(n);
}

/**
 * Filtrelenebilir + sayfalanabilir audit log listesi.
 *
 * Süper admin tüm işletmeleri görür; işletme paneli yalnızca kendi
 * institution_id'sini geçirerek kendi geçmişini görür. Bu yüzden institutionId
 * filtresi ÇAĞIRAN TARAFTA zorunlu kılınır (bkz. /api/business/audit-logs).
 */
function listAuditLogsFiltered({
  institutionId = null,
  action = null,
  limit = 50,
  offset = 0,
} = {}) {
  const take = Math.min(200, Math.max(1, Number(limit) || 50));
  const skip = Math.max(0, Number(offset) || 0);

  const where = [];
  const params = [];
  if (institutionId) {
    where.push("institution_id = ?");
    params.push(String(institutionId));
  }
  if (action) {
    where.push("action = ?");
    params.push(String(action));
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT id, action, actor, institution_id, institution_name, detail, created_at
       FROM audit_log
       ${whereSql}
       ORDER BY datetime(created_at) DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, take, skip);

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM audit_log ${whereSql}`)
    .get(...params);

  return { rows, total: Number(total) || 0 };
}

/** Filtre çipleri için: kullanılan işlem tipleri ve adetleri. */
function listAuditActions(institutionId = null) {
  const whereSql = institutionId ? "WHERE institution_id = ?" : "";
  const params = institutionId ? [String(institutionId)] : [];
  return db
    .prepare(
      `SELECT action, COUNT(*) AS count
       FROM audit_log
       ${whereSql}
       GROUP BY action
       ORDER BY count DESC`
    )
    .all(...params);
}

function applySupabaseAuditRow(row) {
  if (!row?.action || !row?.created_at) return;
  const existing = db
    .prepare(
      `SELECT id FROM audit_log
       WHERE action = ?
         AND COALESCE(institution_id, '') = COALESCE(?, '')
         AND created_at = ?
       LIMIT 1`
    )
    .get(row.action, row.institution_id || null, row.created_at);
  if (existing) return;
  // S-M4: Supabase satırı kendi hash zincirini taşıyorsa BİREBİR kopyala
  // (böylece verifyAuditChain redeploy sonrası da doğrular). Yoksa yerelde
  // zinciri yeniden hesapla.
  db.prepare(
    `INSERT INTO audit_log (action, actor, institution_id, institution_name, detail, created_at, prev_hash, row_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.action,
    row.actor || null,
    row.institution_id || null,
    row.institution_name || null,
    row.detail || null,
    row.created_at,
    row.prev_hash || null,
    row.row_hash || null
  );
}

function getSeoSettings() {
  const row = db.prepare(`SELECT value FROM site_settings WHERE key = 'seo'`).get();
  if (!row?.value) return { ...DEFAULT_SEO_SETTINGS };
  try {
    const parsed = JSON.parse(row.value);
    return { ...DEFAULT_SEO_SETTINGS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch (_e) {
    return { ...DEFAULT_SEO_SETTINGS };
  }
}

function updateSeoSettings(payload = {}) {
  const current = getSeoSettings();
  const next = {
    ...current,
    site_name: String(payload.site_name ?? current.site_name ?? "").trim() || DEFAULT_SEO_SETTINGS.site_name,
    title: String(payload.title ?? current.title ?? "").trim() || DEFAULT_SEO_SETTINGS.title,
    description:
      String(payload.description ?? current.description ?? "").trim() ||
      DEFAULT_SEO_SETTINGS.description,
    keywords: String(payload.keywords ?? current.keywords ?? "").trim(),
    canonical_url:
      String(payload.canonical_url ?? current.canonical_url ?? "").trim() ||
      DEFAULT_SEO_SETTINGS.canonical_url,
    og_image: String(payload.og_image ?? current.og_image ?? "").trim(),
    robots: String(payload.robots ?? current.robots ?? "").trim() || DEFAULT_SEO_SETTINGS.robots,
    geo_region: String(payload.geo_region ?? current.geo_region ?? "").trim(),
    geo_placename: String(payload.geo_placename ?? current.geo_placename ?? "").trim(),
    locale: String(payload.locale ?? current.locale ?? "").trim() || "tr_TR",
    focus_queries: String(payload.focus_queries ?? current.focus_queries ?? "").trim(),
    structured_data_enabled:
      payload.structured_data_enabled === undefined
        ? current.structured_data_enabled !== false
        : !(
            payload.structured_data_enabled === false ||
            payload.structured_data_enabled === 0 ||
            payload.structured_data_enabled === "0" ||
            payload.structured_data_enabled === "false"
          ),
  };

  db.prepare(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ('seo', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(JSON.stringify(next));

  return next;
}


/* ==========================================================================
 * ABONELİK PAKETLERİ VE TAHSİLAT
 * ========================================================================== */

const DEFAULT_PLANS = [
  { code: "deneme", ad: "Deneme", sure_gun: 14, fiyat: 0, sira: 1 },
  { code: "aylik", ad: "Aylık Abonelik", sure_gun: 30, fiyat: 500, sira: 2 },
  { code: "yillik", ad: "Yıllık Abonelik", sure_gun: 365, fiyat: 5000, sira: 3 },
  { code: "ucretsiz", ad: "Ücretsiz Listeleme", sure_gun: 0, fiyat: 0, sira: 4 },
];

/** Eski subscription_type değerlerini plan koduna eşler. */
function planCodeFromSubscriptionType(type) {
  const t = String(type || "Test");
  if (t === "Aylık") return "aylik";
  if (t === "Yıllık") return "yillik";
  if (t === "Ücretsiz") return "ucretsiz";
  if (t === "Manuel") return "aylik";
  return "deneme";
}

function seedPlansIfNeeded() {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM plans`).get()?.c || 0;
  if (count > 0) return;
  const ins = db.prepare(
    `INSERT INTO plans (code, ad, sure_gun, fiyat, kdv_orani, aktif, sira)
     VALUES (?, ?, ?, ?, 0, 1, ?)`
  );
  for (const p of DEFAULT_PLANS) ins.run(p.code, p.ad, p.sure_gun, p.fiyat, p.sira);
  console.log(`[DB] ✅ ${DEFAULT_PLANS.length} abonelik paketi eklendi (fiyat artık veri).`);
}

function listPlans({ onlyActive = false } = {}) {
  const where = onlyActive ? `WHERE aktif = 1` : ``;
  return db.prepare(`SELECT * FROM plans ${where} ORDER BY sira ASC`).all();
}

function getPlan(code) {
  return db.prepare(`SELECT * FROM plans WHERE code = ?`).get(String(code || ""));
}

function updatePlan(code, { ad, sure_gun, fiyat, kdv_orani, aktif } = {}) {
  const row = getPlan(code);
  if (!row) throw new Error("Paket bulunamadı.");
  const next = {
    ad: ad !== undefined ? String(ad).trim() : row.ad,
    sure_gun: sure_gun !== undefined ? Math.max(0, parseInt(sure_gun, 10) || 0) : row.sure_gun,
    fiyat: fiyat !== undefined ? Math.max(0, Number(fiyat) || 0) : row.fiyat,
    kdv_orani: kdv_orani !== undefined ? Math.max(0, Number(kdv_orani) || 0) : row.kdv_orani,
    aktif: aktif !== undefined ? (aktif ? 1 : 0) : row.aktif,
  };
  if (!next.ad) throw new Error("Paket adı zorunludur.");
  db.prepare(
    `UPDATE plans SET ad = ?, sure_gun = ?, fiyat = ?, kdv_orani = ?, aktif = ? WHERE code = ?`
  ).run(next.ad, next.sure_gun, next.fiyat, next.kdv_orani, next.aktif, code);
  return getPlan(code);
}

function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* P3.3 — indirim kodları (S1)                                          */
/* ------------------------------------------------------------------ */

function normalizeDiscountCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function listDiscountCodes() {
  return db.prepare(`SELECT * FROM discount_codes ORDER BY datetime(created_at) DESC`).all();
}

function getDiscountCode(code) {
  return db.prepare(`SELECT * FROM discount_codes WHERE code = ?`).get(normalizeDiscountCode(code)) || null;
}

function createDiscountCode({ code, tur, deger, para_birimi, max_kullanim, gecerlilik_bitis, aciklama } = {}) {
  const c = normalizeDiscountCode(code);
  if (!c || c.length < 3) throw new Error("Kod en az 3 karakter olmalı.");
  if (getDiscountCode(c)) throw new Error("Bu kod zaten var.");
  const type = tur === "fixed" ? "fixed" : "percent";
  const val = Math.max(0, Number(deger) || 0);
  if (val <= 0) throw new Error("İndirim değeri 0'dan büyük olmalı.");
  if (type === "percent" && val > 100) throw new Error("Yüzde indirim 100'ü aşamaz.");
  const maxUse = Math.max(0, parseInt(max_kullanim, 10) || 0);
  let bitis = null;
  if (gecerlilik_bitis) {
    const d = new Date(gecerlilik_bitis);
    if (Number.isNaN(d.getTime())) throw new Error("Geçersiz son kullanma tarihi.");
    bitis = isoDay(d);
  }
  db.prepare(
    `INSERT INTO discount_codes (code, tur, deger, para_birimi, max_kullanim, gecerlilik_bitis, aciklama)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(c, type, val, String(para_birimi || "TRY").toUpperCase(), maxUse, bitis, aciklama ? String(aciklama).trim() : null);
  return getDiscountCode(c);
}

function setDiscountCodeActive(code, aktif) {
  const row = getDiscountCode(code);
  if (!row) throw new Error("Kod bulunamadı.");
  db.prepare(`UPDATE discount_codes SET aktif = ? WHERE code = ?`).run(aktif ? 1 : 0, row.code);
  return getDiscountCode(row.code);
}

function deleteDiscountCode(code) {
  const row = getDiscountCode(code);
  if (!row) throw new Error("Kod bulunamadı.");
  db.prepare(`DELETE FROM discount_codes WHERE code = ?`).run(row.code);
  return { deleted: true, code: row.code };
}

/**
 * Kodu bir baz tutara karşı değerlendirir. `throwOnInvalid` false ise
 * `{ valid:false, reason }` döner (UI ön-kontrolü); true ise hata fırlatır.
 */
function evaluateDiscountCode(code, baseAmount, { throwOnInvalid = false } = {}) {
  const fail = (reason) => {
    if (throwOnInvalid) throw new Error(reason);
    return { valid: false, reason };
  };
  const c = normalizeDiscountCode(code);
  if (!c) return fail("İndirim kodu boş.");
  const row = getDiscountCode(c);
  if (!row) return fail("İndirim kodu bulunamadı.");
  if (!row.aktif) return fail("İndirim kodu pasif.");
  if (row.gecerlilik_bitis && isoDay(new Date()) > row.gecerlilik_bitis) {
    return fail("İndirim kodunun süresi dolmuş.");
  }
  if (row.max_kullanim > 0 && row.kullanim_sayisi >= row.max_kullanim) {
    return fail("İndirim kodu kullanım limitine ulaştı.");
  }
  const base = Math.max(0, Number(baseAmount) || 0);
  let indirim = row.tur === "fixed" ? row.deger : (base * row.deger) / 100;
  indirim = Math.min(base, Math.round(indirim * 100) / 100);
  return {
    valid: true,
    row,
    indirim,
    netTutar: Math.round((base - indirim) * 100) / 100,
  };
}

function redeemDiscountCode(code) {
  const row = getDiscountCode(code);
  if (!row) return;
  db.prepare(
    `UPDATE discount_codes SET kullanim_sayisi = kullanim_sayisi + 1 WHERE code = ?`
  ).run(row.code);
}

/** Tahsilat kaydı. Tutar o günkü fiyatla dondurulur (zam geçmişi bozmasın). */
function createPayment({
  institution_id,
  plan_code,
  tutar,
  kdv,
  odeme_tarihi,
  donem_baslangic,
  donem_bitis,
  yontem,
  durum = "odendi",
  fatura_no,
  aciklama,
  olusturan,
  discount_code,
}) {
  const inst = String(institution_id || "").trim();
  if (!inst) throw new Error("İşletme zorunludur.");
  const plan = getPlan(plan_code);
  if (!plan) throw new Error("Geçersiz paket.");

  const odeme = odeme_tarihi ? new Date(odeme_tarihi) : new Date();
  if (Number.isNaN(odeme.getTime())) throw new Error("Geçersiz ödeme tarihi.");

  const bas = donem_baslangic ? isoDay(donem_baslangic) : isoDay(odeme);
  const bit = donem_bitis
    ? isoDay(donem_bitis)
    : isoDay(new Date(odeme.getTime() + (plan.sure_gun || 30) * 86400000));

  const gross = tutar !== undefined && tutar !== null && tutar !== "" ? Number(tutar) : plan.fiyat;
  if (!Number.isFinite(gross) || gross < 0) throw new Error("Geçersiz tutar.");
  const vat = kdv !== undefined && kdv !== null && kdv !== "" ? Number(kdv) : 0;

  let amount = gross;
  let appliedCode = null;
  let discountAmount = 0;
  if (discount_code) {
    const evald = evaluateDiscountCode(discount_code, gross, { throwOnInvalid: true });
    amount = evald.netTutar;
    discountAmount = evald.indirim;
    appliedCode = evald.row.code;
  }

  const info = db
    .prepare(
      `INSERT INTO payments
         (institution_id, plan_code, tutar, kdv, odeme_tarihi, donem_baslangic,
          donem_bitis, yontem, durum, fatura_no, aciklama, olusturan,
          indirim_kodu, indirim_tutari)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      inst,
      plan.code,
      amount,
      Number.isFinite(vat) ? vat : 0,
      odeme.toISOString(),
      bas,
      bit,
      yontem ? String(yontem).trim() : null,
      String(durum || "odendi"),
      fatura_no ? String(fatura_no).trim() : null,
      aciklama ? String(aciklama).trim() : null,
      olusturan ? String(olusturan).trim() : null,
      appliedCode,
      discountAmount
    );
  if (appliedCode) redeemDiscountCode(appliedCode);
  return db.prepare(`SELECT * FROM payments WHERE id = ?`).get(info.lastInsertRowid);
}

function deletePayment(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) throw new Error("Geçersiz ödeme ID.");
  const row = db.prepare(`SELECT * FROM payments WHERE id = ?`).get(n);
  if (!row) throw new Error("Ödeme bulunamadı.");
  db.prepare(`DELETE FROM payments WHERE id = ?`).run(n);
  return { deleted: true, payment: row };
}

/** Döküm: işletme adı ve paket adıyla zenginleştirilmiş ödeme listesi. */
function listPayments({ institution_id, from, to, limit = 500 } = {}) {
  const args = [];
  let where = `WHERE 1=1`;
  if (institution_id) {
    where += ` AND p.institution_id = ?`;
    args.push(String(institution_id));
  }
  if (from) {
    where += ` AND date(p.odeme_tarihi) >= date(?)`;
    args.push(isoDay(from));
  }
  if (to) {
    where += ` AND date(p.odeme_tarihi) <= date(?)`;
    args.push(isoDay(to));
  }
  args.push(Math.max(1, Math.min(2000, Number(limit) || 500)));

  return db
    .prepare(
      `SELECT p.*, i.institution_name, pl.ad AS plan_adi
       FROM payments p
       LEFT JOIN institutions i ON i.institution_id = p.institution_id
       LEFT JOIN plans pl ON pl.code = p.plan_code
       ${where}
       ORDER BY p.odeme_tarihi DESC, p.id DESC
       LIMIT ?`
    )
    .all(...args);
}

function getPaymentsForInstitution(institutionId, limit = 100) {
  return listPayments({ institution_id: institutionId, limit });
}

/** B-H1: taze kurulumda SQLite → Supabase bootstrap için ham ödeme satırları. */
function listAllPaymentsForSync() {
  return db.prepare(`SELECT * FROM payments`).all();
}

/** B-H1: tek ödeme satırını id ile getir (dual-write payload'u için). */
function getPaymentById(id) {
  return db.prepare(`SELECT * FROM payments WHERE id = ?`).get(Number(id)) || null;
}

/** Gelir özeti: bu ay, bu yıl, toplam + paket dağılımı. */
function getRevenueSummary() {
  const sum = (sql, ...a) => Number(db.prepare(sql).get(...a)?.t) || 0;
  const now = new Date();
  const ayBas = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const yilBas = `${now.getUTCFullYear()}-01-01`;

  return {
    buAy: sum(
      `SELECT SUM(tutar + kdv) AS t FROM payments WHERE durum = 'odendi' AND date(odeme_tarihi) >= date(?)`,
      ayBas
    ),
    buYil: sum(
      `SELECT SUM(tutar + kdv) AS t FROM payments WHERE durum = 'odendi' AND date(odeme_tarihi) >= date(?)`,
      yilBas
    ),
    toplam: sum(`SELECT SUM(tutar + kdv) AS t FROM payments WHERE durum = 'odendi'`),
    bekleyen: sum(`SELECT SUM(tutar + kdv) AS t FROM payments WHERE durum = 'bekliyor'`),
    odemeSayisi:
      Number(db.prepare(`SELECT COUNT(*) AS t FROM payments WHERE durum = 'odendi'`).get()?.t) || 0,
    paketDagilimi: db
      .prepare(
        `SELECT p.plan_code, pl.ad AS plan_adi, COUNT(*) AS adet, SUM(p.tutar + p.kdv) AS toplam
         FROM payments p LEFT JOIN plans pl ON pl.code = p.plan_code
         WHERE p.durum = 'odendi' GROUP BY p.plan_code ORDER BY toplam DESC`
      )
      .all(),
  };
}

/**
 * P3.3 — türetilmiş gelir metrikleri (S1): MRR, ARPA, gecikmiş, churn, LTV.
 * Abonelik durumu institutions'tan, fiyat plans'tan gelir (tarihi tahsilat
 * tutarları değil — "şu an ne kazanıyoruz" sorusu).
 */
function getRevenueAnalytics() {
  const businesses = listBusinesses();
  const planByCode = new Map(listPlans().map((p) => [p.code, p]));

  const monthlyValue = (subscriptionType) => {
    const plan = planByCode.get(planCodeFromSubscriptionType(subscriptionType));
    if (!plan || !plan.fiyat || !plan.sure_gun) return 0;
    return (plan.fiyat / plan.sure_gun) * 30;
  };

  let mrr = 0;
  let activePaying = 0;
  let overdueCount = 0;
  let overdueAmount = 0;
  const planBreakdown = {};

  for (const b of businesses) {
    const type = b.subscription_type || "Test";
    const listed = b.is_active !== false && (b.days_remaining == null || b.days_remaining >= 0);
    const mv = monthlyValue(type);

    if (listed && mv > 0) {
      mrr += mv;
      activePaying += 1;
      planBreakdown[type] = (planBreakdown[type] || 0) + 1;
    }
    // Gecikmiş: süresi dolmuş ama hâlâ hesabı açık (yenileme bekleyen).
    if (b.days_remaining != null && b.days_remaining < 0 && mv > 0) {
      overdueCount += 1;
      const plan = planByCode.get(planCodeFromSubscriptionType(type));
      overdueAmount += plan ? plan.fiyat : 0;
    }
  }

  // Churn: son 90 günde pasifleşmiş (is_active=0) ve bitiş tarihi bu pencerede
  // olan hesaplar. Kesin bir deaktivasyon damgası yok — bitiş tarihi vekil.
  const cutoff = isoDay(new Date(Date.now() - 90 * 86400000));
  const churned = businesses.filter(
    (b) =>
      b.is_active === false &&
      b.subscription_end_date &&
      isoDay(b.subscription_end_date) >= cutoff &&
      monthlyValue(b.subscription_type) > 0
  ).length;

  const churnRate = activePaying + churned > 0 ? churned / (activePaying + churned) : 0;
  const arpa = activePaying > 0 ? mrr / activePaying : 0;
  // LTV: churn biliniyorsa ARPA / churnRate, değilse 12 aylık vekil.
  const ltv = churnRate > 0 ? arpa / churnRate : arpa * 12;

  const now = new Date();
  const ayBas = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const collectedThisMonth =
    Number(
      db
        .prepare(
          `SELECT SUM(tutar + kdv) AS t FROM payments
           WHERE durum = 'odendi' AND date(odeme_tarihi) >= date(?)`
        )
        .get(ayBas)?.t
    ) || 0;
  const payingInstThisMonth =
    Number(
      db
        .prepare(
          `SELECT COUNT(DISTINCT institution_id) AS c FROM payments
           WHERE durum = 'odendi' AND date(odeme_tarihi) >= date(?)`
        )
        .get(ayBas)?.c
    ) || 0;

  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
  return {
    mrr: round(mrr),
    arr: round(mrr * 12),
    arpa: round(arpa),
    ltv: round(ltv),
    activePaying,
    overdueCount,
    overdueAmount: round(overdueAmount),
    churned90d: churned,
    churnRate: round(churnRate * 100),
    collectedThisMonth: round(collectedThisMonth),
    payingInstThisMonth,
    planBreakdown: Object.entries(planBreakdown)
      .map(([type, adet]) => ({ type, adet }))
      .sort((a, b) => b.adet - a.adet),
  };
}

/** Vade takvimi: önümüzdeki N günde biten abonelikler. */
function listExpiringSubscriptions(days = 30) {
  const n = Math.max(1, Math.min(365, Number(days) || 30));
  return listBusinesses()
    .filter((b) => b.days_remaining != null && b.days_remaining <= n)
    .map((b) => ({
      institution_id: b.institution_id,
      institution_name: b.institution_name,
      subscription_type: b.subscription_type,
      subscription_end_date: b.subscription_end_date,
      days_remaining: b.days_remaining,
      is_active: b.is_active,
    }))
    .sort((a, b) => (a.days_remaining ?? 9999) - (b.days_remaining ?? 9999));
}

/**
 * Geriye dönük tahsilat üretimi: mevcut aboneliklerden birer payments satırı.
 * Döküm ilk günden boş açılmasın diye. Idempotent — zaten kaydı olan atlanır.
 */
function backfillPaymentsFromSubscriptions(olusturan = "sistem") {
  let eklenen = 0;
  const rows = listBusinesses();
  for (const b of rows) {
    if (!b.subscription_end_date) continue;
    const varMi = db
      .prepare(`SELECT COUNT(*) AS c FROM payments WHERE institution_id = ?`)
      .get(b.institution_id)?.c;
    if (varMi > 0) continue;

    const code = planCodeFromSubscriptionType(b.subscription_type);
    const plan = getPlan(code);
    if (!plan) continue;

    const bit = new Date(b.subscription_end_date);
    if (Number.isNaN(bit.getTime())) continue;
    const bas = new Date(bit.getTime() - (plan.sure_gun || 30) * 86400000);

    try {
      createPayment({
        institution_id: b.institution_id,
        plan_code: code,
        tutar: plan.fiyat,
        odeme_tarihi: bas.toISOString(),
        donem_baslangic: bas,
        donem_bitis: bit,
        durum: "odendi",
        aciklama: "Mevcut abonelikten geriye dönük oluşturuldu",
        olusturan,
      });
      eklenen += 1;
    } catch (err) {
      console.warn("[DB] backfill payment:", b.institution_id, err.message);
    }
  }
  if (eklenen > 0) {
    console.log(`[DB] ✅ ${eklenen} abonelik için geriye dönük tahsilat kaydı üretildi.`);
  }
  return { eklenen };
}

/**
 * İşletme bazında tıklama toplamı. visitor_sessions.clicked_businesses
 * işletme ADIYLA tutuluyor; institution_id'ye eşliyoruz.
 */
function getClicksByBusiness() {
  const sessions = db
    .prepare(`SELECT clicked_businesses, clicked_business_ids FROM visitor_sessions`)
    .all();
  const byName = new Map();
  const byId = new Map();
  for (const row of sessions) {
    for (const name of parseJsonArray(row.clicked_businesses)) {
      const key = String(name || "").trim();
      if (key) byName.set(key, (byName.get(key) || 0) + 1);
    }
    for (const id of parseJsonArray(row.clicked_business_ids)) {
      const key = String(id || "").trim();
      if (key) byId.set(key, (byId.get(key) || 0) + 1);
    }
  }
  const insts = db
    .prepare(
      `SELECT institution_id, institution_name FROM institutions
       WHERE COALESCE(role,'business') != 'superadmin'`
    )
    .all();
  return insts
    .map((i) => {
      // S7: id eslesmesi birincil; eski (id'siz) satirlar icin isim yedek.
      const idHits = byId.get(String(i.institution_id).trim()) || 0;
      const nameHits = byName.get(String(i.institution_name).trim()) || 0;
      return {
        institution_id: i.institution_id,
        institution_name: i.institution_name,
        tiklama: idHits > 0 ? idHits : nameHits,
      };
    })
    .sort((a, b) => b.tiklama - a.tiklama);
}

function getClicksForInstitution(institutionId) {
  const all = getClicksByBusiness();
  const hit = all.find((r) => r.institution_id === institutionId);
  return {
    tiklama: hit?.tiklama || 0,
    siralama: hit ? all.filter((r) => r.tiklama > hit.tiklama).length + 1 : null,
    toplamIsletme: all.length,
    toplamZiyaretci:
      Number(db.prepare(`SELECT COUNT(*) AS c FROM visitor_sessions`).get()?.c) || 0,
  };
}

/** Partnerlik başvuruları — public form yazıyordu ama gören ekran yoktu. */
function listPartnershipApplications(limit = 200) {
  const n = Math.max(1, Math.min(1000, Number(limit) || 200));
  try {
    return db.prepare(`SELECT * FROM partnership_applications ORDER BY id DESC LIMIT ?`).all(n);
  } catch (err) {
    console.warn("[DB] partnership list:", err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// P2.5 — işletme analitik olayları (analytics_events)
// ---------------------------------------------------------------------------

const ANALYTICS_EVENT_TYPES = new Set([
  "view",
  "call",
  "whatsapp",
  "directions",
  "search_impression",
]);

/** Tek analitik olay yaz. Bilinmeyen event tipi / geçersiz id sessizce yok sayılır. */
function recordAnalyticsEvent({
  institution_id = null,
  event,
  session_id = null,
  currency = null,
  city = null,
} = {}) {
  const type = String(event || "").trim();
  if (!ANALYTICS_EVENT_TYPES.has(type)) return null;
  const instId = Number(institution_id);
  const info = db
    .prepare(
      `INSERT INTO analytics_events (institution_id, event, session_id, currency, city)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      Number.isFinite(instId) && instId > 0 ? instId : null,
      type,
      session_id ? String(session_id).slice(0, 80) : null,
      currency ? String(currency).trim().toUpperCase().slice(0, 8) : null,
      city ? String(city).trim().slice(0, 80) : null
    );
  return info.lastInsertRowid;
}

/**
 * Bir işletmenin son N günlük analitiği:
 *   { days, series:[{date, view, call, whatsapp, directions, search_impression}],
 *     totals:{...}, byCurrency:[{currency,count}], byCity:[{city,count}] }
 */
function getBusinessAnalytics(institutionId, { days = 7 } = {}) {
  const instId = Number(institutionId);
  const win = Math.min(Math.max(Number(days) || 7, 1), 90);
  const empty = {
    days: win,
    series: [],
    totals: { view: 0, call: 0, whatsapp: 0, directions: 0, search_impression: 0 },
    byCurrency: [],
    byCity: [],
  };
  if (!Number.isFinite(instId) || instId <= 0) return empty;

  const since = `-${win} days`;
  const rows = db
    .prepare(
      `SELECT date(created_at) AS d, event, currency, city
         FROM analytics_events
        WHERE institution_id = ?
          AND created_at >= datetime('now', ?)`
    )
    .all(instId, since);

  // Gün ızgarasını doldur (boş günler 0).
  const byDate = new Map();
  for (let i = win - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    byDate.set(d, {
      date: d,
      view: 0,
      call: 0,
      whatsapp: 0,
      directions: 0,
      search_impression: 0,
    });
  }
  const totals = { view: 0, call: 0, whatsapp: 0, directions: 0, search_impression: 0 };
  const currencyCounts = new Map();
  const cityCounts = new Map();

  for (const r of rows) {
    if (totals[r.event] === undefined) continue;
    totals[r.event] += 1;
    const bucket = byDate.get(r.d);
    if (bucket) bucket[r.event] += 1;
    if (r.currency) {
      currencyCounts.set(r.currency, (currencyCounts.get(r.currency) || 0) + 1);
    }
    if (r.city) {
      cityCounts.set(r.city, (cityCounts.get(r.city) || 0) + 1);
    }
  }

  const toRanked = (m, key) =>
    [...m.entries()]
      .map(([k, count]) => ({ [key]: k, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

  return {
    days: win,
    series: [...byDate.values()],
    totals,
    byCurrency: toRanked(currencyCounts, "currency"),
    byCity: toRanked(cityCounts, "city"),
  };
}

// ---------------------------------------------------------------------------
// P2.6 — pazar yeri sağlığı (S2): bayat kur, kapsama boşluğu, marj yaşı
// ---------------------------------------------------------------------------

/**
 * Her işletme için son marj güncellemesinin yaşı + kapsama boşlukları.
 * Kur sanity kontrolü server.js'te (canlı MB kuru + adjustments orada).
 */
function getMarketHealth({ staleDays = 7 } = {}) {
  const stale = Math.min(Math.max(Number(staleDays) || 7, 1), 90);

  const lastAdjRows = db
    .prepare(
      `SELECT institution_id, MAX(updated_at) AS last_update
         FROM rate_adjustments
        GROUP BY institution_id`
    )
    .all();
  const lastMap = new Map(lastAdjRows.map((r) => [r.institution_id, r.last_update]));

  const now = Date.now();
  const staleMs = stale * 86400000;

  const businesses = listBusinesses().map((b) => {
    const raw = lastMap.get(b.institution_id) || null;
    const iso = raw ? toIsoTimestamp(raw) : null;
    const ms = iso ? Date.parse(iso) : null;
    const ageDays = ms ? Math.floor((now - ms) / 86400000) : null;
    const active =
      b.is_active === 1 || b.is_active === true || b.is_active === "1" || b.is_active == null;
    return {
      institution_id: b.institution_id,
      name: String(b.institution_name || "").replace(/\s*\([Tt]est\)\s*/g, " ").trim(),
      is_active: active,
      branch_count: Number(b.branch_count) || 0,
      last_margin_update: iso,
      last_margin_age_days: ageDays,
      never_configured: !raw,
      stale: !raw || (ms != null && now - ms > staleMs),
    };
  });

  // Kapsama: şubesi olan şehirler.
  const covered = new Set();
  for (const row of db.prepare(`SELECT address FROM branches`).all()) {
    const c = extractCitySlug(row.address);
    if (c) covered.add(c);
  }
  const allCities = (CITY_RULES || []).map((r) => r.slug);

  return {
    staleDays: stale,
    generatedAt: new Date().toISOString(),
    businesses,
    staleCount: businesses.filter((x) => x.stale && x.is_active).length,
    neverConfiguredCount: businesses.filter((x) => x.never_configured).length,
    businessesWithoutBranch: businesses
      .filter((x) => x.branch_count === 0)
      .map((x) => x.name),
    coveredCities: [...covered],
    uncoveredCities: allCities.filter((c) => !covered.has(c)),
  };
}

// ---------------------------------------------------------------------------
// P3.1 — self-signup başvuruları (signup_requests)
// ---------------------------------------------------------------------------

const SIGNUP_STATUSES = new Set(["pending", "approved", "rejected"]);

function mapSignupRequestRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    institution_name: row.institution_name || "",
    contact_person: row.contact_person || "",
    email: row.email || "",
    phone: row.phone || "",
    city: row.city || null,
    current_rate_info: row.current_rate_info || null,
    status: SIGNUP_STATUSES.has(row.status) ? row.status : "pending",
    reject_reason: row.reject_reason || null,
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at ? toIsoTimestamp(row.reviewed_at) : null,
    created_business_id: row.created_business_id == null ? null : Number(row.created_business_id),
    created_at: toIsoTimestamp(row.created_at),
  };
}

/**
 * Public başvuru kaydı. Anti-abuse:
 *  - aynı e-posta / telefon / kurum adıyla BEKLEYEN başvuru varsa reddet
 *  - o kurum adı / e-posta zaten institutions'ta kayıtlıysa reddet
 */
function createSignupRequest({
  institution_name,
  contact_person,
  email,
  phone,
  city = null,
  current_rate_info = null,
}) {
  const name = String(institution_name || "").trim().slice(0, 160);
  const person = String(contact_person || "").trim().slice(0, 120);
  const mail = String(email || "").trim().toLowerCase().slice(0, 160);
  const tel = String(phone || "").replace(/[^\d+() \-]/g, "").trim().slice(0, 40);
  const cityClean = city ? String(city).trim().slice(0, 40) : null;
  const rateInfo = current_rate_info ? String(current_rate_info).trim().slice(0, 1000) : null;

  if (!name || !person || !mail || !tel) {
    throw new Error("Kurum adı, yetkili, e-posta ve telefon zorunludur.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    throw new Error("Geçerli bir e-posta girin.");
  }
  const digits = tel.replace(/\D/g, "");
  if (digits.length < 7) {
    throw new Error("Geçerli bir telefon numarası girin.");
  }

  const dupPending = db
    .prepare(
      `SELECT 1 FROM signup_requests
        WHERE status = 'pending'
          AND (lower(email) = ? OR replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')','') = ?
               OR lower(institution_name) = lower(?))
        LIMIT 1`
    )
    .get(mail, digits, name);
  if (dupPending) {
    throw new Error("Bu bilgilerle zaten bekleyen bir başvurunuz var. İnceliyoruz.");
  }

  const existingBiz = db
    .prepare(
      `SELECT 1 FROM institutions
        WHERE lower(institution_name) = lower(?) OR lower(email) = ?
        LIMIT 1`
    )
    .get(name, mail);
  if (existingBiz) {
    throw new Error("Bu kurum ya da e-posta zaten kayıtlı. Şifrenizi mi unuttunuz?");
  }

  const info = db
    .prepare(
      `INSERT INTO signup_requests
         (institution_name, contact_person, email, phone, city, current_rate_info, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(name, person, mail, tel, cityClean, rateInfo);

  return mapSignupRequestRow(
    db.prepare(`SELECT * FROM signup_requests WHERE id = ?`).get(info.lastInsertRowid)
  );
}

function listSignupRequests({ status, limit = 200 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const where = status && SIGNUP_STATUSES.has(String(status)) ? `WHERE status = ?` : "";
  const args = where ? [String(status)] : [];
  return db
    .prepare(
      `SELECT * FROM signup_requests ${where}
       ORDER BY datetime(created_at) DESC
       LIMIT ?`
    )
    .all(...args, lim)
    .map(mapSignupRequestRow);
}

function getSignupRequestById(id) {
  return mapSignupRequestRow(
    db.prepare(`SELECT * FROM signup_requests WHERE id = ?`).get(Number(id))
  );
}

function countPendingSignupRequests() {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM signup_requests WHERE status = 'pending'`)
    .get();
  return Number(row?.c) || 0;
}

function updateSignupRequestStatus(id, { status, reject_reason, reviewed_by, created_business_id } = {}) {
  const existing = getSignupRequestById(id);
  if (!existing) throw new Error("Başvuru bulunamadı.");
  const s = String(status || "").trim();
  if (!SIGNUP_STATUSES.has(s) || s === "pending") {
    throw new Error("Geçersiz başvuru durumu.");
  }
  db.prepare(
    `UPDATE signup_requests
        SET status = ?, reject_reason = ?, reviewed_by = ?, reviewed_at = datetime('now'),
            created_business_id = ?
      WHERE id = ?`
  ).run(
    s,
    s === "rejected" ? String(reject_reason || "").trim().slice(0, 1000) || null : null,
    String(reviewed_by || "").trim().slice(0, 80) || null,
    created_business_id != null ? Number(created_business_id) : null,
    Number(id)
  );
  return getSignupRequestById(id);
}

// ---------------------------------------------------------------------------
// P3.4 — lead CRM + talep analitiği (lead_meta, search_misses)
// ---------------------------------------------------------------------------

const LEAD_SOURCES = new Set(["signup", "partnership"]);
const LEAD_STATUSES = new Set(["new", "contacted", "won", "lost"]);

function mapLeadMetaRow(row) {
  if (!row) return { status: "new", note: null, reminder_date: null, assignee: null, updated_at: null };
  return {
    status: LEAD_STATUSES.has(row.status) ? row.status : "new",
    note: row.note || null,
    reminder_date: row.reminder_date || null,
    assignee: row.assignee || null,
    updated_at: row.updated_at ? toIsoTimestamp(row.updated_at) : null,
  };
}

/** signup_requests + partnership_applications birleşik lead görünümü. */
function listLeads({ status, limit = 300 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const metaRows = db.prepare(`SELECT * FROM lead_meta`).all();
  const metaByKey = new Map(metaRows.map((m) => [`${m.source}:${m.source_id}`, mapLeadMetaRow(m)]));

  const signups = db
    .prepare(`SELECT * FROM signup_requests ORDER BY datetime(created_at) DESC LIMIT ?`)
    .all(lim)
    .map((r) => {
      const meta = metaByKey.get(`signup:${r.id}`) || mapLeadMetaRow(null);
      return {
        lead_key: `signup:${r.id}`,
        source: "signup",
        source_id: r.id,
        institution_name: r.institution_name || "",
        contact_person: r.contact_person || "",
        email: r.email || "",
        phone: r.phone || "",
        city: r.city || null,
        message: r.current_rate_info || null,
        source_status: r.status || "pending",
        created_at: toIsoTimestamp(r.created_at),
        ...meta,
      };
    });

  const partners = db
    .prepare(`SELECT * FROM partnership_applications ORDER BY datetime(created_at) DESC LIMIT ?`)
    .all(lim)
    .map((r) => {
      const meta = metaByKey.get(`partnership:${r.id}`) || mapLeadMetaRow(null);
      return {
        lead_key: `partnership:${r.id}`,
        source: "partnership",
        source_id: r.id,
        institution_name: r.institution_name || "",
        contact_person: r.contact_person || "",
        email: r.email || "",
        phone: r.phone || "",
        city: null,
        message: r.message || null,
        source_status: null,
        created_at: toIsoTimestamp(r.created_at),
        ...meta,
      };
    });

  let all = [...signups, ...partners].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
  if (status && LEAD_STATUSES.has(String(status))) {
    all = all.filter((l) => l.status === status);
  }
  return all.slice(0, lim);
}

function upsertLeadMeta({ source, source_id, status, note, reminder_date, assignee, updated_by } = {}) {
  const src = String(source || "").trim();
  if (!LEAD_SOURCES.has(src)) throw new Error("Geçersiz lead kaynağı.");
  const sid = Number(source_id);
  if (!Number.isFinite(sid) || sid <= 0) throw new Error("Geçersiz lead ID.");

  const table = src === "signup" ? "signup_requests" : "partnership_applications";
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(sid);
  if (!exists) throw new Error("Lead bulunamadı.");

  const st = status !== undefined ? String(status).trim() : undefined;
  if (st !== undefined && !LEAD_STATUSES.has(st)) throw new Error("Geçersiz lead durumu.");

  let rd = null;
  if (reminder_date) {
    const d = new Date(reminder_date);
    if (Number.isNaN(d.getTime())) throw new Error("Geçersiz hatırlatma tarihi.");
    rd = isoDay(d);
  }

  const current = db.prepare(`SELECT * FROM lead_meta WHERE source = ? AND source_id = ?`).get(src, sid);
  const next = {
    status: st !== undefined ? st : current?.status || "new",
    note:
      note !== undefined
        ? note
          ? String(note).trim().slice(0, 2000)
          : null
        : current?.note || null,
    reminder_date: reminder_date !== undefined ? rd : current?.reminder_date || null,
    assignee:
      assignee !== undefined
        ? assignee
          ? String(assignee).trim().slice(0, 80)
          : null
        : current?.assignee || null,
    updated_by: updated_by ? String(updated_by).trim().slice(0, 80) : null,
  };

  db.prepare(
    `INSERT INTO lead_meta (source, source_id, status, note, reminder_date, assignee, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(source, source_id) DO UPDATE SET
       status = excluded.status,
       note = excluded.note,
       reminder_date = excluded.reminder_date,
       assignee = excluded.assignee,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`
  ).run(src, sid, next.status, next.note, next.reminder_date, next.assignee, next.updated_by);

  return { source: src, source_id: sid, ...mapLeadMetaRow(
    db.prepare(`SELECT * FROM lead_meta WHERE source = ? AND source_id = ?`).get(src, sid)
  ) };
}

function getLeadCrmStats() {
  const leads = listLeads({ limit: 1000 });
  const byStatus = { new: 0, contacted: 0, won: 0, lost: 0 };
  let remindersDue = 0;
  let remindersUpcoming = 0;
  const today = isoDay(new Date());
  const in7 = isoDay(new Date(Date.now() + 7 * 86400000));
  for (const l of leads) {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    if (l.reminder_date && l.status !== "won" && l.status !== "lost") {
      if (l.reminder_date <= today) remindersDue += 1;
      else if (l.reminder_date <= in7) remindersUpcoming += 1;
    }
  }
  return { total: leads.length, byStatus, remindersDue, remindersUpcoming };
}

function normalizeSearchQuery(raw) {
  return String(raw || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Anasayfa büro araması sonuç bulamadığında çağrılır. Sessizce yutar. */
function recordSearchMiss({ query, city, session_id } = {}) {
  const q = String(query || "").trim().slice(0, 120);
  const norm = normalizeSearchQuery(q);
  if (norm.length < 2) return { skipped: true };
  db.prepare(
    `INSERT INTO search_misses (query, query_norm, city, session_id) VALUES (?, ?, ?, ?)`
  ).run(
    q,
    norm,
    city ? String(city).trim().slice(0, 60) : null,
    session_id ? String(session_id).trim().slice(0, 80) : null
  );
  return { ok: true };
}

function getSearchMissStats({ days = 30, limit = 20 } = {}) {
  const d = Math.min(Math.max(Number(days) || 30, 1), 365);
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const since = `datetime('now', '-${d} days')`;
  const top = db
    .prepare(
      `SELECT query_norm, COUNT(*) AS adet, MAX(created_at) AS son,
              (SELECT query FROM search_misses s2 WHERE s2.query_norm = s1.query_norm
                ORDER BY datetime(created_at) DESC LIMIT 1) AS ornek
         FROM search_misses s1
        WHERE created_at > ${since}
        GROUP BY query_norm
        ORDER BY adet DESC, son DESC
        LIMIT ?`
    )
    .all(lim);
  const byCity = db
    .prepare(
      `SELECT city, COUNT(*) AS adet FROM search_misses
        WHERE created_at > ${since} AND city IS NOT NULL AND city != ''
        GROUP BY city ORDER BY adet DESC LIMIT 20`
    )
    .all();
  const total =
    Number(
      db.prepare(`SELECT COUNT(*) AS c FROM search_misses WHERE created_at > ${since}`).get()?.c
    ) || 0;
  return { days: d, total, top, byCity };
}

/** analytics_events'ten talep kırılımı (şehir / para birimi / en çok görüntülenen). */
function getDemandAnalytics({ days = 30 } = {}) {
  const d = Math.min(Math.max(Number(days) || 30, 1), 365);
  const since = `datetime('now', '-${d} days')`;
  const engage = `event IN ('view','call','whatsapp','directions')`;

  const byCity = db
    .prepare(
      `SELECT city, COUNT(*) AS adet FROM analytics_events
        WHERE created_at > ${since} AND ${engage} AND city IS NOT NULL AND city != ''
        GROUP BY city ORDER BY adet DESC LIMIT 15`
    )
    .all();
  const byCurrency = db
    .prepare(
      `SELECT currency, COUNT(*) AS adet FROM analytics_events
        WHERE created_at > ${since} AND ${engage} AND currency IS NOT NULL AND currency != ''
        GROUP BY currency ORDER BY adet DESC`
    )
    .all();
  const topBusinessesRaw = db
    .prepare(
      `SELECT institution_id, COUNT(*) AS adet FROM analytics_events
        WHERE created_at > ${since} AND ${engage} AND institution_id IS NOT NULL
        GROUP BY institution_id ORDER BY adet DESC LIMIT 15`
    )
    .all();
  const nameById = new Map(
    db
      .prepare(`SELECT id, institution_name FROM institutions`)
      .all()
      .map((r) => [r.id, r.institution_name])
  );
  const topBusinesses = topBusinessesRaw.map((r) => ({
    institution_id: r.institution_id,
    institution_name: nameById.get(r.institution_id) || `#${r.institution_id}`,
    adet: r.adet,
  }));
  return { days: d, byCity, byCurrency, topBusinesses };
}

/** Dönüşüm hunisi (ziyaret → büro tıklama → lead → kazanıldı). Tüm zaman. */
function getLeadFunnel() {
  const visitors = getVisitorStats().total_visitors || 0;
  const clicks = getClicksByBusiness().reduce((sum, b) => sum + (Number(b.tiklama) || 0), 0);
  const leadsTotal =
    (Number(db.prepare(`SELECT COUNT(*) AS c FROM signup_requests`).get()?.c) || 0) +
    (Number(db.prepare(`SELECT COUNT(*) AS c FROM partnership_applications`).get()?.c) || 0);
  const won =
    (Number(
      db.prepare(`SELECT COUNT(*) AS c FROM signup_requests WHERE status = 'approved'`).get()?.c
    ) || 0) +
    (Number(db.prepare(`SELECT COUNT(*) AS c FROM lead_meta WHERE status = 'won'`).get()?.c) || 0);
  return [
    { key: "visitors", value: visitors },
    { key: "clicks", value: clicks },
    { key: "leads", value: leadsTotal },
    { key: "won", value: won },
  ];
}

// ---------------------------------------------------------------------------
// P3.6 — self-servis ödeme / dekont (payment_proofs)
// ---------------------------------------------------------------------------

const PROOF_STATUSES = new Set(["pending", "approved", "rejected"]);

/** Dekont görseli — logo doğrulayıcının aynı sniff mantığı, daha büyük sınır. */
function sanitizeProofImage(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("Dekont görseli zorunludur.");
  if (s.length > 3_500_000) {
    throw new Error("Dekont dosyası çok büyük (en fazla ~2.5 MB).");
  }
  const m = s.match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([\s\S]+)$/i);
  if (!m) throw new Error("Dekont yalnızca base64 kodlu görsel olabilir (data:image/...;base64,).");
  const declaredMime = String(m[1] || "").toLowerCase().trim();
  if (declaredMime.includes("svg")) throw new Error("SVG kabul edilmez. PNG, JPEG, WEBP veya GIF kullanın.");
  if (!LOGO_ALLOWED_MIME.has(declaredMime)) {
    throw new Error("Desteklenmeyen dosya türü. PNG, JPEG, WEBP veya GIF kullanın.");
  }
  let buf;
  try {
    buf = Buffer.from(m[2], "base64");
  } catch (_e) {
    throw new Error("Dekont verisi çözülemedi.");
  }
  const sniffed = sniffImageMime(buf);
  if (!sniffed) throw new Error("Dekont içeriği geçerli bir görsel değil.");
  const norm = (x) => (x === "image/jpg" ? "image/jpeg" : x);
  return `data:${norm(sniffed)};base64,${buf.toString("base64")}`;
}

/** plan kodu → subscription_type etiketi (planCodeFromSubscriptionType tersi). */
function subscriptionTypeFromPlanCode(code) {
  const c = String(code || "").toLowerCase();
  if (c === "yillik") return "Yıllık";
  if (c === "aylik") return "Aylık";
  if (c === "ucretsiz") return "Ücretsiz";
  return "Test";
}

function mapPaymentProofRow(row, { includeImage = false } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    institution_id: row.institution_id,
    plan_code: row.plan_code,
    amount: row.amount == null ? null : Number(row.amount),
    method: row.method || null,
    note: row.note || null,
    status: PROOF_STATUSES.has(row.status) ? row.status : "pending",
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at ? toIsoTimestamp(row.reviewed_at) : null,
    reject_reason: row.reject_reason || null,
    payment_id: row.payment_id == null ? null : Number(row.payment_id),
    created_at: toIsoTimestamp(row.created_at),
    institution_name: row.institution_name || null,
    plan_adi: row.plan_adi || null,
  };
  if (includeImage) out.proof_image = row.proof_image;
  return out;
}

function createPaymentProof({ institution_id, plan_code, amount, method, note, proof_image } = {}) {
  const inst = String(institution_id || "").trim();
  if (!inst) throw new Error("İşletme zorunludur.");
  const plan = getPlan(plan_code);
  if (!plan) throw new Error("Geçersiz paket.");
  const image = sanitizeProofImage(proof_image);

  // Anti-abuse: aynı işletmenin bekleyen dekontu varsa yenisini engelle.
  const pending = db
    .prepare(`SELECT 1 FROM payment_proofs WHERE institution_id = ? AND status = 'pending' LIMIT 1`)
    .get(inst);
  if (pending) {
    throw new Error("Zaten inceleme bekleyen bir dekontunuz var. Sonucu bekleyin.");
  }

  const amt =
    amount !== undefined && amount !== null && amount !== "" ? Number(amount) : plan.fiyat;
  const info = db
    .prepare(
      `INSERT INTO payment_proofs (institution_id, plan_code, amount, method, note, proof_image)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      inst,
      plan.code,
      Number.isFinite(amt) ? amt : null,
      method ? String(method).trim().slice(0, 40) : null,
      note ? String(note).trim().slice(0, 1000) : null,
      image
    );
  return mapPaymentProofRow(
    db.prepare(`SELECT * FROM payment_proofs WHERE id = ?`).get(info.lastInsertRowid)
  );
}

function listPaymentProofs({ status, institution_id, limit = 200, includeImage = false } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const where = [];
  const args = [];
  if (status && PROOF_STATUSES.has(String(status))) {
    where.push(`pp.status = ?`);
    args.push(String(status));
  }
  if (institution_id) {
    where.push(`pp.institution_id = ?`);
    args.push(String(institution_id));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  args.push(lim);
  return db
    .prepare(
      `SELECT pp.*, i.institution_name, pl.ad AS plan_adi
         FROM payment_proofs pp
         LEFT JOIN institutions i ON i.institution_id = pp.institution_id
         LEFT JOIN plans pl ON pl.code = pp.plan_code
         ${clause}
         ORDER BY datetime(pp.created_at) DESC
         LIMIT ?`
    )
    .all(...args)
    .map((r) => mapPaymentProofRow(r, { includeImage }));
}

function getPaymentProofById(id, { includeImage = false } = {}) {
  const row = db
    .prepare(
      `SELECT pp.*, i.institution_name, pl.ad AS plan_adi
         FROM payment_proofs pp
         LEFT JOIN institutions i ON i.institution_id = pp.institution_id
         LEFT JOIN plans pl ON pl.code = pp.plan_code
        WHERE pp.id = ?`
    )
    .get(Number(id));
  return mapPaymentProofRow(row, { includeImage });
}

function countPendingPaymentProofs() {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM payment_proofs WHERE status = 'pending'`).get()?.c) || 0;
}

/**
 * Onay: mevcut kalan güne planın süresini EKLE (süresi geçmişse bugünden başlat),
 * subscription_type'ı plana yükselt, hesabı aktive et. `payments` satırı ayrıca
 * server.js'te createPayment ile yazılır; burada yalnızca abonelik uzatılır.
 */
function extendSubscriptionForPlan(institutionId, planCode) {
  const plan = getPlan(planCode);
  if (!plan) throw new Error("Geçersiz paket.");
  const row = db
    .prepare(
      `SELECT id, subscription_type, subscription_end_date FROM institutions WHERE institution_id = ?`
    )
    .get(String(institutionId));
  if (!row) throw new Error("İşletme bulunamadı.");

  const currentRemaining = daysRemainingFrom(row.subscription_end_date);
  const base = Number.isFinite(currentRemaining) && currentRemaining > 0 ? currentRemaining : 0;
  const addDays = plan.sure_gun || 30;
  const nextType = subscriptionTypeFromPlanCode(planCode);
  const nextEnd =
    nextType === "Ücretsiz" ? null : endDateFromRemainingDays(base + addDays);

  db.prepare(
    `UPDATE institutions
        SET subscription_type = ?, subscription = ?, subscription_end_date = ?, is_active = 1
      WHERE institution_id = ?`
  ).run(nextType, buildSubscriptionLabel(nextType), nextEnd, String(institutionId));

  return { institution_id: String(institutionId), subscription_type: nextType, subscription_end_date: nextEnd, added_days: addDays };
}

function updatePaymentProofStatus(id, { status, reviewed_by, reject_reason, payment_id } = {}) {
  const existing = getPaymentProofById(id);
  if (!existing) throw new Error("Dekont bulunamadı.");
  if (existing.status !== "pending") throw new Error("Bu dekont zaten işlenmiş.");
  const s = String(status || "").trim();
  if (s !== "approved" && s !== "rejected") throw new Error("Geçersiz dekont durumu.");
  db.prepare(
    `UPDATE payment_proofs
        SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), reject_reason = ?, payment_id = ?
      WHERE id = ?`
  ).run(
    s,
    reviewed_by ? String(reviewed_by).trim().slice(0, 80) : null,
    s === "rejected" ? String(reject_reason || "").trim().slice(0, 1000) || null : null,
    payment_id != null ? Number(payment_id) : null,
    Number(id)
  );
  return getPaymentProofById(id);
}

// ---------------------------------------------------------------------------
// P3.2 — kur alarmları (rate_alerts)
// ---------------------------------------------------------------------------

const RATE_ALERT_CURRENCIES = new Set(["USD", "EUR", "GBP"]);
const RATE_ALERT_SIDES = new Set(["buy", "sell"]);
const RATE_ALERT_DIRECTIONS = new Set(["above", "below"]);
const RATE_ALERT_MAX_PER_EMAIL = 15;
const RATE_ALERT_DEBOUNCE_HOURS = 12;

function mapRateAlertRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email || "",
    currency: row.currency,
    side: row.side,
    direction: row.direction,
    threshold: Number(row.threshold),
    verified: row.verified === 1 || row.verified === true,
    active: row.active === 1 || row.active === true,
    armed: row.armed === 1 || row.armed === true,
    last_fired_at: row.last_fired_at ? toIsoTimestamp(row.last_fired_at) : null,
    manage_token: row.manage_token,
    verified_at: row.verified_at ? toIsoTimestamp(row.verified_at) : null,
    created_at: toIsoTimestamp(row.created_at),
  };
}

/**
 * Public alarm kaydı (verified=0). Aynı alarm (e-posta+birim+yön+eşik) zaten
 * varsa yeni satır AÇMAZ, mevcut kaydı `reused:true` ile döndürür.
 */
function createRateAlert({ email, currency, side, direction, threshold } = {}) {
  const mail = String(email || "").trim().toLowerCase().slice(0, 160);
  const cur = String(currency || "").trim().toUpperCase();
  const sd = String(side || "").trim().toLowerCase();
  const dir = String(direction || "").trim().toLowerCase();
  const thr = Number(String(threshold).replace(",", "."));

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    throw new Error("Geçerli bir e-posta girin.");
  }
  if (!RATE_ALERT_CURRENCIES.has(cur)) throw new Error("Geçersiz para birimi.");
  if (!RATE_ALERT_SIDES.has(sd)) throw new Error("Geçersiz işlem yönü.");
  if (!RATE_ALERT_DIRECTIONS.has(dir)) throw new Error("Geçersiz alarm yönü.");
  if (!Number.isFinite(thr) || thr <= 0 || thr > 100000) {
    throw new Error("Geçerli bir eşik değeri girin.");
  }
  const threshRounded = Math.round(thr * 10000) / 10000;

  const existing = db
    .prepare(
      `SELECT * FROM rate_alerts
        WHERE lower(email) = ? AND currency = ? AND side = ? AND direction = ?
          AND ABS(threshold - ?) < 0.00005
        LIMIT 1`
    )
    .get(mail, cur, sd, dir, threshRounded);
  if (existing) return { alert: mapRateAlertRow(existing), reused: true };

  const activeCount = db
    .prepare(`SELECT COUNT(*) AS c FROM rate_alerts WHERE lower(email) = ? AND active = 1`)
    .get(mail);
  if (Number(activeCount?.c) >= RATE_ALERT_MAX_PER_EMAIL) {
    throw new Error("Bu e-posta için alarm sınırına ulaşıldı. Önce bazılarını kaldırın.");
  }

  const token = crypto.randomBytes(24).toString("hex");
  const info = db
    .prepare(
      `INSERT INTO rate_alerts (email, currency, side, direction, threshold, manage_token)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(mail, cur, sd, dir, threshRounded, token);
  return {
    alert: mapRateAlertRow(
      db.prepare(`SELECT * FROM rate_alerts WHERE id = ?`).get(info.lastInsertRowid)
    ),
    reused: false,
  };
}

function getRateAlertByToken(token) {
  return mapRateAlertRow(
    db.prepare(`SELECT * FROM rate_alerts WHERE manage_token = ?`).get(String(token || ""))
  );
}

function listRateAlertsByEmail(email) {
  return db
    .prepare(
      `SELECT * FROM rate_alerts WHERE lower(email) = ? ORDER BY datetime(created_at) DESC`
    )
    .all(String(email || "").trim().toLowerCase())
    .map(mapRateAlertRow);
}

/** Çift-opt-in doğrulama — verified=1, aktifleşir, armed=1. */
function verifyRateAlert(token) {
  const alert = getRateAlertByToken(token);
  if (!alert) throw new Error("Alarm bulunamadı.");
  if (!alert.verified) {
    db.prepare(
      `UPDATE rate_alerts SET verified = 1, active = 1, armed = 1, verified_at = datetime('now')
        WHERE id = ?`
    ).run(alert.id);
  }
  return getRateAlertByToken(token);
}

/** token'in e-postası hedef alarmın e-postasıyla aynı olmalı (yetki). */
function setRateAlertActive({ token, id, active } = {}) {
  const owner = getRateAlertByToken(token);
  if (!owner) throw new Error("Yetkisiz.");
  const target = mapRateAlertRow(
    db.prepare(`SELECT * FROM rate_alerts WHERE id = ?`).get(Number(id))
  );
  if (!target || target.email.toLowerCase() !== owner.email.toLowerCase()) {
    throw new Error("Alarm bulunamadı.");
  }
  db.prepare(`UPDATE rate_alerts SET active = ?, armed = 1 WHERE id = ?`).run(
    active ? 1 : 0,
    target.id
  );
  return mapRateAlertRow(db.prepare(`SELECT * FROM rate_alerts WHERE id = ?`).get(target.id));
}

function deleteRateAlert({ token, id } = {}) {
  const owner = getRateAlertByToken(token);
  if (!owner) throw new Error("Yetkisiz.");
  const target = db.prepare(`SELECT * FROM rate_alerts WHERE id = ?`).get(Number(id));
  if (!target || String(target.email).toLowerCase() !== owner.email.toLowerCase()) {
    throw new Error("Alarm bulunamadı.");
  }
  db.prepare(`DELETE FROM rate_alerts WHERE id = ?`).run(target.id);
  return { ok: true };
}

function deactivateAllRateAlertsByToken(token) {
  const owner = getRateAlertByToken(token);
  if (!owner) throw new Error("Yetkisiz.");
  const info = db
    .prepare(`UPDATE rate_alerts SET active = 0 WHERE lower(email) = ?`)
    .run(owner.email.toLowerCase());
  return { ok: true, updated: info.changes };
}

function getActiveVerifiedRateAlerts() {
  return db
    .prepare(`SELECT * FROM rate_alerts WHERE active = 1 AND verified = 1`)
    .all()
    .map(mapRateAlertRow);
}

/** Alarm tetiklendi — last_fired_at damgası + armed=0 (eşik geçişi sıfırlanır). */
function recordRateAlertFired(id) {
  db.prepare(
    `UPDATE rate_alerts SET last_fired_at = datetime('now'), armed = 0 WHERE id = ?`
  ).run(Number(id));
}

function setRateAlertArmed(id, armed) {
  db.prepare(`UPDATE rate_alerts SET armed = ? WHERE id = ?`).run(armed ? 1 : 0, Number(id));
}

/** Superadmin değer sinyali — toplam / aktif / kırılım / son 30 (e-posta maskeli). */
function getRateAlertStats() {
  const total = db.prepare(`SELECT COUNT(*) AS c FROM rate_alerts`).get();
  const activeVerified = db
    .prepare(`SELECT COUNT(*) AS c FROM rate_alerts WHERE active = 1 AND verified = 1`)
    .get();
  const pendingVerify = db
    .prepare(`SELECT COUNT(*) AS c FROM rate_alerts WHERE verified = 0`)
    .get();
  const byTarget = db
    .prepare(
      `SELECT currency, side, direction, COUNT(*) AS count
         FROM rate_alerts WHERE active = 1 AND verified = 1
        GROUP BY currency, side, direction
        ORDER BY count DESC`
    )
    .all();
  const recent = db
    .prepare(`SELECT * FROM rate_alerts ORDER BY datetime(created_at) DESC LIMIT 30`)
    .all()
    .map((r) => {
      const m = mapRateAlertRow(r);
      const [local, domain] = String(m.email).split("@");
      const masked =
        (local ? local.slice(0, 1) + "***" : "***") + (domain ? "@" + domain : "");
      delete m.email;
      delete m.manage_token;
      return { ...m, email_masked: masked };
    });
  return {
    total: Number(total?.c) || 0,
    activeVerified: Number(activeVerified?.c) || 0,
    pendingVerify: Number(pendingVerify?.c) || 0,
    byTarget,
    recent,
    debounceHours: RATE_ALERT_DEBOUNCE_HOURS,
  };
}

module.exports = {
  initDb,
  createRateAlert,
  getRateAlertByToken,
  listRateAlertsByEmail,
  verifyRateAlert,
  setRateAlertActive,
  deleteRateAlert,
  deactivateAllRateAlertsByToken,
  getActiveVerifiedRateAlerts,
  recordRateAlertFired,
  setRateAlertArmed,
  getRateAlertStats,
  RATE_ALERT_DEBOUNCE_HOURS,
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
  listPublicBranches,
  getPublicExchangeOfficeBySlug,
  listPublicExchangeOfficeSlugs,
  purgeOrphanBranches,
  replaceBusinessBranchesFromSupabase,
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
  hasRecentBusinessNotification,
  createAdminNotification,
  listAdminNotifications,
  countUnreadAdminNotifications,
  markAdminNotificationsRead,
  createSupportTicket,
  listSupportTickets,
  getSupportTicketById,
  countOpenSupportTickets,
  updateSupportTicket,
  recordAnalyticsEvent,
  getBusinessAnalytics,
  getMarketHealth,
  createSignupRequest,
  listSignupRequests,
  getSignupRequestById,
  countPendingSignupRequests,
  updateSignupRequestStatus,
  listLeads,
  upsertLeadMeta,
  getLeadCrmStats,
  recordSearchMiss,
  getSearchMissStats,
  getDemandAnalytics,
  getLeadFunnel,
  createPaymentProof,
  listPaymentProofs,
  getPaymentProofById,
  countPendingPaymentProofs,
  updatePaymentProofStatus,
  extendSubscriptionForPlan,
  subscriptionTypeFromPlanCode,
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
  getAdjustmentsForInstitution,
  getAllAdjustmentsMap,
  upsertAdjustments,
  recordHistoricalRates,
  getHistoricalRates,
  getHistoricalRatesCount,
  getLatestHistoricalRatesSnapshot,
  listPlans,
  getPlan,
  updatePlan,
  createPayment,
  deletePayment,
  listPayments,
  getPaymentById,
  getPaymentsForInstitution,
  getRevenueSummary,
  getRevenueAnalytics,
  listDiscountCodes,
  getDiscountCode,
  createDiscountCode,
  setDiscountCodeActive,
  deleteDiscountCode,
  evaluateDiscountCode,
  listExpiringSubscriptions,
  backfillPaymentsFromSubscriptions,
  getClicksByBusiness,
  getClicksForInstitution,
  listPartnershipApplications,
  planCodeFromSubscriptionType,
  getBusinessRateHistory,
  bulkInsertHistoricalRates,
  getVisitorStats,
  incrementVisitorCount,
  startVisitorSession,
  updateVisitorSession,
  listVisitorSessions,
  getAdminAnalytics,
  findInstitutionForPasswordReset,
  createPasswordResetToken,
  findValidPasswordReset,
  markPasswordResetUsed,
  hashResetToken,
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
};
