/**
 * Migration Script: SQLite → Supabase
 * Lokal SQLite veritabanından Supabase'e 6 yıllık kur verilerini göç eder
 * 
 * Kullanım: node migrateToSupabase.js
 */

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const { supabase } = require("./src/config/supabaseClient");

// SQLite veritabanını aç
const dbPath = path.join(__dirname, "data", "finsight.db");
const db = new DatabaseSync(dbPath);

// Migration ayarları
const BATCH_SIZE = 500; // Her seferde Supabase'e gönderilecek satır sayısı

/**
 * SQLite'dan tüm geçmiş kur verilerini oku
 */
function fetchAllHistoricalRatesFromSQLite() {
  console.log("[MIGRATION] 📂 SQLite'dan geçmiş kur verileri okunuyor...");
  
  try {
    const stmt = db.prepare(`
      SELECT 
        currency,
        buy_rate,
        sell_rate,
        recorded_at
      FROM historical_rates
      ORDER BY recorded_at ASC
    `);
    
    const rows = stmt.all();
    console.log(`[MIGRATION] ✅ Toplam ${rows.length} satır SQLite'dan okundu.`);
    
    return rows || [];
  } catch (error) {
    console.error("[MIGRATION] ❌ SQLite okuma hatası:", error.message);
    throw error;
  }
}

/**
 * Veri şemasını dönüştür ve format et
 */
function transformDataToSupabaseSchema(sqliteRows) {
  console.log("[MIGRATION] 🔄 Veri şeması dönüştürülüyor...");
  
  return sqliteRows.map((row) => ({
    currency: row.currency.trim().toUpperCase(),
    buy_rate: parseFloat(row.buy_rate),
    sell_rate: parseFloat(row.sell_rate),
    recorded_at: new Date(row.recorded_at).toISOString(), // ISO format
  }));
}

/**
 * Verileri batch'ler halinde Supabase'e yükle
 */
async function uploadBatchesToSupabase(transformedData) {
  const totalBatches = Math.ceil(transformedData.length / BATCH_SIZE);
  console.log(`[MIGRATION] 📦 ${totalBatches} batch'e bölünüyor (${BATCH_SIZE}/batch)...`);
  
  let successCount = 0;
  let errorCount = 0;
  let duplicateCount = 0;

  for (let i = 0; i < totalBatches; i++) {
    const start = i * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, transformedData.length);
    const batch = transformedData.slice(start, end);

    try {
      // Supabase'e batch insert (upsert ile duplicate handling)
      const { data, error } = await supabase
        .from("historical_rates")
        .upsert(batch, {
          onConflict: "currency,recorded_at", // Unique constraint
        });

      if (error) {
        console.error(
          `[MIGRATION] ❌ Batch ${i + 1}/${totalBatches} hatası:`,
          error.message
        );
        errorCount++;
      } else {
        successCount += batch.length;
        console.log(
          `[MIGRATION] ✅ Batch ${i + 1}/${totalBatches} yüklendi (${batch.length} satır, toplam: ${successCount})`
        );
      }
    } catch (err) {
      console.error(
        `[MIGRATION] ❌ Batch ${i + 1}/${totalBatches} exception:`,
        err.message
      );
      errorCount++;
    }

    // Rate limiting: Her batch'in arası biraz bekle (Supabase API quota'sından kaçın)
    if (i < totalBatches - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return { successCount, errorCount, totalBatches };
}

/**
 * Ana migration fonksiyonu
 */
async function migrate() {
  console.log("\n========================================");
  console.log("🚀 SQLite → Supabase Migration Başlıyor");
  console.log("========================================\n");

  try {
    // Adım 1: SQLite'dan veri oku
    const sqliteData = fetchAllHistoricalRatesFromSQLite();

    if (sqliteData.length === 0) {
      console.log("[MIGRATION] ⚠️  SQLite'da geçmiş kur verisi bulunamadı.");
      console.log("[MIGRATION] İşlem iptal edildi.");
      process.exit(0);
    }

    // Adım 2: Şemayı dönüştür
    const transformedData = transformDataToSupabaseSchema(sqliteData);

    // Adım 3: Batch'ler halinde yükle
    console.log("\n[MIGRATION] 📤 Supabase'e yükleniyorum...\n");
    const result = await uploadBatchesToSupabase(transformedData);

    // Sonuç
    console.log("\n========================================");
    console.log("✅ MIGRATION TÜRESEİ BAŞARILI");
    console.log("========================================");
    console.log(`📊 Başarılı satırlar: ${result.successCount}`);
    console.log(`❌ Hata sayısı: ${result.errorCount}`);
    console.log(`📦 İşlenen batch'ler: ${result.totalBatches}`);
    console.log(`📅 Tarih: ${new Date().toISOString()}`);
    console.log("========================================\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration başarısız:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  } finally {
    // Database bağlantısını kapat
    try {
      if (db) {
        db.close();
      }
    } catch (e) {
      // Sessizce kapat
    }
  }
}

// Migration başlat
migrate();
