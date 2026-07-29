/**
 * Supabase client — CommonJS (backend server.js ile uyumlu)
 *
 * URL/KEY process.env üzerinden okunur (bkz. backend/.env, backend/.env.example).
 * Bu modül bağımsız script'lerden de import edilebildiği için (örn. migrateToSupabase.js)
 * dotenv burada da güvenli şekilde yüklenir (zaten yüklenmişse tekrar yükleme no-op'tur).
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "[Supabase] SUPABASE_URL / SUPABASE_KEY tanımlı değil. backend/.env dosyasını backend/.env.example'a göre oluşturun."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const {
  resolvePeriodSpec,
  MARKET_ARCHIVE_HOURS,
} = require("../periodSpec");
const {
  toSupabaseMarginHistoryRow,
  fromSupabaseMarginHistoryRow,
  enforceSellGteBuy,
  normalizeKind,
} = require("../marginSchema");

function bucketByHour(rawRows) {
  const byHour = new Map();
  for (const row of rawRows) {
    const d = new Date(row.recorded_at);
    if (Number.isNaN(d.getTime())) continue;
    d.setMinutes(0, 0, 0);
    const key = d.toISOString();
    const existing = byHour.get(key);
    if (!existing || new Date(existing.recorded_at).getTime() < new Date(row.recorded_at).getTime()) {
      byHour.set(key, {
        currency: row.currency,
        buy_rate: Number(row.buy_rate),
        sell_rate: Number(row.sell_rate),
        recorded_at: row.recorded_at,
      });
    }
  }
  return Array.from(byHour.values()).sort(
    (a, b) => new Date(a.recorded_at) - new Date(b.recorded_at)
  );
}

function bucketByDay(rawRows) {
  const byDay = new Map();
  for (const row of rawRows) {
    const dayKey = String(row.recorded_at).slice(0, 10);
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
  return Array.from(byDay.values()).sort(
    (a, b) => new Date(a.recorded_at) - new Date(b.recorded_at)
  );
}

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
 * Piyasa Özeti grafikleri.
 * period yalnızca agregasyon yoğunluğunu belirler; veri derinliği her zaman
 * tam arşivdir — böylece Saatlik/Günlük/Haftalık/Aylık'te de soldaki ok ile
 * yıllar geriye gidilebilir (Yıllık ile aynı UX).
 */
async function getMarketHistoricalRates(period = "Günlük", currency = "USD") {
  const spec = resolvePeriodSpec(period);
  const viewHours = spec.viewHours;
  const pctHours = spec.pctHours;
  const cutoffTime = new Date(Date.now() - MARKET_ARCHIVE_HOURS * 60 * 60 * 1000).toISOString();
  const viewCutoffTime = new Date(Date.now() - pctHours * 60 * 60 * 1000).toISOString();

  const rawRows = await fetchAllPages((from, to) =>
    supabase
      .from("historical_rates")
      .select("currency, buy_rate, sell_rate, recorded_at")
      .eq("currency", currency)
      .gte("recorded_at", cutoffTime)
      .order("recorded_at", { ascending: true })
      .range(from, to)
  );

  // Agregasyon: PERIOD_SPEC.bucket (hour | day)
  const rows =
    spec.bucket === "hour" ? bucketByHour(rawRows) : bucketByDay(rawRows);

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
  const isLimitedByAvailableData = actualSpanHours < viewHours;

  const { data: pastRows } = await supabase
    .from("historical_rates")
    .select("buy_rate, sell_rate")
    .eq("currency", currency)
    .lte("recorded_at", viewCutoffTime)
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
    requestedSpanDays: Math.max(1, Math.floor(viewHours / 24)),
  };
}

function lastRowAtOrBefore(sortedRows, tsMs, tsKey = "recorded_at") {
  let result = null;
  for (const row of sortedRows) {
    const rowMs = new Date(row[tsKey]).getTime();
    if (rowMs <= tsMs) result = row;
    else break;
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
      margin_value: Number(found.margin_value) || 0,
    };
  }
  if (sortedHistoryRows.length > 0) {
    const first = sortedHistoryRows[0];
    return {
      margin_type: normalizeKind(first.margin_type),
      margin_value: Number(first.margin_value) || 0,
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
 * İşletme detay grafiği — Supabase MB kurları + işletme marj geçmişi.
 *
 * Yeni işletmeler: extras.inceptionMs ile geçmiş kesilir; o tarihten itibaren
 * MB değişimleri biriktikçe grafik yavaş yavaş dolmaya başlar.
 *
 * @param {string} institutionId - slug (örn. "akbank"), ASLA parseInt etme
 * @param {string} currency
 * @param {string} period - Saatlik|Günlük|...
 * @param {object} extras
 * @param {number} [extras.inceptionMs] - işletme oluşturulma zamanı
 * @param {Array} [extras.buyHistory]
 * @param {Array} [extras.sellHistory]
 * @param {object} [extras.currentBuyAdj]
 * @param {object} [extras.currentSellAdj]
 */
async function getBusinessRateHistory(institutionId, currency, period, extras = {}) {
  const spec = resolvePeriodSpec(period);
  const hoursBack = spec.fetchHours;
  const nowMs = Date.now();
  const windowStartMs = nowMs - hoursBack * 60 * 60 * 1000;
  const inceptionMs = Number(extras.inceptionMs) || 0;
  // Yeni işletme: sadece oluşturulduktan sonraki veriler
  const effectiveStartMs = Math.max(windowStartMs, inceptionMs);

  // MB kurları: carry-forward için effectiveStart'tan biraz öncesini de al
  const fetchFromIso = new Date(
    Math.max(0, effectiveStartMs - 7 * 24 * 60 * 60 * 1000)
  ).toISOString();

  const allMbRows = await fetchAllPages((from, to) =>
    supabase
      .from("historical_rates")
      .select("buy_rate, sell_rate, recorded_at")
      .eq("currency", currency)
      .gte("recorded_at", fetchFromIso)
      .order("recorded_at", { ascending: true })
      .range(from, to)
  );

  if (!allMbRows.length) {
    return {
      rows: [],
      hasAnyData: false,
      requestedSpanDays: Math.floor(hoursBack / 24),
      meta: { institutionId, effectiveStartMs, source: "supabase" },
    };
  }

  const buyHistory = Array.isArray(extras.buyHistory) ? extras.buyHistory : [];
  const sellHistory = Array.isArray(extras.sellHistory) ? extras.sellHistory : [];

  const eventTimestamps = new Set([effectiveStartMs, nowMs]);
  for (const row of allMbRows) {
    const t = new Date(row.recorded_at).getTime();
    if (Number.isFinite(t) && t >= effectiveStartMs && t <= nowMs) {
      eventTimestamps.add(t);
    }
  }
  for (const row of buyHistory) {
    const t = new Date(row.recorded_at).getTime();
    if (Number.isFinite(t) && t >= effectiveStartMs && t <= nowMs) {
      eventTimestamps.add(t);
    }
  }
  for (const row of sellHistory) {
    const t = new Date(row.recorded_at).getTime();
    if (Number.isFinite(t) && t >= effectiveStartMs && t <= nowMs) {
      eventTimestamps.add(t);
    }
  }

  const sortedTimestamps = Array.from(eventTimestamps).sort((a, b) => a - b);
  const rows = [];

  for (const tsMs of sortedTimestamps) {
    const mbRow = mbRateValueAt(allMbRows, tsMs);
    if (!mbRow) continue;
    const buyRate = Number(mbRow.buy_rate);
    const sellRate = Number(mbRow.sell_rate);
    if (!(buyRate > 0) || !(sellRate > 0)) continue;

    const buyMargin = marginValueAt(buyHistory, extras.currentBuyAdj, tsMs);
    const sellMargin = marginValueAt(sellHistory, extras.currentSellAdj, tsMs);
    const finalBuy = applyMarginToRate(
      buyRate,
      buyMargin.margin_type,
      buyMargin.margin_value
    );
    const finalSell = applyMarginToRate(
      sellRate,
      sellMargin.margin_type,
      sellMargin.margin_value
    );
    if (finalBuy == null || finalSell == null) continue;

    const ordered = enforceSellGteBuy(finalBuy, finalSell);
    rows.push({
      recorded_at: new Date(tsMs).toISOString(),
      timeMs: tsMs,
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

  console.log(
    `[SUPABASE] business-rate ${institutionId}/${currency}/${period}: ${rows.length} nokta (inception=${inceptionMs || "yok"})`
  );

  return {
    rows,
    hasAnyData: rows.length > 0,
    requestedSpanDays: Math.floor(hoursBack / 24),
    meta: { institutionId, effectiveStartMs, source: "supabase" },
  };
}

/** Marj değişimini Supabase margin_history'ye yaz (kalıcı birikim) */
async function insertMarginHistory(entry) {
  // Kanonik → Supabase kolon eşlemesi (marginSchema.js):
  //   entry.type / entry.side → margin_type (buy|sell)
  //   entry.margin_type / entry.kind → margin_type_value (fixed|percent)
  let payload;
  try {
    payload = toSupabaseMarginHistoryRow({
      institution_id: entry.institution_id,
      currency: entry.currency,
      side: entry.side || entry.type,
      kind: entry.kind || entry.margin_type,
      margin_value: entry.margin_value,
      recorded_at: entry.recorded_at,
    });
  } catch (err) {
    console.warn("[Supabase] margin_history insert (schema):", err.message);
    return false;
  }

  const { error } = await supabase.from("margin_history").insert([payload]);

  if (error) {
    // Tablo yoksa sessizce geç — SQLite yedek olarak kalır
    console.warn("[Supabase] margin_history insert:", error.message);
    return false;
  }
  return true;
}

/** Supabase'den işletme marj geçmişini oku */
async function fetchMarginHistory(institutionId, currency, type) {
  try {
    const data = await fetchAllPages((from, to) =>
      supabase
        .from("margin_history")
        .select("margin_type_value, margin_value, recorded_at, margin_type")
        .eq("institution_id", String(institutionId))
        .eq("currency", currency)
        .eq("margin_type", type) // Supabase: side (buy|sell)
        .order("recorded_at", { ascending: true })
        .range(from, to)
    );
    return (data || []).map((row) => {
      const canonical = fromSupabaseMarginHistoryRow(row);
      return {
        margin_type: canonical.kind, // kanonik: kind (fixed|percent)
        margin_value: canonical.margin_value,
        recorded_at: canonical.recorded_at,
      };
    });
  } catch (err) {
    console.warn("[Supabase] margin_history fetch:", err.message);
    return [];
  }
}

module.exports = {
  supabase,
  insertHistoricalRate,
  getMarketHistoricalRates,
  getBusinessRateHistory,
  insertMarginHistory,
  fetchMarginHistory,
};
