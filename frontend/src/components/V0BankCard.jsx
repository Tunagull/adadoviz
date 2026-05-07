function getCurrencyDisplay(currency) {
  if (currency === "ALTIN") return "ALTIN (gr)";
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
};

function formatRate(rate, currency) {
  if (rate === null || rate === undefined || rate === "") {
    return "—";
  }
  const n = typeof rate === "number" ? rate : Number.parseFloat(String(rate).replace(",", "."));
  if (!Number.isFinite(n)) {
    return "—";
  }
  if (currency === "ALTIN") {
    return n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return n.toFixed(2);
}

export function V0BankCard({ bank, mode }) {
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
  const ratesByPriority = ["EUR", "USD", "GBP", "ALTIN"];
  const exchangeRates = ratesByPriority.map((code) => {
    const found = (bank.exchangeRates || []).find((rate) => rate.currency === code);
    return {
      currency: code,
      buy: found?.buy ?? null,
      sell: found?.sell ?? null,
    };
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl backdrop-blur-lg transition-all duration-300 hover:-translate-y-1 hover:border-teal-500/30">
      <a
        href={bank.websiteUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-3 px-1 pb-4"
      >
        <img
          src={`https://www.google.com/s2/favicons?domain=${bankDomains[String(bank.name || "").toLowerCase()] || "bank.com"}&sz=128`}
          alt={bank.name}
          className="h-8 w-8 shrink-0 rounded-full bg-white p-0.5 object-contain shadow-sm"
        />
        <h3 className="text-base font-semibold leading-tight text-slate-100 transition group-hover:text-blue-300 group-hover:underline">
          {bank.name}
        </h3>
      </a>

      {mode === "exchange" ? (
        <div className="px-1 pb-1">
          <div className="divide-y divide-slate-700/60">
            {exchangeRates.map((rate) => (
              <div key={rate.currency} className="flex items-center justify-between py-3">
                <span className="inline-flex items-center justify-center rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300">
                  {getCurrencyDisplay(rate.currency)}
                </span>

                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      ALIS
                    </span>
                    <span className="font-mono text-xl font-bold text-emerald-400">
                      {formatRate(rate.buy, rate.currency)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      SATIS
                    </span>
                    <span className="font-mono text-xl font-bold text-rose-400">
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
