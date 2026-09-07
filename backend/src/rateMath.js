const { findInstitutionByName } = require("./institutions");
const { enforceSellGteBuy, normalizeKind, normalizeSide } = require("./marginSchema");

/**
 * ✅ ADIM 2: Floating-Point Precision Guarantee
 * 
 * Problem: JavaScript IEEE 754 (0.1 + 0.2 = 0.30000000000000004)
 * Solution: Explicit rounding after EVERY calculation
 * 
 * Used in:
 * - Rate calculations (XML rates)
 * - Margin applications (buy + margin)
 * - Currency conversions (amount * rate)
 * - API responses (all numeric values)
 */

function roundRate(value, decimals = 4) {
  // ✅ NULL/UNDEFINED Check
  if (value === null || value === undefined) return null;
  
  // ✅ FINITE Check (catches NaN, Infinity)
  if (!Number.isFinite(Number(value))) return null;
  
  // ✅ Precision rounding: Math.round() method
  // Formula: Math.round(value * 10^n) / 10^n
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(Number(value) * factor) / factor;
  
  // ✅ Final verification (extra safety)
  return Number.isFinite(rounded) ? rounded : null;
}

/**
 * ✅ Convenience: 2-decimal rounding for display
 * Used for: API responses, database storage
 */
function roundRateDisplay(value) {
  return roundRate(value, 2);  // 2 decimals for TL/currency display
}

/**
 * Marjı referans kura uygular (kesinlik garantili).
 *
 * ⚠️ KÂR YÖNÜ (2026-09 düzeltmesi): Döviz bürosunun kârı, referans kur ile
 * ilan ettiği kur arasındaki farktır ve iki taraf TERS yönde çalışır:
 *
 *   ALIŞ  (büro müşteriden döviz alır): büro referansın ALTINDA fiyat verir.
 *          ilan_alış = referans_alış − marj     → kâr = referans − ilan_alış
 *          (alış fiyatı düştükçe kâr artar)
 *   SATIŞ (büro müşteriye döviz satar): büro referansın ÜSTÜNDE fiyat verir.
 *          ilan_satış = referans_satış + marj   → kâr = ilan_satış − referans
 *
 * Eski kod her iki tarafta da `base + m` yapıyordu; alış tarafında bu, büronun
 * dövizi referansın üstünde satın alması (her işlemde zarar) ve "kâr" olarak
 * yanlış işaretle gösterilmesi demekti. P2.6 pazar-sağlığı sanity bandı
 * (`buy_above_cb`, `buy_margin_wide = (referans − alış)/referans`) zaten doğru
 * modeli varsayıyordu.
 *
 * Formül:
 *   percent: base ± (base * marj / 100)
 *   fixed:   base ± marj (TL)
 * `side` verilmezse geriye dönük uyum için "sell" (toplama) varsayılır.
 *
 * Kesinlik: her hesap sonrası açık `roundRate()`; alış sonucu 0'ın altına düşemez.
 */
function applyMarginToValue(kur, margin, marginType, side = "sell") {
  const base = Number(kur);
  const m = Math.max(0, Number(margin) || 0);
  if (!Number.isFinite(base)) return null;

  const delta = normalizeKind(marginType) === "percent" ? (base * m) / 100 : m;
  const isBuy = normalizeSide(side) === "buy";
  let result = roundRate(isBuy ? base - delta : base + delta, 4);

  // Alış kuru negatife düşemez (aşırı yüzde marjı koruması).
  if (isBuy && Number.isFinite(result) && result < 0) result = 0;

  if (!Number.isFinite(result)) {
    console.warn(
      `[PRECISION] Invalid result: ${base} ${isBuy ? "-" : "+"} ${delta} (${marginType}) = ${result}`
    );
    return null;
  }
  return result;
}

// Granüler: her currency × type (buy/sell) için kendi margin'i var
function getGranularMargin(institutionId, currency, type, adjustmentsMap) {
  const instAdj = adjustmentsMap.get(institutionId);
  if (!instAdj) return { margin_type: "fixed", margin_value: 0 };
  
  const key = `${currency}_${type}`;
  return instAdj[key] || { margin_type: "fixed", margin_value: 0 };
}

function applyAdjustmentToPair(pair, adj) {
  if (!adj) {
    return enforceSellGteBuy(pair?.buy ?? null, pair?.sell ?? null);
  }

  // Granüler format (buy/sell ayrı ayrı): { buy: { margin_type, margin_value }, sell: { ... } }
  if (adj.buy && adj.sell && typeof adj.buy === "object") {
    return enforceSellGteBuy(
      applyMarginToValue(pair?.buy, adj.buy.margin_value, adj.buy.margin_type, "buy"),
      applyMarginToValue(pair?.sell, adj.sell.margin_value, adj.sell.margin_type, "sell")
    );
  }

  // Eski format (single): { buy_adj, sell_adj, margin_type }
  const marginType = normalizeKind(adj?.margin_type);
  const buyAdj = Math.max(0, Number(adj?.buy_adj) || 0);
  const sellAdj = Math.max(0, Number(adj?.sell_adj) || 0);
  return enforceSellGteBuy(
    applyMarginToValue(pair?.buy, buyAdj, marginType, "buy"),
    applyMarginToValue(pair?.sell, sellAdj, marginType, "sell")
  );
}

function applyGranularAdjustments(pair, buyMargin, sellMargin) {
  return enforceSellGteBuy(
    applyMarginToValue(pair?.buy, buyMargin?.margin_value, buyMargin?.margin_type, "buy"),
    applyMarginToValue(pair?.sell, sellMargin?.margin_value, sellMargin?.margin_type, "sell")
  );
}

/** Public API: banka kurlarına kurum marjını uygula. */
function applyAdjustmentsToBanksPayload(cachedRates, adjustmentsMap) {
  if (!cachedRates?.banks?.length) return cachedRates;

  const banks = cachedRates.banks.map((bank) => {
    const institution = findInstitutionByName(bank.bankName || bank.bank);
    const institutionId = institution?.id;
    
    // İdentity seçilmemişse (veya dış banka ise), hiçbir margin uygulamadan kurları olduğu gibi döndür
    if (!institutionId) {
      return {
        ...bank,
        institutionId: null,
      };
    }
    
    const adjByCurrency = adjustmentsMap.get(institutionId) || {};

    const nextRates = { ...(bank.rates || {}) };
    for (const [currency, pair] of Object.entries(nextRates)) {
      nextRates[currency] = applyAdjustmentToPair(pair, adjByCurrency[currency]);
    }

    const nextExchangeRates = Array.isArray(bank.exchangeRates)
      ? bank.exchangeRates.map((row) => {
          const adjusted = applyAdjustmentToPair(row, adjByCurrency[row.currency]);
          return { ...row, buy: adjusted.buy, sell: adjusted.sell };
        })
      : bank.exchangeRates;

    return {
      ...bank,
      institutionId: institutionId || null,
      rates: nextRates,
      exchangeRates: nextExchangeRates,
    };
  });

  return {
    ...cachedRates,
    banks,
    centralBankUpdatedAt: cachedRates.centralBankUpdatedAt || null,
  };
}

module.exports = {
  roundRate,
  roundRateDisplay,  // ✅ New: 2-decimal display rounding
  applyMarginToValue,
  applyAdjustmentToPair,
  getGranularMargin,
  applyGranularAdjustments,
  applyAdjustmentsToBanksPayload,
  enforceSellGteBuy,
};
