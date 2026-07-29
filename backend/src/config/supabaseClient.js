import { createClient } from "@supabase/supabase-js";

// Supabase connection credentials
// TODO: Move these to environment variables in production
const SUPABASE_URL = "https://njwzjqwidcavohojjlty.supabase.co";
const SUPABASE_KEY = "sb_publishable_F8p7KYsAxwxGM-1MX9OF0g_1kaY_di1";

// Create Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Insert historical rate data into Supabase
 * @param {string} currency - Currency code (USD, EUR, GBP)
 * @param {number} buy_rate - Buy rate
 * @param {number} sell_rate - Sell rate
 * @param {string} recorded_at - ISO timestamp when rate was recorded
 * @returns {Promise<Object>} Insert result
 */
export async function insertHistoricalRate(
  currency,
  buy_rate,
  sell_rate,
  recorded_at
) {
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
 * Fetch historical rates for a currency within a time period
 * @param {string} currency - Currency code
 * @param {Date} startDate - Start date for the range
 * @param {Date} endDate - End date for the range
 * @returns {Promise<Array>} Historical rates
 */
export async function getHistoricalRates(currency, startDate, endDate) {
  const { data, error } = await supabase
    .from("historical_rates")
    .select("*")
    .eq("currency", currency)
    .gte("recorded_at", startDate.toISOString())
    .lte("recorded_at", endDate.toISOString())
    .order("recorded_at", { ascending: true });

  if (error) {
    console.error("[Supabase] Fetch error:", error.message);
    throw new Error(`Failed to fetch rates: ${error.message}`);
  }

  return data || [];
}

/**
 * Fetch the latest rate for a currency
 * @param {string} currency - Currency code
 * @returns {Promise<Object|null>} Latest rate or null
 */
export async function getLatestRate(currency) {
  const { data, error } = await supabase
    .from("historical_rates")
    .select("*")
    .eq("currency", currency)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = "no rows found" - which is fine
    console.error("[Supabase] Fetch error:", error.message);
    return null;
  }

  return data || null;
}

/**
 * Fetch business rate history combining MB rates and margin history
 * @param {number} institutionId - Institution ID
 * @param {string} currency - Currency code
 * @param {Date} startDate - Start date for range
 * @param {Date} endDate - End date for range
 * @returns {Promise<Array>} Combined rate history with margins applied
 */
export async function getBusinessRateHistory(
  institutionId,
  currency,
  startDate,
  endDate
) {
  // Fetch MB rates
  const { data: mbRates, error: mbError } = await supabase
    .from("historical_rates")
    .select("*")
    .eq("currency", currency)
    .gte("recorded_at", startDate.toISOString())
    .lte("recorded_at", endDate.toISOString())
    .order("recorded_at", { ascending: true });

  if (mbError) {
    console.error("[Supabase] MB rates fetch error:", mbError.message);
    throw new Error(`Failed to fetch MB rates: ${mbError.message}`);
  }

  // Fetch margin history for this institution
  const { data: marginHistory, error: marginError } = await supabase
    .from("margin_history")
    .select("*")
    .eq("institution_id", institutionId)
    .eq("currency", currency)
    .gte("recorded_at", startDate.toISOString())
    .lte("recorded_at", endDate.toISOString())
    .order("recorded_at", { ascending: true });

  if (marginError) {
    console.error("[Supabase] Margin history fetch error:", marginError.message);
    throw new Error(`Failed to fetch margin history: ${marginError.message}`);
  }

  // Merge and calculate final rates
  const combinedData = [];
  const margins = marginHistory || [];
  const rates = mbRates || [];

  let currentMarginBuy = { type: "fixed", value: 0 };
  let currentMarginSell = { type: "fixed", value: 0 };
  let marginIdx = 0;

  for (const rate of rates) {
    const rateTime = new Date(rate.recorded_at).getTime();

    // Update margins up to this rate's timestamp
    while (
      marginIdx < margins.length &&
      new Date(margins[marginIdx].recorded_at).getTime() <= rateTime
    ) {
      const margin = margins[marginIdx];
      if (margin.margin_type === "buy") {
        currentMarginBuy = {
          type: margin.margin_type_value,
          value: margin.margin_value,
        };
      } else {
        currentMarginSell = {
          type: margin.margin_type_value,
          value: margin.margin_value,
        };
      }
      marginIdx++;
    }

    // Calculate final rates
    const finalBuy = applyMargin(rate.buy_rate, currentMarginBuy);
    const finalSell = applyMargin(rate.sell_rate, currentMarginSell);

    combinedData.push({
      timeMs: rateTime,
      recorded_at: rate.recorded_at,
      buy_rate: rate.buy_rate,
      sell_rate: rate.sell_rate,
      final_buy: finalBuy,
      final_sell: finalSell,
    });
  }

  return combinedData;
}

/**
 * Apply margin to a base rate
 * @param {number} baseRate - Base rate from Central Bank
 * @param {Object} margin - { type: "fixed"|"percent", value: number }
 * @returns {number} Rate with margin applied
 */
function applyMargin(baseRate, margin) {
  if (!margin || !baseRate) return baseRate;

  const base = Number(baseRate);
  const value = Number(margin.value) || 0;

  if (margin.type === "percent") {
    return base + (base * value) / 100;
  }
  return base + value;
}

export default supabase;
