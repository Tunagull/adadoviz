const COLLECT_API_URL = "https://api.collectapi.com/economy/allCurrency";
const COLLECT_DEPOSIT_API_URL = "https://api.collectapi.com/economy/depositRate";
const COLLECT_CAR_LOAN_API_URL = "https://api.collectapi.com/economy/credit/tasit-kredisi";
const COLLECT_CREDIT_LIST_API_URL = "https://api.collectapi.com/economy/credit";
const COLLECT_HOME_LOAN_API_URL = "https://api.collectapi.com/economy/credit/konut-kredisi";
const COLLECT_API_HEADERS = {
  "content-type": "application/json",
  authorization: "apikey 71Q0XKa5pUlOKmYgRpsagw:1L7OueF1vqhkSAxz6CHFez",
};

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
];
const BANK_NAMES_ORDER = BANK_DEFINITIONS.map((b) => b.name);

const DEFAULT_RATES = {
  EUR: { buy: 43.2, sell: 44.1 },
  USD: { buy: 39.1, sell: 39.9 },
  GBP: { buy: 51.7, sell: 52.9 },
  ALTIN: { buy: 2440.0, sell: 2470.0 },
};

function roundRate(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  return Number(Math.round(n * 10 ** decimals) / 10 ** decimals);
}

function randomInRange(min, max) {
  return roundRate(min + Math.random() * (max - min), 2);
}

function uniqueRandomInRange(min, max, usedSet) {
  let attempt = 0;
  while (attempt < 40) {
    const val = randomInRange(min, max);
    const key = val.toFixed(2);
    if (!usedSet.has(key)) {
      usedSet.add(key);
      return val;
    }
    attempt += 1;
  }
  const fallback = roundRate(max - usedSet.size * 0.01, 2);
  usedSet.add(fallback.toFixed(2));
  return fallback;
}

function buildExchangeRatesArray(rates) {
  return [
    { currency: "EUR", buy: rates.EUR.buy, sell: rates.EUR.sell },
    { currency: "USD", buy: rates.USD.buy, sell: rates.USD.sell },
    { currency: "GBP", buy: rates.GBP.buy, sell: rates.GBP.sell },
    { currency: "ALTIN", buy: rates.ALTIN.buy, sell: rates.ALTIN.sell },
  ];
}

function normalizeBankName(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function coalesceNumber(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function coerceRatesDeep(obj) {
  if (!obj || !obj.rates) return obj;
  const currencies = ["EUR", "USD", "GBP", "ALTIN"];
  const nextRates = {};
  currencies.forEach((c) => {
    nextRates[c] = {
      buy: roundRate(obj.rates[c]?.buy, 2) ?? DEFAULT_RATES[c].buy,
      sell: roundRate(obj.rates[c]?.sell, 2) ?? DEFAULT_RATES[c].sell,
    };
  });
  return { ...obj, rates: nextRates };
}

function normalizeBankPayload(bankPayload) {
  const payload = coerceRatesDeep(bankPayload);
  return {
    ...payload,
    bankName: payload.bank,
    exchangeRates: buildExchangeRatesArray(payload.rates),
  };
}

function buildDefaultBankSnapshot(name, sourceUrl, demoByBank) {
  const demo = demoByBank[name];
  return normalizeBankPayload({
    bank: name,
    sourceUrl,
    rates: {
      EUR: { ...DEFAULT_RATES.EUR },
      USD: { ...DEFAULT_RATES.USD },
      GBP: { ...DEFAULT_RATES.GBP },
      ALTIN: { ...DEFAULT_RATES.ALTIN },
    },
    depositRate: demo.depositRate,
    loans: { ...demo.loans },
    interestRates: [{ type: "Mevduat Faizi", rate: demo.depositRate }],
    note: "Fallback snapshot",
  });
}

function createDynamicDemoByBank() {
  const depositUsed = new Set();
  const konutUsed = new Set();
  const tasitUsed = new Set();
  const ihtiyacUsed = new Set();
  const out = {};
  BANK_DEFINITIONS.forEach((bank) => {
    out[bank.name] = {
      depositRate: uniqueRandomInRange(44.0, 52.0, depositUsed),
      loans: {
        konut: uniqueRandomInRange(2.9, 3.8, konutUsed),
        tasit: uniqueRandomInRange(3.9, 4.9, tasitUsed),
        ihtiyac: uniqueRandomInRange(4.5, 5.9, ihtiyacUsed),
      },
    };
  });
  return out;
}

function parseCollectApiResult(resultRows, code) {
  const hit = resultRows.find((row) => {
    const key = `${row?.code || ""} ${row?.name || ""} ${row?.currency || ""}`.toUpperCase();
    return key.includes(code);
  });
  if (!hit) return { ...DEFAULT_RATES[code] };
  const sellRef = coalesceNumber(hit.selling, hit.sell, hit.price, hit.rate, hit.value);
  const buyRef = coalesceNumber(hit.buying, hit.buy, sellRef ? sellRef * 0.99 : null);
  const safeSell = roundRate(sellRef, 2) ?? DEFAULT_RATES[code].sell;
  const safeBuy = roundRate(buyRef, 2) ?? roundRate(safeSell * 0.99, 2);
  return { buy: safeBuy, sell: safeSell };
}

function bankMatchesLabel(label, bankName) {
  const key = normalizeBankName(label);
  const target = normalizeBankName(bankName);
  if (!key || !target) return false;
  if (key.includes(target) || target.includes(key)) return true;
  const aliases = {
    "ziraat bankası": ["ziraat"],
    "garanti bbva": ["garanti", "bbva"],
    akbank: ["akbank"],
    "türkiye iş bankası": ["isbank", "is bankasi", "turkiye is"],
    "yapı kredi": ["yapi kredi", "yapikredi"],
    halkbank: ["halkbank"],
    "vakıfbank": ["vakifbank"],
    "qnb finansbank": ["qnb", "finansbank"],
    "denizbank": ["denizbank"],
    "kuveyt türk": ["kuveyt turk"],
    teb: ["teb", "turk ekonomi"],
    "ing bank": ["ing"],
    odeabank: ["odeabank"],
    fibabanka: ["fibabanka"],
    "albaraka türk": ["albaraka"],
  };
  const terms = aliases[target] || [];
  return terms.some((term) => key.includes(term));
}

async function fetchCollectApiRates() {
  const res = await fetch(COLLECT_API_URL, { method: "GET", headers: COLLECT_API_HEADERS });
  if (!res.ok) throw new Error(`CollectAPI HTTP ${res.status}`);
  const payload = await res.json();
  const rows = Array.isArray(payload?.result) ? payload.result : [];
  if (!rows.length) throw new Error("CollectAPI boş result döndü.");
  const usd = parseCollectApiResult(rows, "USD");
  const eur = parseCollectApiResult(rows, "EUR");
  const gbp = parseCollectApiResult(rows, "GBP");
  const goldRow = rows.find((row) => {
    const key = `${row?.code || ""} ${row?.name || ""} ${row?.currency || ""}`.toUpperCase();
    return key.includes("XAU") || key.includes("ALTIN") || key.includes("GOLD");
  });
  const goldRaw = coalesceNumber(goldRow?.selling, goldRow?.sell, goldRow?.price, goldRow?.rate);
  const goldBase = roundRate(goldRaw && goldRaw > 500 ? goldRaw : 2450, 2);
  return {
    USD: usd,
    EUR: eur,
    GBP: gbp,
    ALTIN: { buy: roundRate(goldBase - 12, 2), sell: roundRate(goldBase + 12, 2) },
  };
}

async function fetchCollectDepositRates() {
  const res = await fetch(COLLECT_DEPOSIT_API_URL, { method: "GET", headers: COLLECT_API_HEADERS });
  if (!res.ok) throw new Error(`CollectAPI depositRate HTTP ${res.status}`);
  const payload = await res.json();
  const rows = Array.isArray(payload?.result) ? payload.result : [];
  const out = {};
  BANK_NAMES_ORDER.forEach((name) => {
    const hit = rows.find((row) =>
      bankMatchesLabel(
        [row?.bank, row?.bankName, row?.name, row?.title, row?.institution, row?.label].filter(Boolean).join(" "),
        name
      )
    );
    out[name] = roundRate(
      coalesceNumber(hit?.rate, hit?.depositRate, hit?.value, hit?.percent, hit?.oran, hit?.interestRate),
      2
    );
  });
  return out;
}

async function fetchCollectLoanRates() {
  let tasitRows = [];
  const tasitRes = await fetch(COLLECT_CAR_LOAN_API_URL, { method: "GET", headers: COLLECT_API_HEADERS });
  console.log(`[SCRAPE] tasit-kredisi Status Code: ${tasitRes.status}`);
  if (tasitRes.ok) {
    const tasitPayload = await tasitRes.json();
    tasitRows = Array.isArray(tasitPayload?.result) ? tasitPayload.result : [];
  } else {
    const creditListRes = await fetch(COLLECT_CREDIT_LIST_API_URL, { method: "GET", headers: COLLECT_API_HEADERS });
    console.log(`[SCRAPE] credit list fallback Status Code: ${creditListRes.status}`);
    if (!creditListRes.ok) {
      throw new Error(`CollectAPI tasit-kredisi HTTP ${tasitRes.status} / credit HTTP ${creditListRes.status}`);
    }
    const payload = await creditListRes.json();
    const allRows = Array.isArray(payload?.result) ? payload.result : [];
    tasitRows = allRows.filter((row) =>
      `${row?.type || ""} ${row?.loanType || ""} ${row?.name || ""} ${row?.title || ""}`.toLowerCase().includes("tasit")
    );
  }
  const konutRes = await fetch(COLLECT_HOME_LOAN_API_URL, { method: "GET", headers: COLLECT_API_HEADERS });
  console.log(`[SCRAPE] konut-kredisi Status Code: ${konutRes.status}`);
  if (!konutRes.ok) throw new Error(`CollectAPI konut-kredisi HTTP ${konutRes.status}`);
  const konutPayload = await konutRes.json();
  const konutRows = Array.isArray(konutPayload?.result) ? konutPayload.result : [];
  console.log("Kredi API Ham Veri:", { tasit: tasitRows, konut: konutRows });

  const out = {};
  BANK_NAMES_ORDER.forEach((name) => {
    const tasitHit = tasitRows.find((row) =>
      bankMatchesLabel([row?.bank, row?.bankName, row?.name, row?.title, row?.institution].filter(Boolean).join(" "), name)
    );
    const konutHit = konutRows.find((row) =>
      bankMatchesLabel([row?.bank, row?.bankName, row?.name, row?.title, row?.institution].filter(Boolean).join(" "), name)
    );
    out[name] = {
      tasit: roundRate(coalesceNumber(tasitHit?.rate, tasitHit?.oran, tasitHit?.value, tasitHit?.monthlyRate), 2),
      konut: roundRate(coalesceNumber(konutHit?.rate, konutHit?.oran, konutHit?.value, konutHit?.monthlyRate), 2),
      ihtiyac: null,
    };
  });
  return out;
}

async function fetchAllData() {
  const demoByBank = createDynamicDemoByBank();
  const marketRates = await fetchCollectApiRates().catch((error) => {
    console.error(`[SCRAPE] Döviz API hatası: ${error.message || error}. Varsayılan kur kullanılacak.`);
    return DEFAULT_RATES;
  });
  const depositRatesByBank = await fetchCollectDepositRates().catch((error) => {
    const status = String(error?.message || "").match(/HTTP\s+(\d+)/i)?.[1] || "unknown";
    console.error(`[SCRAPE] API Hatası: ${status}, Dinamik Demo Verisi üretildi (mevduat).`);
    return Object.fromEntries(BANK_NAMES_ORDER.map((name) => [name, demoByBank[name].depositRate]));
  });
  const loansByBank = await fetchCollectLoanRates().catch((error) => {
    const status = String(error?.message || "").match(/HTTP\s+(\d+)/i)?.[1] || "unknown";
    console.error(`[SCRAPE] API Hatası: ${status}, Dinamik Demo Verisi üretildi (kredi).`);
    return Object.fromEntries(BANK_NAMES_ORDER.map((name) => [name, { ...demoByBank[name].loans }]));
  });
  return { marketRates, depositRatesByBank, loansByBank, demoByBank };
}

function buildBankRates(baseRates) {
  return {
    EUR: {
      buy: roundRate(baseRates.EUR.buy + randomInRange(-0.18, -0.05), 2),
      sell: roundRate(baseRates.EUR.sell + randomInRange(0.05, 0.18), 2),
    },
    USD: {
      buy: roundRate(baseRates.USD.buy + randomInRange(-0.2, -0.05), 2),
      sell: roundRate(baseRates.USD.sell + randomInRange(0.05, 0.2), 2),
    },
    GBP: {
      buy: roundRate(baseRates.GBP.buy + randomInRange(-0.22, -0.06), 2),
      sell: roundRate(baseRates.GBP.sell + randomInRange(0.06, 0.24), 2),
    },
    ALTIN: {
      buy: roundRate(baseRates.ALTIN.buy + randomInRange(-18, -4), 2),
      sell: roundRate(baseRates.ALTIN.sell + randomInRange(4, 18), 2),
    },
  };
}

function finalizeBanks(banksArray, demoByBank) {
  const byName = new Map(banksArray.filter((b) => b?.bank).map((b) => [b.bank, b]));
  const merged = BANK_DEFINITIONS.map((bank) => {
    const existing = byName.get(bank.name);
    if (existing) return normalizeBankPayload(existing);
    return buildDefaultBankSnapshot(bank.name, bank.sourceUrl, demoByBank);
  });
  return {
    updatedAt: new Date().toISOString(),
    totalBanks: BANK_NAMES_ORDER.length,
    banks: merged,
  };
}

function emptyPayloadForServerError() {
  const demoByBank = createDynamicDemoByBank();
  return finalizeBanks([], demoByBank);
}

async function scrapeAllBanks() {
  try {
    const { marketRates, depositRatesByBank, loansByBank, demoByBank } = await fetchAllData();
    const banks = BANK_DEFINITIONS.map((bank) =>
      normalizeBankPayload({
        bank: bank.name,
        sourceUrl: bank.sourceUrl,
        rates: buildBankRates(marketRates),
        depositRate: roundRate(depositRatesByBank[bank.name] ?? demoByBank[bank.name].depositRate, 2),
        loans: {
          tasit: roundRate(loansByBank[bank.name]?.tasit ?? demoByBank[bank.name].loans.tasit, 2),
          konut: roundRate(loansByBank[bank.name]?.konut ?? demoByBank[bank.name].loans.konut, 2),
          ihtiyac: roundRate(loansByBank[bank.name]?.ihtiyac ?? demoByBank[bank.name].loans.ihtiyac, 2),
        },
        interestRates: [
          {
            type: "Mevduat Faizi",
            rate: roundRate(depositRatesByBank[bank.name] ?? demoByBank[bank.name].depositRate, 2),
          },
        ],
        note: "CollectAPI baz kur + banka bazlı dinamik makas",
      })
    );
    return finalizeBanks(banks, demoByBank);
  } catch (error) {
    console.error("[SCRAPE] scrapeAllBanks kritik hata:", error.message || error);
    return emptyPayloadForServerError();
  }
}

module.exports = { scrapeAllBanks, emptyPayloadForServerError, BANK_NAMES_ORDER, fetchAllData };
