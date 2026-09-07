import { useEffect, useState } from "react";
import { BellRing, RefreshCw } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { fetchAdminRateAlerts, runRateAlertCheck } from "../lib/auth";

const SIDE = { buy: "Alış", sell: "Satış" };
const DIR = { above: "üstü", below: "altı" };

/**
 * P3.2 — superadmin değer sinyali (C3). "Sistem Sağlığı" sekmesinde
 * MarketHealthPanel'in altında. Aktif alarm sayısı + en popüler eşikler +
 * manuel kontrol tetiği. Veri yükleme deseni MarketHealthPanel ile aynı
 * (efekt içinde senkron setState yok).
 */
export function RateAlertPanel({ token }) {
  const { t } = useLanguage();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkResult, setCheckResult] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    fetchAdminRateAlerts(token)
      .then((res) => {
        if (alive) {
          setData(res);
          setError("");
        }
      })
      .catch((err) => {
        if (alive) setError(err.message || "Kur alarmları alınamadı.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, reloadKey]);

  const runCheck = () => {
    runRateAlertCheck(token)
      .then((r) => {
        setCheckResult(r);
        setReloadKey((k) => k + 1);
      })
      .catch((err) => setError(err.message));
  };

  if (loading && !data) {
    return (
      <section className="rounded-card border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/80">
        <p className="text-sm text-ink-500 dark:text-ink-400">{t("loadingShort")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/80">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-ink-800 dark:text-ink-200">
          <BellRing size={18} className="text-brand-600 dark:text-brand-400" />
          <h3 className="font-semibold">{t("rateAlertAdminTitle")}</h3>
        </div>
        <button
          type="button"
          onClick={runCheck}
          className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
        >
          <RefreshCw size={13} /> {t("rateAlertAdminRunCheck")}
        </button>
      </div>

      {error ? (
        <p className="mb-3 text-sm text-danger-700 dark:text-danger-300">{error}</p>
      ) : null}

      {data ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              [data.activeVerified, t("rateAlertAdminActive")],
              [data.pendingVerify, t("rateAlertAdminPending")],
              [data.total, t("rateAlertAdminTotal")],
            ].map(([n, label]) => (
              <div
                key={label}
                className="rounded-lg border border-ink-200 px-3 py-2 dark:border-ink-700/60"
              >
                <p className="text-xl font-bold tabular-nums text-ink-900 dark:text-white">
                  {n}
                </p>
                <p className="text-[11px] text-ink-500 dark:text-ink-400">{label}</p>
              </div>
            ))}
          </div>

          {data.byTarget?.length ? (
            <ul className="mt-3 space-y-1 text-xs text-ink-600 dark:text-ink-300">
              {data.byTarget.slice(0, 6).map((r, i) => (
                <li key={i} className="flex justify-between">
                  <span>
                    {r.currency} {SIDE[r.side] || r.side} · eşik{" "}
                    {DIR[r.direction] || r.direction}
                  </span>
                  <span className="font-semibold tabular-nums">{r.count}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {checkResult ? (
            <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600 dark:bg-ink-950 dark:text-ink-300">
              {t("rateAlertAdminCheckDone")}: {checkResult.checked ?? 0} /{" "}
              {checkResult.fired ?? 0} / {checkResult.emailed ?? 0}
            </p>
          ) : null}

          {data.recent?.length ? (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-ink-500 dark:text-ink-400">
                {t("rateAlertAdminRecent")} ({data.recent.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {data.recent.map((r) => (
                  <li
                    key={r.id}
                    className="flex justify-between gap-2 text-ink-600 dark:text-ink-300"
                  >
                    <span className="truncate">
                      {r.email_masked} · {r.currency} {SIDE[r.side] || r.side}{" "}
                      {Number(r.threshold).toLocaleString("tr-TR")}
                    </span>
                    <span className="shrink-0">
                      {r.verified ? (r.active ? "✓" : "⏸") : "…"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default RateAlertPanel;
