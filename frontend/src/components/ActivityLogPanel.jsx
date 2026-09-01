import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { apiUrl } from "../lib/api";
import { auditActionLabel } from "../lib/auditActions";

/**
 * Aktivite günlüğü paneli — hem süper adminde hem işletme panelinde kullanılır.
 *
 *  mode="admin"    → /api/admin/audit-logs    (tüm işletmeler + işletme filtresi)
 *  mode="business" → /api/business/audit-logs (yalnızca kendi kayıtları)
 *
 * İşletme kırılımı sunucuda oturumdan belirlenir; buradaki filtre yalnızca
 * süper admin içindir.
 */
export function ActivityLogPanel({ token, mode = "business", businesses = [] }) {
  const { t, lang } = useLanguage();
  const isAdmin = mode === "admin";
  const locale = lang === "en" ? "en-US" : "tr-TR";

  const [logs, setLogs] = useState([]);
  const [actions, setActions] = useState([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [businessFilter, setBusinessFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Yükleniyor durumu KULLANICI EYLEMİNDE açılır (filtre/sayfa değişimi), efekt
   * içinde değil; böylece efekt gövdesinde senkron setState olmaz
   * (react-hooks/set-state-in-effect).
   */
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const params = new URLSearchParams({ page: String(page), limit: isAdmin ? "50" : "25" });
      if (actionFilter) params.set("action", actionFilter);
      if (isAdmin && businessFilter) params.set("institution_id", businessFilter);

      const endpoint = isAdmin ? "/api/admin/audit-logs" : "/api/business/audit-logs";
      const response = await fetch(apiUrl(`${endpoint}?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || t("logsLoadError"));

      setError(null);
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setActions(Array.isArray(data.actions) ? data.actions : []);
      setTotal(Number(data.total) || 0);
      setPageCount(Number(data.pageCount) || 1);
    } catch (err) {
      setError(err.message || t("logsLoadError"));
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [token, page, actionFilter, businessFilter, isAdmin, t]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = useMemo(() => {
    const max = Math.min(pageCount, 10);
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [pageCount]);

  // Filtre değişince ilk sayfaya dönülür; efekt içinde setState yerine
  // doğrudan setter'da yapılır (react-hooks/set-state-in-effect).
  const changeAction = (value) => {
    setLoading(true);
    setActionFilter(value);
    setPage(1);
  };

  const changeBusiness = (value) => {
    setLoading(true);
    setBusinessFilter(value);
    setPage(1);
  };

  const chipClass = (active) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? "border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300"
        : "border-ink-300 text-ink-600 hover:bg-ink-100 dark:border-white/10 dark:text-ink-300 dark:hover:bg-white/5"
    }`;

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t("logsTitle")}</h2>
        <p className="text-sm text-ink-600 dark:text-ink-400">
          {isAdmin ? t("logsLeadAdmin") : t("logsLeadBusiness")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={chipClass(!actionFilter)} onClick={() => changeAction("")}>
          {t("logsAll")} ({total})
        </button>
        {actions.map((row) => (
          <button
            key={row.action}
            type="button"
            className={chipClass(actionFilter === row.action)}
            onClick={() => changeAction(row.action)}
          >
            {auditActionLabel(row.action, lang)} ({row.count})
          </button>
        ))}
      </div>

      {isAdmin && businesses.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={chipClass(!businessFilter)}
            onClick={() => changeBusiness("")}
          >
            {t("logsAllBusinesses")}
          </button>
          {businesses.map((business) => (
            <button
              key={business.institution_id}
              type="button"
              className={chipClass(businessFilter === business.institution_id)}
              onClick={() => changeBusiness(business.institution_id)}
            >
              {business.institution_name || business.institution_id}
            </button>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-ink-200 bg-white dark:border-white/10 dark:bg-ink-900">
        {error ? (
          <p className="p-4 text-sm text-danger-600 dark:text-danger-400">{error}</p>
        ) : loading ? (
          <p className="p-4 text-sm text-ink-500 dark:text-ink-400">…</p>
        ) : logs.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-500 dark:text-ink-400">{t("logsEmpty")}</p>
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-white/5">
            {logs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    {log.detail || auditActionLabel(log.action, lang)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500 dark:text-ink-400">
                    <span className="rounded-full bg-ink-100 px-2 py-0.5 dark:bg-white/5">
                      {auditActionLabel(log.action, lang)}
                    </span>
                    {isAdmin && log.institution_name ? <span>{log.institution_name}</span> : null}
                    {log.actor ? <span>{log.actor}</span> : null}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-ink-500 dark:text-ink-400">
                  {new Date(log.created_at).toLocaleString(locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pageCount > 1 ? (
        <nav className="flex flex-wrap items-center justify-center gap-2 text-sm">
          {pages.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => { setLoading(true); setPage(value); }}
              className={`rounded-md border px-3 py-1.5 ${
                value === page
                  ? "border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300"
                  : "border-ink-300 hover:bg-ink-100 dark:border-white/10 dark:hover:bg-white/5"
              }`}
            >
              {value}
            </button>
          ))}
        </nav>
      ) : null}
    </section>
  );
}
