/**
 * Tek marj şema sözlüğü (project_audit_report.md §1.2).
 *
 * Uygulama / SQLite kanonik alanlar:
 *   side = 'buy' | 'sell'           — kotasyon tarafı
 *   kind = 'fixed' | 'percent'      — marj uygulama biçimi
 *
 * Fiziksel kolon adları (bilinçli olarak farklı kaldı — mevcut Supabase
 * verisini bozmamak için kolon rename yapılmaz; mapping bu katmanda):
 *
 *   SQLite margin_history / rate_adjustments:
 *     type        → side
 *     margin_type → kind
 *
 *   Supabase margin_history:
 *     margin_type       → side   (buy|sell)   ← tarihsel isim çakışması
 *     margin_type_value → kind   (fixed|percent)
 *
 *   Supabase rate_adjustments:
 *     type        → side
 *     margin_type → kind   (SQLite ile aynı)
 */

const SIDES = Object.freeze(["buy", "sell"]);
const KINDS = Object.freeze(["fixed", "percent"]);

const BASELINE_OFFSET_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function normalizeSide(value) {
  const v = String(value || "").toLowerCase().trim();
  return SIDES.includes(v) ? v : null;
}

function normalizeKind(value) {
  return value === "percent" ? "percent" : "fixed";
}

function normalizeMarginValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Uygulama kanonik satırı → Supabase margin_history insert payload */
function toSupabaseMarginHistoryRow({
  institution_id,
  currency,
  side,
  kind,
  margin_value,
  recorded_at,
}) {
  const normalizedSide = normalizeSide(side);
  if (!normalizedSide) {
    throw new Error(`Geçersiz marj tarafı (side): ${side}`);
  }
  return {
    institution_id: String(institution_id),
    currency: String(currency).toUpperCase(),
    margin_type: normalizedSide, // Supabase: side
    margin_type_value: normalizeKind(kind), // Supabase: kind
    margin_value: Number(margin_value) || 0,
    recorded_at: recorded_at || new Date().toISOString(),
  };
}

/** Supabase margin_history satırı → uygulama kanonik biçimi */
function fromSupabaseMarginHistoryRow(row) {
  if (!row) return null;
  return {
    side: normalizeSide(row.margin_type) || normalizeSide(row.side) || "buy",
    kind: normalizeKind(row.margin_type_value ?? row.margin_type),
    margin_type: normalizeKind(row.margin_type_value ?? row.margin_type), // kanonik alias
    margin_value: Number(row.margin_value) || 0,
    recorded_at: row.recorded_at,
  };
}

/**
 * finalSell >= finalBuy iş kuralı.
 * Ters kotasyon varsa satış fiyatını alışa yükseltir (büro aleyhine satış engellenir).
 */
function enforceSellGteBuy(buy, sell) {
  if (buy == null || sell == null) return { buy, sell };
  const b = Number(buy);
  const s = Number(sell);
  if (!Number.isFinite(b) || !Number.isFinite(s)) return { buy, sell };
  if (s < b) return { buy: b, sell: b };
  return { buy: b, sell: s };
}

function baselineRecordedAtIso(nowMs = Date.now()) {
  return new Date(nowMs - BASELINE_OFFSET_MS).toISOString();
}

module.exports = {
  SIDES,
  KINDS,
  BASELINE_OFFSET_MS,
  normalizeSide,
  normalizeKind,
  normalizeMarginValue,
  toSupabaseMarginHistoryRow,
  fromSupabaseMarginHistoryRow,
  enforceSellGteBuy,
  baselineRecordedAtIso,
};
