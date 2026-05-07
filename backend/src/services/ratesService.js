const axios = require("axios");
const cheerio = require("cheerio");

const SOURCE_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";

function buildMockRates() {
  return {
    source: "mock",
    fetchedAt: new Date().toISOString(),
    rates: {
      USD: { buy: 38.42, sell: 38.58 },
      EUR: { buy: 41.31, sell: 41.54 },
      GBP: { buy: 48.05, sell: 48.33 },
    },
  };
}

function parseRate(value) {
  if (!value) return null;
  const parsed = Number.parseFloat(String(value).replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

async function scrapeRatesFromSource() {
  const { data } = await axios.get(SOURCE_URL, {
    timeout: 10000,
    headers: {
      "User-Agent": "Mozilla/5.0 (RatesBot)",
    },
  });

  const $ = cheerio.load(data, { xmlMode: true });
  const currencies = ["USD", "EUR", "GBP"];
  const rates = {};

  currencies.forEach((code) => {
    const currency = $(`Currency[CurrencyCode="${code}"]`);
    if (!currency.length) return;

    const buy = parseRate(currency.find("ForexBuying").text());
    const sell = parseRate(currency.find("ForexSelling").text());

    rates[code] = { buy, sell };
  });

  if (!rates.USD || !rates.EUR || !rates.GBP) {
    throw new Error("Missing one or more currency rates from source.");
  }

  return {
    source: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    rates,
  };
}

async function getRates() {
  try {
    return await scrapeRatesFromSource();
  } catch (error) {
    return {
      ...buildMockRates(),
      note: "Live source unavailable. Returned mock rates.",
      error: error.message,
    };
  }
}

module.exports = {
  getRates,
};
