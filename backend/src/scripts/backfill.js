#!/usr/bin/env node

/**
 * ✅ Historical Rates Backfill Script — GERÇEK KKTC Merkez Bankası XML Arşivi
 *
 * Kaynak: https://mb.gov.ct.tr/kur/tarih/YYYYMMDD
 * Format: KKTCMB_Doviz_Kurlari XML (aynı /api/kktc-kurlar endpoint'inin kullandığı yapı)
 *
 * Örnek:
 *   27/11/2001 → https://mb.gov.ct.tr/kur/tarih/20011127
 *   09/04/2011 → https://mb.gov.ct.tr/kur/tarih/20110409
 *
 * ✅ SECURITY: Sahte/sentetik/mock veri KESİNLİKLE üretilmiyor.
 *    Fetch veya parse başarısız olursa SADECE console.warn + continue, hiçbir satır eklenmiyor.
 *
 * ✅ GÜVENLİ: Mevcut historical_rates verisi (canlı SSE'den biriken) SİLİNMİYOR.
 *    Her (currency, tarih) çifti için önce kontrol edilir, zaten varsa atlanır (duplicate önleme).
 *
 * Usage:
 *   node backend/src/scripts/backfill.js
 */

const axios = require('axios');
const xml2js = require('xml2js');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'finsight.db');
const CENTRAL_BANK_URL = 'https://mb.gov.ct.tr/kur/tarih';
const CURRENCY_SYMBOLS = ['USD', 'EUR', 'GBP'];

let db;

function initDb() {
  try {
    db = new DatabaseSync(DB_PATH);
    console.log(`✅ Database connected: ${DB_PATH}`);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
}

/**
 * ✅ Belirli bir (currency, tarih) çifti için zaten kayıt var mı kontrol et (duplicate önleme)
 */
function existsForDate(currency, dateStr) {
  const isoDatePrefix = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
  const row = db.prepare(
    `SELECT COUNT(*) as c FROM historical_rates WHERE currency = ? AND date(recorded_at) = ?`
  ).get(currency, isoDatePrefix);
  return row.c > 0;
}

/**
 * ✅ Belirli bir tarih için KKTC Merkez Bankası'ndan GERÇEK XML verisini çek ve parse et
 * xml2js kullanılır (server.js /api/kktc-kurlar ile birebir aynı parsing mantığı)
 */
async function fetchRatesForDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;

  const url = `${CENTRAL_BANK_URL}/${dateStr}`;

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (FinSightRatesBot)',
      },
    });

    const parser = new xml2js.Parser();
    const jsonData = await parser.parseStringPromise(response.data);

    const root = jsonData.KKTCMB_Doviz_Kurlari || {};
    const resmiKurlar = root.Resmi_Kurlar?.[0]?.Resmi_Kur || [];

    const rates = {};
    for (const kur of resmiKurlar) {
      const sembol = kur.Sembol?.[0];
      if (!CURRENCY_SYMBOLS.includes(sembol)) continue;

      const buy = parseFloat(String(kur.Doviz_Alis?.[0]).replace(',', '.'));
      const sell = parseFloat(String(kur.Doviz_Satis?.[0]).replace(',', '.'));

      if (Number.isFinite(buy) && Number.isFinite(sell) && buy > 0 && sell > 0) {
        rates[sembol] = { buy, sell };
      }
    }

    if (Object.keys(rates).length === 0) {
      // ✅ Parse başarısız veya beklenen kurlar bulunamadı → null döndür (mock YOK)
      return { success: false, error: 'XML içinde USD/EUR/GBP kurları bulunamadı', dateStr };
    }

    return { success: true, rates, dateStr };
  } catch (err) {
    let errorMsg = err.message;
    if (err.response?.status === 404) errorMsg = 'Veri yok (404)';
    else if (err.response?.status === 500) errorMsg = 'Sunucu hatası (500)';
    return { success: false, error: errorMsg, dateStr };
  }
}

/**
 * ✅ DB'ye SADECE doğrulanmış GERÇEK veriyi kaydet (duplicate kontrolü ile)
 */
function insertRates(dateStr, rates) {
  if (!rates || Object.keys(rates).length === 0) return 0;

  const isoDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}T12:00:00.000Z`;

  const insert = db.prepare(`
    INSERT INTO historical_rates (currency, buy_rate, sell_rate, recorded_at)
    VALUES (?, ?, ?, ?)
  `);

  let count = 0;
  for (const [currency, pair] of Object.entries(rates)) {
    if (!pair.buy || !pair.sell) continue;

    // ✅ Duplicate önleme: bu currency+tarih için zaten kayıt varsa atla
    if (existsForDate(currency, dateStr)) {
      continue;
    }

    insert.run(currency, pair.buy, pair.sell, isoDate);
    count++;
  }

  return count;
}

/**
 * ✅ Main Backfill Logic — 6 YIL (kullanıcı onayı ile)
 */
async function runBackfill() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Gerçek Veri Backfill: KKTC Merkez Bankası XML Arşivi       ║');
  console.log('║  Kaynak: https://mb.gov.ct.tr/kur/tarih/YYYYMMDD             ║');
  console.log('║  ✅ SECURITY: Mock veri ÜRETİLMİYOR - Sadece GERÇEK veri     ║');
  console.log('║  ✅ Mevcut canlı veri SİLİNMİYOR (duplicate önleme aktif)    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  initDb();

  const today = new Date();
  const daysToFetch = 2200; // ✅ 6 yıl (kullanıcı onaylı)

  console.log(`📅 Dönem: ${daysToFetch} gün (~6 yıl)`);
  console.log(`📍 Başlangıç: ${today.toLocaleDateString('tr-TR')}`);
  console.log(`⚠️  Mock veri üretilmeyecek, sadece gerçek Merkez Bankası verileri toplanacak\n`);

  let totalInserted = 0;
  let successCount = 0;
  let failureCount = 0;
  let skipDuplicateCount = 0;

  for (let i = 0; i < daysToFetch; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    const { success, rates, error, dateStr } = await fetchRatesForDate(date);

    if (success) {
      const inserted = insertRates(dateStr, rates);
      totalInserted += inserted;
      successCount++;

      const dateFormatted = date.toLocaleDateString('tr-TR');
      if (inserted > 0) {
        const ratesSummary = Object.entries(rates)
          .map(([curr, pair]) => `${curr}: ${pair.buy.toFixed(4)}/${pair.sell.toFixed(4)}`)
          .join(' | ');
        console.log(`✅ ${dateFormatted} (${dateStr}) → ${ratesSummary} [+${inserted}]`);
      } else {
        skipDuplicateCount++;
        console.log(`⏭️  ${dateFormatted} (${dateStr}) → zaten mevcut, atlandı`);
      }
    } else {
      failureCount++;
      // ✅ SECURITY: SADECE warn, mock YOK
      console.warn(`⚠️  ${date.toLocaleDateString('tr-TR')} (${dateStr}) - Veri bulunamadı: ${error}`);
    }

    // ✅ Rate limiting - Merkez Bankası sunucusuna aşırı yük bindirmemek için
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    BACKFILL ÖZETİ                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`✅ Başarılı fetch: ${successCount} gün`);
  console.log(`❌ Başarısız fetch: ${failureCount} gün`);
  console.log(`⏭️  Zaten mevcut (duplicate atlandı): ${skipDuplicateCount} gün`);
  console.log(`📊 Yeni eklenen kayıt: ${totalInserted}`);
  console.log('');

  const totalCount = db.prepare('SELECT COUNT(*) as count FROM historical_rates').get().count;
  console.log(`📈 Veritabanında toplam: ${totalCount}`);
  console.log('');

  const byCurrency = db.prepare(`
    SELECT currency, COUNT(*) as count
    FROM historical_rates
    GROUP BY currency
    ORDER BY currency
  `).all();

  if (byCurrency.length > 0) {
    console.log('📊 Para birimine göre dağılım:');
    for (const row of byCurrency) {
      console.log(`   - ${row.currency}: ${row.count} kayıt`);
    }
  }

  const dateRange = db.prepare(`
    SELECT MIN(recorded_at) as min_date, MAX(recorded_at) as max_date
    FROM historical_rates
  `).get();

  if (dateRange.min_date && dateRange.max_date) {
    console.log('');
    console.log('📅 Veri aralığı:');
    console.log(`   - Başlangıç: ${new Date(dateRange.min_date).toLocaleDateString('tr-TR')}`);
    console.log(`   - Bitiş: ${new Date(dateRange.max_date).toLocaleDateString('tr-TR')}`);
  }

  console.log('');
  console.log('✨ Backfill tamamlandı! Grafikler artık gerçek KKTC Merkez Bankası verileriyle dolu.');
  console.log('⚠️  NOT: Hiçbir mock/sentetik veri üretilmedi - Sadece gerçek Merkez Bankası XML verisi kullanıldı.');
  console.log('');

  process.exit(0);
}

process.on('unhandledRejection', (err) => {
  console.error('❌ Beklenmedik hata:', err);
  process.exit(1);
});

runBackfill().catch((err) => {
  console.error('❌ Backfill hatası:', err);
  process.exit(1);
});
