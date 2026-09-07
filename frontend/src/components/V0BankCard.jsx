import { useState, useEffect, useRef, memo } from "react";
import { Award, MapPin, Phone } from "lucide-react";
import { mediaUrl } from "../lib/api";
import { useLanguage } from "../context/LanguageContext";
import { GlowCard } from "./ui/spotlight-card";
import { AnimatedRate } from "./ui/animated-counter";

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

const RATES_BY_PRIORITY = ["EUR", "USD", "GBP"];

/** M1/M7: `bank.exchangeRates` içeriğinin kararlı parmak izi — effect ve memo için. */
function ratesFingerprint(bank) {
  return (bank?.exchangeRates || [])
    .map((r) => `${r.currency}:${r.buy}:${r.sell}`)
    .join("|");
}

function normalizeExchangeRows(bank) {
  return RATES_BY_PRIORITY.map((code) => {
    const found = (bank.exchangeRates || []).find((rate) => rate.currency === code);
    return { currency: code, buy: found?.buy ?? null, sell: found?.sell ?? null };
  });
}

/**
 * @param {object} props
 * @param {{EUR?:{buy:number,sell:number},USD?:{buy:number,sell:number},GBP?:{buy:number,sell:number}}} [props.bestRates]
 *   U-10: Panodaki en iyi alış / en iyi satış değerleri. Bu kart o değeri
 *   tutturuyorsa ilgili hücre işaretlenir.
 */
function V0BankCardComponent({
  bank,
  onSelect,
  showNearestBranch = false,
  bestRates = null,
  branches = [],
  introRates = false,
}) {
  const { t, lang } = useLanguage();
  // ✅ Flash effect durumu
  const [flashColor, setFlashColor] = useState(null); // 'green' | 'red' | null
  /** A-C2 / D7: ekran okuyucu için "USD alış 40,85'e güncellendi" duyurusu. */
  const [rateAnnouncement, setRateAnnouncement] = useState("");
  const prevRatesRef = useRef({});

  const exchangeRates = normalizeExchangeRows(bank);
  const fingerprint = ratesFingerprint(bank);

  // SSE → Dashboard banks güncellemesi → parmak izi değişir; flash buradan tetiklenir.
  // M7: tek bağımlılık `fingerprint` — her dashboard re-render'ında değil, yalnızca
  // kur içeriği gerçekten değişince çalışır.
  useEffect(() => {
    if (!bank.institutionId) return undefined;
    const rows = normalizeExchangeRows(bank);

    if (Object.keys(prevRatesRef.current).length === 0) {
      for (const rate of rows) {
        if (rate.buy) prevRatesRef.current[rate.currency] = rate.buy;
      }
      return undefined;
    }

    let changed = null;
    for (const rate of rows) {
      const oldRate = prevRatesRef.current[rate.currency];
      if (rate.buy && oldRate && rate.buy !== oldRate) {
        changed = { currency: rate.currency, oldRate, newRate: rate.buy };
        prevRatesRef.current[rate.currency] = rate.buy;
        break;
      }
    }

    if (changed) {
      const up = changed.newRate > changed.oldRate;
      setFlashColor(up ? "green" : "red");
      const locale = lang === "en" ? "en-US" : "tr-TR";
      const formatted = changed.newRate.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      setRateAnnouncement(
        lang === "en"
          ? `${changed.currency} buy updated to ${formatted}`
          : `${changed.currency} alış ${formatted}'e güncellendi`
      );
      const timer = setTimeout(() => setFlashColor(null), 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, bank.institutionId, lang]);

  const getCardClasses = () => {
    const baseClasses = "group rounded-2xl backdrop-blur-lg transition-all duration-300 cursor-pointer";

    if (flashColor === "green") {
      return `${baseClasses} border-success-500/80 bg-success-500/20 shadow-lg shadow-success-500/30 border`;
    } else if (flashColor === "red") {
      return `${baseClasses} border-danger-500/80 bg-danger-500/20 shadow-lg shadow-danger-500/30 border`;
    }
    return `${baseClasses} border border-ink-200 bg-white/90 shadow-xl dark:border-white/10 dark:bg-ink-900/60 dark:shadow-card-dark`;
  };

  const rawName = bank.name || "";
  const displayName = rawName.replace(/\s*\([Tt]est\)\s*/g, "").trim();
  /** M-01: karttan doğrudan arama / yol tarifi için en uygun şube. */
  const contactBranch = bank.nearestBranch || branches?.[0] || null;
  const contactPhone = contactBranch?.phone || contactBranch?.whatsapp || bank.phone || null;
  const hasCoords =
    contactBranch &&
    Number.isFinite(Number(contactBranch.lat)) &&
    Number.isFinite(Number(contactBranch.lng));
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

  // D7 / A-C2: renk tek gösterge olmasın — yön oku eşlik eder.
  const trendGlyph = flashColor === "green" ? "▲" : flashColor === "red" ? "▼" : null;
  const valueDurationClass = flashColor ? "duration-instant" : "duration-base";

  return (
    <GlowCard
      className={getCardClasses() + " p-4 sm:p-6"}
      glowColor={flashColor === "green" ? "green" : flashColor === "red" ? "red" : "white"}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${displayName || bank.name} — ${t("openAnalysis")}`}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {rateAnnouncement}
      </span>

      <div className="flex items-center gap-3 px-1 pb-4">
        <img
          src={
            mediaUrl(bank.logo_url) ||
            `https://www.google.com/s2/favicons?domain=${bankDomains[String(bank.name || "").toLowerCase()] || "bank.com"}&sz=128`
          }
          alt={displayName || bank.name}
          className="h-8 w-8 shrink-0 rounded-full bg-white p-0.5 object-cover shadow-sm"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h3
            className={`glow-card-title min-w-0 text-base font-semibold leading-tight transition-all duration-300 ${
              flashColor === "green"
                ? "text-success-700 dark:text-success-200"
                : flashColor === "red"
                  ? "text-danger-700 dark:text-danger-200"
                  : "text-ink-800 dark:text-ink-100 group-hover:text-brand-700 dark:group-hover:text-white"
            }`}
          >
            <span className="block truncate">{displayName || bank.name}</span>
            {nearestLabel ? (
              <span className="mt-0.5 block truncate text-xs font-medium text-brand-600 dark:text-brand-300">
                {nearestLabel}
              </span>
            ) : null}
          </h3>
        </div>
      </div>

      <div className="px-1 pb-1">
        <div className="flex items-center justify-end gap-5 px-1 pb-1.5">
          <span className="w-[4.75rem] text-right text-[11px] font-medium tracking-wide text-ink-500 dark:text-ink-400">
            {t("buyShort")}
          </span>
          <span className="w-[4.75rem] text-right text-[11px] font-medium tracking-wide text-ink-500 dark:text-ink-400">
            {t("sellShort")}
          </span>
        </div>
        <div className="divide-y divide-ink-200 dark:divide-ink-700/60">
          {exchangeRates.map((rate) => {
            const best = bestRates?.[rate.currency];
            const isBestBuy =
              best?.buy != null && rate.buy != null && Math.abs(best.buy - rate.buy) < 1e-9;
            const isBestSell =
              best?.sell != null && rate.sell != null && Math.abs(best.sell - rate.sell) < 1e-9;

            return (
              <div key={rate.currency} className="flex items-center justify-between gap-3 py-3">
                <span
                  className={`inline-flex items-center justify-center rounded-control px-3 py-1.5 text-xs font-semibold transition-colors ease-out-strong ${valueDurationClass} ${
                    flashColor === "green"
                      ? "bg-success-500/25 text-success-700 dark:text-success-400"
                      : flashColor === "red"
                        ? "bg-danger-500/25 text-danger-700 dark:text-danger-400"
                        : "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200"
                  }`}
                >
                  {getCurrencyDisplay(rate.currency)}
                </span>

                <div className="flex items-center gap-5">
                  <div className="flex w-[4.75rem] items-center justify-end gap-1">
                    {trendGlyph ? (
                      <span
                        aria-hidden="true"
                        className={`text-[11px] ${flashColor === "green" ? "text-success-600 dark:text-success-400" : "text-danger-600 dark:text-danger-400"}`}
                      >
                        {trendGlyph}
                      </span>
                    ) : null}
                    {isBestBuy ? (
                      <Award
                        size={12}
                        className="shrink-0 text-brand-600 dark:text-brand-400"
                        aria-label={t("bestBuy")}
                      />
                    ) : null}
                    <span
                      className={`font-mono text-xl font-bold tabular-nums transition-colors ease-out-strong ${valueDurationClass} ${
                        flashColor === "green"
                          ? "text-success-700 dark:text-success-400"
                          : flashColor === "red"
                            ? "text-danger-700 dark:text-danger-400"
                            : isBestBuy
                              ? "text-brand-700 dark:text-brand-300"
                              : "text-ink-900 dark:text-white"
                      }`}
                    >
                      <AnimatedRate value={rate.buy} play={introRates} />
                    </span>
                  </div>

                  <div className="flex w-[4.75rem] items-center justify-end gap-1">
                    {trendGlyph ? (
                      <span
                        aria-hidden="true"
                        className={`text-[11px] ${flashColor === "green" ? "text-success-600 dark:text-success-400" : "text-danger-600 dark:text-danger-400"}`}
                      >
                        {trendGlyph}
                      </span>
                    ) : null}
                    {isBestSell ? (
                      <Award
                        size={12}
                        className="shrink-0 text-brand-600 dark:text-brand-400"
                        aria-label={t("bestSell")}
                      />
                    ) : null}
                    <span
                      className={`font-mono text-xl font-bold tabular-nums transition-colors ease-out-strong ${valueDurationClass} ${
                        flashColor === "green"
                          ? "text-success-700 dark:text-success-400"
                          : flashColor === "red"
                            ? "text-danger-700 dark:text-danger-400"
                            : isBestSell
                              ? "text-brand-700 dark:text-brand-300"
                              : "text-ink-900 dark:text-white"
                      }`}
                    >
                      <AnimatedRate value={rate.sell} play={introRates} />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {contactPhone || hasCoords ? (
          <div className="flex gap-2 border-t border-ink-200 px-1 pt-3 dark:border-ink-700/60">
            {contactPhone ? (
              <a
                href={`tel:${String(contactPhone).replace(/[^\d+]/g, "")}`}
                onClick={(e) => e.stopPropagation()}
                className="btn-subtle btn-sm min-h-[2.5rem] flex-1"
              >
                <Phone size={14} aria-hidden="true" />
                {t("callBtn")}
              </a>
            ) : null}
            {hasCoords ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${contactBranch.lat},${contactBranch.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="btn-ghost btn-sm min-h-[2.5rem] flex-1"
              >
                <MapPin size={14} aria-hidden="true" />
                {t("directionsBtn")}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </GlowCard>
  );
}

/**
 * M1: parent `filteredAndSortedBanks` her yeniden hesaplamada `{...bank}` ile
 * yeni nesneler üretiyor → shallow memo boşa çıkıyordu. Kartın gerçekten
 * çizdiği alanları karşılaştır.
 */
function areEqual(prev, next) {
  const pb = prev.bank || {};
  const nb = next.bank || {};
  return (
    (pb.institutionId || pb.id) === (nb.institutionId || nb.id) &&
    pb.name === nb.name &&
    pb.logo_url === nb.logo_url &&
    pb.phone === nb.phone &&
    ratesFingerprint(pb) === ratesFingerprint(nb) &&
    (pb.nearestBranch?.id ?? null) === (nb.nearestBranch?.id ?? null) &&
    (pb.nearestBranch?.distanceKm ?? null) === (nb.nearestBranch?.distanceKm ?? null) &&
    prev.showNearestBranch === next.showNearestBranch &&
    prev.introRates === next.introRates &&
    prev.onSelect === next.onSelect &&
    prev.branches === next.branches &&
    JSON.stringify(prev.bestRates) === JSON.stringify(next.bestRates)
  );
}

export const V0BankCard = memo(V0BankCardComponent, areEqual);
