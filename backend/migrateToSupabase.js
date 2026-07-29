/**
 * Migration Script: SQLite → Supabase (tam göç)
 *
 * Kullanım:
 *   cd backend
 *   node migrateToSupabase.js
 *
 * Not: Supabase'de DELETE (veya TRUNCATE) yetkisi gerekir.
 * SQL Editor'da bir kez çalıştır:
 *   TRUNCATE public.historical_rates RESTART IDENTITY;
 *   CREATE POLICY "Allow backend delete" ON public.historical_rates
 *     FOR DELETE USING (true);
 */

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://njwzjqwidcavohojjlty.supabase.co";
const SUPABASE_KEY = "sb_publishable_F8p7KYsAxwxGM-1MX9OF0g_1kaY_di1";
const BATCH_SIZE = 500;
const VALID_CURRENCIES = new Set(["USD", "EUR", "GBP"]);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const dbPath = path.join(__dirname, "data", "finsight.db");
const db = new DatabaseSync(dbPath);

async function countSupabaseRows() {
  const { count, error } = await supabase
    .from("historical_rates")
    .select("*", { count: "exact", head: true });

  if (error) {
    throw new Error(`Supabase satır sayımı hatası: ${error.message}`);
  }
  return count || 0;
}

/** 1. Adım: Supabase historical_rates tablosunu tamamen boşalt */
async function clearSupabaseTable() {
  const before = await countSupabaseRows();
  console.log(`   (temizlik öncesi Supabase satır: ${before})`);

  // PostgREST filtre zorunluluğu → her zaman true koşul
  const { error } = await supabase
    .from("historical_rates")
    .delete()
    .gte("id", 0);

  if (error) {
    throw new Error(`Supabase temizleme hatası: ${error.message}`);
  }

  const after = await countSupabaseRows();
  if (after > 0) {
    throw new Error(
      `Supabase temizlenemedi (${after} satır kaldı). ` +
        `Muhtemelen DELETE RLS policy yok. Supabase SQL Editor'da şunu çalıştır:\n\n` +
        `  TRUNCATE public.historical_rates RESTART IDENTITY;\n` +
        `  CREATE POLICY "Allow backend delete" ON public.historical_rates\n` +
        `    FOR DELETE USING (true);\n\n` +
        `Sonra scripti tekrar çalıştır.`
    );
  }

  console.log("1. Adım: Supabase temizlendi");
}

/** SQLite'dan LIMIT olmadan TÜM satırları çek */
function fetchAllFromSQLite() {
  const stmt = db.prepare(`
    SELECT currency, buy_rate, sell_rate, recorded_at
    FROM historical_rates
    ORDER BY recorded_at ASC
  `);
  return stmt.all() || [];
}

/**
 * currency + "_" + recorded_at anahtarıyla Map tekilleştirme.
 * Geçersiz currency / tarih / sayı satırları atılır.
 */
function deduplicateRows(sqliteRows) {
  const map = new Map();
  let skippedInvalid = 0;
  let skippedDuplicate = 0;

  for (const row of sqliteRows) {
    const currency = String(row.currency || "")
      .trim()
      .toUpperCase();

    if (!VALID_CURRENCIES.has(currency)) {
      skippedInvalid += 1;
      continue;
    }

    const buyRate = Number(row.buy_rate);
    const sellRate = Number(row.sell_rate);
    if (!Number.isFinite(buyRate) || !Number.isFinite(sellRate)) {
      skippedInvalid += 1;
      continue;
    }

    const recordedAtDate = new Date(row.recorded_at);
    if (Number.isNaN(recordedAtDate.getTime())) {
      skippedInvalid += 1;
      continue;
    }

    const recorded_at = recordedAtDate.toISOString();
    const key = `${currency}_${recorded_at}`;

    if (map.has(key)) {
      skippedDuplicate += 1;
      continue;
    }

    map.set(key, {
      currency,
      buy_rate: buyRate,
      sell_rate: sellRate,
      recorded_at,
    });
  }

  return {
    uniqueRows: Array.from(map.values()),
    skippedInvalid,
    skippedDuplicate,
  };
}

/** 500'erli batch insert (upsert yok — tablo sıfırlandı) */
async function insertBatches(rows) {
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
  console.log(
    `3. Adım: Batch'ler yükleniyor... (${totalBatches} paket, ${BATCH_SIZE}/paket)`
  );

  let successCount = 0;

  for (let i = 0; i < totalBatches; i++) {
    const start = i * BATCH_SIZE;
    const batch = rows.slice(start, start + BATCH_SIZE);

    const { error } = await supabase.from("historical_rates").insert(batch);

    if (error) {
      throw new Error(
        `Batch ${i + 1}/${totalBatches} insert hatası: ${error.message}`
      );
    }

    successCount += batch.length;
    console.log(
      `   ✅ Batch ${i + 1}/${totalBatches} yüklendi (${batch.length} satır, toplam: ${successCount})`
    );

    if (i < totalBatches - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  return successCount;
}

async function migrate() {
  console.log("\n========================================");
  console.log("🚀 SQLite → Supabase Tam Migration");
  console.log("========================================\n");

  try {
    await clearSupabaseTable();

    const sqliteRows = fetchAllFromSQLite();
    const { uniqueRows, skippedInvalid, skippedDuplicate } =
      deduplicateRows(sqliteRows);

    console.log(
      `2. Adım: SQLite'dan ${sqliteRows.length} satır çekildi, tekilleştirme sonrası ${uniqueRows.length} satır kaldı` +
        ` (duplicate atılan: ${skippedDuplicate}, geçersiz: ${skippedInvalid})`
    );

    if (uniqueRows.length === 0) {
      console.log("⚠️  Yüklenecek satır yok. Migration iptal.");
      process.exit(0);
    }

    const inserted = await insertBatches(uniqueRows);
    const finalCount = await countSupabaseRows();

    console.log("\n========================================");
    console.log("✅ Migration başarıyla tamamlandı");
    console.log(`📊 Yazılan satır: ${inserted}`);
    console.log(`📊 Supabase doğrulama count: ${finalCount}`);
    console.log(`📅 ${new Date().toISOString()}`);
    console.log("========================================\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration başarısız:", error.message);
    process.exit(1);
  } finally {
    try {
      db.close();
    } catch (_e) {
      // ignore
    }
  }
}

migrate();
