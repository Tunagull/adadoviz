import { useEffect, useMemo, useState } from "react";
import { Search, TrendingUp, ArrowUpDown } from "lucide-react";
import { V0BankCard } from "./V0BankCard";

/** Backend listesiyle uyumlu Türkiye banka haritası. */
const LOCAL_BANKS = [
  { id: "ziraat", name: "Ziraat Bankası", websiteUrl: "https://www.ziraatbank.com.tr" },
  { id: "garanti", name: "Garanti BBVA", websiteUrl: "https://www.garantibbva.com.tr" },
  { id: "akbank", name: "Akbank", websiteUrl: "https://www.akbank.com" },
  { id: "isbank", name: "Türkiye İş Bankası", websiteUrl: "https://www.isbank.com.tr" },
  { id: "yapikredi", name: "Yapı Kredi", websiteUrl: "https://www.yapikredi.com.tr" },
  { id: "halkbank", name: "Halkbank", websiteUrl: "https://www.halkbank.com.tr" },
  { id: "vakifbank", name: "VakıfBank", websiteUrl: "https://www.vakifbank.com.tr" },
  { id: "qnb", name: "QNB Finansbank", websiteUrl: "https://www.qnb.com.tr" },
  { id: "denizbank", name: "DenizBank", websiteUrl: "https://www.denizbank.com" },
  { id: "kuveytturk", name: "Kuveyt Türk", websiteUrl: "https://www.kuveytturk.com.tr" },
  { id: "teb", name: "TEB", websiteUrl: "https://www.teb.com.tr" },
  { id: "ing", name: "ING Bank", websiteUrl: "https://www.ing.com.tr" },
  { id: "odeabank", name: "Odeabank", websiteUrl: "https://www.odeabank.com.tr" },
  { id: "fibabanka", name: "Fibabanka", websiteUrl: "https://www.fibabanka.com.tr" },
  { id: "albaraka", name: "Albaraka Türk", websiteUrl: "https://www.albarakaturk.com.tr" },
];

const EXCHANGE_SORT_OPTIONS = [
  { value: "none", label: "Sıralama Yok" },
  { value: "gbp-buy-high", label: "En Yüksek Alış (GBP)" },
  { value: "gbp-buy-low", label: "En Düşük Alış (GBP)" },
  { value: "usd-buy-high", label: "En Yüksek Alış (USD)" },
  { value: "usd-buy-low", label: "En Düşük Alış (USD)" },
  { value: "eur-buy-high", label: "En Yüksek Alış (EUR)" },
  { value: "eur-buy-low", label: "En Düşük Alış (EUR)" },
  { value: "altin-buy-high", label: "En Yüksek Alış (Altın)" },
  { value: "altin-buy-low", label: "En Düşük Alış (Altın)" },
];
const INTEREST_SORT_OPTIONS = [
  { value: "none", label: "Sıralama Yok" },
  { value: "deposit-high", label: "En Yüksek Mevduat Faizi" },
  { value: "deposit-low", label: "En Düşük Mevduat Faizi" },
];
const CREDIT_SORT_OPTIONS = [
  { value: "none", label: "Sıralama Yok" },
  { value: "credit-tasit-low", label: "En Düşük Taşıt Kredisi" },
  { value: "credit-konut-low", label: "En Düşük Konut Kredisi" },
  { value: "credit-ihtiyac-low", label: "En Düşük İhtiyaç Kredisi" },
];
function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Serbest metin veya sayıdan kur sayısı; ondalığı bozmadan çözümleme (örn. "44.38" veya TR formatı). */
function parseRateNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const trimmed = String(value).trim().replace(/\s/g, "");
  if (!trimmed) return null;
  const lastDot = trimmed.lastIndexOf(".");
  const lastComma = trimmed.lastIndexOf(",");
  let normalized = trimmed.replace(/[^\d.,-]/g, "");
  if (!normalized) return null;
  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(/,/g, "");
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";

function mapApiBankToExchangeRows(apiBank) {
  const fromArray = Array.isArray(apiBank?.exchangeRates) ? apiBank.exchangeRates : [];
  const fromObj = apiBank?.rates ?? {};
  const byCodeFromArray = Object.fromEntries(
    fromArray.map((row) => [row.currency, { buy: row.buy, sell: row.sell }])
  );

  const pick = (code) => {
    const rowPair = byCodeFromArray[code];
    const objPair = fromObj[code];
    const buyRaw = rowPair?.buy ?? objPair?.buy;
    const sellRaw = rowPair?.sell ?? objPair?.sell;
    const buy = parseRateNumber(buyRaw);
    const sell = parseRateNumber(sellRaw);
    return { currency: code, buy, sell };
  };

  return [pick("EUR"), pick("USD"), pick("GBP"), pick("ALTIN")];
}

function toNumberForCompare(value) {
  return parseRateNumber(value) ?? 0;
}

function getBestGBPBuyRate(bankList) {
  let best = null;
  for (const bank of bankList) {
    const gbpRate = bank.exchangeRates.find((r) => r.currency === "GBP");
    const gbpBuy = toNumberForCompare(gbpRate?.buy);
    if (gbpBuy > 0 && (!best || gbpBuy > best.rate)) {
      best = { bank, rate: gbpBuy };
    }
  }
  return best;
}

function getRate(bank, currency, type) {
  const rate = bank.exchangeRates.find((r) => r.currency === currency);
  return rate ? toNumberForCompare(rate[type]) : 0;
}

function getDepositRate(bank) {
  const directRate = parseRateNumber(bank?.depositRate);
  const listRate = parseRateNumber(bank?.interestRates?.[0]?.rate);
  return directRate ?? listRate ?? 0;
}

function getLoanRate(bank, loanType) {
  return parseRateNumber(bank?.loans?.[loanType]) ?? 0;
}

function getBestDepositRate(bankList) {
  let best = null;
  for (const bank of bankList) {
    const rate = getDepositRate(bank);
    if (rate > 0 && (!best || rate > best.rate)) {
      best = { bank, rate };
    }
  }
  return best;
}

export function V0FinancialDashboard() {
  const [mode, setMode] = useState("exchange");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("none");
  const [banks, setBanks] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [calculatorBank, setCalculatorBank] = useState("");
  const [exchangeCurrency, setExchangeCurrency] = useState("USD");
  const [exchangeAmountTl, setExchangeAmountTl] = useState("10000");
  const [exchangeOperation, setExchangeOperation] = useState("buy");
  const [depositAmount, setDepositAmount] = useState("100000");
  const [depositDays, setDepositDays] = useState("32");
  const [depositType, setDepositType] = useState("monthly");
  const [loanType, setLoanType] = useState("tasit");
  const [loanAmount, setLoanAmount] = useState("300000");
  const [loanMonths, setLoanMonths] = useState("24");

  useEffect(() => {
    let mounted = true;

    const fetchBanks = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/kurlar`);
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        const data = await response.json();
        console.log("Backend'den Gelen Veri:", data);
        const incomingBanks = Array.isArray(data?.banks) ? data.banks : [];
        const websiteByName = new Map(
          LOCAL_BANKS.map((bank) => [normalizeText(bank.name), bank.websiteUrl])
        );

        const mappedBanks = incomingBanks.map((apiBank, index) => {
          const apiName = apiBank?.bankName || apiBank?.bank || `Banka ${index + 1}`;
          const normalizedName = normalizeText(apiName);
          const websiteUrl = apiBank?.sourceUrl || websiteByName.get(normalizedName) || "#";
          const exchangeRates = mapApiBankToExchangeRows(apiBank);

          return {
            id: `api-bank-${index + 1}`,
            name: apiName,
            websiteUrl,
            exchangeRates,
            depositRate: parseRateNumber(apiBank?.depositRate),
            loans: {
              tasit: parseRateNumber(apiBank?.loans?.tasit),
              konut: parseRateNumber(apiBank?.loans?.konut),
              ihtiyac: parseRateNumber(apiBank?.loans?.ihtiyac),
            },
            interestRates: Array.isArray(apiBank?.interestRates) && apiBank.interestRates.length > 0
              ? apiBank.interestRates
              : [
                  {
                    type: "Mevduat Faizi",
                    rate: parseRateNumber(apiBank?.depositRate) ?? 45,
                  },
                ],
          };
        });

        if (mounted) {
          setBanks(mappedBanks);
          setLastUpdated(data?.updatedAt ?? null);
        }
      } catch (error) {
        console.error("Kur verisi alınamadı:", error);
        if (mounted) {
          setBanks([]);
          setLastUpdated(null);
        }
      }
    };

    fetchBanks();
    const intervalId = setInterval(fetchBanks, 60000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

  const currentSortOptions = useMemo(() => {
    if (mode === "interest") return INTEREST_SORT_OPTIONS;
    if (mode === "credit") return CREDIT_SORT_OPTIONS;
    return EXCHANGE_SORT_OPTIONS;
  }, [mode]);

  useEffect(() => {
    setSortBy("none");
  }, [mode]);

  useEffect(() => {
    const allowedValues = new Set(currentSortOptions.map((o) => o.value));
    if (!allowedValues.has(sortBy)) {
      setSortBy(currentSortOptions[0]?.value ?? "none");
    }
  }, [currentSortOptions, sortBy]);

  useEffect(() => {
    if (banks.length === 0) return;
    if (!calculatorBank || !banks.some((b) => b.name === calculatorBank)) {
      setCalculatorBank(banks[0].name);
    }
  }, [banks, calculatorBank]);

  useEffect(() => {
    if (depositType === "daily") setDepositDays("1");
    if (depositType === "monthly") setDepositDays("32");
    if (depositType === "yearly") setDepositDays("365");
  }, [depositType]);

  const filteredAndSortedBanks = useMemo(() => {
    let result = [...banks];
    if (searchQuery) {
      result = result.filter((bank) => bank.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    if (mode === "exchange" && sortBy !== "none") {
      result.sort((a, b) => {
        const [currency, type, direction] = sortBy.split("-");
        const currencyUpper = currency.toUpperCase();
        const rateA = getRate(a, currencyUpper, type);
        const rateB = getRate(b, currencyUpper, type);
        return direction === "high" ? rateB - rateA : rateA - rateB;
      });
    } else if (mode === "interest" && sortBy.startsWith("deposit-")) {
      result.sort((a, b) => {
        const rateA = getDepositRate(a);
        const rateB = getDepositRate(b);
        return sortBy === "deposit-high" ? rateB - rateA : rateA - rateB;
      });
    } else if (mode === "credit" && sortBy.startsWith("credit-")) {
      const [, loanKey, direction] = sortBy.split("-");
      result.sort((a, b) => {
        const rateA = getLoanRate(a, loanKey);
        const rateB = getLoanRate(b, loanKey);
        return direction === "low" ? rateA - rateB : rateB - rateA;
      });
    }

    return result;
  }, [banks, searchQuery, sortBy, mode]);

  const bestDeposit = getBestDepositRate(banks);
  const selectedCalculatorBank = banks.find((b) => b.name === calculatorBank) ?? null;
  const selectedExchangePair =
    selectedCalculatorBank?.exchangeRates?.find((r) => r.currency === exchangeCurrency) ?? null;
  const selectedExchangeSellRate = selectedExchangePair?.sell ?? null;
  const selectedExchangeBuyRate = selectedExchangePair?.buy ?? null;
  const exchangeTl = Number.parseFloat(exchangeAmountTl);
  const exchangeResult =
    Number.isFinite(exchangeTl) &&
    exchangeTl > 0 &&
    (exchangeOperation === "buy" ? Number.isFinite(selectedExchangeSellRate) : Number.isFinite(selectedExchangeBuyRate))
      ? exchangeOperation === "buy"
        ? exchangeTl / selectedExchangeSellRate
        : exchangeTl * selectedExchangeBuyRate
      : null;

  const depositPrincipal = Number.parseFloat(depositAmount);
  const depositTermDays = Number.parseFloat(depositDays);
  const selectedDepositRateBase = selectedCalculatorBank ? getDepositRate(selectedCalculatorBank) : null;
  const selectedDepositRate =
    Number.isFinite(selectedDepositRateBase)
      ? depositType === "daily"
        ? Math.max(selectedDepositRateBase - 3.5, 0)
        : depositType === "yearly"
          ? Math.max(selectedDepositRateBase - 1.5, 0)
          : selectedDepositRateBase
      : null;
  const depositProfit =
    Number.isFinite(depositPrincipal) &&
    depositPrincipal > 0 &&
    Number.isFinite(depositTermDays) &&
    depositTermDays > 0 &&
    Number.isFinite(selectedDepositRate)
      ? depositPrincipal * (selectedDepositRate / 100) * (depositTermDays / 365)
      : null;
  const depositTotal = Number.isFinite(depositProfit) ? depositPrincipal + depositProfit : null;

  const principal = Number.parseFloat(loanAmount);
  const months = Number.parseFloat(loanMonths);
  const monthlyRate = selectedCalculatorBank ? getLoanRate(selectedCalculatorBank, loanType) : null;
  const i = Number.isFinite(monthlyRate) ? monthlyRate / 100 : null;
  const loanInstallment =
    Number.isFinite(principal) && principal > 0 && Number.isFinite(months) && months > 0 && Number.isFinite(i)
      ? i === 0
        ? principal / months
        : principal * ((i * (1 + i) ** months) / ((1 + i) ** months - 1))
      : null;
  const loanTotal = Number.isFinite(loanInstallment) ? loanInstallment * months : null;
  const activeLoanRate = Number.isFinite(monthlyRate) ? monthlyRate : null;

  return (
    <div className="min-h-screen bg-[#020617] text-white relative">
      <header className="sticky top-0 z-[100] w-full px-6 py-4 flex items-center justify-between border-b border-white/10 bg-[#020617]/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-gradient-to-tr from-indigo-500 to-teal-400 p-2 text-white shadow-md shadow-indigo-900/40">
            <TrendingUp className="size-6" />
          </div>
          <h2 className="bg-gradient-to-r from-teal-400 to-indigo-400 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent sm:text-3xl">
            FinSight.io
          </h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
          <span className="relative inline-flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400"></span>
          </span>
          Canlı Piyasa
        </div>
        </div>
      </header>
      <div className="pointer-events-none fixed -left-60 -top-40 z-0 h-[40rem] w-[40rem] rounded-full bg-teal-500/20 blur-[140px]"></div>
      <div className="pointer-events-none fixed -right-40 top-10 z-0 h-[45rem] w-[45rem] rounded-full bg-indigo-500/20 blur-[140px]"></div>
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(56,189,248,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.22) 1px, transparent 1px)",
          backgroundSize: "38px 38px",
        }}
      />
      <div className="relative z-10 w-full max-w-[1600px] mx-auto px-4 md:px-8 pb-12 flex flex-col gap-8">
      <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl backdrop-blur-lg transition-all hover:border-teal-500/30">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-cyan-300">Piyasa Özeti (Market Summary)</h3>
          <span className="text-xs text-slate-400">Terminal Görünümü</span>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          {[
            { title: "USD/TRY", value: "33.15", change: "+0.22%", up: true, spark: "5,22 20,12 35,17 50,9 65,13 80,6" },
            { title: "EUR/TRY", value: "36.05", change: "-0.11%", up: false, spark: "5,10 20,14 35,11 50,16 65,13 80,18" },
            { title: "ALTIN (Ons)", value: "2350 USD", change: "+0.18%", up: true, spark: "5,18 20,9 35,15 50,8 65,12 80,7" },
            { title: "Türkiye Mevduat Ort.", value: bestDeposit ? `%${bestDeposit.rate.toFixed(2)}` : "%48.50", change: "32 Gün", up: true, spark: "5,14 20,13 35,12 50,13 65,11 80,10" },
            { title: "TCMB Gösterge Faizi", value: "%50.00", change: "Sabit", up: true, spark: "5,12 20,12 35,12 50,12 65,12 80,12" },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-white/10 bg-slate-900/80 p-3 backdrop-blur-md transition-transform duration-300 hover:-translate-y-1 hover:border-teal-500/30"
            >
              <p className="text-xs uppercase tracking-wide text-slate-400">{item.title}</p>
              <p className="mt-1 font-mono text-xl font-bold text-slate-100">{item.value}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className={`text-xs font-semibold ${item.up ? "text-emerald-400" : "text-rose-400"}`}>{item.change}</span>
                <svg viewBox="0 0 85 24" className="h-6 w-24">
                  <polyline fill="none" stroke={item.up ? "#34d399" : "#fb7185"} strokeWidth="2" points={item.spark} />
                </svg>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-white/10 bg-slate-950/70 p-1 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setMode("exchange")}
            className={`rounded-md px-4 py-2 text-sm transition ${mode === "exchange" ? "bg-gradient-to-r from-teal-400 to-indigo-500 text-white shadow-lg shadow-teal-500/20" : "text-slate-300"}`}
          >
            Kur
          </button>
          <button
            type="button"
            onClick={() => setMode("interest")}
            className={`rounded-md px-4 py-2 text-sm transition ${mode === "interest" ? "bg-gradient-to-r from-teal-400 to-indigo-500 text-white shadow-lg shadow-teal-500/20" : "text-slate-300"}`}
          >
            Faiz
          </button>
          <button
            type="button"
            onClick={() => setMode("credit")}
            className={`rounded-md px-4 py-2 text-sm transition ${mode === "credit" ? "bg-gradient-to-r from-teal-400 to-indigo-500 text-white shadow-lg shadow-teal-500/20" : "text-slate-300"}`}
          >
            Kredi
          </button>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              placeholder="Banka ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 pl-10 pr-3 text-sm text-slate-100 outline-none focus:border-blue-400"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
          >
            {currentSortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl backdrop-blur-lg transition-all hover:border-teal-500/30">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            {mode === "exchange"
              ? "Döviz Çevirici"
              : mode === "interest"
                ? "Mevduat Getiri Hesaplayıcı"
                : "Kredi Taksit Hesaplayıcı"}
          </h3>
        </div>

        {mode === "exchange" ? (
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Banka Seçin</label>
              <select
                value={calculatorBank}
                onChange={(e) => setCalculatorBank(e.target.value)}
                className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
              >
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.name}>
                    {`${bank.name} | Alış: ${
                      Number.isFinite(bank.exchangeRates?.find((r) => r.currency === exchangeCurrency)?.buy)
                        ? bank.exchangeRates.find((r) => r.currency === exchangeCurrency).buy.toFixed(2)
                        : "—"
                    } | Satış: ${
                      Number.isFinite(bank.exchangeRates?.find((r) => r.currency === exchangeCurrency)?.sell)
                        ? bank.exchangeRates.find((r) => r.currency === exchangeCurrency).sell.toFixed(2)
                        : "—"
                    }`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-medium text-indigo-300">İşlem Türü</label>
              <div className="inline-flex w-full rounded-lg border border-white/10 bg-slate-900/80 p-1 backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => setExchangeOperation("buy")}
                  className={`flex-1 rounded-md px-3 py-2 text-sm transition ${
                    exchangeOperation === "buy"
                      ? "bg-gradient-to-r from-teal-400 to-indigo-500 text-white shadow-lg shadow-teal-500/20"
                      : "text-slate-300"
                  }`}
                >
                  🟢 Döviz Al
                </button>
                <button
                  type="button"
                  onClick={() => setExchangeOperation("sell")}
                  className={`flex-1 rounded-md px-3 py-2 text-sm transition ${
                    exchangeOperation === "sell" ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/20" : "text-slate-300"
                  }`}
                >
                  ⚫️ Döviz Bozdur
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Döviz Birimi</label>
              <select
                value={exchangeCurrency}
                onChange={(e) => setExchangeCurrency(e.target.value)}
                className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">
                {exchangeOperation === "buy" ? "Çevrilecek Tutar (TL)" : "Bozdurulacak Döviz"}
              </label>
              <input
                type="number"
                min="0"
                value={exchangeAmountTl}
                onChange={(e) => setExchangeAmountTl(e.target.value)}
                className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
                placeholder={exchangeOperation === "buy" ? "TL Tutarı" : `${exchangeCurrency} Tutarı`}
              />
            </div>
            <div className="flex items-end justify-center pb-1">
              <button
                type="button"
                onClick={() => setExchangeOperation((prev) => (prev === "buy" ? "sell" : "buy"))}
                className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200 transition hover:border-cyan-500/60 hover:text-cyan-300"
                aria-label="Swap"
              >
                <ArrowUpDown className="size-5" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">
                {exchangeOperation === "buy" ? "Alınacak Döviz" : "Elde Edilecek TL"}
              </label>
              <div className="flex h-11 items-center rounded-lg border border-indigo-700/60 bg-indigo-900/50 px-3 text-sm text-slate-100">
                {Number.isFinite(exchangeResult)
                  ? `${exchangeResult.toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} ${exchangeOperation === "buy" ? exchangeCurrency : "TL"}`
                  : "Sonuç bekleniyor"}
              </div>
            </div>
            <div className="sm:col-span-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              {Number.isFinite(exchangeOperation === "buy" ? selectedExchangeSellRate : selectedExchangeBuyRate) && selectedCalculatorBank
                ? `💡 İşlem Kuru: 1 ${exchangeCurrency} = ${(
                    exchangeOperation === "buy" ? selectedExchangeSellRate : selectedExchangeBuyRate
                  ).toFixed(2)} TL (${selectedCalculatorBank.name} ${exchangeOperation === "buy" ? "Satış" : "Alış"})`
                : "💡 İşlem kuru seçili banka ve döviz birimine göre hesaplanır."}
            </div>
          </div>
        ) : mode === "interest" ? (
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Banka Seçin</label>
              <select
                value={calculatorBank}
                onChange={(e) => setCalculatorBank(e.target.value)}
                className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
              >
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.name}>
                    {bank.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Anapara Tutarı (TL)</label>
              <input
                type="number"
                min="0"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
                placeholder="Anapara (TL)"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Vade Türü</label>
              <select
                value={depositType}
                onChange={(e) => setDepositType(e.target.value)}
                className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
              >
                <option value="daily">Günlük</option>
                <option value="monthly">Aylık</option>
                <option value="yearly">Yıllık</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Vade Süresi (Gün)</label>
              <input
                type="number"
                min="1"
                value={depositDays}
                onChange={(e) => setDepositDays(e.target.value)}
                className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
                placeholder="Vade (Gün)"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Net Getiri</label>
              <div className="flex h-11 items-center rounded-lg border border-indigo-700/60 bg-indigo-900/50 px-3 text-sm text-slate-100">
                {Number.isFinite(depositProfit)
                  ? `${depositProfit.toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Net getiri hesaplanamadı"}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Vade Sonu Toplam</label>
              <div className="flex h-11 items-center rounded-lg border border-indigo-700/60 bg-indigo-900/50 px-3 text-sm text-slate-100">
                {Number.isFinite(depositTotal)
                  ? `${depositTotal.toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Vade sonu bekleniyor"}
              </div>
            </div>
            <div className="sm:col-span-6 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
              {Number.isFinite(selectedDepositRate)
                ? `Kullanılan Faiz Oranı: %${selectedDepositRate.toFixed(2)} (${depositType === "daily" ? "Günlük" : depositType === "monthly" ? "Aylık" : "Yıllık"} baz)`
                : "Faiz oranı banka verisine göre belirlenecektir."}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Banka Seçin</label>
              <select
                value={calculatorBank}
                onChange={(e) => setCalculatorBank(e.target.value)}
                className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
              >
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.name}>
                    {bank.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Kredi Türü</label>
              <select
                value={loanType}
                onChange={(e) => setLoanType(e.target.value)}
                className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
              >
                <option value="tasit">Taşıt</option>
                <option value="konut">Konut</option>
                <option value="ihtiyac">İhtiyaç</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Kredi Tutarı (TL)</label>
              <input
                type="number"
                min="0"
                value={loanAmount}
                onChange={(e) => setLoanAmount(e.target.value)}
                className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
                placeholder="Kredi Tutarı (TL)"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Vade (Ay)</label>
              <input
                type="number"
                min="1"
                value={loanMonths}
                onChange={(e) => setLoanMonths(e.target.value)}
                className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-blue-400"
                placeholder="Vade (Ay)"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Aylık Taksit Tutarı</label>
              <div className="flex h-11 items-center rounded-lg border border-indigo-700/60 bg-indigo-900/50 px-3 text-sm text-slate-100">
                {Number.isFinite(loanInstallment)
                  ? `${loanInstallment.toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Taksit hesaplanamadı"}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-300">Toplam Geri Ödeme</label>
              <div className="flex h-11 items-center rounded-lg border border-indigo-700/60 bg-indigo-900/50 px-3 text-sm text-slate-100">
                {Number.isFinite(loanTotal)
                  ? `${loanTotal.toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Toplam ödeme bekleniyor"}
              </div>
            </div>
            <div className="sm:col-span-6 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
              {Number.isFinite(activeLoanRate) && selectedCalculatorBank
                ? `💡 Uygulanan Aylık Faiz: %${activeLoanRate.toFixed(2)} (${selectedCalculatorBank.name} ${
                    loanType === "tasit" ? "Taşıt Kredisi" : loanType === "konut" ? "Konut Kredisi" : "İhtiyaç Kredisi"
                  })`
                : "💡 Uygulanan faiz, seçilen banka ve kredi türüne göre belirlenir."}
            </div>
          </div>
        )}
      </div>

      {banks.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 py-10 text-center text-slate-300 shadow-xl backdrop-blur-lg">
          Kur listesi yukleniyor veya baglanti hatası...
        </div>
      ) : filteredAndSortedBanks.length > 0 ? (
        <div className="grid gap-8 md:gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAndSortedBanks.map((bank) => (
            <V0BankCard key={bank.id} bank={bank} mode={mode} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 py-10 text-center text-slate-300 shadow-xl backdrop-blur-lg">
          Banka bulunamadi.
        </div>
      )}

      {lastUpdated ? (
        <div className="mt-10 flex justify-center px-2">
          <div className="rounded-lg border border-slate-700/80 bg-slate-950/60 px-4 py-2.5 text-center text-xs tracking-wide text-slate-500 shadow-sm">
            {`Son Güncelleme: ${new Date(lastUpdated).toLocaleString("tr-TR", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}`}
          </div>
        </div>
      ) : null}
      <div className="mt-5 border-t border-white/10 pt-3 text-center text-xs text-slate-500">
        Türkiye Finansal Veri Merkezi | FinSight.io
      </div>
      </div>
    </div>
  );
}
