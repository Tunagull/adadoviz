import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Eye, Phone, MessageCircle, Navigation, BarChart3 } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { useTheme } from "../context/ThemeContext";
import { fetchBusinessAnalytics } from "../lib/auth";
import { chartSkin, hollowDot } from "../lib/chartTheme";

const EVENT_META = [
  { key: "view", icon: Eye },
  { key: "call", icon: Phone },
  { key: "whatsapp", icon: MessageCircle },
  { key: "directions", icon: Navigation },
];

/**
 * P2.5 — işletmenin kendi analitik özeti (B3).
 * 7/30 gün zaman serisi (görüntüleme + tıklama türleri) + toplamlar + şehir/
 * para-birimi kırılımı. Veri `/api/business/analytics`; onay yoksa istemci hiç
 * olay göndermediği için "veri yok" doğal durumdur.
 */
export function BusinessAnalyticsPanel({ token }) {
  const { t, lang } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const skin = chartSkin(isDark);

  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await fetchBusinessAnalytics(token, days);
        if (alive) {
          setData(res);
          setError("");
        }
      } catch (err) {
        if (alive) setError(err.message || "Analitik alınamadı.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, days]);

  const series = useMemo(
    () =>
      (data?.series || []).map((row) => ({
        ...row,
        label: new Date(row.date).toLocaleDateString(lang === "en" ? "en-GB" : "tr-TR", {
          day: "2-digit",
          month: "2-digit",
        }),
      })),
    [data, lang]
  );

  const totals = data?.totals || {};
  const totalEvents = EVENT_META.reduce((s, e) => s + (Number(totals[e.key]) || 0), 0);

  return (
    <section className="rounded-card border border-ink-200 bg-white p-4 dark:border-white/10 dark:bg-ink-900/60 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-white">
          <BarChart3 className="size-4" aria-hidden="true" />
          {t("bizAnalyticsTitle")}
        </h3>
        <div className="flex rounded-control border border-ink-200 p-0.5 dark:border-white/15">
          {[7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`min-h-[2.25rem] rounded-[0.55rem] px-3 text-sm font-medium transition-colors ${
                days === d
                  ? "bg-ink-900 text-white dark:bg-white dark:text-ink-950"
                  : "text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white"
              }`}
            >
              {t(d === 7 ? "bizAnalytics7d" : "bizAnalytics30d")}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-700 dark:text-danger-300">
          {error}
        </p>
      ) : loading && !data ? (
        <p className="mt-4 text-sm text-ink-500 dark:text-ink-400">{t("bizAnalyticsLoading")}</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {EVENT_META.map(({ key, icon: Icon }) => (
              <div
                key={key}
                className="rounded-xl border border-ink-200 bg-ink-50 px-3 py-3 dark:border-white/10 dark:bg-ink-950/50"
              >
                <p className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {t(`bizAnalyticsEvent_${key}`)}
                </p>
                <p className="mt-1 font-mono text-lg font-bold text-ink-900 dark:text-white">
                  {Number(totals[key]) || 0}
                </p>
              </div>
            ))}
          </div>

          {totalEvents === 0 ? (
            <p className="mt-4 text-sm text-ink-500 dark:text-ink-400">{t("bizAnalyticsEmpty")}</p>
          ) : (
            <>
              <div className="mt-4 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="bizViewFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={skin.neon} stopOpacity={isDark ? 0.28 : 0.16} />
                        <stop offset="100%" stopColor={skin.neon} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={skin.grid} strokeDasharray="3 6" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: skin.tick, fontSize: 11 }}
                      axisLine={{ stroke: skin.axis }}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: skin.tick, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={32}
                    />
                    <Tooltip
                      contentStyle={{
                        background: skin.tooltipBg,
                        border: `1px solid ${skin.tooltipBorder}`,
                        borderRadius: 12,
                        color: skin.tooltipFg,
                        fontSize: 12,
                      }}
                      cursor={{ stroke: skin.cursor }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: skin.tick }} />
                    <Area
                      type="monotone"
                      dataKey="view"
                      name={t("bizAnalyticsEvent_view")}
                      stroke={skin.neon}
                      strokeWidth={2}
                      fill="url(#bizViewFill)"
                      dot={hollowDot(skin.neon, skin.dotFill, 3)}
                      activeDot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="call"
                      name={t("bizAnalyticsEvent_call")}
                      stroke={skin.up}
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="whatsapp"
                      name={t("bizAnalyticsEvent_whatsapp")}
                      stroke="#25d366"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="directions"
                      name={t("bizAnalyticsEvent_directions")}
                      stroke={skin.mutedLine}
                      strokeWidth={2}
                      strokeDasharray="1 4"
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <RankList
                  title={t("bizAnalyticsByCurrency")}
                  rows={data?.byCurrency}
                  nameKey="currency"
                />
                <RankList title={t("bizAnalyticsByCity")} rows={data?.byCity} nameKey="city" />
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function RankList({ title, rows, nameKey }) {
  const list = Array.isArray(rows) ? rows : [];
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
        {title}
      </p>
      {list.length === 0 ? (
        <p className="text-sm text-ink-400 dark:text-ink-500">—</p>
      ) : (
        <ul className="space-y-1">
          {list.map((row) => (
            <li
              key={row[nameKey]}
              className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-1.5 text-sm dark:bg-ink-950/50"
            >
              <span className="text-ink-700 dark:text-ink-200">{row[nameKey]}</span>
              <span className="font-mono font-semibold text-ink-900 dark:text-white">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
