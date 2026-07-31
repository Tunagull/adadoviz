import { useState, useEffect, useRef, memo } from "react";

function getCurrencyDisplay(currency) {
  return currency;
}

const bankDomains = {
  "ziraat bankası": "ziraatbank.com.tr",
  "garanti bbva": "garantibbva.com.tr",
  akbank: "akbank.com",
  "türkiye iş bankası": "isbank.com.tr",
  "yapı kredi": "yapikredi.com.tr",
  halkbank: "halkbank.com.tr",
  vakıfbank: "vakifbank.com.tr",
  "qnb finansbank": "qnbfinansbank.com",
  denizbank: "denizbank.com",
  "kuveyt türk": "kuveytturk.com.tr",
  teb: "teb.com.tr",
  "ing bank": "ing.com.tr",
  odeabank: "odeabank.com.tr",
  fibabanka: "fibabanka.com.tr",
  "albaraka türk": "albaraka.com.tr",
  "sun döviz": "sundoviz.com.tr",
};

function formatRate(rate, currency) {
  if (rate === null || rate === undefined || rate === "") {
    return "—";
  }
  const n = typeof rate === "number" ? rate : Number.parseFloat(String(rate).replace(",", "."));
  if (!Number.isFinite(n)) {
    return "—";
  }
  return n.toFixed(2);
}

function V0BankCardComponent({ bank, mode, onSelect, showNearestBranch = false }) {
  // ✅ ADIM 2: Flash effect durumları
  const [flashColor, setFlashColor] = useState(null); // 'green' | 'red' | null
  const prevRatesRef = useRef({});

  const interestRates = Array.isArray(bank.interestRates) ? bank.interestRates : [];
  const loans = bank?.loans ?? {};
  const baseDepositRateRaw =
    typeof bank?.depositRate === "number"
      ? bank.depositRate
      : Number.parseFloat(String(interestRates?.[0]?.rate ?? "").replace(",", "."));
  const baseDepositRate = Number.isFinite(baseDepositRateRaw) ? baseDepositRateRaw : null;
  const simulatedDepositRows =
    Number.isFinite(baseDepositRate)
      ? [
          { label: "Günlük (1-7 Gün)", rate: Math.max(baseDepositRate - 3.5, 0) },
          { label: "Aylık (32-92 Gün)", rate: baseDepositRate },
          { label: "Yıllık (365 Gün)", rate: Math.max(baseDepositRate - 1.5, 0) },
        ]
      : [];
  const ratesByPriority = ["EUR", "USD", "GBP"];
  const exchangeRates = ratesByPriority.map((code) => {
    const found = (bank.exchangeRates || []).find((rate) => rate.currency === code);
    return {
      currency: code,
      buy: found?.buy ?? null,
      sell: found?.sell ?? null,
    };
  });

  // SSE → Dashboard banks güncellemesi → bu prop değişir; flash buradan tetiklenir.
  // liveRates ayrı prop olarak verilmez: memo ile gereksiz tüm-kart re-render önlenir.
  useEffect(() => {
    if (mode !== "exchange" || !bank.institutionId) return;

    if (Object.keys(prevRatesRef.current).length === 0) {
      for (const rate of exchangeRates) {
        if (rate.buy) {
          prevRatesRef.current[rate.currency] = rate.buy;
        }
      }
      return;
    }

    let hasChanged = false;
    let isPositive = true;

    for (const rate of exchangeRates) {
      if (rate.buy && prevRatesRef.current[rate.currency]) {
        const oldRate = prevRatesRef.current[rate.currency];
        const newRate = rate.buy;

        if (newRate !== oldRate) {
          hasChanged = true;
          isPositive = newRate > oldRate;
          prevRatesRef.current[rate.currency] = newRate;
          break;
        }
      }
    }

    if (hasChanged) {
      setFlashColor(isPositive ? "green" : "red");
      const timer = setTimeout(() => setFlashColor(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [mode, bank.institutionId, bank.exchangeRates]);

  // ✅ ADIM 3: Tailwind Flash Effect - Dinamik sınıflar + Smooth Fade
  // Hover glow = Admin Paneli butonuyla birebir aynı:
  // hover:border-cyan-400 + hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]
  const getCardClasses = () => {
    const baseClasses =
      "group overflow-hidden rounded-2xl backdrop-blur-lg transition-all duration-300 cursor-pointer";

    if (flashColor === "green") {
      return `${baseClasses} border-emerald-500/80 bg-emerald-500/20 shadow-lg shadow-emerald-500/30 border`;
    } else if (flashColor === "red") {
      return `${baseClasses} border-rose-500/80 bg-rose-500/20 shadow-lg shadow-rose-500/30 border`;
    } else {
      return `${baseClasses} border border-slate-200 bg-white/90 shadow-xl dark:border-white/10 dark:bg-slate-900/60 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:hover:border-cyan-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]`;
    }
  };

  const rawName = bank.name || "";
  const isTestAccount = bank.subscription_type === "Test";
  const displayName = rawName.replace(/\s*\([Tt]est\)\s*/g, "").trim();
  const nearest = showNearestBranch ? bank.nearestBranch : null;
  const nearestLabel =
    nearest?.name && Number.isFinite(nearest.distanceKm)
      ? `(${nearest.name} - ${
          nearest.distanceKm < 10
            ? `${nearest.distanceKm.toFixed(1)}km`
            : `${Math.round(nearest.distanceKm)}km`
        })`
      : null;

  const handleCardClick = () => {
    if (typeof onSelect === "function") onSelect(bank);
  };

  const handleCardKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleCardClick();
    }
  };

  return (
    <div
      className={getCardClasses() + " p-6"}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${displayName || bank.name} analizini aç`}
    >
      <div className="flex items-center gap-3 px-1 pb-4">
        <img
          src={
            bank.logo_url ||
            `https://www.google.com/s2/favicons?domain=${bankDomains[String(bank.name || "").toLowerCase()] || "bank.com"}&sz=128`
          }
          alt={displayName || bank.name}
          className="h-8 w-8 shrink-0 rounded-full bg-white p-0.5 object-cover shadow-sm"
        />
        <div className="flex items-center gap-2 min-w-0">
          <h3
            className={`text-base font-semibold leading-tight transition-all duration-300 truncate ${
              flashColor === "green"
                ? "text-emerald-700 dark:text-emerald-200"
                : flashColor === "red"
                  ? "text-rose-700 dark:text-rose-200"
                  : "text-slate-800 dark:text-slate-100 group-hover:text-cyan-600 dark:group-hover:text-cyan-400"
            }`}
          >
            {displayName || bank.name}
            {nearestLabel ? (
              <span className="ml-1.5 text-xs font-medium text-teal-600 dark:text-teal-300">
                {nearestLabel}
              </span>
            ) : null}
          </h3>
          {isTestAccount && (
            <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-extrabold tracking-wider text-rose-500 bg-rose-500/10 border border-rose-500/30 shadow-[0_0_12px_rgba(244,63,94,0.5)]">
              TEST
            </span>
          )}
        </div>
      </div>

      {mode === "exchange" ? (
        <div className="px-1 pb-1">
          <div className="divide-y divide-slate-200 dark:divide-slate-700/60">
            {exchangeRates.map((rate) => (
              <div key={rate.currency} className="flex items-center justify-between py-3">
                <span className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-700 ease-out ${
                  flashColor === "green" ? "bg-emerald-500/30 text-emerald-700 dark:text-emerald-200" :
                  flashColor === "red" ? "bg-rose-500/30 text-rose-700 dark:text-rose-200" :
                  "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}>
                  {getCurrencyDisplay(rate.currency)}
                </span>

                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <span className={`mb-0.5 block text-[10px] font-medium uppercase tracking-wider transition-colors duration-700 ease-out ${
                      flashColor === "green" ? "text-emerald-300" :
                      flashColor === "red" ? "text-rose-300" :
                      "text-slate-500"
                    }`}>
                      ALIS
                    </span>
                    <span className={`font-mono text-xl font-bold transition-colors duration-700 ease-out ${
                      flashColor === "green" ? "text-emerald-300" :
                      flashColor === "red" ? "text-rose-300" :
                      "text-emerald-400"
                    }`}>
                      {formatRate(rate.buy, rate.currency)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className={`mb-0.5 block text-[10px] font-medium uppercase tracking-wider transition-colors duration-700 ease-out ${
                      flashColor === "green" ? "text-emerald-300" :
                      flashColor === "red" ? "text-rose-300" :
                      "text-slate-500"
                    }`}>
                      SATIS
                    </span>
                    <span className={`font-mono text-xl font-bold transition-colors duration-700 ease-out ${
                      flashColor === "green" ? "text-emerald-300" :
                      flashColor === "red" ? "text-rose-300" :
                      "text-rose-400"
                    }`}>
                      {formatRate(rate.sell, rate.currency)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : mode === "interest" ? (
        <div className="px-1 pb-1">
          {simulatedDepositRows.length > 0 ? (
            <div className="divide-y divide-slate-700/60">
              {simulatedDepositRows.map((item) => (
                <div key={item.label} className="flex items-center justify-between py-3">
                  <span className="text-sm text-slate-400">{item.label}</span>
                  <span className="font-mono text-xl font-bold text-emerald-300">%{item.rate.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center px-4 py-8 text-center text-sm text-slate-400">
              Bu kaynakta faiz verisi yayınlanmıyor; yalnızca döviz özeti kullanılıyor.
            </div>
          )}
        </div>
      ) : (
        <div className="px-1 pb-1">
          <div className="divide-y divide-slate-700/60">
            {[
              { key: "tasit", label: "Taşıt Kredisi" },
              { key: "konut", label: "Konut Kredisi" },
              { key: "ihtiyac", label: "İhtiyaç Kredisi" },
            ].map((item) => {
              const raw = loans?.[item.key];
              const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? "").replace(",", "."));
              return (
                <div key={item.key} className="flex items-center justify-between py-3">
                  <span className="text-sm text-slate-300">{item.label}</span>
                  <span className="font-mono text-2xl font-bold text-amber-300">
                    {Number.isFinite(value) ? `%${value.toFixed(2)}` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export const V0BankCard = memo(V0BankCardComponent);
