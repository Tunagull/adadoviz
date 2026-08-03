require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const { INSTITUTIONS, CURRENCIES, findInstitutionByName } = require("./institutions");
const { periodToHoursBack } = require("./periodSpec");
const {
  enforceSellGteBuy,
  normalizeKind,
  baselineRecordedAtIso,
} = require("./marginSchema");

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
  // Zaten çakışan (currency, recorded_at) kayıtları varsa index oluşturma
  // sessizce başarısız olur — şema kurulumunun tamamını bozmaz.
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_rates_unique
      ON historical_rates(currency, recorded_at)
    `);
  } catch (err) {
    console.warn("[DB] idx_historical_rates_unique oluşturulamadı (çakışan kayıtlar olabilir):", err.message);
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
  if (!columnExists("institutions", "contact_person")) {
    db.exec(`ALTER TABLE institutions ADD COLUMN contact_person TEXT`);
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
  const passwordHash = bcrypt.hashSync("123", 10);
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

  runInTransaction(() => {
    for (const inst of customInsts) {
      insert.run(inst.username, passwordHash, inst.institution_id, inst.name);
      insertLegacy.run(inst.username, passwordHash, inst.institution_id, inst.name);
    }
  });

  const count = db.prepare("SELECT COUNT(*) AS c FROM institutions WHERE username IN ('banka1', 'banka2', 'banka3')").get().c;
  if (count === 3) {
    console.log("[DB] Banka 1, 2, 3 zaten mevcut.");
  } else {
    console.log("[DB] Custom institutions eklendi (şifre: 123).");
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
  const passwordHash = bcrypt.hashSync("123", 10);
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
      const info = insert.run(username, passwordHash, inst.id, inst.name, endDate);
      if (info.changes > 0) added += 1;
    }
  });

  if (added > 0) {
    console.log(`[DB] Katalog işletmeleri eklendi: +${added} (şifre: 123)`);
  } else {
    console.log("[DB] Katalog işletmeleri zaten mevcut.");
  }
}

/**
 * Super admin hesabını hazırlar.
 * Varsayılan: kullanıcı adı "tuna", şifre "123"
 * (SUPERADMIN_USERNAME / SUPERADMIN_INITIAL_PASSWORD ile override edilebilir).
 */
function seedSuperAdminIfNeeded() {
  const username = process.env.SUPERADMIN_USERNAME || "tuna";
  const password = process.env.SUPERADMIN_INITIAL_PASSWORD || "123";
  const passwordHash = bcrypt.hashSync(password, 10);
  const existing = db
    .prepare("SELECT id FROM institutions WHERE username = ?")
    .get(username);

  if (existing) {
    db.prepare(`
      UPDATE institutions
      SET role = 'superadmin',
          institution_id = 'superadmin',
          institution_name = COALESCE(institution_name, 'FinSight Super Admin'),
          password_hash = ?
      WHERE username = ?
    `).run(passwordHash, username);
    console.log(`[DB] Super admin (${username}) güncellendi.`);
    return;
  }

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

function packageDays(subscriptionType, subscriptionDuration) {
  // Test = sınırsız (end_date null); buradaki 14 yalnızca geriye dönük yedek
  if (subscriptionType === "Test") return 14;
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
  if (t === "Test" || t === "Aylık" || t === "Yıllık" || t === "Manuel") return t;
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
function deactivateIfExpired(row) {
  if (!row || row.role === "superadmin") return row;
  if (normalizeSubscriptionType(row.subscription_type) === "Test") return row;
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

function mapBusinessRow(row) {
  if (!row) return null;
  const synced = deactivateIfExpired(row);
  const days_remaining = daysRemainingFrom(synced.subscription_end_date);
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
    subscription_type: synced.subscription_type || "Test",
    logo_url: synced.logo_url || null,
    phone: synced.phone || null,
    contact_person: synced.contact_person || null,
    working_hours,
    days_remaining,
    branch_limit,
    branch_count,
  };
}

function sanitizeLogoUrl(raw) {
  if (raw === undefined) return undefined; // güncellemede dokunma
  if (raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (!s.startsWith("data:image/")) {
    throw new Error("Logo yalnızca görsel (data:image) formatında olmalıdır.");
  }
  // ~900KB base64 sınırı
  if (s.length > 900_000) {
    throw new Error("Logo dosyası çok büyük. Lütfen daha küçük bir görsel kullanın.");
  }
  return s;
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
  return {
    ...synced,
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
              created_at
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
  // Test = sınırsız abonelik (subscription_end_date null)
  let endDate = null;
  if (type !== "Test") {
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

  // Bilinen banka adına eşleşirse dashboard kartıyla aynı institution_id kullan
  const known = findInstitutionByName(cleanName);
  const slug =
    cleanUsername
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || `biz_${Date.now()}`;
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
  const nextEmail =
    email === undefined
      ? row.email || null
      : normalizeContactEmail(email, { required: true });
  const typeChanged = subscription_type != null || remaining_days != null;
  const nextType = typeChanged
    ? normalizeSubscriptionType(subscription_type ?? row.subscription_type)
    : normalizeSubscriptionType(row.subscription_type);
  const nextLabel = typeChanged ? buildSubscriptionLabel(nextType) : (row.subscription || buildSubscriptionLabel(nextType));
  let endDate = row.subscription_end_date;
  if (typeChanged) {
    if (nextType === "Test") {
      endDate = null;
    } else {
      endDate = endDateFromRemainingDays(
        remaining_days != null ? remaining_days : packageDays(nextType)
      );
    }
  } else if (!endDate && nextType !== "Test") {
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
  if (!nextEmail) {
    throw new Error("E-posta zorunludur.");
  }

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
  const row = db.prepare(`SELECT id, role FROM institutions WHERE id = ?`).get(id);
  if (!row) throw new Error("İşletme bulunamadı.");
  if (row.role === "superadmin") throw new Error("Super admin hesabı silinemez.");

  db.prepare(`DELETE FROM branches WHERE business_id = ?`).run(id);
  db.prepare(`DELETE FROM institutions WHERE id = ?`).run(id);
  return { ok: true, id };
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
function isInstitutionPubliclyVisible(row) {
  if (!row) return false;
  if (row.role === "superadmin") return false;
  const synced = deactivateIfExpired(row);
  if (synced.is_active === 0 || synced.is_active === false) return false;
  if (synced.subscription_end_date) {
    const end = new Date(synced.subscription_end_date).getTime();
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
            VALUES (?, ?, ?, ?, ?, datetime('now', '-10 years'))
          `).run(trimmedInstitutionId, currency, type, baselineType, baselineValue);
          baselineWrite = { margin_type: baselineType, margin_value: baselineValue, recorded_at: baselineRecordedAt };
        }

        const newRecordedAt = new Date().toISOString();
        db.prepare(`
          INSERT INTO margin_history (institution_id, currency, type, margin_type, margin_value, recorded_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).run(trimmedInstitutionId, currency, type, marginType, marginValue);
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
function recordHistoricalRates(rates) {
  if (!Array.isArray(rates) || rates.length === 0) return;

  runInTransaction(() => {
    const insert = db.prepare(`
      INSERT INTO historical_rates (currency, buy_rate, sell_rate, recorded_at)
      VALUES (?, ?, ?, datetime('now'))
    `);

    for (const rate of rates) {
      if (rate.currency && typeof rate.buy_rate === 'number' && typeof rate.sell_rate === 'number') {
        insert.run(rate.currency, rate.buy_rate, rate.sell_rate);
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
      const recordedAt = row.recorded_at;
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

function applyMarginToRate(rawRate, marginType, marginValue) {
  const base = Number(rawRate);
  const m = Math.max(0, Number(marginValue) || 0);
  if (!Number.isFinite(base)) return null;
  if (normalizeKind(marginType) === "percent") return base + (base * m) / 100;
  return base + m;
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

    const finalBuy = applyMarginToRate(buyRate, buyMargin.margin_type, buyMargin.margin_value);
    const finalSell = applyMarginToRate(sellRate, sellMargin.margin_type, sellMargin.margin_value);
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
          `SELECT session_id, location, clicked_businesses, viewed_currencies, created_at, updated_at
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
        `SELECT session_id, location, clicked_businesses, viewed_currencies, created_at, updated_at
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
    viewed_currencies: parseJsonArray(row.viewed_currencies),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function updateVisitorSession(session_id, { clicked_businesses, viewed_currencies, business, currency }) {
  const sid = String(session_id || "").trim();
  if (!sid) throw new Error("session_id zorunludur.");

  const row = db
    .prepare(
      `SELECT session_id, location, clicked_businesses, viewed_currencies, created_at, updated_at
       FROM visitor_sessions WHERE session_id = ?`
    )
    .get(sid);

  if (!row) throw new Error("Oturum bulunamadı.");

  let businesses = parseJsonArray(row.clicked_businesses);
  let currencies = parseJsonArray(row.viewed_currencies);

  if (Array.isArray(clicked_businesses)) {
    businesses = mergeUniqueStrings(businesses, clicked_businesses);
  }
  if (business) {
    businesses = mergeUniqueStrings(businesses, [business]);
  }
  if (Array.isArray(viewed_currencies)) {
    currencies = mergeUniqueStrings(currencies, viewed_currencies);
  }
  if (currency) {
    currencies = mergeUniqueStrings(currencies, [currency]);
  }

  db.prepare(
    `UPDATE visitor_sessions
     SET clicked_businesses = ?, viewed_currencies = ?, updated_at = datetime('now')
     WHERE session_id = ?`
  ).run(JSON.stringify(businesses), JSON.stringify(currencies), sid);

  return mapVisitorSession(
    db
      .prepare(
        `SELECT session_id, location, clicked_businesses, viewed_currencies, created_at, updated_at
         FROM visitor_sessions WHERE session_id = ?`
      )
      .get(sid)
  );
}

function listVisitorSessions(limit = 50) {
  const rows = db
    .prepare(
      `SELECT session_id, location, clicked_businesses, viewed_currencies, created_at, updated_at
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
    .run(institutionId, email, token, expiresAt);

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
      .get(value) || null
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
                logo_url, email, phone, contact_person, working_hours, created_at
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
                logo_url, email, phone, contact_person, working_hours, created_at
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
              logo_url, email, phone, contact_person, working_hours, created_at
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
      row.created_at || null,
      row.institution_id
    );
  } else {
    db.prepare(
      `INSERT INTO institutions
        (username, password_hash, institution_id, institution_name, role, subscription,
         subscription_type, subscription_end_date, is_active, logo_url, email, phone, contact_person, working_hours, branch_limit, created_at)
       VALUES (?, ?, ?, ?, 'business', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.username || row.institution_id,
      row.password_hash || bcrypt.hashSync("123", 10),
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
      row.created_at || new Date().toISOString()
    );
  }
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

const DEFAULT_SEO_SETTINGS = {
  site_name: "AdaDöviz",
  title: "AdaDöviz | KKTC Döviz Kurları, Dolar TL, Euro Kur ve Döviz Bürosu",
  description:
    "Kuzey Kıbrıs (KKTC) güncel döviz kurları: dolar TL, euro, sterlin. Lefkoşa, Girne ve Gazimağusa döviz bürolarını karşılaştırın. Canlı exchange rates.",
  keywords:
    "kktc döviz, dolar tl, döviz bürosu, exchange, kktc exchange, lefkoşa döviz, girne döviz, gazimağusa döviz, euro kuru, sterlin kuru, kuzey kıbrıs döviz, adadöviz, ada döviz",
  canonical_url: "https://adadoviz.tunahangul.com/",
  og_image: "https://adadoviz.tunahangul.com/adadoviz-logo.svg",
  robots: "index, follow, max-image-preview:large",
  geo_region: "CY-Nicosia",
  geo_placename: "Northern Cyprus, KKTC",
  locale: "tr_TR",
  focus_queries:
    "döviz, dolar tl, döviz bürosu, exchange, kktc döviz, lefkoşa exchange, euro tl",
  structured_data_enabled: true,
};

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

module.exports = {
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
  getHistoricalRates,
  getHistoricalRatesCount,
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
  updateInstitutionPassword,
  getSeoSettings,
  updateSeoSettings,
};
