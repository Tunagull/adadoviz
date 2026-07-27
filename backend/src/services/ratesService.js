const axios = require("axios");
const cheerio = require("cheerio");

const SOURCE_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";

function parseRate(value) {
  if (!value) return null;
  const parsed = Number.parseFloat(String(value).replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function buildMockCentralBank() {
  const now = new Date();
  return {
    source: "mock",
    fetchedAt: now.toISOString(),
    xmlDate: now.toISOString().slice(0, 10),
    updatedAt: now.toISOString(),
    rates: {
      USD: { buy: 38.42, sell: 38.58 },
      EUR: { buy: 41.31, sell: 41.54 },
      GBP: { buy: 48.05, sell: 48.33 },
      ALTIN: { buy: 2440.0, sell: 2470.0 },
    },
    note: "Live XML unavailable. Returned mock central bank rates.",
  };
}

/**
 * Merkez Bankası (TCMB today.xml) kurları + XML tarih/saat bilgisi.
 * Tarih_Date/@Tarih ve Date attributes kullanılır.
 */
async function scrapeRatesFromSource() {
  const { data } = await axios.get(SOURCE_URL, {
    timeout: 10000,
    headers: {
      "User-Agent": "Mozilla/5.0 (FinSightRatesBot)",
    },
  });

  const $ = cheerio.load(data, { xmlMode: true });
  const root = $("Tarih_Date").first();
  const xmlDateAttr = root.attr("Tarih") || root.attr("Date") || null;
  const bulletinDate = root.attr("Date") || null;

  let updatedAt = new Date().toISOString();
  if (xmlDateAttr) {
    // TCMB formatı genelde DD.MM.YYYY
    const parts = String(xmlDateAttr).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (parts) {
      updatedAt = new Date(`${parts[3]}-${parts[2]}-${parts[1]}T12:00:00+03:00`).toISOString();
    } else if (bulletinDate) {
      const iso = new Date(`${bulletinDate}T12:00:00+03:00`);
      if (!Number.isNaN(iso.getTime())) updatedAt = iso.toISOString();
    }
  }

  const currencies = ["USD", "EUR", "GBP"];
  const rates = {};

  currencies.forEach((code) => {
    const currency = $(`Currency[CurrencyCode="${code}"]`);
    if (!currency.length) return;
    const buy = parseRate(currency.find("ForexBuying").text());
    const sell = parseRate(currency.find("ForexSelling").text());
    const efektif_buy = parseRate(currency.find("Efektif_Alis").text());
    const efektif_sell = parseRate(currency.find("Efektif_Satis").text());
    rates[code] = { 
      buy, 
      sell,
      efektif_buy: efektif_buy || buy,
      efektif_sell: efektif_sell || sell,
    };
  });

  // Altın: TCMB'de XAU/Gram olmayabilir; boşsa null bırakılır.
  const gold = $(`Currency[CurrencyCode="XAU"]`);
  if (gold.length) {
    rates.ALTIN = {
      buy: parseRate(gold.find("ForexBuying").text()),
      sell: parseRate(gold.find("ForexSelling").text()),
    };
  } else {
    rates.ALTIN = { buy: null, sell: null };
  }

  if (!rates.USD || !rates.EUR || !rates.GBP) {
    throw new Error("Missing one or more currency rates from source.");
  }

  return {
    source: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    xmlDate: xmlDateAttr,
    bulletinDate,
    updatedAt,
    rates,
  };
}

async function getRates() {
  try {
    return await scrapeRatesFromSource();
  } catch (error) {
    return {
      ...buildMockCentralBank(),
      error: error.message,
    };
  }
}

module.exports = {
  getRates,
  scrapeRatesFromSource,
};
