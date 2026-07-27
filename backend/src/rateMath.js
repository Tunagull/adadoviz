const { findInstitutionByName } = require("./institutions");

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
 * ✅ ADIM 2: Apply Margin with Precision Guarantee
 * 
 * Formula:
 *  - percent: KUR + (KUR * margin / 100)
 *  - fixed:   KUR + margin (TL)
 * 
 * Precision Guarantee:
 *  1. Input validation (finite numbers)
 *  2. Calculation
 *  3. EXPLICIT roundRate() on result
 *  4. Final validation
 */
function applyMarginToValue(kur, margin, marginType) {
  // ✅ Step 1: Input Validation
  const base = Number(kur);
  const m = Math.max(0, Number(margin) || 0);
  
  // ✅ Base rate must be finite
  if (!Number.isFinite(base)) return null;
  
  // ✅ Step 2: Calculate with precision guarantee
  let result;
  
  if (marginType === "percent") {
    // ✅ Percentage calculation: KUR + (KUR * margin / 100)
    // Example: 39.15 + (39.15 * 0.5 / 100) = 39.15 + 0.19575 = 39.34575
    const percentageIncrease = (base * m) / 100;
    result = base + percentageIncrease;
    // ✅ CRITICAL: Apply rounding IMMEDIATELY
    result = roundRate(result, 4);
  } else {
    // ✅ Fixed calculation: KUR + margin (TL)
    // Example: 39.15 + 0.50 = 39.65
    result = base + m;
    // ✅ CRITICAL: Apply rounding IMMEDIATELY
    result = roundRate(result, 4);
  }
  
  // ✅ Step 3: Final validation
  if (!Number.isFinite(result)) {
    console.warn(`[PRECISION] Invalid result: ${base} + ${m} (${marginType}) = ${result}`);
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
    return {
      buy: pair?.buy ?? null,
      sell: pair?.sell ?? null,
    };
  }

  // Granüler format (buy/sell ayrı ayrı): { buy: { margin_type, margin_value }, sell: { ... } }
  if (adj.buy && adj.sell && typeof adj.buy === 'object') {
    return {
      buy: applyMarginToValue(pair?.buy, adj.buy.margin_value, adj.buy.margin_type),
      sell: applyMarginToValue(pair?.sell, adj.sell.margin_value, adj.sell.margin_type),
    };
  }

  // Eski format (single): { buy_adj, sell_adj, margin_type }
  const marginType = adj?.margin_type === "percent" ? "percent" : "fixed";
  const buyAdj = Math.max(0, Number(adj?.buy_adj) || 0);
  const sellAdj = Math.max(0, Number(adj?.sell_adj) || 0);
  return {
    buy: applyMarginToValue(pair?.buy, buyAdj, marginType),
    sell: applyMarginToValue(pair?.sell, sellAdj, marginType),
  };
}

function applyGranularAdjustments(pair, buyMargin, sellMargin) {
  return {
    buy: applyMarginToValue(pair?.buy, buyMargin?.margin_value, buyMargin?.margin_type),
    sell: applyMarginToValue(pair?.sell, sellMargin?.margin_value, sellMargin?.margin_type),
  };
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
};
