/**
 * Supabase client — CommonJS (backend server.js ile uyumlu)
 *
 * TODO: URL/KEY'i process.env'e taşı
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://njwzjqwidcavohojjlty.supabase.co";
const SUPABASE_KEY = "sb_publishable_F8p7KYsAxwxGM-1MX9OF0g_1kaY_di1";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PERIOD_HOURS = {
  Saatlik: 24,
  Günlük: 24 * 7,
  Haftalık: 24 * 30,
  Aylık: 24 * 365,
  Yıllık: 24 * 365 * 5,
};

/**
 * Supabase PostgREST varsayılan limiti 1000 satır.
 * Tüm sayfaları çekerek tam sonuç döndürür.
 */
async function fetchAllPages(buildQuery) {
  const pageSize = 1000;
  let from = 0;
  const all = [];

  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

/** Tek bir kur kaydını Supabase'e ekle */
async function insertHistoricalRate(currency, buy_rate, sell_rate, recorded_at) {
  const { data, error } = await supabase.from("historical_rates").insert([
    {
      currency,
      buy_rate,
      sell_rate,
      recorded_at,
      created_at: new Date().toISOString(),
    },
  ]);

  if (error) {
    console.error("[Supabase] Insert error:", error.message);
    throw new Error(`Failed to insert rate: ${error.message}`);
  }

  return data;
}

/**
 * Piyasa Özeti grafikleri için — SQLite getHistoricalRates ile aynı shape.
 * Response: { rows, exactPercentageChange, isLimitedByAvailableData, actualSpanDays, requestedSpanDays }
 */
async function getMarketHistoricalRates(period = "Günlük", currency = "USD") {
  const hoursBack = PERIOD_HOURS[period] || PERIOD_HOURS.Günlük;
  const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  // Cutoff sonrası tüm ham noktalar (pagination ile)
  const rawRows = await fetchAllPages((from, to) =>
    supabase
      .from("historical_rates")
      .select("currency, buy_rate, sell_rate, recorded_at")
      .eq("currency", currency)
      .gte("recorded_at", cutoffTime)
      .order("recorded_at", { ascending: true })
      .range(from, to)
  );

  // Saatlik: ham noktalar; diğerleri: günde 1 (günün son kaydı)
  let rows;
  if (period === "Saatlik") {
    rows = rawRows;
  } else {
    const byDay = new Map();
    for (const row of rawRows) {
      const dayKey = String(row.recorded_at).slice(0, 10); // YYYY-MM-DD
      const existing = byDay.get(dayKey);
      if (
        !existing ||
        new Date(row.recorded_at).getTime() > new Date(existing.recorded_at).getTime()
      ) {
        byDay.set(dayKey, {
          currency: row.currency,
          buy_rate: Number(row.buy_rate),
          sell_rate: Number(row.sell_rate),
          recorded_at: row.recorded_at,
        });
      }
    }
    rows = Array.from(byDay.values()).sort(
      (a, b) => new Date(a.recorded_at) - new Date(b.recorded_at)
    );
  }

  // En eski kayıt → veri derinliği
  const { data: earliestRows, error: earliestError } = await supabase
    .from("historical_rates")
    .select("recorded_at")
    .eq("currency", currency)
    .order("recorded_at", { ascending: true })
    .limit(1);

  if (earliestError) {
    throw new Error(`Earliest fetch failed: ${earliestError.message}`);
  }

  const earliest = earliestRows?.[0]?.recorded_at || null;
  const actualSpanHours = earliest
    ? (Date.now() - new Date(earliest).getTime()) / 3600000
    : 0;
  const isLimitedByAvailableData = actualSpanHours < hoursBack;

  // Yüzde değişim: cutoff'taki en yakın geçmiş vs en güncel
  const { data: pastRows } = await supabase
    .from("historical_rates")
    .select("buy_rate, sell_rate")
    .eq("currency", currency)
    .lte("recorded_at", cutoffTime)
    .order("recorded_at", { ascending: false })
    .limit(1);

  const { data: currentRows } = await supabase
    .from("historical_rates")
    .select("buy_rate, sell_rate")
    .eq("currency", currency)
    .order("recorded_at", { ascending: false })
    .limit(1);

  const pastRate = pastRows?.[0];
  const currentRate = currentRows?.[0];

  let exactPercentageChange = 0;
  if (pastRate && currentRate) {
    const pastMid = (Number(pastRate.buy_rate) + Number(pastRate.sell_rate)) / 2;
    const currentMid =
      (Number(currentRate.buy_rate) + Number(currentRate.sell_rate)) / 2;
    if (pastMid > 0) {
      exactPercentageChange = ((currentMid - pastMid) / pastMid) * 100;
    }
  }

  console.log(
    `[SUPABASE] ${currency} (${period}): ${rows.length} nokta, span=${Math.floor(actualSpanHours / 24)}g, yeterli=${!isLimitedByAvailableData}`
  );

  return {
    rows,
    exactPercentageChange,
    isLimitedByAvailableData,
    actualSpanDays: Math.floor(actualSpanHours / 24),
    requestedSpanDays: Math.floor(hoursBack / 24),
  };
}

/**
 * İşletme detay grafiği — MB + marj birleşik seri
 */
async function getBusinessRateHistory(institutionId, currency, startDate, endDate) {
  const mbRates = await fetchAllPages((from, to) =>
    supabase
      .from("historical_rates")
      .select("*")
      .eq("currency", currency)
      .gte("recorded_at", startDate.toISOString())
      .lte("recorded_at", endDate.toISOString())
      .order("recorded_at", { ascending: true })
      .range(from, to)
  );

  let margins = [];
  try {
    margins = await fetchAllPages((from, to) =>
      supabase
        .from("margin_history")
        .select("*")
        .eq("institution_id", institutionId)
        .eq("currency", currency)
        .gte("recorded_at", startDate.toISOString())
        .lte("recorded_at", endDate.toISOString())
        .order("recorded_at", { ascending: true })
        .range(from, to)
    );
  } catch (err) {
    // margin_history yoksa veya boşsa sadece MB kurları ile devam
    console.warn("[Supabase] margin_history okunamadı:", err.message);
    margins = [];
  }

  const combinedData = [];
  let currentMarginBuy = { type: "fixed", value: 0 };
  let currentMarginSell = { type: "fixed", value: 0 };
  let marginIdx = 0;

  for (const rate of mbRates) {
    const rateTime = new Date(rate.recorded_at).getTime();

    while (
      marginIdx < margins.length &&
      new Date(margins[marginIdx].recorded_at).getTime() <= rateTime
    ) {
      const margin = margins[marginIdx];
      const typeVal = margin.margin_type_value || margin.margin_type || "fixed";
      const side = margin.margin_type || margin.type;
      if (side === "buy") {
        currentMarginBuy = { type: typeVal, value: Number(margin.margin_value) || 0 };
      } else {
        currentMarginSell = { type: typeVal, value: Number(margin.margin_value) || 0 };
      }
      marginIdx += 1;
    }

    combinedData.push({
      timeMs: rateTime,
      recorded_at: rate.recorded_at,
      buy_rate: Number(rate.buy_rate),
      sell_rate: Number(rate.sell_rate),
      final_buy: applyMargin(rate.buy_rate, currentMarginBuy),
      final_sell: applyMargin(rate.sell_rate, currentMarginSell),
    });
  }

  return combinedData;
}

function applyMargin(baseRate, margin) {
  if (!margin || baseRate == null) return Number(baseRate) || 0;
  const base = Number(baseRate);
  const value = Number(margin.value) || 0;
  if (margin.type === "percent") {
    return base + (base * value) / 100;
  }
  return base + value;
}

module.exports = {
  supabase,
  insertHistoricalRate,
  getMarketHistoricalRates,
  getBusinessRateHistory,
};
