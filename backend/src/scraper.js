/**
 * ✅ SADELEŞTIRILMIŞ SCRAPER - Sadece Merkez Bankası XML Kurları
 * 
 * Bu modül yalnızca döviz kurlarını (USD, EUR, GBP) işler.
 * Faiz, kredi ve mevduat özelliklerinin tüm kodları kaldırılmıştır.
 */

const BANK_DEFINITIONS = [
  { name: "Ziraat Bankası", sourceUrl: "https://www.ziraatbank.com.tr" },
  { name: "Garanti BBVA", sourceUrl: "https://www.garantibbva.com.tr" },
  { name: "Akbank", sourceUrl: "https://www.akbank.com" },
  { name: "Türkiye İş Bankası", sourceUrl: "https://www.isbank.com.tr" },
  { name: "Yapı Kredi", sourceUrl: "https://www.yapikredi.com.tr" },
  { name: "Halkbank", sourceUrl: "https://www.halkbank.com.tr" },
  { name: "VakıfBank", sourceUrl: "https://www.vakifbank.com.tr" },
  { name: "QNB Finansbank", sourceUrl: "https://www.qnb.com.tr" },
  { name: "DenizBank", sourceUrl: "https://www.denizbank.com" },
  { name: "Kuveyt Türk", sourceUrl: "https://www.kuveytturk.com.tr" },
  { name: "TEB", sourceUrl: "https://www.teb.com.tr" },
  { name: "ING Bank", sourceUrl: "https://www.ing.com.tr" },
  { name: "Odeabank", sourceUrl: "https://www.odeabank.com.tr" },
  { name: "Fibabanka", sourceUrl: "https://www.fibabanka.com.tr" },
  { name: "Albaraka Türk", sourceUrl: "https://www.albarakaturk.com.tr" },
  { name: "Sun Döviz", sourceUrl: "https://www.sundoviz.com.tr" },
];

const BANK_NAMES_ORDER = BANK_DEFINITIONS.map((b) => b.name);

const DEFAULT_RATES = {
  EUR: { buy: 43.2, sell: 44.1 },
  USD: { buy: 39.1, sell: 39.9 },
  GBP: { buy: 51.7, sell: 52.9 },
};

/**
 * ✅ Temel Utility Fonksiyonları
 */
function roundRate(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  return Number(Math.round(n * 10 ** decimals) / 10 ** decimals);
}

function coalesceNumber(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function buildExchangeRatesArray(rates) {
  return [
    { currency: "EUR", buy: rates.EUR.buy, sell: rates.EUR.sell },
    { currency: "USD", buy: rates.USD.buy, sell: rates.USD.sell },
    { currency: "GBP", buy: rates.GBP.buy, sell: rates.GBP.sell },
  ];
}

/**
 * ✅ Banka Snapshot'ı Oluştur - Sadece Döviz Kurları
 * 
 * Faiz, kredi ve mevduat alanları tamamen kaldırıldı.
 * Sadece USD/EUR/GBP alış-satış oranları döndürülüyor.
 */
function buildBankSnapshot(name, sourceUrl, rates = DEFAULT_RATES) {
  return {
    bank: name,
    bankName: name,
    sourceUrl,
    rates: {
      EUR: { buy: rates.EUR.buy, sell: rates.EUR.sell },
      USD: { buy: rates.USD.buy, sell: rates.USD.sell },
      GBP: { buy: rates.GBP.buy, sell: rates.GBP.sell },
    },
    exchangeRates: buildExchangeRatesArray(rates),
    // ✅ REMOVED: depositRate, loans, interestRates (bunlar artık gerekli değil)
  };
}

/**
 * ✅ Boş Payload - Fallback Verisi
 * 
 * API başarısız olduğunda tüm bankalar için varsayılan oranlarla dönüş yap.
 */
function emptyPayloadForServerError() {
  const banks = BANK_DEFINITIONS.map((def) => buildBankSnapshot(def.name, def.sourceUrl, DEFAULT_RATES));
  return {
    updatedAt: new Date().toISOString(),
    totalBanks: banks.length,
    banks,
  };
}

/**
 * ✅ Merkez Bankası Kurlarıyla Banka Snapshot'ları Oluştur
 * 
 * Her banka için Merkez Bankası XML kurları kullanılır.
 * Banka spesifik kurlar yoktur - tümü Merkez Bankası'ndan gelir.
 */
function buildBanksFromCentralRates(centralRates) {
  if (!centralRates) {
    return BANK_DEFINITIONS.map((def) => buildBankSnapshot(def.name, def.sourceUrl, DEFAULT_RATES));
  }

  return BANK_DEFINITIONS.map((def) => {
    const rates = {
      EUR: {
        buy: roundRate(centralRates.EUR?.buy, 4) ?? DEFAULT_RATES.EUR.buy,
        sell: roundRate(centralRates.EUR?.sell, 4) ?? DEFAULT_RATES.EUR.sell,
      },
      USD: {
        buy: roundRate(centralRates.USD?.buy, 4) ?? DEFAULT_RATES.USD.buy,
        sell: roundRate(centralRates.USD?.sell, 4) ?? DEFAULT_RATES.USD.sell,
      },
      GBP: {
        buy: roundRate(centralRates.GBP?.buy, 4) ?? DEFAULT_RATES.GBP.buy,
        sell: roundRate(centralRates.GBP?.sell, 4) ?? DEFAULT_RATES.GBP.sell,
      },
    };

    return buildBankSnapshot(def.name, def.sourceUrl, rates);
  });
}

module.exports = {
  BANK_DEFINITIONS,
  BANK_NAMES_ORDER,
  DEFAULT_RATES,
  buildBankSnapshot,
  buildBanksFromCentralRates,
  emptyPayloadForServerError,
  roundRate,
};
