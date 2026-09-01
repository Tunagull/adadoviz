import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { ChevronDown, Clock, MapPin, Navigation, X } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { trackCurrencyView } from "../lib/analytics";
import { apiUrl, mediaUrl } from "../lib/api";
import { useLanguage } from "../context/LanguageContext";
import { useTheme } from "../context/ThemeContext";
import { HeaderActions } from "./HeaderActions";
import { Helmet } from "react-helmet-async";
import { buildExchangeOfficeGraphJsonLd } from "../lib/localBusinessSchema";
import { buildBusinessSlug, buildBranchSlug } from "../lib/slug";
import { ChartContainer, ChartHoverCard, ChartSwatch, ChartTooltip } from "./ui/chart";
import { chartSkin, hollowDot } from "../lib/chartTheme";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const KKTC_CENTER = [35.2281, 33.5136];

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

const PERIOD_TABS = [
  { id: "daily", labelKey: "periodDaily", apiPeriod: "Saatlik", windowMs: 24 * 60 * 60 * 1000 },
  { id: "weekly", labelKey: "periodWeekly", apiPeriod: "Günlük", windowMs: 7 * 24 * 60 * 60 * 1000 },
];

const CURRENCIES = ["USD", "EUR", "GBP"];

function roundDisplay(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

// İşletme grafiği X ekseni — DD/MM + 24 saat (AM/PM yok)
function formatAxisTime(timeMs, periodId) {
  const d = new Date(timeMs);
  if (!Number.isFinite(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  if (periodId === "daily") {
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}, ${hh}:${min}`;
  }
  return `${dd}/${mm}`;
}

// Tooltip: "31 Temmuz, 16:00" / "31 July, 16:00"
function formatTooltipTime(timeMs, localeCode = "tr-TR") {
  const d = new Date(timeMs);
  if (!Number.isFinite(d.getTime())) return "";
  const day = d.getDate();
  const monthName = d.toLocaleDateString(localeCode, { month: "long" });
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${monthName}, ${hh}:${min}`;
}

function BusinessRatesTooltip({ active, payload, label, localeCode, buyLabel, sellLabel, buyColor, sellColor }) {
  if (!active || !payload?.length) return null;
  const buy = payload.find((entry) => entry.dataKey === "finalBuy" && entry.value != null);
  const sell = payload.find((entry) => entry.dataKey === "finalSell" && entry.value != null);
  if (!buy && !sell) return null;
  return (
    <ChartHoverCard label={formatTooltipTime(label, localeCode)}>
      {buy ? (
        <div className="flex items-center gap-2 text-xs">
          <ChartSwatch label={`${buyLabel}:`} color={buyColor} />
          <span className="font-semibold tabular-nums text-ink-900 dark:text-white">
            {Number(buy.value).toFixed(4)}
          </span>
        </div>
      ) : null}
      {sell ? (
        <div className="flex items-center gap-2 text-xs">
          <ChartSwatch label={`${sellLabel}:`} color={sellColor} />
          <span className="font-semibold tabular-nums text-ink-900 dark:text-white">
            {Number(sell.value).toFixed(4)}
          </span>
        </div>
      ) : null}
    </ChartHoverCard>
  );
}

function getFaviconDomain(bankName) {
  const key = String(bankName || "").toLowerCase();
  return bankDomains[key] || "bank.com";
}

function hasValidCoords(branch) {
  return (
    branch &&
    Number.isFinite(Number(branch.lat)) &&
    Number.isFinite(Number(branch.lng))
  );
}

const WEEK_DAYS = [
  { key: "pazartesi", labelKey: "dayMon" },
  { key: "sali", labelKey: "dayTue" },
  { key: "carsamba", labelKey: "dayWed" },
  { key: "persembe", labelKey: "dayThu" },
  { key: "cuma", labelKey: "dayFri" },
  { key: "cumartesi", labelKey: "daySat" },
  { key: "pazar", labelKey: "daySun" },
];

function minutesToClock(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return null;
  const m = Math.max(0, Math.min(1440, Number(minutes)));
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function parseWorkingHours(raw) {
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      return { _legacy: raw };
    }
  }
  return null;
}

function buildWeekSchedule(workingHours, t) {
  const hours = parseWorkingHours(workingHours);
  if (!hours) return null;
  if (hours._legacy) {
    return [{ key: "legacy", label: t("workingHoursLabel"), value: hours._legacy, closed: false }];
  }
  return WEEK_DAYS.map(({ key, labelKey }) => {
    const slot = hours[key];
    const start = Array.isArray(slot) ? slot[0] : null;
    const end = Array.isArray(slot) ? slot[1] : null;
    if (start == null || end == null) {
      return { key, label: t(labelKey), value: t("workingHoursClosed"), closed: true };
    }
    const from = minutesToClock(start);
    const to = minutesToClock(end);
    return {
      key,
      label: t(labelKey),
      value: from && to ? `${from} — ${to}` : t("workingHoursNotSet"),
      closed: false,
    };
  });
}

/** JS getDay(): 0=Pazar … 6=Cumartesi → WEEK_DAYS index (Pazartesi=0) */
function getTodayWeekIndex() {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function MapUpdater({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      map.flyTo([Number(lat), Number(lng)], 15);
    }
  }, [lat, lng, map]);
  return null;
}

/**
 * İşletme Analiz Modalı — KKTC MB historical_rates + gerçek işletme marjları + şube konumları.
 */
export function BusinessDetailModal({
  business,
  onClose,
  initialBranchId = null,
  initialView = "grafik",
}) {
  const { t, lang } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const localeCode = lang === "en" ? "en-US" : "tr-TR";
  const skin = chartSkin(isDark);
  const [activeView, setActiveView] = useState(
    initialView === "konum" ? "konum" : "grafik"
  );
  const [periodId, setPeriodId] = useState("daily");
  const [currency, setCurrency] = useState("USD");
  const [chartRows, setChartRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState("");
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [hoursExpanded, setHoursExpanded] = useState(false);
  const hoursPopoverRef = useRef(null);

  const institutionId = business?.institutionId;
  const displayName = String(business?.name || "")
    .replace(/\s*\([Tt]est\)\s*/g, "")
    .trim();

  const activePeriod = PERIOD_TABS.find((t) => t.id === periodId) || PERIOD_TABS[0];

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    setHoursExpanded(false);
  }, [selectedBranch?.id, activeView]);

  useEffect(() => {
    if (!hoursExpanded) return undefined;
    const onPointerDown = (event) => {
      if (hoursPopoverRef.current && !hoursPopoverRef.current.contains(event.target)) {
        setHoursExpanded(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setHoursExpanded(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [hoursExpanded]);

  useEffect(() => {
    trackCurrencyView(currency);
  }, [currency]);

  // ✅ İşletme grafiği — İZOLE veri kaynağı: /api/business-rate-history
  // Nihai Kur = İlgili Tarihteki MB Kuru + İlgili Tarihteki İşletme Kâr Marjı
  // (Bu hesaplama backend'de yapılır; Piyasa Özeti /api/historical-rates'i kullanır ve
  // bu istekten tamamen bağımsızdır.)
  useEffect(() => {
    if (!business || !institutionId || activeView !== "grafik") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const url = apiUrl(
          `/api/business-rate-history?institution_id=${encodeURIComponent(institutionId)}&period=${encodeURIComponent(activePeriod.apiPeriod)}&currency=${currency}`
        );
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        // Backend `rates` döner; eski `rows` yanıtına da tolerans
        const rows = Array.isArray(data.rates)
          ? data.rates
          : Array.isArray(data.rows)
            ? data.rows
            : [];
        setChartRows(rows);
      } catch (err) {
        console.error("[BusinessDetailModal] Business rate history:", err);
        if (!cancelled) {
          /*
            ⚠️ TASARIM DÜZELTMESİ (D-12): Hata metni doğrudan `err.message`'tan
            geliyordu; sunucu 500 döndüğünde kullanıcı ekranda ham "HTTP 500"
            görüyordu. Hata mesajı kullanıcıya NE OLDUĞUNU ve NE YAPACAĞINI
            söylemeli — teknik ayrıntı konsola aittir, arayüze değil.
          */
          setError("Geçmiş kurlar şu anda yüklenemedi. Birazdan tekrar deneyin.");
          setChartRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business, institutionId, activePeriod.apiPeriod, currency, activeView]);

  // Şubeler (public API — institution_id slug)
  useEffect(() => {
    if (!institutionId) {
      setBranches([]);
      setSelectedBranch(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setBranchesLoading(true);
      setBranchesError("");
      try {
        const res = await fetch(
          apiUrl(`/api/institutions/${encodeURIComponent(institutionId)}/branches`)
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(data.branches) ? data.branches : [];
        setBranches(rows);
        const preferredId =
          initialBranchId != null ? String(initialBranchId) : null;
        const preferred = preferredId
          ? rows.find((b) => String(b.id) === preferredId)
          : null;
        setSelectedBranch(preferred || rows[0] || null);
      } catch (err) {
        console.error("[BusinessDetailModal] Branches:", err);
        if (!cancelled) {
          setBranches([]);
          setSelectedBranch(null);
          setBranchesError(err.message || "Şubeler alınamadı.");
        }
      } finally {
        if (!cancelled) setBranchesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [institutionId, initialBranchId]);

  // Backend zaten "Nihai Kur = MB Kuru + Kâr Marjı" formülüyle hesaplayıp
  // kronolojik sırada döndürüyor.
  // Hover sıçramasını önlemek için zaman eksenini sıklaştırırız; kur değerleri
  // ASLA uydurulmaz / mock üretilmez — yalnızca API'den gelen son bilinen
  // gerçek nokta (lastKnown) zaman adımlarına taşınır (forward-fill).
  const finalChartData = useMemo(() => {
    if (!chartRows.length) return [];

    const sorted = chartRows
      .map((row) => {
        const timeMs = new Date(row.recorded_at).getTime();
        const finalBuy = roundDisplay(row.final_buy);
        const finalSell = roundDisplay(row.final_sell);
        return {
          recorded_at: row.recorded_at,
          timeMs,
          baseBuy: Number(row.buy_rate),
          baseSell: Number(row.sell_rate),
          finalBuy,
          finalSell,
        };
      })
      .filter((row) => Number.isFinite(row.timeMs) && row.finalBuy != null && row.finalSell != null)
      .sort((a, b) => a.timeMs - b.timeMs);

    if (sorted.length <= 1) return sorted;

    const windowStart = sorted[0].timeMs;
    const windowEnd = sorted[sorted.length - 1].timeMs;
    if (!(windowEnd > windowStart)) return sorted;

    // Günlük: 5 dk; Haftalık: 30 dk — ara hover için zaman örneklemesi
    let stepMs = periodId === "daily" ? 5 * 60 * 1000 : 30 * 60 * 1000;
    const MAX_POINTS = 1500;
    const spanMs = windowEnd - windowStart;
    if (spanMs / stepMs > MAX_POINTS) {
      stepMs = Math.ceil(spanMs / MAX_POINTS);
    }

    const densified = [];
    let cursor = 0;
    let lastKnown = sorted[0];
    let iterations = 0;

    for (let t = windowStart; t <= windowEnd && iterations < MAX_POINTS; t += stepMs) {
      iterations += 1;
      while (cursor < sorted.length && sorted[cursor].timeMs <= t) {
        lastKnown = sorted[cursor];
        cursor += 1;
      }
      // finalBuy/finalSell = lastKnown (API); sadece timeMs örneklenir
      densified.push({
        recorded_at: lastKnown.recorded_at,
        timeMs: t,
        baseBuy: lastKnown.baseBuy,
        baseSell: lastKnown.baseSell,
        finalBuy: lastKnown.finalBuy,
        finalSell: lastKnown.finalSell,
        is_padded: lastKnown.timeMs !== t,
      });
    }

    const last = sorted[sorted.length - 1];
    if (!densified.length || densified[densified.length - 1].timeMs < last.timeMs) {
      densified.push({ ...last, is_padded: false });
    }

    return densified;
  }, [chartRows, periodId]);

  const yDomain = useMemo(() => {
    if (!finalChartData.length) return ["auto", "auto"];
    let min = Infinity;
    let max = -Infinity;
    for (const row of finalChartData) {
      min = Math.min(min, row.finalBuy, row.finalSell);
      max = Math.max(max, row.finalBuy, row.finalSell);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return ["auto", "auto"];
    if (Math.abs(max - min) < 0.0001) {
      const pad = Math.max(Math.abs(min) * 0.002, 0.01);
      return [min - pad, max + pad];
    }
    const pad = Math.max((max - min) * 0.08, 0.01);
    return [Number((min - pad).toFixed(4)), Number((max + pad).toFixed(4))];
  }, [finalChartData]);

  const yTicks = useMemo(() => {
    if (!Array.isArray(yDomain) || yDomain[0] === "auto") return undefined;
    const [min, max] = yDomain;
    const steps = 4;
    const ticks = [];
    for (let i = 0; i <= steps; i += 1) {
      ticks.push(min + ((max - min) * i) / steps);
    }
    return ticks;
  }, [yDomain]);

  const chartConfig = {
    finalBuy: { label: t("buy"), color: skin.neon },
    finalSell: { label: t("sell"), color: skin.mutedLine },
  };
  const xAxisTicks = useMemo(() => {
    if (finalChartData.length < 2) return undefined;
    const min = finalChartData[0].timeMs;
    const max = finalChartData[finalChartData.length - 1].timeMs;
    if (!(max > min)) return [min];
    return [min, min + (max - min) * 0.25, min + (max - min) * 0.5, min + (max - min) * 0.75, max];
  }, [finalChartData]);

  const mapCenter = hasValidCoords(selectedBranch)
    ? [Number(selectedBranch.lat), Number(selectedBranch.lng)]
    : KKTC_CENTER;

  const weekSchedule = useMemo(
    () => buildWeekSchedule(business?.workingHours ?? business?.working_hours, t),
    [business?.workingHours, business?.working_hours, t]
  );

  const localBusinessJsonLd = useMemo(() => {
    if (!business) return null;
    const bizName = displayName || business.name || "Döviz Bürosu";
    const businessSlug = buildBusinessSlug({
      institutionId: business.institutionId,
      name: bizName,
    });
    const branchNodes = (branches || []).map((branch) => ({
      ...branch,
      slug: buildBranchSlug(branch, bizName),
    }));
    return buildExchangeOfficeGraphJsonLd({
      businessName: bizName,
      businessSlug,
      workingHours: business.workingHours ?? business.working_hours,
      phone: business.phone,
      logoUrl: mediaUrl(business.logo_url),
      branches: branchNodes,
      lang,
    });
  }, [business, branches, displayName, lang]);

  const todayHours = useMemo(() => {
    if (!weekSchedule?.length) return null;
    if (weekSchedule[0]?.key === "legacy") return weekSchedule[0];
    return weekSchedule[getTodayWeekIndex()] || null;
  }, [weekSchedule]);

  const canExpandHours = Boolean(weekSchedule?.length && weekSchedule[0]?.key !== "legacy");

  const tabActiveClass =
    "rounded-md px-2.5 py-1.5 text-xs font-semibold transition border border-brand-500/40 bg-brand-500/15 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300 sm:px-3";
  const tabIdleClass =
    "rounded-md px-2.5 py-1.5 text-xs font-semibold transition border border-transparent text-ink-500 hover:text-brand-700 hover:bg-ink-100 dark:text-ink-400 dark:hover:text-brand-200 dark:hover:bg-ink-800/80 sm:px-3";

  if (!business) return null;

  const panelBody = (
    <>
        <div className="flex shrink-0 flex-col gap-2 border-b border-ink-200 px-3 py-3 dark:border-ink-800 sm:gap-3 sm:px-4">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
              <img
                src={
                  mediaUrl(business.logo_url) ||
                  `https://www.google.com/s2/favicons?domain=${getFaviconDomain(displayName || business.name)}&sz=128`
                }
                alt=""
                className="h-9 w-9 shrink-0 rounded-full bg-white p-0.5 object-cover shadow-sm"
              />
              <h2 className="truncate text-base font-semibold text-ink-900 dark:text-white sm:text-lg">
                {displayName || business.name}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>
          </div>

          <div className="flex w-full rounded-lg border border-ink-200 bg-ink-50 p-0.5 dark:border-ink-700 dark:bg-ink-950">
            <button
              type="button"
              onClick={() => setActiveView("grafik")}
              className={`min-w-0 flex-1 text-center ${activeView === "grafik" ? tabActiveClass : tabIdleClass}`}
            >
              {t("chartTabLabel")}
            </button>
            <button
              type="button"
              onClick={() => setActiveView("konum")}
              className={`min-w-0 flex-1 text-center ${activeView === "konum" ? tabActiveClass : tabIdleClass}`}
            >
              {t("businessInfoTabLabel")}
            </button>
          </div>
        </div>

        {activeView === "grafik" && (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-200 px-3 py-2.5 dark:border-ink-800 sm:px-4">
              {PERIOD_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPeriodId(tab.id)}
                  className={`press rounded-lg px-3 py-1.5 text-sm font-medium sm:px-4 sm:py-2 ${
                    periodId === tab.id
                      ? "border border-brand-500/40 bg-brand-500/15 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                      : "border border-transparent text-ink-500 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-ink-800/80 dark:hover:text-white"
                  }`}
                >
                  {t(tab.labelKey)}
                </button>
              ))}
              <div className="mx-1 hidden h-6 w-px bg-ink-200 dark:bg-ink-700 sm:block" />
              {CURRENCIES.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    setCurrency(code);
                    trackCurrencyView(code);
                  }}
                  /*
                    ⚠️ TASARIM DÜZELTMESİ (D-11): Bu modalın tek bir satırında
                    ÜÇ farklı "aktif sekme" dili vardı — görünüm sekmeleri soluk
                    mavi dolgu, dönem sekmeleri marka tonu, para birimi
                    sekmeleri ise neredeyse SİYAH dolgu. Siyah, uygulamanın
                    başka hiçbir yerinde kullanılmayan bir renkti; üç kontrol
                    yan yana dururken ayrı tasarım sistemlerinden gelmiş gibi
                    okunuyordu.

                    Artık üçü de aynı marka tonunu kullanıyor. Boyut farkı
                    (bunlar daha küçük) hiyerarşiyi zaten anlatıyor; ikinci bir
                    renk diline gerek yok.
                  */
                  className={`press rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                    currency === code
                      ? "border border-brand-500/40 bg-brand-500/15 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                      : "border border-transparent bg-ink-100 text-ink-500 hover:text-ink-800 dark:bg-ink-800 dark:text-ink-400 dark:hover:text-white"
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>

            <div className="flex min-h-[280px] flex-1 flex-col overflow-hidden px-3 py-3 sm:min-h-0 sm:px-4 md:min-h-[420px]">
              <div className="min-h-[260px] w-full flex-1 rounded-xl border border-ink-200 bg-ink-50 p-2 dark:border-ink-800 dark:bg-ink-950/60 sm:min-h-0">
                {loading ? (
                  <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-ink-500 dark:text-ink-400">
                    {t("loadingGeneric")}
                  </div>
                ) : error ? (
                  <div className="flex h-full min-h-[280px] items-center justify-center px-4 text-center text-sm text-danger-700 dark:text-danger-300">
                    {error}
                  </div>
                ) : finalChartData.length === 0 ? (
                  <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-1 px-4 text-center text-sm text-ink-500 dark:text-ink-400">
                    <span>{t("businessChartInsufficientData")}</span>
                    <span className="text-xs text-ink-600 dark:text-ink-400">
                      {t("businessChartWillBuild")}
                    </span>
                  </div>
                ) : (
                  <ChartContainer
                    config={chartConfig}
                    className="aspect-auto h-full min-h-[260px] w-full [&_.recharts-curve.recharts-tooltip-cursor]:stroke-ink-300 dark:[&_.recharts-curve.recharts-tooltip-cursor]:stroke-white/20"
                  >
                    <ComposedChart data={finalChartData} margin={{ top: 8, right: 15, left: 5, bottom: 5 }}>
                      <defs>
                        <linearGradient id="bizBuyFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={skin.neon} stopOpacity={isDark ? 0.3 : 0.22} />
                          <stop offset="100%" stopColor={skin.neon} stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="4 4"
                        stroke={skin.grid}
                        strokeOpacity={1}
                        horizontal
                        vertical={false}
                      />
                      <XAxis
                        dataKey="timeMs"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        scale="time"
                        ticks={xAxisTicks}
                        tick={{ fill: skin.tick, fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={40}
                        tickMargin={8}
                        tickFormatter={(ms) => formatAxisTime(ms, periodId)}
                      />
                      <YAxis
                        domain={yDomain}
                        ticks={yTicks}
                        tick={{ fill: skin.tick, fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        tickMargin={8}
                        tickFormatter={(v) => Number(v).toFixed(2)}
                      />
                      <ChartTooltip
                        content={
                          <BusinessRatesTooltip
                            localeCode={localeCode}
                            buyLabel={t("buy")}
                            sellLabel={t("sell")}
                            buyColor={skin.neon}
                            sellColor={skin.mutedLine}
                          />
                        }
                        cursor={{
                          stroke: skin.cursor,
                          strokeWidth: 1,
                          strokeDasharray: "none",
                        }}
                      />
                      <Area
                        type="linear"
                        dataKey="finalBuy"
                        name="finalBuy"
                        stroke="transparent"
                        fill="url(#bizBuyFill)"
                        strokeWidth={0}
                        dot={false}
                        isAnimationActive={false}
                        legendType="none"
                      />
                      <Line
                        type="linear"
                        dataKey="finalBuy"
                        name="finalBuy"
                        stroke={skin.neon}
                        strokeWidth={2}
                        dot={finalChartData.length <= 16 ? hollowDot(skin.neon, skin.dotFill) : false}
                        activeDot={hollowDot(skin.neon, skin.dotFill)}
                        isAnimationActive={false}
                      />
                      <Line
                        type="linear"
                        dataKey="finalSell"
                        name="finalSell"
                        stroke={skin.mutedLine}
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={
                          finalChartData.length <= 16
                            ? hollowDot(skin.mutedLine, skin.dotFill)
                            : false
                        }
                        activeDot={hollowDot(skin.mutedLine, skin.dotFill)}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ChartContainer>
                )}
              </div>
            </div>
          </>
        )}

        {activeView === "konum" && (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-4 md:grid-cols-3 md:overflow-hidden md:min-h-[400px]">
            <div className="col-span-1 flex min-h-0 flex-col gap-3 overflow-y-auto md:max-h-full">
              <div className="shrink-0 rounded-xl border border-ink-200 bg-ink-50 p-3 dark:border-ink-800 dark:bg-ink-950/60">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-ink-600">
                  <MapPin size={12} className="shrink-0 text-brand-600 dark:text-brand-400" />
                  {t("branchesLabel")}
                </p>
                {branchesLoading ? (
                  <p className="py-4 text-center text-sm text-ink-500 dark:text-ink-400">{t("branchesLoading")}</p>
                ) : branchesError ? (
                  <p className="py-4 text-center text-sm text-danger-700 dark:text-danger-300">{branchesError}</p>
                ) : branches.length === 0 ? (
                  <p className="py-4 text-center text-sm text-ink-500 dark:text-ink-400">
                    {t("branchesEmpty")}
                  </p>
                ) : (
                  <ul className="max-h-[9.5rem] space-y-1.5 overflow-y-auto overscroll-contain pr-0.5">
                    {branches.map((branch) => {
                      const selected = selectedBranch?.id === branch.id;
                      return (
                        <li key={branch.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedBranch(branch)}
                            title={branch.name}
                            className={`w-full truncate rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-all duration-300 ${
                              selected
                                ? "border-brand-500/50 bg-brand-500/10 text-brand-700 shadow-[0_0_12px_rgba(45,212,191,0.2)] dark:text-brand-300"
                                : "border-ink-200 bg-white text-ink-700 hover:border-brand-500/40 hover:text-brand-700 dark:border-white/10 dark:bg-ink-950/60 dark:text-ink-200 dark:hover:text-brand-200"
                            }`}
                          >
                            {branch.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {selectedBranch ? (
                <div className="min-h-0 shrink-0 rounded-xl border border-ink-200 bg-white p-4 shadow-lg dark:border-ink-700 dark:bg-ink-900/90 md:overflow-y-auto">
                  <h3 className="mb-3 truncate text-sm font-semibold text-ink-900 dark:text-white">
                    {selectedBranch.name}
                  </h3>
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="text-[10px] tracking-wide text-ink-600">
                        {t("addressLabelShort")}
                      </dt>
                      <dd className="mt-0.5 break-words text-ink-700 dark:text-ink-200">
                        {selectedBranch.address || t("workingHoursNotSet")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] tracking-wide text-ink-600">
                        {t("phoneLabelShort")}
                      </dt>
                      <dd className="mt-0.5 text-ink-700 dark:text-ink-200">
                        {selectedBranch.phone ? (
                          <a
                            href={`tel:${String(selectedBranch.phone).replace(/\s/g, "")}`}
                            className="text-brand-700 hover:underline dark:text-brand-300"
                          >
                            {selectedBranch.phone}
                          </a>
                        ) : (
                          t("workingHoursNotSet")
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] tracking-wide text-ink-600">
                        {t("whatsappLabelShort")}
                      </dt>
                      <dd className="mt-0.5 text-ink-700 dark:text-ink-200">
                        {selectedBranch.whatsapp ? (
                          <a
                            href={`https://wa.me/${String(selectedBranch.whatsapp).replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-700 hover:underline dark:text-brand-300"
                          >
                            {selectedBranch.whatsapp}
                          </a>
                        ) : (
                          t("workingHoursNotSet")
                        )}
                      </dd>
                    </div>
                    <div ref={hoursPopoverRef} className="relative">
                      <dt className="mb-1.5 text-[10px] tracking-wide text-ink-600">
                        {t("workingHoursLabel")}
                      </dt>
                      <dd>
                        {!todayHours ? (
                          <span className="text-ink-700 dark:text-ink-200">
                            {t("workingHoursNotSet")}
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => canExpandHours && setHoursExpanded((v) => !v)}
                              disabled={!canExpandHours}
                              aria-expanded={hoursExpanded}
                              title={canExpandHours ? t("viewWeeklySchedule") : undefined}
                              className={`flex w-full items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-2.5 py-2 text-left transition dark:border-ink-800 dark:bg-ink-950/50 ${
                                canExpandHours
                                  ? "hover:border-brand-500/40 hover:bg-brand-500/5 cursor-pointer"
                                  : "cursor-default"
                              }`}
                            >
                              <Clock
                                size={14}
                                className="shrink-0 text-brand-600 dark:text-brand-400"
                              />
                              <span
                                className={`min-w-0 flex-1 truncate text-xs font-medium ${
                                  todayHours.closed
                                    ? "text-danger-700 dark:text-danger-400/90"
                                    : "text-ink-800 dark:text-ink-100"
                                }`}
                              >
                                {todayHours.key === "legacy"
                                  ? todayHours.value
                                  : `${todayHours.label} ${todayHours.value}`}
                              </span>
                              {canExpandHours ? (
                                <ChevronDown
                                  size={14}
                                  className={`shrink-0 text-ink-600 dark:text-ink-400 transition-transform duration-200 ${
                                    hoursExpanded ? "rotate-180" : ""
                                  }`}
                                />
                              ) : null}
                            </button>

                            {hoursExpanded && canExpandHours ? (
                              <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-dropdown overflow-hidden rounded-xl border border-ink-200 bg-white p-2 shadow-xl shadow-ink-900/10 ring-1 ring-black/5 dark:border-ink-700 dark:bg-ink-900 dark:shadow-black/40 dark:ring-white/5">
                                <p className="mb-1.5 px-1.5 text-[10px] font-semibold tracking-wide text-ink-600 dark:text-ink-400">
                                  {t("weeklyHoursTitle")}
                                </p>
                                <ul className="max-h-52 space-y-0.5 overflow-y-auto">
                                  {weekSchedule.map((row) => {
                                    const isToday = row.key === todayHours.key;
                                    return (
                                      <li
                                        key={row.key}
                                        className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs ${
                                          isToday
                                            ? "bg-brand-500/10 text-brand-800 dark:text-brand-200"
                                            : "text-ink-600 dark:text-ink-300"
                                        }`}
                                      >
                                        <span
                                          className={
                                            isToday
                                              ? "font-semibold"
                                              : "text-ink-500 dark:text-ink-400"
                                          }
                                        >
                                          {row.label}
                                        </span>
                                        <span
                                          className={
                                            row.closed
                                              ? "font-medium text-danger-700 dark:text-danger-400/90"
                                              : "font-medium tabular-nums"
                                          }
                                        >
                                          {row.value}
                                        </span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            ) : null}
                          </>
                        )}
                      </dd>
                    </div>
                  </dl>
                  {hasValidCoords(selectedBranch) ? (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${selectedBranch.lat},${selectedBranch.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-500/20 dark:text-brand-300"
                    >
                      <Navigation size={16} />
                      {t("getDirectionsBtn")}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="relative col-span-1 min-h-[280px] overflow-hidden rounded-xl border border-ink-200 bg-ink-100 dark:border-ink-800 dark:bg-ink-950 md:col-span-2 md:min-h-0">
              {!selectedBranch ? (
                <div className="flex h-full items-center justify-center text-sm text-ink-500 dark:text-ink-400">
                  {t("selectBranchForMap")}
                </div>
              ) : !hasValidCoords(selectedBranch) ? (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-ink-500 dark:text-ink-400">
                  {t("branchNoCoords")}
                </div>
              ) : (
                <>
                  <MapContainer
                    key={`map-${institutionId}`}
                    center={mapCenter}
                    zoom={15}
                    scrollWheelZoom
                    className="h-full min-h-[280px] w-full md:min-h-full"
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapUpdater lat={selectedBranch.lat} lng={selectedBranch.lng} />
                    <Marker position={[Number(selectedBranch.lat), Number(selectedBranch.lng)]} />
                  </MapContainer>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedBranch.lat},${selectedBranch.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute bottom-3 right-3 z-overlay inline-flex items-center gap-2 rounded-lg border border-brand-500/40 bg-white/95 px-3 py-2 text-xs font-semibold text-brand-700 shadow-lg backdrop-blur transition hover:border-brand-400 dark:bg-ink-950/90 dark:text-brand-300"
                  >
                    <Navigation size={14} />
                    {t("getDirectionsBtn")}
                  </a>
                </>
              )}
            </div>
          </div>
        )}
    </>
  );

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-end justify-center p-0 sm:items-center sm:p-3 md:p-4">
      {localBusinessJsonLd ? (
        <Helmet>
          <script type="application/ld+json">{JSON.stringify(localBusinessJsonLd)}</script>
        </Helmet>
      ) : null}
      <button
        type="button"
        aria-label="Kapat"
        className="absolute inset-0 bg-ink-950/40 backdrop-blur-md dark:bg-ink-950/80"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={displayName || business.name}
        className="relative z-raised flex h-[min(94dvh,94vh)] max-h-[min(94dvh,94vh)] w-full max-w-5xl flex-col overflow-hidden rounded-t-card border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900 dark:shadow-black/50 sm:h-[90vh] sm:max-h-[90vh] sm:w-[95%] sm:rounded-card md:w-full"
      >
        {panelBody}
      </div>
    </div>,
    document.body
  );
}
