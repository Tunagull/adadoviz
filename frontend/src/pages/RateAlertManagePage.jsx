import { useCallback, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BellRing, CheckCircle2, Trash2 } from "lucide-react";
import { BrandLogo } from "../components/BrandLogo";
import { SiteNav } from "../components/SiteNav";
import { HeaderActions } from "../components/HeaderActions";
import { MobileNav } from "../components/MobileNav";
import { useLanguage } from "../context/LanguageContext";
import {
  fetchRateAlertManage,
  verifyRateAlert,
  setRateAlertActive,
  deleteRateAlert,
  unsubscribeAllRateAlerts,
} from "../lib/rateAlerts";

function alertPhrase(t, a) {
  const side = a.side === "sell" ? t("sellShort") : t("buyShort");
  const dir = a.direction === "below" ? t("rateAlertBelow") : t("rateAlertAbove");
  const thr = Number(a.threshold).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return `${a.currency} ${side} · ${dir} ${thr} ₺`;
}

/**
 * P3.2 — token'lı alarm yönetimi (`/alarm/:token`). `?v=1` ise önce doğrular.
 * noindex — link yalnızca e-postadan gelir.
 */
export function RateAlertManagePage() {
  const { t } = useLanguage();
  const { token } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldVerify = searchParams.get("v") === "1";

  const [state, setState] = useState({
    status: "loading",
    email: "",
    alerts: [],
    error: "",
    verified: false,
  });

  const load = useCallback(async () => {
    try {
      if (shouldVerify) {
        try {
          await verifyRateAlert(token);
        } catch {
          /* zaten doğrulanmış olabilir — yoksay */
        }
      }
      const data = await fetchRateAlertManage(token);
      setState({
        status: "ready",
        email: data.email || "",
        alerts: data.alerts || [],
        error: "",
        verified: shouldVerify,
      });
      if (shouldVerify) {
        const p = new URLSearchParams(searchParams);
        p.delete("v");
        setSearchParams(p, { replace: true });
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err.message || t("rateAlertManageError"),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (a) => {
    try {
      await setRateAlertActive(token, a.id, !a.active);
      setState((s) => ({
        ...s,
        alerts: s.alerts.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)),
      }));
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    }
  };
  const remove = async (a) => {
    try {
      await deleteRateAlert(token, a.id);
      setState((s) => ({ ...s, alerts: s.alerts.filter((x) => x.id !== a.id) }));
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    }
  };
  const stopAll = async () => {
    try {
      await unsubscribeAllRateAlerts(token);
      setState((s) => ({ ...s, alerts: s.alerts.map((x) => ({ ...x, active: false })) }));
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    }
  };

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900 dark:bg-ink-950 dark:text-white">
      <Helmet>
        <title>{`${t("rateAlertManageTitle")} | AdaDöviz`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <header className="sticky top-0 z-sticky w-full border-b border-ink-200/80 bg-white/80 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80 sm:px-6 sm:py-4 md:py-5">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 sm:gap-4">
          <BrandLogo className="min-w-0 shrink" />
          <SiteNav className="mr-auto ml-2" />
          <HeaderActions />
          <MobileNav />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="mb-6 flex items-center gap-2">
          <BellRing className="size-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          <h1 className="text-2xl font-bold tracking-tight">{t("rateAlertManageTitle")}</h1>
        </div>

        {state.verified ? (
          <div
            role="status"
            className="mb-4 flex items-start gap-3 rounded-lg border border-success-500/30 bg-success-500/10 px-4 py-3 text-sm text-success-800 dark:text-success-200"
          >
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>{t("rateAlertVerifiedOk")}</p>
          </div>
        ) : null}

        {state.status === "loading" ? (
          <p className="text-sm text-ink-500 dark:text-ink-400">{t("loadingShort")}</p>
        ) : state.status === "error" ? (
          <div
            role="alert"
            className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-700 dark:text-danger-200"
          >
            {state.error}
          </div>
        ) : (
          <section className="surface-card overflow-hidden p-0">
            <div className="border-b border-ink-200 px-4 py-3 text-xs text-ink-500 dark:border-ink-700/60 dark:text-ink-400">
              {t("rateAlertManageFor")}: <span className="font-medium">{state.email}</span>
            </div>
            {state.alerts.length === 0 ? (
              <p className="p-6 text-sm text-ink-500 dark:text-ink-400">
                {t("rateAlertManageEmpty")}
              </p>
            ) : (
              <ul className="divide-y divide-ink-200 dark:divide-ink-700/60">
                {state.alerts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink-900 dark:text-white">
                        {alertPhrase(t, a)}
                      </span>
                      <span className="text-xs text-ink-500 dark:text-ink-400">
                        {!a.verified
                          ? t("rateAlertPendingVerify")
                          : a.active
                            ? t("rateAlertActiveLabel")
                            : t("rateAlertPausedLabel")}
                        {a.last_fired_at
                          ? ` · ${t("rateAlertLastFired")}: ${new Date(
                              a.last_fired_at
                            ).toLocaleDateString("tr-TR")}`
                          : ""}
                      </span>
                    </span>
                    {a.verified ? (
                      <button type="button" onClick={() => toggle(a)} className="btn btn-sm">
                        {a.active ? t("rateAlertPause") : t("rateAlertResume")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => remove(a)}
                      aria-label={t("rateAlertRemove")}
                      className="btn btn-sm text-danger-600 hover:text-danger-700 dark:text-danger-400"
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {state.alerts.some((a) => a.active) ? (
              <div className="border-t border-ink-200 px-4 py-3 dark:border-ink-700/60">
                <button
                  type="button"
                  onClick={stopAll}
                  className="text-sm font-medium text-danger-600 hover:underline dark:text-danger-400"
                >
                  {t("rateAlertStopAll")}
                </button>
              </div>
            ) : null}
          </section>
        )}

        <Link
          to="/"
          className="mt-6 inline-block text-sm text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
        >
          {t("signupBackHome")}
        </Link>
      </main>
    </div>
  );
}

export default RateAlertManagePage;
