import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import { Check } from "lucide-react";
import { BrandLogo } from "../components/BrandLogo";
import { SiteNav } from "../components/SiteNav";
import { HeaderActions } from "../components/HeaderActions";
import { MobileNav } from "../components/MobileNav";
import { FloatingSelect } from "../components/ui/floating-label";
import { ChartContainer, ChartHoverCard, ChartLegend, ChartLegendContent, ChartSwatch, ChartTooltip } from "../components/ui/chart";
import { chartSkin, comparePalette, compareDash, hollowDot } from "../lib/chartTheme";
import { useLanguage } from "../context/LanguageContext";
import { useTheme } from "../context/ThemeContext";
import { apiUrl, fetchRatesWithRetry } from "../lib/api";
import { cityOptionsFromBranches } from "../lib/cities";

const CURRENCIES = ["USD", "EUR", "GBP"];
const CURRENCY_SYMBOL = { USD: "$", EUR: "€", GBP: "£" };
const MAX_SELECTION = 4;
const WINDOW_DAYS = 14;
/**
 * İşletme kur geçmişi için periyot.
 *
 * "Günlük" bu uçta 14 günlük pencereye yalnızca ~5 gün nokta düşürüyor (kısa
 * vadeli/gün içi görünüm); grafiğin sol tarafı işletme çizgisiz kalıyordu.
 * "Haftalık" ~30 günü kapsadığı için 14 günlük pencereyi baştan sona doldurur.
 */
const HISTORY_PERIOD = "Haftalık";

/** Yerel saate göre yyyy-MM-dd (toISOString UTC kaydırması yapmasın diye). */
function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function lastDays(count) {
  const days = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dayKey(d));
  }
  return days;
}

/**
 * Aynı güne ait birden fazla kayıt gelebilir (marj gün içinde değişmiş olabilir).
 * Grafikte günün SON değeri gösterilir.
 */
function bucketByDay(rows, buyField, sellField) {
  const map = new Map();
  for (const row of rows || []) {
    const key = dayKey(row.recorded_at);
    if (!key) continue;
    const buy = Number(row[buyField]);
    const sell = Number(row[sellField]);
    if (!Number.isFinite(buy) || !Number.isFinite(sell)) continue;
    map.set(key, { buy, sell });
  }
  return map;
}

function formatRate(value, locale) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function CompareRatesTooltip({ active, payload, label, locale, config }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((entry) => entry.value != null);
  if (!rows.length) return null;
  return (
    <ChartHoverCard label={label} className="max-w-[280px]">
      {rows.map((entry) => {
        const item = config?.[entry.dataKey];
        return (
          <div key={entry.dataKey} className="flex items-center justify-between gap-3 text-xs">
            <ChartSwatch label={item?.label || entry.name} color={item?.color || entry.color} />
            <span className="shrink-0 font-semibold tabular-nums text-ink-900 dark:text-white">
              {formatRate(entry.value, locale)}
            </span>
          </div>
        );
      })}
    </ChartHoverCard>
  );
}

function shortLabel(day, locale) {
  const date = new Date(`${day}T12:00:00`);
  return date.toLocaleDateString(locale, { day: "2-digit", month: "short" });
}

export function ComparePage() {
  const { t, lang } = useLanguage();
  const { theme } = useTheme();
  const locale = lang === "en" ? "en-US" : "tr-TR";
  const isDark = theme === "dark";
  const skin = chartSkin(isDark);
  const palette = comparePalette(isDark);

  const [searchParams, setSearchParams] = useSearchParams();
  const [businesses, setBusinesses] = useState([]);
  const [seriesByBusiness, setSeriesByBusiness] = useState({});
  /** institutionId -> o işletmenin şubelerinin bulunduğu şehir slug'ları */
  const [citiesByBusiness, setCitiesByBusiness] = useState({});
  const [branchGroups, setBranchGroups] = useState({});
  const [loading, setLoading] = useState(true);
  // M2: hata bir KOD olarak saklanır, render sırasında çevrilir — böylece
  // `t` fetch-effect bağımlılığı olmaktan çıkar (dil değişimi refetch tetiklemez).
  const [errorCode, setErrorCode] = useState(null);

  const currency = CURRENCIES.includes(searchParams.get("birim"))
    ? searchParams.get("birim")
    : "USD";

  const cityFilter = searchParams.get("sehir") || "";

  // URL'deki ham seçim. Bağımlılık dizilerinde dizi yerine bu string kullanılır.
  const requestedKey = searchParams.get("isletmeler") || "";

  /** Şehir filtresi uygulanmış işletme listesi — çipler bundan çizilir. */
  const visibleBusinesses = useMemo(() => {
    if (!cityFilter) return businesses;
    return businesses.filter((b) => citiesByBusiness[b.institutionId]?.includes(cityFilter));
  }, [businesses, citiesByBusiness, cityFilter]);

  // Katalogdaki işletmelerle kesiştir; geçersiz id ile grafik boş kalmasın.
  const selected = useMemo(() => {
    const requested = requestedKey
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (visibleBusinesses.length === 0) return requested.slice(0, MAX_SELECTION);
    const valid = requested.filter((id) => visibleBusinesses.some((b) => b.institutionId === id));
    if (valid.length > 0) return valid.slice(0, MAX_SELECTION);
    return visibleBusinesses.slice(0, 3).map((b) => b.institutionId);
  }, [requestedKey, visibleBusinesses]);

  const selectedKey = selected.join(",");

  const pushState = useCallback(
    (nextSelected, nextCurrency, nextCity) => {
      const params = new URLSearchParams();
      if (nextSelected.length) params.set("isletmeler", nextSelected.join(","));
      params.set("birim", nextCurrency);
      if (nextCity) params.set("sehir", nextCity);
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  /**
   * Şehir değişince, o şehirde şubesi olmayan işletmeler seçimden düşer;
   * aksi hâlde çip listesinde görünmeyen bir işletme grafikte kalırdı.
   */
  const changeCity = (nextCity) => {
    const allowed = nextCity
      ? businesses.filter((b) => citiesByBusiness[b.institutionId]?.includes(nextCity))
      : businesses;
    const kept = selected.filter((id) => allowed.some((b) => b.institutionId === id));
    pushState(kept, currency, nextCity);
  };

  // İşletme listesi (bir kez). F-H3: soğuk-başlangıç toleranslı, edge-önbellekli
  // proxy üzerinden — dashboard ile aynı retry döngüsü.
  useEffect(() => {
    let alive = true;
    fetchRatesWithRetry({ isCancelled: () => !alive })
      .then((data) => {
        if (!alive || !data) return;
        const list = (data?.banks || [])
          .filter((b) => b.institutionId)
          .map((b) => ({
            institutionId: b.institutionId,
            name: b.bankName || b.bank || b.institutionId,
          }));
        setBusinesses(list);
      })
      .catch(() => alive && setErrorCode("compareError"));
    return () => {
      alive = false;
    };
  }, []);

  // Şube listesi: şehir filtresinin seçenekleri ve işletme-şehir eşlemesi
  useEffect(() => {
    let alive = true;
    fetch(apiUrl("/api/branches"))
      .then((res) => res.json())
      .then((data) => {
        if (!alive) return;
        const groups = {};
        const map = {};
        for (const branch of data?.branches || []) {
          const id = branch.institution_id;
          if (!id) continue;
          (groups[id] = groups[id] || []).push(branch);
          if (branch.city && !(map[id] || []).includes(branch.city)) {
            map[id] = [...(map[id] || []), branch.city];
          }
        }
        setBranchGroups(groups);
        setCitiesByBusiness(map);
      })
      .catch((err) => {
        // M6: sessizce yutma — şehir filtresi kaybolursa en azından log'da görünsün.
        console.warn("[ComparePage] /api/branches alınamadı:", err);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Seçili her işletme için nihai kur geçmişi
  useEffect(() => {
    // Boş seçimde de Promise.all kullanılır: setState efekt gövdesinde senkron
    // değil, promise callback'inde çalışsın diye (react-hooks/set-state-in-effect).
    let alive = true;
    const ids = selectedKey ? selectedKey.split(",") : [];

    Promise.all(
      ids.map((id) =>
        fetch(apiUrl(`/api/business-rate-history?institution_id=${encodeURIComponent(id)}&currency=${currency}&period=${HISTORY_PERIOD}`))
          .then((res) => (res.ok ? res.json() : { rates: [] }))
          .then((data) => [id, bucketByDay(data?.rates, "final_buy", "final_sell")])
          .catch(() => [id, new Map()])
      )
    )
      .then((entries) => {
        if (!alive) return;
        setErrorCode(null);
        setSeriesByBusiness(Object.fromEntries(entries));
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setErrorCode("compareError");
        setLoading(false);
      });

    return () => {
      alive = false;
    };
    // `selected` yerine `selectedKey` (kararlı string) — M2.
  }, [selectedKey, currency]);

  const cityOptions = useMemo(
    () => cityOptionsFromBranches(branchGroups, lang),
    [branchGroups, lang]
  );

  const days = useMemo(() => lastDays(WINDOW_DAYS), []);

  const chartData = useMemo(
    () =>
      days.map((day) => {
        const row = { day, label: shortLabel(day, locale) };
        for (const id of selected) {
          const point = seriesByBusiness[id]?.get(day);
          row[`${id}_buy`] = point?.buy ?? null;
          row[`${id}_sell`] = point?.sell ?? null;
        }
        return row;
      }),
    [days, selected, seriesByBusiness, locale]
  );

  const summary = useMemo(
    () =>
      selected.map((id) => {
        const map = seriesByBusiness[id];
        const points = days.map((d) => map?.get(d)).filter(Boolean);
        const first = points[0];
        const last = points[points.length - 1];
        return {
          id,
          name: businesses.find((b) => b.institutionId === id)?.name || id,
          buy: last?.buy ?? null,
          sell: last?.sell ?? null,
          change: first && last ? last.buy - first.buy : null,
        };
      }),
    [selected, seriesByBusiness, days, businesses]
  );

  const chartConfig = useMemo(() => {
    const cfg = {};
    selected.forEach((id, index) => {
      const name = businesses.find((b) => b.institutionId === id)?.name || id;
      const color = palette[index % palette.length];
      cfg[`${id}_buy`] = { label: `${name} - ${t("buyShort")}`, color };
      cfg[`${id}_sell`] = { label: `${name} - ${t("sellShort")}`, color };
    });
    return cfg;
  }, [selected, businesses, palette, t]);

  const toggle = (id) => {
    const exists = selected.includes(id);
    const next = exists
      ? selected.filter((x) => x !== id)
      : [...selected, id].slice(0, MAX_SELECTION);
    pushState(next, currency, cityFilter);
  };

  return (
    <div className="min-h-screen">
      {/*
        ⚠️ HATA DÜZELTMESİ (S-02): Bu sayfada hiç Helmet yoktu. Global SeoHead
        site geneli değerleri bastığı için /kiyasla, ana sayfanın başlığını,
        açıklamasını VE canonical adresini miras alıyordu — yani arama
        motoruna kendini ana sayfa olarak bildiriyordu. Ölçüm:
          title     → "AdaDöviz | KKTC Döviz Kurları…"
          canonical → https://adadoviz.tunahangul.com/
        Kanonik adresin başka bir sayfayı göstermesi, bu sayfanın indeksten
        düşmesi anlamına gelir.
      */}
      {/* canonical'ı SeoHead rota bazında üretir; burada tekrar edilmez. */}
      <Helmet>
        <title>{`${t("compareTitle")} | AdaDöviz`}</title>
        <meta name="description" content={t("compareLead")} />
      </Helmet>

      <header className="sticky top-0 z-sticky w-full border-b border-ink-200/80 bg-white/80 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80 sm:px-6 sm:py-4 md:py-5">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 sm:gap-4">
          <BrandLogo className="min-w-0 shrink" />
          <SiteNav className="mr-auto ml-2" />
          <HeaderActions />
          <MobileNav />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
        <section className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{t("compareTitle")}</h1>
          <p className="max-w-2xl text-sm text-ink-600 dark:text-ink-400">{t("compareLead")}</p>
        </section>

        <section className="surface-card space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{t("compareCurrency")}</span>
            <div className="inline-flex rounded-full border border-ink-300 p-1 dark:border-white/10">
              {CURRENCIES.map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={currency === code}
                  onClick={() => pushState(selected, code, cityFilter)}
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
            {cityOptions.length > 0 ? (
              <FloatingSelect
                label={t("cityFilterLabel")}
                size="sm"
                value={cityFilter}
                onChange={(e) => changeCity(e.target.value)}
              >
                <option value="">{t("cityFilterAll")}</option>
                {cityOptions.map((city) => (
                  <option key={city.slug} value={city.slug}>
                    {city.label}
                  </option>
                ))}
              </FloatingSelect>
            ) : null}

            <span className="ml-auto text-xs text-ink-500 dark:text-ink-400">
              {t("compareSelectHint")} ({selected.length} {t("compareSelected")})
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {visibleBusinesses.map((business) => {
              const active = selected.includes(business.institutionId);
              const disabled = !active && selected.length >= MAX_SELECTION;
              return (
                <button
                  key={business.institutionId}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => toggle(business.institutionId)}
                  className={`inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-ink-950/40 bg-ink-950/[0.06] text-ink-900 dark:border-white/50 dark:bg-white/10 dark:text-white"
                      : "border-ink-300 text-ink-600 hover:bg-ink-100 dark:border-white/10 dark:text-ink-300 dark:hover:bg-white/5"
                  } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  {active ? <Check className="size-3" aria-hidden="true" /> : null}
                  {business.name}
                </button>
              );
            })}
          </div>
        </section>

        {errorCode ? (
          <div role="alert" className="surface-card p-6 text-center text-sm text-danger-600 dark:text-danger-400">
            {t(errorCode)}
          </div>
        ) : selected.length === 0 ? (
          <div className="surface-card p-12 text-center text-sm text-ink-500 dark:text-ink-400">
            {t("compareEmpty")}
          </div>
        ) : (
          <>
            <section className="surface-card p-4">
              <h2 className="mb-4 text-sm font-semibold">
                {currency} {t("compareChartTitle")}
              </h2>
              <div
                className="h-[340px] w-full"
                role="img"
                aria-label={
                  loading
                    ? t("compareLoading")
                    : `${currency} ${t("compareChartTitle")}. ${summary
                        .map(
                          (s) =>
                            `${s.name}: ${t("buyShort")} ${s.buy != null ? s.buy.toFixed(2) : "—"}, ${t("sellShort")} ${s.sell != null ? s.sell.toFixed(2) : "—"}${
                              s.change != null
                                ? ` (${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)})`
                                : ""
                            }`
                        )
                        .join("; ")}`
                }
              >
                {loading ? (
                  <div className="flex h-full items-center justify-center text-sm text-ink-500 dark:text-ink-400">
                    {t("compareLoading")}
                  </div>
                ) : (
                  <ChartContainer
                    config={chartConfig}
                    className="aspect-auto h-[340px] w-full [&_.recharts-curve.recharts-tooltip-cursor]:stroke-ink-300 dark:[&_.recharts-curve.recharts-tooltip-cursor]:stroke-white/20"
                  >
                    <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                      <CartesianGrid
                        strokeDasharray="4 4"
                        stroke={skin.grid}
                        strokeOpacity={1}
                        horizontal
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: skin.tick }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={12}
                        tickMargin={8}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: skin.tick }}
                        tickLine={false}
                        axisLine={false}
                        width={64}
                        domain={["auto", "auto"]}
                        tickMargin={8}
                        tickFormatter={(value) => Number(value).toFixed(2)}
                      />
                      <ChartTooltip
                        content={<CompareRatesTooltip locale={locale} config={chartConfig} />}
                        cursor={{
                          stroke: skin.cursor,
                          strokeWidth: 1,
                          strokeDasharray: "none",
                        }}
                      />
                      <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-4 gap-y-1.5" />} />
                      {selected.flatMap((id, index) => {
                        const color = palette[index % palette.length];
                        const dash = compareDash[index % compareDash.length];
                        const name = businesses.find((b) => b.institutionId === id)?.name || id;
                        const buyDot = hollowDot(color, skin.dotFill, 4);
                        return [
                          <Line
                            key={id + "-buy"}
                            type="linear"
                            dataKey={id + "_buy"}
                            name={name + " - " + t("buyShort")}
                            stroke={color}
                            strokeWidth={2}
                            strokeDasharray={dash === "0" ? undefined : dash}
                            dot={false}
                            activeDot={buyDot}
                            connectNulls
                          />,
                          <Line
                            key={id + "-sell"}
                            type="linear"
                            dataKey={id + "_sell"}
                            name={name + " - " + t("sellShort")}
                            stroke={color}
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            dot={false}
                            activeDot={buyDot}
                            connectNulls
                          />,
                        ];
                      })}
                    </ComposedChart>
                  </ChartContainer>
                )}
              </div>
            </section>

            <section className="surface-card p-4">
              <h2 className="mb-3 text-sm font-semibold">{t("compareToday")}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500 dark:border-white/10 dark:text-ink-400">
                      <th className="px-3 py-2">{t("compareBusiness")}</th>
                      <th className="px-3 py-2 text-right">{t("buyShort")}</th>
                      <th className="px-3 py-2 text-right">{t("sellShort")}</th>
                      <th className="px-3 py-2 text-right">{t("compareChange")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((row) => (
                      <tr key={row.id} className="border-b border-ink-100 last:border-0 dark:border-white/5">
                        <td className="px-3 py-2.5 font-medium">{row.name}</td>
                        <td className="px-3 py-2.5 text-right text-success-600 dark:text-success-400">
                          {formatRate(row.buy, locale)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-brand-600 dark:text-brand-400">
                          {formatRate(row.sell, locale)}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right ${
                            row.change === null
                              ? "text-ink-500 dark:text-ink-400"
                              : row.change >= 0
                                ? "text-success-600 dark:text-success-400"
                                : "text-danger-600 dark:text-danger-400"
                          }`}
                        >
                          {row.change === null ? (
                            "—"
                          ) : (
                            <>
                              <span aria-hidden="true">
                                {row.change > 0 ? "▲ " : row.change < 0 ? "▼ " : "▬ "}
                              </span>
                              <span className="sr-only">
                                {row.change > 0
                                  ? t("trendUp")
                                  : row.change < 0
                                    ? t("trendDown")
                                    : t("trendFlat")}{" "}
                              </span>
                              {(row.change >= 0 ? "+" : "") + formatRate(row.change, locale)}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
