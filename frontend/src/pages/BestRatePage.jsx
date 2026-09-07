import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Award, BellRing, ChevronRight } from "lucide-react";
import { BrandLogo } from "../components/BrandLogo";
import { SiteNav } from "../components/SiteNav";
import { HeaderActions } from "../components/HeaderActions";
import { BuySellToggle } from "../components/BuySellToggle";
import { RateAlertModal } from "../components/RateAlertModal";
import { FloatingInput } from "../components/ui/floating-label";
import { useLanguage } from "../context/LanguageContext";
import { fetchRatesWithRetry, mediaUrl } from "../lib/api";
import { buildBusinessSlug, exchangeOfficePath } from "../lib/slug";
import { trackBusinessClick, trackCurrencyView } from "../lib/analytics";

const CURRENCIES = ["USD", "EUR", "GBP"];
const CURRENCY_SYMBOL = { USD: "$", EUR: "€", GBP: "£" };
/** SSE yok — sekme görünürken 60 sn'de bir tazele (kenar-önbellekli proxy ucuz). */
const REFRESH_MS = 60_000;

/**
 * Serbest metin / sayıdan kur değeri; ondalığı bozmadan (V0FinancialDashboard
 * `parseRateNumber` ile aynı kurallar — burada bağımsız kopya).
 */
function parseRateNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = String(value).trim().replace(/\s/g, "");
  if (!trimmed) return null;
  const lastDot = trimmed.lastIndexOf(".");
  const lastComma = trimmed.lastIndexOf(",");
  let normalized = trimmed.replace(/[^\d.,-]/g, "");
  if (!normalized) return null;
  if (lastComma > lastDot) normalized = normalized.replace(/\./g, "").replace(",", ".");
  else normalized = normalized.replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `/api/kurlar` banka satırından bir para biriminin alış/satış kuru. */
function bankRate(apiBank, currency) {
  const arr = Array.isArray(apiBank?.exchangeRates) ? apiBank.exchangeRates : [];
  const fromArr = arr.find((r) => r.currency === currency);
  const fromObj = apiBank?.rates?.[currency];
  return {
    buy: parseRateNumber(fromArr?.buy ?? fromObj?.buy),
    sell: parseRateNumber(fromArr?.sell ?? fromObj?.sell),
  };
}

/** Panoda listelenebilir mi — aktif ve aboneliği bitmemiş (dashboard ile aynı). */
function isListable(apiBank) {
  const active =
    apiBank?.is_active === true ||
    apiBank?.is_active === 1 ||
    apiBank?.is_active === "1" ||
    (apiBank?.is_active !== false &&
      apiBank?.is_active !== 0 &&
      apiBank?.is_active !== "0");
  if (!active) return false;
  if (apiBank?.subscription_end_date) {
    const end = new Date(apiBank.subscription_end_date).getTime();
    if (Number.isFinite(end) && end <= Date.now()) return false;
  }
  return true;
}

function mapBank(apiBank, index) {
  return {
    institutionId: apiBank?.institutionId || null,
    name: apiBank?.bankName || apiBank?.bank || apiBank?.institutionId || `Banka ${index + 1}`,
    logo_url: apiBank?.logo_url || null,
    slug: apiBank?.slug || null,
    raw: apiBank,
  };
}

export function BestRatePage() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "tr-TR";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [banks, setBanks] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | waking | ready | error
  const [updatedAt, setUpdatedAt] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertKey, setAlertKey] = useState(0);

  const currency = CURRENCIES.includes(searchParams.get("birim"))
    ? searchParams.get("birim")
    : "USD";
  const operation = searchParams.get("islem") === "sell" ? "sell" : "buy";
  const amount = searchParams.get("tutar") || "";

  const setParam = useCallback(
    (patch) => {
      const p = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(patch)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // Kur verisi — soğuk-backend toleranslı, dashboard/ComparePage ile aynı döngü.
  useEffect(() => {
    let alive = true;

    const load = () => {
      fetchRatesWithRetry({
        isCancelled: () => !alive,
        onRetry: () => {
          if (alive) setStatus((s) => (s === "ready" ? s : "waking"));
        },
      })
        .then((data) => {
          if (!alive || !data) return;
          const list = (Array.isArray(data?.banks) ? data.banks : [])
            .filter(isListable)
            .map(mapBank);
          setBanks(list);
          setUpdatedAt(
            data?.ratesChangedAt || data?.updatedAt || new Date().toISOString()
          );
          setStatus("ready");
        })
        .catch(() => {
          if (alive) setStatus((s) => (s === "ready" ? s : "error"));
        });
    };

    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    trackCurrencyView(currency);
  }, [currency]);

  const amountNum = parseRateNumber(amount);
  const hasAmount = Number.isFinite(amountNum) && amountNum > 0;

  const rows = useMemo(() => {
    const list = banks
      .map((b) => {
        const r = bankRate(b.raw, currency);
        return { ...b, rate: operation === "buy" ? r.buy : r.sell };
      })
      .filter((x) => Number.isFinite(x.rate) && x.rate > 0);
    list.sort(
      (a, b) =>
        (operation === "buy" ? b.rate - a.rate : a.rate - b.rate) ||
        String(a.name).localeCompare(String(b.name), "tr")
    );
    return list;
  }, [banks, currency, operation]);

  /** Herkes aynı kuru veriyorsa "en iyi" rozeti bilgi taşımaz. */
  const hasSpread = rows.length >= 2 && rows[0].rate !== rows[rows.length - 1].rate;

  const goToOffice = (biz) => {
    const name = String(biz?.name || "")
      .replace(/\s*\([Tt]est\)\s*/g, " ")
      .trim();
    trackBusinessClick(name || biz?.name, biz?.institutionId);
    const slug =
      biz?.slug ||
      buildBusinessSlug({ institutionId: biz?.institutionId, name: name || biz?.name });
    navigate(exchangeOfficePath(slug), { state: { openDetail: true } });
  };

  const fmtRate = (v) =>
    v.toLocaleString(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const fmtMoney = (v) =>
    v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const resultLabel =
    operation === "buy" ? t("bestRateResultBuy") : t("bestRateResultSell");
  const resultSuffix = operation === "buy" ? "₺" : currency;

  return (
    <div className="min-h-screen">
      <Helmet>
        <title>{`${t("bestRateTitle")} | AdaDöviz`}</title>
        <meta name="description" content={t("bestRateLead")} />
      </Helmet>

      <header className="sticky top-0 z-sticky w-full border-b border-ink-200/80 bg-white/80 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80 sm:px-6 sm:py-4 md:py-5">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 sm:gap-4">
          <BrandLogo className="min-w-0 shrink" />
          <SiteNav className="mr-auto ml-2" />
          <HeaderActions />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <section className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{t("bestRateTitle")}</h1>
          <p className="text-sm text-ink-600 dark:text-ink-400">{t("bestRateLead")}</p>
        </section>

        <section className="surface-card space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{t("bestRateCurrency")}</span>
            <div className="inline-flex rounded-full border border-ink-300 p-1 dark:border-white/10">
              {CURRENCIES.map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={currency === code}
                  onClick={() => setParam({ birim: code })}
                  className={`inline-flex min-h-[2.75rem] items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    currency === code
                      ? "surface-neon"
                      : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-white/5"
                  }`}
                >
                  {CURRENCY_SYMBOL[code]} {code}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t("operationType")}</span>
              <BuySellToggle
                value={operation}
                onChange={(next) => setParam({ islem: next === "sell" ? "sell" : "" })}
              />
            </div>
            <FloatingInput
              label={operation === "buy" ? t("bestRateAmountBuy") : t("bestRateAmountSell")}
              hint={t("bestRateAmountHint")}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setParam({ tutar: e.target.value.replace(/[^\d.,]/g, "") })}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setAlertKey((k) => k + 1);
              setAlertOpen(true);
            }}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            <BellRing size={15} aria-hidden="true" />
            {t("rateAlertCta")}
          </button>
        </section>

        {status === "error" ? (
          <div
            role="alert"
            className="surface-card p-6 text-center text-sm text-danger-600 dark:text-danger-400"
          >
            {t("compareError")}
          </div>
        ) : status === "waking" ? (
          <div className="surface-card p-8 text-center">
            <p className="text-sm font-semibold">{t("banksWakingTitle")}</p>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{t("banksWakingBody")}</p>
          </div>
        ) : status === "loading" ? (
          <div className="surface-card p-8 text-center text-sm text-ink-500 dark:text-ink-400">
            {t("compareLoading")}
          </div>
        ) : rows.length === 0 ? (
          <div className="surface-card p-12 text-center text-sm text-ink-500 dark:text-ink-400">
            {t("bestRateEmpty")}
          </div>
        ) : (
          <section className="surface-card overflow-hidden p-0">
            <ol className="divide-y divide-ink-200 dark:divide-ink-700/60">
              {rows.map((row, index) => {
                const isBest = index === 0 && hasSpread;
                const result = hasAmount
                  ? operation === "buy"
                    ? amountNum * row.rate
                    : amountNum / row.rate
                  : null;
                return (
                  <li key={row.institutionId || row.name}>
                    <button
                      type="button"
                      onClick={() => goToOffice(row)}
                      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                        isBest
                          ? "bg-brand-500/[0.06] dark:bg-brand-400/10"
                          : "hover:bg-ink-50 dark:hover:bg-white/5"
                      }`}
                      aria-label={`${row.name} — ${t("openAnalysis")}`}
                    >
                      <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-ink-400 dark:text-ink-500">
                        {index + 1}
                      </span>
                      <img
                        src={
                          mediaUrl(row.logo_url) ||
                          "https://www.google.com/s2/favicons?domain=bank.com&sz=128"
                        }
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-full bg-white object-cover p-0.5 shadow-sm"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-1.5 truncate font-medium text-ink-900 dark:text-white">
                          <span className="truncate">
                            {String(row.name).replace(/\s*\([Tt]est\)\s*/g, "").trim()}
                          </span>
                          {isBest ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-control bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              <Award size={11} aria-hidden="true" />
                              {t("bestRateBestBadge")}
                            </span>
                          ) : null}
                        </span>
                        {result != null ? (
                          <span className="text-xs text-ink-500 dark:text-ink-400">
                            {resultLabel}: {fmtMoney(result)} {resultSuffix}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[11px] font-medium tracking-wide text-ink-500 dark:text-ink-400">
                          {operation === "buy" ? t("buyShort") : t("sellShort")}
                        </span>
                        <span
                          className={`font-mono text-lg font-bold tabular-nums ${
                            isBest
                              ? "text-brand-700 dark:text-brand-300"
                              : "text-ink-900 dark:text-white"
                          }`}
                        >
                          {fmtRate(row.rate)}
                        </span>
                      </span>
                      <ChevronRight
                        size={16}
                        aria-hidden="true"
                        className="shrink-0 text-ink-400 dark:text-ink-500"
                      />
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {status === "ready" && updatedAt ? (
          <p className="text-center text-xs text-ink-400 dark:text-ink-500">
            {t("bestRateUpdated")}:{" "}
            {new Date(updatedAt).toLocaleString(locale, {
              hour: "2-digit",
              minute: "2-digit",
              day: "2-digit",
              month: "short",
            })}
          </p>
        ) : null}
      </main>

      <RateAlertModal
        key={alertKey}
        open={alertOpen}
        onOpenChange={setAlertOpen}
        defaultCurrency={currency}
        defaultSide={operation}
      />
    </div>
  );
}
