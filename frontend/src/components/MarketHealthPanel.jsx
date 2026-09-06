import { useEffect, useMemo, useState } from "react";
import { Store, AlertTriangle, MapPinOff, Clock } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { cityLabel } from "../lib/cities";
import { fetchAdminMarketHealth } from "../lib/auth";

const ISSUE_KEYS = {
  inverted: "marketHealthIssueInverted",
  buy_above_cb: "marketHealthIssueBuyAboveCb",
  sell_below_cb: "marketHealthIssueSellBelowCb",
  buy_margin_wide: "marketHealthIssueBuyWide",
  sell_margin_wide: "marketHealthIssueSellWide",
};

/**
 * P2.6 — pazar yeri sağlığı (S2): bayat marj, kapsama boşluğu, kur sanity-band.
 * Salt okuma; manuel kur düzeltme mevcut işletme düzenleme akışından yapılır.
 */
export function MarketHealthPanel({ token }) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    fetchAdminMarketHealth(token, 7)
      .then((res) => {
        if (alive) {
          setData(res);
          setError("");
        }
      })
      .catch((err) => {
        if (alive) setError(err.message || "Pazar sağlığı alınamadı.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const staleBusinesses = useMemo(
    () =>
      (data?.businesses || [])
        .filter((b) => b.stale && b.is_active)
        .sort((a, b) => (b.last_margin_age_days ?? 9999) - (a.last_margin_age_days ?? 9999)),
    [data]
  );

  if (loading && !data) {
    return (
      <section className="rounded-card border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/80">
        <p className="text-sm text-ink-500 dark:text-ink-400">{t("marketHealthLoading")}</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="rounded-card border border-danger-500/30 bg-danger-500/10 p-4">
        <p className="text-sm text-danger-700 dark:text-danger-200">{error}</p>
      </section>
    );
  }
  if (!data) return null;

  const stat = (icon, value, label, tone) => (
    <div className="rounded-card border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-900/80">
      <p className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
        {icon}
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-lg font-bold ${
          value > 0 && tone === "warn"
            ? "text-warning-600 dark:text-warning-400"
            : value > 0 && tone === "danger"
              ? "text-danger-600 dark:text-danger-400"
              : "text-ink-900 dark:text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );

  const daysAgo = (n) => t("marketHealthDaysAgo").replace("{n}", String(n ?? "—"));

  return (
    <section className="space-y-4 rounded-card border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/80 sm:p-5">
      <div className="flex items-center gap-2">
        <Store className="size-5 text-brand-600 dark:text-brand-400" />
        <h3 className="font-semibold">{t("marketHealthTitle")}</h3>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat(<Clock className="size-3.5" />, staleBusinesses.length, t("marketHealthStale"), "warn")}
        {stat(
          <AlertTriangle className="size-3.5" />,
          data.anomalyCount || 0,
          t("marketHealthAnomalies"),
          "danger"
        )}
        {stat(
          <MapPinOff className="size-3.5" />,
          (data.uncoveredCities || []).length,
          t("marketHealthUncovered"),
          "warn"
        )}
        {stat(
          <Store className="size-3.5" />,
          (data.businessesWithoutBranch || []).length,
          t("marketHealthNoBranch"),
          "warn"
        )}
      </div>

      {/* Bayat marj */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
          {t("marketHealthStaleList")}
        </p>
        {staleBusinesses.length === 0 ? (
          <p className="text-sm text-ink-400 dark:text-ink-500">{t("marketHealthAllFresh")}</p>
        ) : (
          <ul className="space-y-1">
            {staleBusinesses.map((b) => (
              <li
                key={b.institution_id}
                className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-1.5 text-sm dark:bg-ink-950/50"
              >
                <span className="text-ink-800 dark:text-ink-100">{b.name}</span>
                <span className="text-xs text-ink-500 dark:text-ink-400">
                  {b.never_configured
                    ? t("marketHealthNeverConfigured")
                    : daysAgo(b.last_margin_age_days)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Kur sanity anomalileri */}
      {(data.anomalies || []).length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            {t("marketHealthAnomalyList")}
          </p>
          <ul className="space-y-1">
            {data.anomalies.map((a, i) => (
              <li
                key={`${a.institution_id}-${a.currency}-${i}`}
                className="rounded-lg border border-danger-500/20 bg-danger-500/5 px-3 py-1.5 text-sm"
              >
                <span className="font-medium text-ink-800 dark:text-ink-100">{a.name}</span>{" "}
                <span className="text-ink-500 dark:text-ink-400">
                  · {a.currency} · {t(ISSUE_KEYS[a.issue] || a.issue)}
                </span>
                <span className="ml-1 font-mono text-xs text-ink-500 dark:text-ink-400">
                  ({a.buy} / {a.sell} · MB {a.cbBuy} / {a.cbSell})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Kapsama boşluğu */}
      {(data.uncoveredCities || []).length > 0 ? (
        <p className="text-sm text-ink-600 dark:text-ink-300">
          <span className="font-semibold">{t("marketHealthUncovered")}:</span>{" "}
          {data.uncoveredCities.map((c) => cityLabel(c, lang)).join(", ")}
        </p>
      ) : null}

      <p className="text-xs text-ink-400 dark:text-ink-500">{t("marketHealthManualNote")}</p>
    </section>
  );
}
