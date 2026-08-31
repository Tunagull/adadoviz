import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Helmet } from "react-helmet-async";
import {
  Search,
  TrendingUp,
  TrendingDown,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  X,
  Clock,
  SlidersHorizontal,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { V0BankCard } from "./V0BankCard";
import { Sheet } from "./Sheet";
import { BusinessLoginModal } from "./BusinessLoginModal";
import { SearchableSelect } from "./SearchableSelect";
import { HeaderActions } from "./HeaderActions";
import { BrandLogo } from "./BrandLogo";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { trackBusinessClick, trackCurrencyView } from "../lib/analytics";
import { apiUrl, ratesStreamUrl } from "../lib/api";
import { buildBranchSlug, buildBusinessSlug, exchangeOfficePath } from "../lib/slug";

/** P-04: bilgilendirici log yalnızca geliştirmede. */
const devLog = (...args) => {
  if (import.meta.env.DEV) console.log(...args);
};


const SEO_SITE_URL = "https://adadoviz.tunahangul.com";

function buildCurrencyConversionJsonLd({ lang, banksCount }) {
  const isEn = lang === "en";
  return {
    "@context": "https://schema.org",
    "@type": "CurrencyConversionService",
    name: isEn ? "AdaDöviz KKTC Live Exchange Rates & Converter" : "AdaDöviz KKTC Canlı Döviz Kurları ve Çevirici",
    description: isEn
      ? "Compare live USD, EUR and GBP exchange rates across Northern Cyprus (KKTC) exchange offices and convert currencies instantly."
      : "Kuzey Kıbrıs (KKTC) döviz bürolarının güncel USD, EUR ve GBP kurlarını karşılaştırın; anında döviz çevirisi yapın.",
    url: `${SEO_SITE_URL}/`,
    provider: {
      "@type": "Organization",
      name: "AdaDöviz",
      url: `${SEO_SITE_URL}/`,
      logo: `${SEO_SITE_URL}/adadoviz-mark.svg`,
    },
    areaServed: {
      "@type": "Place",
      name: isEn ? "Northern Cyprus (KKTC)" : "Kuzey Kıbrıs (KKTC)",
    },
    serviceType: "Currency exchange rate comparison",
    availableChannel: {
      "@type": "ServiceChannel",
      serviceUrl: `${SEO_SITE_URL}/`,
      availableLanguage: ["tr", "en"],
    },
    ...(Number.isFinite(banksCount) && banksCount > 0
      ? { offerCount: banksCount }
      : {}),
  };
}

function buildFinancialProductJsonLd(lang) {
  const isEn = lang === "en";
  return {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: isEn ? "KKTC Exchange Rate Comparison" : "KKTC Döviz Kuru Karşılaştırma",
    description: isEn
      ? "Live FX rates for USD/TRY, EUR/TRY and GBP/TRY based on Central Bank of Northern Cyprus reference rates."
      : "KKTC Merkez Bankası referans kurlarına dayalı canlı USD/TRY, EUR/TRY ve GBP/TRY döviz kurları.",
    url: `${SEO_SITE_URL}/`,
    category: "ExchangeRate",
    brand: {
      "@type": "Brand",
      name: "AdaDöviz",
    },
    areaServed: {
      "@type": "AdministrativeArea",
      name: isEn ? "Northern Cyprus" : "Kuzey Kıbrıs Türk Cumhuriyeti",
    },
  };
}

/**
 * ✅ Piyasa Özeti Kartı - Gerçek Geçmiş Veri Grafiği ve SSE Canlı Güncellemeleri
 */
function MarketSummaryCard({ currency = 'USD', period = 'Günlük' }) {
  const { theme } = useTheme();
  const { t, lang } = useLanguage();
  const localeCode = lang === "en" ? "en-US" : "tr-TR";
  const isDark = theme === "dark";
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dataInfo, setDataInfo] = useState(null);
  const [timeOffset, setTimeOffset] = useState(0); // Kaydırılabilir zaman penceresi (0 = güncel aralık)
  const [isModalOpen, setIsModalOpen] = useState(false); // ✅ Tam ekran grafik paneli
  const [customDateRange, setCustomDateRange] = useState({ start: null, end: null });

  // ✅ Offset + özel tarih seçimini period değişince sıfırla
  useEffect(() => {
    setTimeOffset(0);
    setCustomDateRange({ start: null, end: null });
  }, [period]);

  // ✅ Modal açıkken arka plan scroll kilidi
  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen]);

  // ✅ Basit fetch, period/currency değişince yenile
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const url = apiUrl(`/api/historical-rates?period=${period}&currency=${currency}`);
        const res = await fetch(url);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        setRates(data.rates || []);
        setDataInfo(data.meta || null);
        setError(null);
        setLoading(false);
      } catch (err) {
        console.error(`[Chart] ${currency} ${period}:`, err.message);
        setError(err.message);
        setRates([]);
        setDataInfo(null);
        setLoading(false);
      }
    };

    fetchData();
    trackCurrencyView(currency);
    const interval = setInterval(fetchData, 300000); // 5 dakika
    return () => clearInterval(interval);
  }, [currency, period]);

  // ✅ Hatalı verileri filtrele, tarihe göre kesin sırala, timeMs ekle + Saatlik forward-fill
  const chartData = useMemo(() => {
    if (!rates || rates.length === 0) return [];

    // Temel geçerlilik: pozitif olmayan/boş değerleri ele (0, null, negatif)
    const basicValid = rates.filter(r => r.buy_rate > 0 && r.sell_rate > 0);
    let sortedRates = [...basicValid].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

    // Komşu-bazlı anomali filtresi (mock fallback gibi ani sıçramaları ele)
    // Saatlik: dar bant (±%15). Diğerleri: geniş bant (yıllar arası gerçek trend için).
    const isIntraday = period === 'Saatlik';
    const lowerBound = isIntraday ? 0.85 : 0.5;
    const upperBound = isIntraday ? 1.15 : 2;

    sortedRates = sortedRates.filter((r, idx, arr) => {
      const prev = arr[idx - 1]?.buy_rate;
      const next = arr[idx + 1]?.buy_rate;
      const neighbors = [prev, next].filter((v) => typeof v === 'number' && v > 0);
      if (neighbors.length === 0) return true;
      const avgNeighbor = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
      return r.buy_rate > avgNeighbor * lowerBound && r.buy_rate < avgNeighbor * upperBound;
    });

    // ✅ SAATLİK: Ham noktaları sakla; yoğun saatlik doldurma displayChartData'da yapılır
    return sortedRates
      .map((rate) => {
        const timeMs = new Date(rate.recorded_at).getTime();
        return {
          timeMs,
          buy: rate.buy_rate,
          sell: rate.sell_rate,
          mid: (rate.buy_rate + rate.sell_rate) / 2,
          recorded_at: rate.recorded_at,
          buy_rate: rate.buy_rate,
          sell_rate: rate.sell_rate,
        };
      })
      .filter((rate) => Number.isFinite(rate.timeMs));
  }, [rates, period]);

  const oldestDataTime = chartData.length > 0 ? chartData[0].timeMs : null;
  const newestDataTime = chartData.length > 0 ? chartData[chartData.length - 1].timeMs : null;

  /** Periyot kaydırma adımı (ms) — sol/sağ ok her tıkta bu kadar geri/ileri gider */
  const periodStepMs = useMemo(() => {
    const day = 24 * 60 * 60 * 1000;
    switch (period) {
      case "Yıllık":
        return 365 * day;
      case "Aylık":
        return 30 * day;
      case "Haftalık":
        return 7 * day;
      case "Günlük":
        return 1 * day;
      case "Saatlik":
      default:
        return 1 * day; // 24 saatlik pencere, 1 gün kaydır
    }
  }, [period]);

  /** Görünür pencere genişliği (ms) */
  const viewSpanMs = useMemo(() => {
    const day = 24 * 60 * 60 * 1000;
    switch (period) {
      case "Yıllık":
        return 365 * day;
      case "Aylık":
        return 30 * day;
      case "Haftalık":
        return 7 * day;
      case "Günlük":
        return 1 * day;
      case "Saatlik":
      default:
        return 1 * day;
    }
  }, [period]);

  /**
   * En eski veriye ulaşınca sol ok kilitlensin.
   * maxOffset: windowStart'ın oldestDataTime'ın altına INMEMESİ için üst sınır.
   */
  const maxTimeOffset = useMemo(() => {
    if (!Number.isFinite(oldestDataTime)) return 0;
    const nowMs = Date.now();
    // offset=0 iken end≈now, start≈now-viewSpan
    // offset arttıkça end/start geri kayar; start >= oldest olmalı
    // start ≈ now - viewSpan - offset*step  >= oldest
    // offset <= (now - viewSpan - oldest) / step
    const room = nowMs - viewSpanMs - oldestDataTime;
    if (!(room > 0)) return 0;
    return Math.max(0, Math.floor(room / periodStepMs));
  }, [oldestDataTime, viewSpanMs, periodStepMs]);

  // Veri yüklendikten / periyot değiştikten sonra offset arşiv dışına taşmasın
  useEffect(() => {
    setTimeOffset((prev) => Math.min(prev, maxTimeOffset));
  }, [maxTimeOffset, currency, period]);

  // ✅ Tüm periyotlar: kesin takvim (Calendar Date) kaydırması + özel tarih clamp
  const timeWindow = useMemo(() => {
    const nowMs = Date.now();
    const safeOffset = Math.min(Math.max(0, timeOffset), maxTimeOffset);

    const endDate = new Date(nowMs);
    const startDate = new Date(nowMs);

    switch (period) {
      case "Yıllık":
        endDate.setFullYear(endDate.getFullYear() - safeOffset);
        startDate.setTime(endDate.getTime());
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case "Aylık":
        endDate.setMonth(endDate.getMonth() - safeOffset);
        startDate.setTime(endDate.getTime());
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case "Haftalık":
        endDate.setDate(endDate.getDate() - safeOffset * 7);
        startDate.setTime(endDate.getTime());
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "Günlük":
        endDate.setDate(endDate.getDate() - safeOffset);
        startDate.setTime(endDate.getTime());
        startDate.setDate(startDate.getDate() - 1);
        break;
      case "Saatlik":
      default:
        endDate.setHours(endDate.getHours() - safeOffset * 24);
        startDate.setTime(endDate.getTime());
        startDate.setHours(startDate.getHours() - 24);
        break;
    }

    let defaultEnd = endDate.getTime();
    let defaultStart = startDate.getTime();

    // Geçersiz custom tarihler yok sayılır
    const rawStart = Number.isFinite(customDateRange.start) ? customDateRange.start : null;
    const rawEnd = Number.isFinite(customDateRange.end) ? customDateRange.end : null;

    let actualStart = rawStart != null ? Math.min(rawStart, nowMs) : defaultStart;
    let actualEnd = rawEnd != null ? Math.min(rawEnd, nowMs) : defaultEnd;

    if (!Number.isFinite(actualStart) || !Number.isFinite(actualEnd)) {
      actualStart = defaultStart;
      actualEnd = defaultEnd;
    }

    // Bitiş < başlangıç → güvenli default
    if (actualEnd < actualStart) {
      actualStart = defaultStart;
      actualEnd = defaultEnd;
    }

    let windowStart = actualStart;
    let windowEnd = actualEnd;

    // Özel aralık çok genişse max 6 yıl
    const MAX_CUSTOM_SPAN_MS = 6 * 365.25 * 24 * 60 * 60 * 1000;
    if (windowEnd - windowStart > MAX_CUSTOM_SPAN_MS) {
      windowStart = windowEnd - MAX_CUSTOM_SPAN_MS;
    }

    // ⚠️ KRİTİK: Pencereyi arşiv sınırlarının DIŞINA çıkarma.
    // Aksi halde displayChartData boş kalır → tüm kart "Veri yok" olur ve oklar kaybolur.
    if (Number.isFinite(oldestDataTime) && Number.isFinite(newestDataTime)) {
      const span = Math.max(windowEnd - windowStart, 1);
      if (windowEnd < oldestDataTime) {
        // Tamamen veriden önce → en eski görünüme yapıştır
        windowStart = oldestDataTime;
        windowEnd = Math.min(nowMs, oldestDataTime + span);
      } else if (windowStart < oldestDataTime) {
        windowStart = oldestDataTime;
        if (windowEnd <= windowStart) {
          windowEnd = Math.min(nowMs, windowStart + span);
        }
      }
      if (windowStart > newestDataTime) {
        windowEnd = Math.min(nowMs, newestDataTime);
        windowStart = Math.max(oldestDataTime, windowEnd - span);
      }
    }

    const span = Math.max(windowEnd - windowStart, 1);
    // Sol ok: bir adım daha geri gitmek start'ı oldest'in altına iterse kilitli
    const isLeftDisabled =
      !Number.isFinite(oldestDataTime) ||
      safeOffset >= maxTimeOffset ||
      windowStart <= oldestDataTime + 1000; // 1sn tolerans

    return {
      windowStart,
      windowEnd,
      oldestDataTime: oldestDataTime ?? nowMs,
      newestDataTime: newestDataTime ?? nowMs,
      isLeftDisabled,
      isInvalidCustomRange: false,
      maxTimeOffset,
      customTicks: [
        windowStart,
        windowStart + span * 0.25,
        windowStart + span * 0.5,
        windowStart + span * 0.75,
        windowEnd,
      ],
    };
  }, [
    period,
    timeOffset,
    maxTimeOffset,
    oldestDataTime,
    newestDataTime,
    customDateRange,
  ]);

  // Inputlar için YYYY-MM-DD (timezone kaymasını önlemek için yerel zaman)
  // Ham custom değer gösterilir (klavye yazımını bozmamak için); grafik clamp'i timeWindow'da
  const formatForInput = (ms) => {
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split("T")[0];
  };

  const startDateStr = formatForInput(
    customDateRange.start != null && Number.isFinite(customDateRange.start)
      ? customDateRange.start
      : timeWindow.windowStart
  );
  const endDateStr = formatForInput(
    customDateRange.end != null && Number.isFinite(customDateRange.end)
      ? customDateRange.end
      : timeWindow.windowEnd
  );
  const todayStr = formatForInput(Date.now());

  const parseDateInputToMs = (value) => {
    if (!value || typeof value !== "string" || value.length < 10) return null;
    // type="date" YYYY-MM-DD → yerel gece yarısı (UTC parse kaymasını önle)
    const d = new Date(`${value}T00:00:00`);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  };

  // ✅ Pencere filtresi + tüm periyotlarda yoğun forward-fill (ara değer / kopukluk giderilir)
  const displayChartData = useMemo(() => {
    const { windowStart, windowEnd, isInvalidCustomRange } = timeWindow;
    if (!chartData.length) return [];
    if (isInvalidCustomRange) return [];

    // Invalid / ters aralık → döngüye hiç girme (OOM / infinite loop koruması)
    if (
      !Number.isFinite(windowStart) ||
      !Number.isFinite(windowEnd) ||
      windowEnd < windowStart
    ) {
      return [];
    }

    const sortedRates = [...chartData].sort((a, b) => a.timeMs - b.timeMs);
    // Geçmiş pencerede Date.now() ile kesme — aksi halde endCap < windowStart olup boş dönerdi
    const endCap = windowEnd;
    if (!Number.isFinite(endCap) || endCap < windowStart) return [];

    // Periyoda göre adım: Günlük/Saatlik → 1 saat; Haftalık → 6 saat; Aylık/Yıllık → 1 gün
    let stepMs =
      period === "Saatlik" || period === "Günlük"
        ? 60 * 60 * 1000
        : period === "Haftalık"
          ? 6 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;

    if (!Number.isFinite(stepMs) || stepMs <= 0) return [];

    // Nokta sayısı üst sınırı: aşılırsa adımı büyüt (Recharts + bellek güvenliği)
    const MAX_POINTS = 2500;
    const spanMs = endCap - windowStart;
    if (spanMs / stepMs > MAX_POINTS) {
      stepMs = Math.ceil(spanMs / MAX_POINTS);
    }

    const startAligned = Math.floor(windowStart / stepMs) * stepMs;
    if (!Number.isFinite(startAligned)) return [];

    const processedData = [];
    let cursor = 0;

    // İleri taşıma için pencere öncesi son bilinen nokta
    let lastKnown = null;
    for (let i = 0; i < sortedRates.length; i++) {
      if (sortedRates[i].timeMs <= windowStart) {
        lastKnown = sortedRates[i];
        cursor = i;
      } else {
        break;
      }
    }

    // Sert üst sınır: t += stepMs ile sonsuz döngü / OOM imkânsız
    let iterations = 0;
    for (let t = startAligned; t <= endCap && iterations < MAX_POINTS; t += stepMs) {
      iterations += 1;
      if (!Number.isFinite(t)) break;
      if (t < windowStart) continue;
      while (cursor < sortedRates.length && sortedRates[cursor].timeMs <= t) {
        lastKnown = sortedRates[cursor];
        cursor += 1;
      }
      const source = lastKnown || sortedRates[0];
      if (!source) continue;
      processedData.push({
        timeMs: t,
        buy: source.buy ?? source.buy_rate,
        sell: source.sell ?? source.sell_rate,
        mid:
          source.mid ??
          ((source.buy ?? source.buy_rate) + (source.sell ?? source.sell_rate)) / 2,
        is_padded: source.timeMs !== t,
      });
    }

    // Son noktayı pencere sonuna sabitle
    if (processedData.length > 0) {
      const last = processedData[processedData.length - 1];
      if (last.timeMs < endCap) {
        processedData.push({
          ...last,
          timeMs: endCap,
          is_padded: true,
        });
      }
    }

    // Hâlâ boşsa (kenar durum): en az 2 nokta ile güvenli seri üret — kart "Veri yok"a düşmesin
    if (processedData.length === 0 && sortedRates.length > 0) {
      const src = lastKnown || sortedRates[0];
      processedData.push(
        {
          timeMs: windowStart,
          buy: src.buy ?? src.buy_rate,
          sell: src.sell ?? src.sell_rate,
          mid: src.mid ?? ((src.buy ?? src.buy_rate) + (src.sell ?? src.sell_rate)) / 2,
          is_padded: true,
        },
        {
          timeMs: endCap,
          buy: src.buy ?? src.buy_rate,
          sell: src.sell ?? src.sell_rate,
          mid: src.mid ?? ((src.buy ?? src.buy_rate) + (src.sell ?? src.sell_rate)) / 2,
          is_padded: true,
        }
      );
    }

    return processedData;
  }, [chartData, timeWindow, period]);

  // ✅ Yüzde: çizilen seri (buy) ile aynı kaynak — mid kullanmak yükselen buy + düşen mid'de yanlış kırmızı üretir
  const displayPercentage = useMemo(() => {
    if (displayChartData.length < 2) return 0;
    const firstPoint = displayChartData[0];
    const lastPoint = displayChartData[displayChartData.length - 1];
    const firstVal = Number(firstPoint.buy ?? firstPoint.mid);
    const lastVal = Number(lastPoint.buy ?? lastPoint.mid);
    if (!(firstVal > 0) || !Number.isFinite(lastVal)) return 0;
    return ((lastVal - firstVal) / firstVal) * 100;
  }, [displayChartData]);

  // Google Finance stili: pozitif yeşil, negatif kırmızı (+ aynı gradient gölge)
  const strokeColor = displayPercentage >= 0 ? "#10b981" : "#f43f5e";
  const gradientId = `colorValue-${currency}`;

  // ✅ Domain: her zaman aktif zaman penceresi
  const chartDomain = useMemo(
    () => [timeWindow.windowStart, timeWindow.windowEnd],
    [timeWindow]
  );

  // ✅ Sabit domain üzerinde eşit aralıklı 5 tick
  const xAxisTicks = useMemo(() => timeWindow.customTicks, [timeWindow]);

  // Eşit aralıklı Y ekseni (Recharts'ın düzensiz "nice" tick'lerini bypass)
  const yAxisConfig = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const row of displayChartData) {
      const v = Number(row.buy);
      if (!Number.isFinite(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] };
    }
    if (Math.abs(max - min) < 0.0001) {
      const pad = Math.max(Math.abs(min) * 0.002, 0.01);
      min -= pad;
      max += pad;
    } else {
      const pad = (max - min) * 0.06;
      min -= pad;
      max += pad;
    }
    const steps = 4;
    const ticks = [];
    for (let i = 0; i <= steps; i += 1) {
      ticks.push(min + ((max - min) * i) / steps);
    }
    return { domain: [min, max], ticks };
  }, [displayChartData]);

  // Kart üstü tarih aralığı etiketi (Gün Ay Yıl)
  const formatHeaderDate = (ms) => {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString(localeCode, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // ✅ X ekseni: DD/MM + 24 saat (AM/PM yok)
  const formatXAxis = (ms) => {
    if (!ms) return "";
    const d = new Date(ms);
    if (isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    if (period === "Saatlik" || period === "Günlük") {
      const hh = String(d.getHours()).padStart(2, "0");
      return `${dd}/${mm}, ${hh}:00`;
    }
    if (period === "Yıllık") {
      return d.toLocaleDateString(localeCode, { month: "short", year: "numeric" });
    }
    return `${dd}/${mm}`;
  };

  const formatChartTooltipLabel = (ms) => {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "";
    const day = d.getDate();
    const monthName = d.toLocaleDateString(localeCode, { month: "long" });
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${day} ${monthName}, ${hh}:${min}`;
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-ink-200 bg-white p-4 backdrop-blur-md h-32 flex items-center justify-center dark:border-ink-800 dark:bg-ink-900/80">
        <p className="text-xs text-ink-500 dark:text-ink-400">{t("loadingGeneric")}</p>
      </div>
    );
  }

  // Yalnızca gerçekten hiç rate yoksa "Veri yok" — navigasyon sonrası boş pencere kartı öldürmesin
  if (error || chartData.length === 0) {
    return (
      <div className="rounded-xl border border-ink-200 bg-white p-4 backdrop-blur-md h-32 flex items-center justify-center dark:border-ink-800 dark:bg-ink-900/80">
        <p className="text-xs text-ink-500 dark:text-ink-400">{error ? `❌ ${error}` : t("chartNoData")}</p>
      </div>
    );
  }

  if (displayChartData.length === 0) {
    return (
      <div className="rounded-xl border border-ink-200 bg-white p-4 backdrop-blur-md h-32 flex items-center justify-center dark:border-ink-800 dark:bg-ink-900/80">
        <p className="text-xs text-ink-500 dark:text-ink-400">{t("chartNoPointsInRange")}</p>
      </div>
    );
  }

  const last = displayChartData[displayChartData.length - 1].buy;
  const change = Number(displayPercentage).toFixed(2);
  const isPositive = parseFloat(change) >= 0;

  const gridStroke = isDark ? "#1e293b" : "#e2e8f0";
  const axisStroke = isDark ? "#334155" : "#cbd5e1";
  const tickFill = isDark ? "#94a3b8" : "#64748b";
  const tooltipBg = isDark ? "#0f172a" : "#ffffff";
  const tooltipColor = isDark ? "#fff" : "#0f172a";
  const tooltipBorder = isDark ? "none" : "1px solid #e2e8f0";
  const areaOpacity = isDark ? 0.3 : 0.18;
  // ✅ DRY: Aynı grafik hem küçük kartta hem tam ekran modalda kullanılır
  const renderChartContent = (isExpanded = false) => {
    const tickFont = isExpanded ? 12 : 11;
    const gradId = `${gradientId}${isExpanded ? '-modal' : ''}`;

    const chartInner = (
      <AreaChart
        data={displayChartData}
        margin={isExpanded ? { top: 20, bottom: 30, left: 10, right: 20 } : { top: 5, bottom: 5, left: 0, right: 0 }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={strokeColor} stopOpacity={areaOpacity} />
            <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
        <XAxis
          dataKey="timeMs"
          type="number"
          scale="time"
          domain={chartDomain}
          ticks={xAxisTicks}
          tickFormatter={formatXAxis}
          tick={{ fontSize: tickFont, fill: tickFill }}
          axisLine={{ stroke: axisStroke }}
          tickLine={{ stroke: axisStroke }}
        />
        <YAxis
          domain={yAxisConfig.domain}
          ticks={yAxisConfig.ticks}
          width={45}
          tickFormatter={(val) => Number(val).toFixed(2)}
          tick={{ fontSize: tickFont, fill: tickFill }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          labelFormatter={(val) => formatChartTooltipLabel(val)}
          formatter={(value) => [Number(value).toFixed(4) + ' ₺', t("rateLabel")]}
          contentStyle={{ backgroundColor: tooltipBg, border: tooltipBorder, borderRadius: '8px', color: tooltipColor }}
        />
        <Area
          type="monotone"
          dataKey="buy"
          stroke={strokeColor}
          strokeWidth={isExpanded ? 2.5 : 2}
          fillOpacity={1}
          fill={`url(#${gradId})`}
          isAnimationActive={false}
          activeDot={{ r: isExpanded ? 6 : 5, fill: strokeColor, stroke: isDark ? '#fff' : '#0f172a', strokeWidth: 2 }}
        />
      </AreaChart>
    );

    return (
      <div className={`relative w-full ${isExpanded ? 'h-full' : ''}`}>
        {/* Chart Container: Oklar kartın seviyesinde konumlandırıldığı için minimal padding yeterli */}
        <div
          className={`w-full ${isExpanded ? 'h-full' : ''}`}
          style={isExpanded ? { height: '100%', paddingLeft: '20px', paddingRight: '20px' } : { height: 200, paddingLeft: '20px', paddingRight: '20px' }}
        >
          <ResponsiveContainer width="100%" height={isExpanded ? 400 : 200}>
            {chartInner}
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="rounded-xl border border-ink-200 bg-white p-4 relative overflow-hidden dark:border-ink-800 dark:bg-ink-900">
        {/* Sol Ok - Kartın sol kenarına yakın (border'dan ~8px uzak) */}
        <button
          type="button"
          onClick={() => {
            setCustomDateRange({ start: null, end: null });
            setTimeOffset((prev) => Math.min(prev + 1, maxTimeOffset));
          }}
          disabled={timeWindow.isLeftDisabled}
          className={`absolute top-1/2 z-raised -translate-y-1/2 rounded-full transition-all border ${
            timeWindow.isLeftDisabled 
              ? "text-ink-600 opacity-40 cursor-not-allowed border-white/10 bg-ink-900/90 dark:text-ink-600 dark:opacity-40 dark:cursor-not-allowed dark:border-white/10 dark:bg-ink-900/90"
              : "text-ink-300 hover:bg-ink-800 hover:text-white border-white/10 bg-ink-900/90 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-white dark:border-white/10 dark:bg-ink-900/90"
          }`}
          style={{ left: '8px' }}
          aria-label="Önceki dönem"
        >
          <div className="p-1.5"><ChevronLeft size={16} /></div>
        </button>

        {/* Sağ Ok - Kartın sağ kenarına yakın (border'dan ~8px uzak) */}
        <button
          type="button"
          onClick={() => {
            setCustomDateRange({ start: null, end: null });
            setTimeOffset((prev) => Math.max(0, prev - 1));
          }}
          disabled={timeOffset === 0}
          className={`absolute top-1/2 z-raised -translate-y-1/2 rounded-full transition-all border ${
            timeOffset === 0 
              ? "text-ink-600 opacity-40 cursor-not-allowed border-white/10 bg-ink-900/90 dark:text-ink-600 dark:opacity-40 dark:cursor-not-allowed dark:border-white/10 dark:bg-ink-900/90"
              : "text-ink-300 hover:bg-ink-800 hover:text-white border-white/10 bg-ink-900/90 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-white dark:border-white/10 dark:bg-ink-900/90"
          }`}
          style={{ right: '8px' }}
          aria-label="Sonraki dönem"
        >
          <div className="p-1.5"><ChevronRight size={16} /></div>
        </button>

        {/* Merkez Kısım: Tarih Aralığı ve Büyüteç İkonu */}
        <div className="absolute top-3 left-1/2 z-raised flex max-w-[calc(100%-5.5rem)] -translate-x-1/2 flex-col items-center justify-center gap-1 px-1">
          <span className="max-w-full truncate text-center text-[10px] font-medium text-ink-500 dark:text-ink-400">
            {formatHeaderDate(timeWindow.windowStart)} - {formatHeaderDate(timeWindow.windowEnd)}
          </span>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="text-ink-500 hover:text-ink-800 transition-colors p-1 dark:text-ink-400 dark:hover:text-white"
            title="Detaylı Analiz"
            aria-label="Grafiği büyüt"
          >
            <ZoomIn size={16} />
          </button>
        </div>

        {/* Üst başlık */}
        <div className="relative flex items-center justify-between mb-3 min-h-[4.5rem]">
          <div>
            <p className="text-xs uppercase text-ink-500 dark:text-ink-400">{currency}/TRY</p>
            <p className="text-lg font-bold text-ink-800 mt-1 dark:text-ink-100">{last.toFixed(4)}</p>
            <span className={`text-xs font-semibold ${isPositive ? 'text-success-700 dark:text-success-400' : 'text-danger-700 dark:text-danger-400'}`}>
              {isPositive ? '+' : ''}{change}%
            </span>
            {dataInfo?.isLimitedByAvailableData && period !== 'Yıllık' && (
              <p className="text-[10px] text-warning-600/90 mt-1 dark:text-warning-400/80">
                Sınırlı geçmiş veri ({dataInfo.actualSpanDays} gün / {dataInfo.requestedSpanDays} gün gerekli)
              </p>
            )}
          </div>

          {isPositive ? <TrendingUp size={20} className="text-success-700 dark:text-success-400" /> : <TrendingDown size={20} className="text-danger-700 dark:text-danger-400" />}
        </div>

        {renderChartContent(false)}
      </div>

      {isModalOpen && createPortal(
        <div
          className="fixed inset-0 z-toast flex w-screen items-center justify-center bg-ink-950/50 p-3 backdrop-blur-md sm:p-4 md:p-6 dark:bg-ink-950/80"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="relative flex max-h-[min(92dvh,90vh)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-ink-600/60 dark:border-t-slate-400/50 dark:bg-ink-900/70"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute right-2 top-2 z-dropdown flex items-center gap-1.5 sm:right-3 sm:top-3 sm:gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>

            {/* Özel Tarih Seçici — mobilde üst şerit, masaüstünde sol üst */}
            <div className="relative z-raised flex flex-wrap items-center gap-2 border-b border-ink-200/80 bg-ink-50/90 px-3 py-2.5 backdrop-blur-sm dark:border-ink-700/50 dark:bg-ink-900/50 sm:absolute sm:left-4 sm:top-4 sm:max-w-[min(100%,22rem)] sm:rounded-lg sm:border sm:border-ink-200 sm:p-1.5 md:left-6 dark:sm:border-ink-700/50">
              <input
                type="date"
                lang={localeCode}
                value={startDateStr}
                max={endDateStr || todayStr}
                onChange={(e) => {
                  const newStartMs = parseDateInputToMs(e.target.value);
                  if (newStartMs == null) return;
                  setCustomDateRange((prev) => {
                    if (Number.isFinite(prev.end) && newStartMs > prev.end) return prev;
                    // Arşivden eski tarih seçilmesin
                    const clamped =
                      Number.isFinite(oldestDataTime) && newStartMs < oldestDataTime
                        ? oldestDataTime
                        : newStartMs;
                    return { ...prev, start: clamped };
                  });
                  setTimeOffset(0);
                }}
                className="min-w-0 flex-1 cursor-pointer rounded border border-ink-300 bg-white px-2 py-1 text-xs text-ink-800 focus:border-success-500 focus:outline-none dark:border-ink-600 dark:bg-ink-800/80 dark:text-ink-200 sm:flex-none md:text-sm"
              />
              <span className="shrink-0 text-sm text-ink-600 dark:text-ink-400">-</span>
              <input
                type="date"
                lang={localeCode}
                value={endDateStr}
                min={startDateStr}
                max={todayStr}
                onChange={(e) => {
                  const newEndMs = parseDateInputToMs(e.target.value);
                  if (newEndMs == null) return;
                  setCustomDateRange((prev) => {
                    if (Number.isFinite(prev.start) && newEndMs < prev.start) return prev;
                    return { ...prev, end: newEndMs };
                  });
                }}
                className="min-w-0 flex-1 cursor-pointer rounded border border-ink-300 bg-white px-2 py-1 text-xs text-ink-800 focus:border-success-500 focus:outline-none dark:border-ink-600 dark:bg-ink-800/80 dark:text-ink-200 sm:flex-none md:text-sm"
              />
            </div>

            <div className="flex flex-shrink-0 flex-col items-center px-3 pb-0 pt-3 sm:p-4 sm:pb-0 md:p-6 md:pb-0 md:pt-14">
              <h2 className="max-w-full truncate px-12 text-center text-lg font-bold text-ink-800 dark:text-ink-100 sm:px-16 md:text-2xl">{currency}/TRY Detaylı Analiz</h2>
              <span className={`mt-1 text-base font-bold md:text-xl ${displayPercentage >= 0 ? 'text-success-700 dark:text-success-400' : 'text-danger-700 dark:text-danger-400'}`}>
                {displayPercentage > 0 ? '+' : ''}{displayPercentage.toFixed(2)}%
              </span>
            </div>

            {/* Büyük Grafik Wrapper'ı - Tüm sekmeler için sabit yükseklik */}
            <div className="relative block h-[min(52vh,400px)] min-h-[240px] w-full overflow-hidden p-3 sm:h-[400px] sm:p-4 md:p-8">
              {renderChartContent(true)}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function PartnershipForm() {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    institution_name: "",
    contact_person: "",
    email: "",
    phone: "",
    message: "",
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [rawPhone, setRawPhone] = useState("5");
  const phoneFormattedRef = useRef("0(5");
  const phoneInputRef = useRef(null);

  const PHONE_MASK_TEMPLATE = "0(5XX) XXX XXXX";

  const partnershipInputClass =
    "h-11 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 outline-none transition-all duration-300 hover:border-brand-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] focus:border-brand-400 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-ink-700 dark:bg-ink-950 dark:text-ink-100 dark:hover:border-brand-400 dark:focus:border-brand-400";

  const formatPhoneDisplay = (rawDigits) => {
    let d = String(rawDigits || "").replace(/\D/g, "").slice(0, 10);
    if (!d.startsWith("5")) d = `5${d.replace(/^5*/, "")}`.slice(0, 10);
    if (!d) d = "5";
    let out = "0(";
    out += d.slice(0, Math.min(3, d.length));
    if (d.length >= 3) out += ")";
    if (d.length > 3) out += ` ${d.slice(3, Math.min(6, d.length))}`;
    if (d.length > 6) out += ` ${d.slice(6, Math.min(10, d.length))}`;
    return out;
  };

  const buildPhoneMaskGhost = (rawDigits) => {
    const typed = formatPhoneDisplay(rawDigits);
    return PHONE_MASK_TEMPLATE.split("")
      .map((ch, i) => (i < typed.length ? "\u00A0" : ch))
      .join("");
  };

  const extractRawPhoneDigits = (value) => {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("90") && digits.length >= 11) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    digits = digits.slice(0, 10);
    if (!digits.startsWith("5")) {
      digits = `5${digits.replace(/^5*/, "")}`.slice(0, 10);
    }
    return digits || "5";
  };

  const syncPhone = (digits) => {
    const next = extractRawPhoneDigits(digits);
    setRawPhone(next);
    phoneFormattedRef.current = formatPhoneDisplay(next);
    setFormData((prev) => ({ ...prev, phone: `+90 ${formatPhoneDisplay(next)}` }));
  };

  const handlePhoneInputChange = (e) => {
    const inputValue = e.target.value;
    const prevFormatted = phoneFormattedRef.current;
    let digits = extractRawPhoneDigits(inputValue);

    if (
      inputValue.length < prevFormatted.length &&
      digits.length >= rawPhone.length &&
      rawPhone.length > 1
    ) {
      digits = rawPhone.slice(0, -1);
    }

    syncPhone(digits);
  };

  const handlePhoneKeyDown = (e) => {
    const input = e.target;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const lockedUntil = 3;

    if (
      (e.key === "Backspace" || e.key === "Delete" || e.key === "ArrowLeft" || e.key === "Home") &&
      start <= lockedUntil &&
      start === end
    ) {
      if (e.key === "Backspace" || e.key === "Delete" || e.key === "Home") {
        e.preventDefault();
        requestAnimationFrame(() => input.setSelectionRange(lockedUntil, lockedUntil));
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        input.setSelectionRange(lockedUntil, lockedUntil);
        return;
      }
    }

    if (e.key !== "Backspace" || start !== end) return;
    if (rawPhone.length <= 1) {
      e.preventDefault();
      return;
    }
    const before = input.value[start - 1];
    if (before && /\D/.test(before)) {
      e.preventDefault();
      syncPhone(rawPhone.slice(0, -1));
    }
  };

  const handlePhoneFocus = (e) => {
    const lockedUntil = 3;
    const input = e.target;
    requestAnimationFrame(() => {
      const pos = Math.max(input.selectionStart ?? lockedUntil, lockedUntil);
      input.setSelectionRange(pos, pos);
    });
  };

  const handlePhoneClick = (e) => {
    const lockedUntil = 3;
    const input = e.target;
    if ((input.selectionStart ?? 0) < lockedUntil) {
      input.setSelectionRange(lockedUntil, lockedUntil);
    }
  };

  useEffect(() => {
    phoneFormattedRef.current = formatPhoneDisplay(rawPhone);
  }, [rawPhone]);

  const buildPartnershipDefaultMessage = () => {
    const institution = String(formData.institution_name || "").trim() || "…";
    const person = String(formData.contact_person || "").trim() || "…";
    const mail = String(formData.email || "").trim() || "…";
    const tel =
      rawPhone.length >= 10
        ? `+90 ${formatPhoneDisplay(rawPhone)}`
        : String(formData.phone || "").trim() || "…";
    return (
      `${institution} kurumundan ${person} adlı yetkili, AdaDöviz partnerlik programına başvurmak istemektedir. ` +
      `İletişim: ${mail} / ${tel}. Lütfen en kısa sürede dönüş yapınız.`
    );
  };

  const messageIsEmpty = !String(formData.message || "").trim();
  const messagePreview = buildPartnershipDefaultMessage();

  const handleChange = (e) => {
    const { name, value } = e.target;
    let next = value;
    if (name === "contact_person") {
      next = value.replace(/[0-9]/g, "");
    }
    setFormData((prev) => ({ ...prev, [name]: next }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rawPhone.length !== 10) {
      setError(t("phoneIncompleteError") || "Lütfen 10 haneli telefon numarasını eksiksiz girin.");
      return;
    }
    setLoading(true);
    setError("");

    const payload = {
      ...formData,
      phone: `+90 ${formatPhoneDisplay(rawPhone)}`,
      message: messageIsEmpty ? messagePreview : String(formData.message).trim(),
    };

    try {
      const res = await fetch(apiUrl("/api/partnership-apply"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSubmitted(true);
      setFormData({
        institution_name: "",
        contact_person: "",
        email: "",
        phone: "+90 0(5",
        message: "",
      });
      setRawPhone("5");
      phoneFormattedRef.current = "0(5";
      setTimeout(() => setSubmitted(false), 5000);
    } catch (err) {
      setError(err.message || t("applicationSendFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      id="partnership"
      className="mt-12 scroll-mt-28 rounded-2xl border border-ink-200 bg-white p-4 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-ink-900/60 sm:p-6"
    >
      <div className="mb-6">
        <h2 className="text-xl font-bold text-ink-900 dark:text-white">{t("partnership")}</h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{t("partnershipDesc")}</p>
      </div>

      {submitted ? (
        <div className="rounded-lg border border-success-500/30 bg-success-500/10 px-4 py-3 text-sm text-success-700 dark:text-success-200">
          {t("applicationSuccess")}
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-4 rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-700 dark:text-danger-200">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium uppercase tracking-wide text-ink-600 dark:text-ink-300">{t("institutionName")}</label>
                <input
                  type="text"
                  name="institution_name"
                  placeholder={t("institutionNamePlaceholder")}
                  value={formData.institution_name}
                  onChange={handleChange}
                  required
                  className={partnershipInputClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium uppercase tracking-wide text-ink-600 dark:text-ink-300">{t("contactPerson")}</label>
                <input
                  type="text"
                  name="contact_person"
                  placeholder={t("contactPersonPlaceholder")}
                  value={formData.contact_person}
                  onChange={handleChange}
                  inputMode="text"
                  autoComplete="name"
                  required
                  className={partnershipInputClass}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium uppercase tracking-wide text-ink-600 dark:text-ink-300">{t("emailLabel")}</label>
                <input
                  type="email"
                  name="email"
                  placeholder={t("emailPlaceholder")}
                  value={formData.email}
                  onChange={handleChange}
                  required
                  className={partnershipInputClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium uppercase tracking-wide text-ink-600 dark:text-ink-300">{t("phoneLabel")}</label>
                <div className="relative h-11 flex items-center rounded-lg border border-ink-300 bg-white dark:border-ink-700 dark:bg-ink-950 focus-within:border-brand-400 focus-within:shadow-[0_0_15px_rgba(34,211,238,0.4)] transition-all duration-300">
                  <span className="absolute left-3 z-raised text-sm font-mono font-bold text-ink-800 dark:text-white pointer-events-none">
                    +90
                  </span>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-0 flex items-center pl-14 pr-3 text-sm font-mono text-ink-600 dark:text-ink-400 select-none"
                  >
                    {buildPhoneMaskGhost(rawPhone)}
                  </span>
                  <input
                    ref={phoneInputRef}
                    type="tel"
                    name="phone"
                    value={formatPhoneDisplay(rawPhone)}
                    onChange={handlePhoneInputChange}
                    onKeyDown={handlePhoneKeyDown}
                    onFocus={handlePhoneFocus}
                    onClick={handlePhoneClick}
                    inputMode="numeric"
                    autoComplete="tel-national"
                    required
                    className="relative z-raised h-full w-full rounded-lg bg-transparent px-3 pl-14 text-sm font-mono text-ink-800 outline-none caret-brand-500 dark:text-ink-100"
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium uppercase tracking-wide text-ink-600 dark:text-ink-300">{t("messageLabel")}</label>
              <textarea
                name="message"
                rows={4}
                placeholder={t("messagePlaceholder")}
                value={formData.message}
                onChange={handleChange}
                className="rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition-all duration-300 hover:border-brand-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] focus:border-brand-400 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-ink-700 dark:bg-ink-950 dark:text-ink-100 dark:hover:border-brand-400 dark:focus:border-brand-400"
              />
              {messageIsEmpty ? (
                <div className="rounded-lg border border-dashed border-brand-500/40 bg-brand-500/5 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                    {t("messageTemplatePreviewLabel")}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600 dark:text-ink-300">
                    {messagePreview}
                  </p>
                </div>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full sm:w-auto"
            >
              {loading ? t("submitting") : t("submitApplication")}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

/** Backend listesiyle uyumlu Türkiye banka haritası. */
const LOCAL_BANKS = [
  { id: "ziraat", name: "Ziraat Bankası", websiteUrl: "https://www.ziraatbank.com.tr" },
  { id: "garanti", name: "Garanti BBVA", websiteUrl: "https://www.garantibbva.com.tr" },
  { id: "akbank", name: "Akbank", websiteUrl: "https://www.akbank.com" },
  { id: "isbank", name: "Türkiye İş Bankası", websiteUrl: "https://www.isbank.com.tr" },
  { id: "yapikredi", name: "Yapı Kredi", websiteUrl: "https://www.yapikredi.com.tr" },
  { id: "halkbank", name: "Halkbank", websiteUrl: "https://www.halkbank.com.tr" },
  { id: "vakifbank", name: "VakıfBank", websiteUrl: "https://www.vakifbank.com.tr" },
  { id: "qnb", name: "QNB Finansbank", websiteUrl: "https://www.qnb.com.tr" },
  { id: "denizbank", name: "DenizBank", websiteUrl: "https://www.denizbank.com" },
  { id: "kuveytturk", name: "Kuveyt Türk", websiteUrl: "https://www.kuveytturk.com.tr" },
  { id: "teb", name: "TEB", websiteUrl: "https://www.teb.com.tr" },
  { id: "ing", name: "ING Bank", websiteUrl: "https://www.ing.com.tr" },
  { id: "odeabank", name: "Odeabank", websiteUrl: "https://www.odeabank.com.tr" },
  { id: "fibabanka", name: "Fibabanka", websiteUrl: "https://www.fibabanka.com.tr" },
  { id: "albaraka", name: "Albaraka Türk", websiteUrl: "https://www.albarakaturk.com.tr" },
  { id: "sun_doviz", name: "Sun Döviz", websiteUrl: "https://www.sundoviz.com.tr" },
];

/**
 * ⚠️ UX DÜZELTMESİ (denetim bulgusu U-04): Altı sıralama seçeneğinin ALTISI DA
 * alış tarafındaydı. Oysa turist "elimde TL var, dolar alacağım" derken SATIŞ
 * kuruna bakar — o sıralama hiç yoktu. Sıralama mantığı zaten
 * sortBy.split("-") ile [para, tip, yön] okuduğu için algoritma değişmedi;
 * yalnızca eksik seçenekler eklendi.
 *
 * Müşteri için "iyi": alışta EN YÜKSEK, satışta EN DÜŞÜK.
 */
const EXCHANGE_SORT_OPTIONS = [
  { value: "nearest", labelKey: "sortNearest" },
  { value: "none", labelKey: "sortNone" },
  { value: "usd-buy-high", labelKey: "sortUsdBuyHigh" },
  { value: "usd-sell-low", labelKey: "sortUsdSellLow" },
  { value: "eur-buy-high", labelKey: "sortEurBuyHigh" },
  { value: "eur-sell-low", labelKey: "sortEurSellLow" },
  { value: "gbp-buy-high", labelKey: "sortGbpBuyHigh" },
  { value: "gbp-sell-low", labelKey: "sortGbpSellLow" },
  { value: "usd-buy-low", labelKey: "sortUsdBuyLow" },
  { value: "usd-sell-high", labelKey: "sortUsdSellHigh" },
  { value: "eur-buy-low", labelKey: "sortEurBuyLow" },
  { value: "eur-sell-high", labelKey: "sortEurSellHigh" },
  { value: "gbp-buy-low", labelKey: "sortGbpBuyLow" },
  { value: "gbp-sell-high", labelKey: "sortGbpSellHigh" },
];

/** Çalışma saati — string ("09:00 - 17:30") veya haftalık obje */
function isOpenNow(workingHours) {
  if (!workingHours) return false;
  try {
    if (typeof workingHours === "object" && !Array.isArray(workingHours)) {
      const dayKeys = [
        "pazar",
        "pazartesi",
        "sali",
        "carsamba",
        "persembe",
        "cuma",
        "cumartesi",
      ];
      const key = dayKeys[new Date().getDay()];
      const slot = workingHours[key];
      if (!Array.isArray(slot) || slot[0] == null || slot[1] == null) return false;
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      return currentTime >= Number(slot[0]) && currentTime <= Number(slot[1]);
    }

    const [start, end] = String(workingHours)
      .split("-")
      .map((t) => t.trim());
    if (!start || !end) return false;
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);
    if (![startH, startM, endH, endM].every(Number.isFinite)) return false;

    const startTime = startH * 60 + startM;
    const endTime = endH * 60 + endM;

    return currentTime >= startTime && currentTime <= endTime;
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** En yakın şube + mesafe (km). Şube/koordinat yoksa null. */
function getNearestBranchInfo(bank, userLat, userLng, branchesByInstitution) {
  if (userLat == null || userLng == null) return null;
  const id = bank.institutionId;
  const nameKey = normalizeText(bank.name || "");
  const list =
    (id && branchesByInstitution[id]) ||
    branchesByInstitution[nameKey] ||
    [];
  if (!list.length) return null;
  let best = null;
  let min = Number.POSITIVE_INFINITY;
  for (const branch of list) {
    const lat = Number(branch.lat);
    const lng = Number(branch.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const d = haversineKm(userLat, userLng, lat, lng);
    if (d < min) {
      min = d;
      best = branch;
    }
  }
  if (!best || !Number.isFinite(min)) return null;
  return {
    id: best.id,
    name: best.name || "",
    distanceKm: min,
    lat: Number(best.lat),
    lng: Number(best.lng),
  };
}

// ✅ DEAD CODE REMOVED: INTEREST_SORT_OPTIONS ve CREDIT_SORT_OPTIONS kaldırıldı
// Sadece döviz kurları (exchange) mode kullanılıyor
/** Serbest metin veya sayıdan kur sayısı; ondalığı bozmadan çözümleme (örn. "44.38" veya TR formatı). */
function parseRateNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const trimmed = String(value).trim().replace(/\s/g, "");
  if (!trimmed) return null;
  const lastDot = trimmed.lastIndexOf(".");
  const lastComma = trimmed.lastIndexOf(",");
  let normalized = trimmed.replace(/[^\d.,-]/g, "");
  if (!normalized) return null;
  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(/,/g, "");
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}


function mapApiBankToExchangeRows(apiBank) {
  const fromArray = Array.isArray(apiBank?.exchangeRates) ? apiBank.exchangeRates : [];
  const fromObj = apiBank?.rates ?? {};
  const byCodeFromArray = Object.fromEntries(
    fromArray.map((row) => [row.currency, { buy: row.buy, sell: row.sell }])
  );

  const pick = (code) => {
    const rowPair = byCodeFromArray[code];
    const objPair = fromObj[code];
    const buyRaw = rowPair?.buy ?? objPair?.buy;
    const sellRaw = rowPair?.sell ?? objPair?.sell;
    const buy = parseRateNumber(buyRaw);
    const sell = parseRateNumber(sellRaw);
    return { currency: code, buy, sell };
  };

  return [pick("EUR"), pick("USD"), pick("GBP")];
}

function toNumberForCompare(value) {
  return parseRateNumber(value) ?? 0;
}


function getRate(bank, currency, type) {
  const rate = bank.exchangeRates.find((r) => r.currency === currency);
  return rate ? toNumberForCompare(rate[type]) : 0;
}

function getDepositRate(bank) {
  const directRate = parseRateNumber(bank?.depositRate);
  const listRate = parseRateNumber(bank?.interestRates?.[0]?.rate);
  return directRate ?? listRate ?? 0;
}

function getLoanRate(bank, loanType) {
  return parseRateNumber(bank?.loans?.[loanType]) ?? 0;
}


export function V0FinancialDashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, isSuperAdmin, logout } = useAuth();
  const { t, lang } = useLanguage();
  const localeCode = lang === 'en' ? 'en-US' : 'tr-TR';

  const handleLogout = () => {
    // ✅ FIXED MODAL POPUP GÖSTER
    setShowLogoutPopup(true);
    
    // ✅ 1 SANIYE SONRA LOGOUT VE TAM YENILEME
    setTimeout(() => {
      const themePref = localStorage.getItem("finsight-theme");
      const langPref = localStorage.getItem("finsight-lang");
      logout();
      localStorage.clear();
      try {
        sessionStorage.removeItem("finsight_business_auth");
        sessionStorage.removeItem("finsight_auth_remember");
      } catch {
        /* ignore */
      }
      if (themePref) localStorage.setItem("finsight-theme", themePref);
      if (langPref) localStorage.setItem("finsight-lang", langPref);
      window.location.href = "/";  // ✅ React Router'dan önce tam yenileme
    }, 1000);
  };
  const [mode] = useState("exchange");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("none");
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [branchesByInstitution, setBranchesByInstitution] = useState({});
  const [geoToast, setGeoToast] = useState("");
  const [showLocationConsent, setShowLocationConsent] = useState(false);
  const [banks, setBanks] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const lastUpdatedRef = useRef(null);
  const ratesFingerprintRef = useRef("");
  /** SSE sinyali geldiğinde kurları yeniden çekmek için (K-02). */
  const refetchBanksRef = useRef(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [, setRawCentralBankRates] = useState(null); // ✅ SAF XML kurları
  const [calculatorBank, setCalculatorBank] = useState("");
  const [isBusinessLoginOpen, setIsBusinessLoginOpen] = useState(false);
  const [showLogoutPopup, setShowLogoutPopup] = useState(false);  // ✅ YENİ: Çıkış Modal
  const [chartPeriod, setChartPeriod] = useState('Günlük');  // ✅ YENİ: Market Summary filtresi
  const [liveRates, setLiveRates] = useState(null); // ✅ TEK merkezi SSE mesajı - tüm banka kartları bunu paylaşır
  const [headerCompact, setHeaderCompact] = useState(false);

  // ✅ Histerezis (iki farklı eşik + aradaki "ölü bölge"): scroll pozisyonu tek bir
  // sınırın (örn. 20px) etrafında gidip gelince header'ın sürekli küçülüp büyüyerek
  // "titremesini" (jitter) önler. Küçülme ve büyüme için farklı eşikler kullanılır.
  useEffect(() => {
    const COMPACT_ABOVE = 72;
    const EXPAND_BELOW = 24;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        setHeaderCompact((prev) => {
          if (!prev && y > COMPACT_ABOVE) return true;
          if (prev && y < EXPAND_BELOW) return false;
          return prev;
        });
      });
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // ✅ FIX: Her V0BankCard kendi SSE bağlantısını açtığında (16+ kart), tarayıcının
  // host başına bağlantı limiti (~6) tükeniyor ve Market Summary'nin fetch istekleri
  // sonsuza kadar kuyrukta kalıyordu ("Yükleniyor..." hiç bitmiyordu).
  // Çözüm: TEK bir SSE bağlantısı burada (Dashboard seviyesinde) açılır,
  // gelen mesaj state'e yazılır, tüm banka kartlarına prop olarak aşağı geçirilir.
  useEffect(() => {
    let eventSource = null;
    let reconnectTimer = null;
    let isMounted = true;
    let reconnectAttempt = 0;

    const connect = () => {
      eventSource = new EventSource(ratesStreamUrl());

      eventSource.onopen = () => {
        reconnectAttempt = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "rate_update" && data.rates) {
            setLiveRates(data.rates);
            const at = data.ratesChangedAt || data.timestamp || new Date().toISOString();
            if (at !== lastUpdatedRef.current) {
              lastUpdatedRef.current = at;
              setLastUpdated(at);
            }
          } else if (data.type === "data_changed" && data.ratesChangedAt) {
            if (data.ratesChangedAt !== lastUpdatedRef.current) {
              lastUpdatedRef.current = data.ratesChangedAt;
              setLastUpdated(data.ratesChangedAt);
            }
          }
        } catch {
          // Sessizce yut - tekil mesaj parse hatası kritik değil
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        if (isMounted) {
          // Exponential backoff (1s, 2s, 4s, … max 30s) — reconnect storm önlenir
          const delayMs = Math.min(30000, 1000 * Math.pow(2, reconnectAttempt));
          reconnectAttempt += 1;
          reconnectTimer = setTimeout(connect, delayMs);
        }
      };
    };

    connect();

    return () => {
      isMounted = false;
      if (eventSource) eventSource.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  /**
   * SSE ile Merkez Bankası değişimi geldiğinde kartları tazele.
   *
   * ⚠️ K-02 sonrası: Burada marjlar tarayıcıda tutulup nihai kur yeniden
   * HESAPLANIYORDU. Marj artık istemciye hiç inmediği için (ve inmemesi
   * gerektiği için) SSE bir "yeniden çek" sinyaline dönüştü — nihai kuru
   * her zaman backend hesaplar.
   */
  useEffect(() => {
    if (!liveRates) return;
    setRawCentralBankRates(liveRates);
    refetchBanksRef.current?.();
  }, [liveRates]);

  const scrollToPartnership = () => {
    document.getElementById("partnership")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (window.location.hash === "#partnership") {
      const timer = window.setTimeout(scrollToPartnership, 120);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, []);
  const [exchangeCurrency, setExchangeCurrency] = useState("");
  // Alış: döviz tutarı → TL; Satış: TL tutarı → döviz
  const [exchangeAmount, setExchangeAmount] = useState("0");
  const [exchangeOperation, setExchangeOperation] = useState("buy");
  const [depositAmount, setDepositAmount] = useState("100000");
  const [depositDays, setDepositDays] = useState("32");
  const [depositType, setDepositType] = useState("monthly");
  const [loanType, setLoanType] = useState("tasit");
  const [loanAmount, setLoanAmount] = useState("300000");
  const [loanMonths, setLoanMonths] = useState("24");

  useEffect(() => {
    let mounted = true;

    const fetchBanks = async () => {
      try {
        /**
         * ⚠️ GÜVENLİK + MİMARİ DÜZELTMESİ (denetim bulgusu K-02): Burada
         * /api/kurlar ile birlikte /api/margins de çekiliyor ve nihai kur
         * TARAYICIDA yeniden hesaplanıyordu. İki sorunu vardı:
         *   1) /api/margins public'ti ve 20 işletmenin kâr marjını herkese
         *      açıyordu (rakip istihbaratı). Uç artık superadmin'e kapalı.
         *   2) Aynı sayı iki yerde hesaplanıyordu — backend'de ve frontend'de.
         * Nihai kurun tek kaynağı artık backend'dir.
         */
        const ratesRes = await fetch(apiUrl("/api/kurlar"));
        if (!ratesRes.ok) {
          throw new Error(`Kurlar API error: ${ratesRes.status}`);
        }
        const data = await ratesRes.json();

        const incomingBanks = Array.isArray(data?.banks) ? data.banks : [];
        const websiteByName = new Map(
          LOCAL_BANKS.map((bank) => [normalizeText(bank.name), bank.websiteUrl])
        );

        // ✅ DINAMIK HESAPLAMA: Raw XML kurlar + DB marjları
        const mappedBanks = incomingBanks.map((apiBank, index) => {
          const apiName = apiBank?.bankName || apiBank?.bank || `Banka ${index + 1}`;
          const normalizedName = normalizeText(apiName);
          const websiteUrl = apiBank?.sourceUrl || websiteByName.get(normalizedName) || "#";
          
          // ✅ KILIT: Backend'ten gelen institutionId kullan (örn: 'akbank', 'ziraat', 'garanti')
          const institutionId = apiBank?.institutionId;
          
          // Nihai kur backend'den gelir (K-02): tek gerçeklik kaynağı.
          const exchangeRates = mapApiBankToExchangeRows(apiBank);

          return {
            id: `api-bank-${index + 1}`,
            name: apiName,
            websiteUrl,
            institutionId,
            slug:
              apiBank?.slug ||
              buildBusinessSlug({
                institutionId,
                name: apiName,
              }),
            exchangeRates,
            workingHours:
              apiBank?.workingHours ||
              apiBank?.working_hours ||
              null,
            depositRate: parseRateNumber(apiBank?.depositRate),
            loans: {
              tasit: parseRateNumber(apiBank?.loans?.tasit),
              konut: parseRateNumber(apiBank?.loans?.konut),
              ihtiyac: parseRateNumber(apiBank?.loans?.ihtiyac),
            },
            interestRates: Array.isArray(apiBank?.interestRates) && apiBank.interestRates.length > 0
              ? apiBank.interestRates
              : [
                  {
                    type: "Mevduat Faizi",
                    rate: parseRateNumber(apiBank?.depositRate) ?? 45,
                  },
                ],
            subscription_type: apiBank?.subscription_type || null,
            subscription_end_date: apiBank?.subscription_end_date || null,
            days_remaining:
              apiBank?.days_remaining != null ? Number(apiBank.days_remaining) : null,
            logo_url: apiBank?.logo_url || null,
            is_active:
              apiBank?.is_active === true ||
              apiBank?.is_active === 1 ||
              apiBank?.is_active === "1" ||
              (apiBank?.is_active !== false &&
                apiBank?.is_active !== 0 &&
                apiBank?.is_active !== "0"),
          };
        }).filter((bank) => {
          const isActive =
            bank.is_active === true || bank.is_active === 1 || bank.is_active === "1";
          if (!isActive) return false;
          if (bank.subscription_end_date) {
            const end = new Date(bank.subscription_end_date).getTime();
            if (Number.isFinite(end) && end <= Date.now()) return false;
          }
          return true;
        });

        // ✅ SAF XML kurlarını kaydet (Dinamik hesaplama için)
        if (data?.rawCentralBankRates) {
          setRawCentralBankRates(data.rawCentralBankRates);
          devLog("[DASHBOARD] SAF XML kurları kaydedildi:", data.rawCentralBankRates);
        }

        if (mounted) {
          setBanks(mappedBanks);

          // Son güncelleme: yalnızca kur/marj içeriği veya sunucu damgası değişince
          const fingerprint = JSON.stringify(
            mappedBanks.map((b) => ({
              id: b.institutionId || b.id,
              rates: b.exchangeRates,
            }))
          );
          const serverChangedAt =
            data?.ratesChangedAt || data?.updatedAt || null;
          const contentChanged = fingerprint !== ratesFingerprintRef.current;
          if (contentChanged) {
            ratesFingerprintRef.current = fingerprint;
          }
          const nextStamp =
            contentChanged
              ? serverChangedAt || new Date().toISOString()
              : serverChangedAt && serverChangedAt !== lastUpdatedRef.current
                ? serverChangedAt
                : null;

          if (nextStamp && nextStamp !== lastUpdatedRef.current) {
            lastUpdatedRef.current = nextStamp;
            setLastUpdated(nextStamp);
          } else if (!lastUpdatedRef.current && serverChangedAt) {
            lastUpdatedRef.current = serverChangedAt;
            setLastUpdated(serverChangedAt);
          }

          devLog(`[DASHBOARD] ${mappedBanks.length} banka yüklendi, FirstBank: ${mappedBanks[0]?.name || "N/A"}`);
        }
      } catch (error) {
        console.error("[DASHBOARD] Kur verisi alınamadı:", error);
        if (mounted) {
          setBanks([]);
          setLastUpdated(null);
        }
      }
    };

    refetchBanksRef.current = fetchBanks;
    fetchBanks();
    const intervalId = setInterval(fetchBanks, 300000); // 5 dakika = 300000ms
    
    devLog("[DASHBOARD] Otomatik yenileme başlatıldı - 5 dakika aralığıyla");

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

  // ✅ DEAD CODE REMOVED: Interest ve Credit mode'ları kaldırıldı
  // ✅ Sadece exchange mode kullanılıyor
  const currentSortOptions = useMemo(() => {
    return EXCHANGE_SORT_OPTIONS.map((opt) => ({
      value: opt.value,
      label: t(opt.labelKey),
    }));
  }, [t]);

  // Şube koordinatları — En Yakın Konum sıralaması
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/branches"));
        if (!res.ok) return;
        const data = await res.json();
        const rows = Array.isArray(data.branches) ? data.branches : [];
        const map = {};
        for (const branch of rows) {
          const key = branch.institution_id || normalizeText(branch.institution_name || "");
          if (!key) continue;
          if (!map[key]) map[key] = [];
          map[key].push(branch);
          const nameKey = normalizeText(branch.institution_name || "");
          if (nameKey && nameKey !== key) {
            if (!map[nameKey]) map[nameKey] = [];
            map[nameKey].push(branch);
          }
        }
        if (!cancelled) setBranchesByInstitution(map);
      } catch (err) {
        console.warn("[DASHBOARD] Şubeler (konum) alınamadı:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!geoToast) return undefined;
    const timer = setTimeout(() => setGeoToast(""), 4500);
    return () => clearTimeout(timer);
  }, [geoToast]);

  const requestNearestSort = () => {
    if (!navigator.geolocation) {
      setGeoToast(t("locationUnsupported"));
      setSortBy("none");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setSortBy("nearest");
        setGeoToast("");
      },
      () => {
        setGeoToast(t("locationPermissionRequired"));
        setUserLocation(null);
        setSortBy("none");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };

  const handleSortChange = (value) => {
    if (value === "nearest") {
      if (userLocation) {
        setSortBy("nearest");
        return;
      }
      setShowLocationConsent(true);
      return;
    }
    setSortBy(value);
  };

  useEffect(() => {
    const allowedValues = new Set(currentSortOptions.map((o) => o.value));
    if (!allowedValues.has(sortBy)) {
      setSortBy(currentSortOptions[0]?.value ?? "none");
    }
  }, [currentSortOptions, sortBy]);

  const filteredAndSortedBanks = useMemo(() => {
    // Aktif + süresi dolmamış
    let result = banks.filter((b) => {
      const isActive =
        b.is_active === true || b.is_active === 1 || b.is_active === "1";
      if (!isActive) return false;
      if (b.subscription_end_date) {
        const end = new Date(b.subscription_end_date).getTime();
        if (Number.isFinite(end) && end <= Date.now()) return false;
      }
      return true;
    });

    const byIdOrInstitution = Array.from(
      new Map(
        result.map((business) => [
          business.institutionId || business.id,
          business,
        ])
      ).values()
    );
    result = Array.from(
      new Map(
        byIdOrInstitution.map((business) => [
          normalizeText(business.name || business.bankName || "") ||
            business.institutionId ||
            business.id,
          business,
        ])
      ).values()
    );

    if (searchQuery) {
      result = result.filter((bank) =>
        bank.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (openNowOnly) {
      result = result.filter((bank) => {
        const hours =
          bank.workingHours ||
          bank.working_hours ||
          "09:00 - 17:00";
        return isOpenNow(hours);
      });
    }

    const nearestActive =
      sortBy === "nearest" &&
      userLocation?.lat != null &&
      userLocation?.lng != null;

    if (nearestActive) {
      result = result.map((bank) => {
        const nearest = getNearestBranchInfo(
          bank,
          userLocation.lat,
          userLocation.lng,
          branchesByInstitution
        );
        return {
          ...bank,
          nearestBranch: nearest,
          nearestDistanceKm: nearest?.distanceKm ?? Number.POSITIVE_INFINITY,
        };
      });
      result.sort((a, b) => a.nearestDistanceKm - b.nearestDistanceKm);
    } else if (sortBy !== "none") {
      result = result.map((bank) => ({
        ...bank,
        nearestBranch: null,
        nearestDistanceKm: null,
      }));
      result.sort((a, b) => {
        const [currency, type, direction] = sortBy.split("-");
        const currencyUpper = currency.toUpperCase();
        const rateA = getRate(a, currencyUpper, type);
        const rateB = getRate(b, currencyUpper, type);
        // Kuru olmayan işletmeler sıralamanın sonuna düşsün (NaN sıralamayı bozmasın).
        const okA = Number.isFinite(rateA);
        const okB = Number.isFinite(rateB);
        if (!okA && !okB) return 0;
        if (!okA) return 1;
        if (!okB) return -1;
        return direction === "high" ? rateB - rateA : rateA - rateB;
      });
    } else {
      result = result.map((bank) => ({
        ...bank,
        nearestBranch: null,
        nearestDistanceKm: null,
      }));
      result.sort((a, b) => a.name.localeCompare(b.name, "tr"));
    }

    return result;
  }, [banks, searchQuery, sortBy, openNowOnly, userLocation, branchesByInstitution]);

  /**
   * ⚠️ UX DÜZELTMESİ (denetim bulgusu U-10): Panoda beş büronun da kuru
   * kuruşuna kadar aynı görünüyordu ve en iyi kuru gösteren hiçbir işaret
   * yoktu — yani "büroları karşılaştır" vaadi ekranda hiç görünmüyordu.
   *
   * Müşteri açısından en iyi ALIŞ = en yüksek (dövizini daha pahalıya
   * bozdurur), en iyi SATIŞ = en düşük (dövizi daha ucuza alır).
   * Sonuç V0BankCard'a `bestRates` olarak geçer ve ilgili hücre işaretlenir.
   */
  const bestRates = useMemo(() => {
    if (mode !== "exchange" || filteredAndSortedBanks.length < 2) return null;
    const result = {};
    for (const currency of ["EUR", "USD", "GBP"]) {
      let bestBuy = null;
      let bestSell = null;
      for (const bank of filteredAndSortedBanks) {
        const row = bank.exchangeRates?.find((r) => r.currency === currency);
        const buy = Number(row?.buy);
        const sell = Number(row?.sell);
        if (Number.isFinite(buy) && (bestBuy == null || buy > bestBuy)) bestBuy = buy;
        if (Number.isFinite(sell) && (bestSell == null || sell < bestSell)) bestSell = sell;
      }
      // Herkes aynı kuru veriyorsa "en iyi" işareti bilgi taşımaz — işaretleme.
      let worstBuy = null;
      let worstSell = null;
      for (const bank of filteredAndSortedBanks) {
        const row = bank.exchangeRates?.find((r) => r.currency === currency);
        const buy = Number(row?.buy);
        const sell = Number(row?.sell);
        if (Number.isFinite(buy) && (worstBuy == null || buy < worstBuy)) worstBuy = buy;
        if (Number.isFinite(sell) && (worstSell == null || sell > worstSell)) worstSell = sell;
      }
      const buySpread = bestBuy != null && worstBuy != null && bestBuy - worstBuy > 1e-9;
      const sellSpread = bestSell != null && worstSell != null && worstSell - bestSell > 1e-9;
      if (buySpread || sellSpread) {
        result[currency] = {
          buy: buySpread ? bestBuy : null,
          sell: sellSpread ? bestSell : null,
        };
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }, [filteredAndSortedBanks, mode]);

  const selectedCalculatorBank = banks.find((b) => b.name === calculatorBank) ?? null;
  const selectedExchangePair =
    selectedCalculatorBank?.exchangeRates?.find((r) => r.currency === exchangeCurrency) ?? null;
  const selectedExchangeSellRate = selectedExchangePair?.sell ?? null;
  const selectedExchangeBuyRate = selectedExchangePair?.buy ?? null;
  const exchangeAmountNum = Number.parseFloat(exchangeAmount);
  // Alış = büronun alış kuru (müşteri döviz satar → TL alır)
  // Satış = büronun satış kuru (müşteri TL verir → döviz alır)
  const exchangeResult =
    Number.isFinite(exchangeAmountNum) &&
    exchangeAmountNum > 0 &&
    (exchangeOperation === "buy"
      ? Number.isFinite(selectedExchangeBuyRate)
      : Number.isFinite(selectedExchangeSellRate))
      ? exchangeOperation === "buy"
        ? exchangeAmountNum * selectedExchangeBuyRate
        : exchangeAmountNum / selectedExchangeSellRate
      : null;

  const depositPrincipal = Number.parseFloat(depositAmount);
  const depositTermDays = Number.parseFloat(depositDays);
  const selectedDepositRateBase = selectedCalculatorBank ? getDepositRate(selectedCalculatorBank) : null;
  const selectedDepositRate =
    Number.isFinite(selectedDepositRateBase)
      ? depositType === "daily"
        ? Math.max(selectedDepositRateBase - 3.5, 0)
        : depositType === "yearly"
          ? Math.max(selectedDepositRateBase - 1.5, 0)
          : selectedDepositRateBase
      : null;
  const depositProfit =
    Number.isFinite(depositPrincipal) &&
    depositPrincipal > 0 &&
    Number.isFinite(depositTermDays) &&
    depositTermDays > 0 &&
    Number.isFinite(selectedDepositRate)
      ? depositPrincipal * (selectedDepositRate / 100) * (depositTermDays / 365)
      : null;
  const depositTotal = Number.isFinite(depositProfit) ? depositPrincipal + depositProfit : null;

  const principal = Number.parseFloat(loanAmount);
  const months = Number.parseFloat(loanMonths);
  const monthlyRate = selectedCalculatorBank ? getLoanRate(selectedCalculatorBank, loanType) : null;
  const i = Number.isFinite(monthlyRate) ? monthlyRate / 100 : null;
  const loanInstallment =
    Number.isFinite(principal) && principal > 0 && Number.isFinite(months) && months > 0 && Number.isFinite(i)
      ? i === 0
        ? principal / months
        : principal * ((i * (1 + i) ** months) / ((1 + i) ** months - 1))
      : null;
  const loanTotal = Number.isFinite(loanInstallment) ? loanInstallment * months : null;
  const activeLoanRate = Number.isFinite(monthlyRate) ? monthlyRate : null;
  // A-06: üst bar çipleri 26px yükseklikteydi; parmakla isabet ettirilemiyordu.
  const headerBtnClass = headerCompact
    ? "inline-flex items-center justify-center min-h-[2.25rem] rounded-full border px-3 text-[11px] font-semibold transition-all duration-300"
    : "inline-flex items-center justify-center min-h-[2.75rem] rounded-full border px-3.5 text-xs font-semibold transition-all duration-300";


  /** Sıralama ve "Şu An Açık" kontrolleri hem satır içi hem Sheet'te kullanılır. */
  const sortControl = (
    <SearchableSelect
      value={sortBy}
      onChange={handleSortChange}
      options={currentSortOptions}
      placeholder={t("sortLabel")}
      aria-label={t("sortLabel")}
      className="w-full"
    />
  );

  const openNowControl = (
    <button
      type="button"
      role="switch"
      aria-checked={openNowOnly}
      onClick={() => setOpenNowOnly((v) => !v)}
      className={`inline-flex h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-sm font-medium transition-all duration-300 border-ink-300 bg-white dark:border-ink-700 dark:bg-ink-950 hover:border-brand-400 dark:hover:border-brand-400 sm:w-auto sm:justify-start ${
        openNowOnly ? "text-brand-700 dark:text-brand-300" : "text-ink-600 dark:text-ink-300"
      }`}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        <Clock className={`size-4 shrink-0 transition-colors duration-300 ${openNowOnly ? "text-brand-600 dark:text-brand-400" : ""}`} />
        <span className="truncate">{t("openNow")}</span>
      </span>
      <span
        className={`relative ml-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-all duration-300 ${
          openNowOnly
            ? "border-brand-400/60 bg-brand-gradient"
            : "border-ink-400 bg-ink-300 dark:border-ink-600 dark:bg-ink-700"
        }`}
      >
        <span
          className={`inline-block size-3.5 rounded-full bg-white shadow transition ${
            openNowOnly ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );

  /** Mobil filtre düğmesindeki rozet: kaç filtre aktif? */
  const activeFilterCount = (sortBy !== "none" ? 1 : 0) + (openNowOnly ? 1 : 0);

  const currencyConversionLd = useMemo(
    () => JSON.stringify(buildCurrencyConversionJsonLd({ lang, banksCount: banks.length })),
    [lang, banks.length]
  );
  const financialProductLd = useMemo(() => JSON.stringify(buildFinancialProductJsonLd(lang)), [lang]);

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900 relative dark:bg-[#020617] dark:text-white">
      {/*
        ⚠️ SEO DÜZELTMESİ (denetim bulgusu U-09): Bu sayfada DÖRT rakip <Helmet>
        vardı — SeoHead (veritabanından), ana başlık, piyasa özeti bloğu ve
        çevirici bloğu. Üçü prioritizeSeoTags taşıyordu; hangisinin son
        güncellendiğine göre sayfa başlığı değişiyordu (ölçüm: arka arkaya iki
        okuma iki farklı <title> döndürdü) ve çeviricide para birimi seçmek
        sayfanın kimliğini değiştiriyordu.

        Artık title/description/canonical/og'un TEK sahibi App.jsx'teki
        <SeoHead /> — yani süper admin'in SEO paneli gerçekten çalışıyor.
        Burada yalnızca yapısal veri (JSON-LD) kalıyor.
      */}
      <Helmet>
        <script type="application/ld+json">{currencyConversionLd}</script>
        <script type="application/ld+json">{financialProductLd}</script>
      </Helmet>
      <header
        className={`sticky top-0 z-sticky w-full border-b border-ink-200/80 bg-white/80 backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-[#020617]/80 ${
          headerCompact ? "px-3 py-2 shadow-sm sm:px-6 sm:py-2.5" : "px-3 py-3 sm:px-6 sm:py-4 md:py-5"
        }`}
      >
        <div
          className={`mx-auto flex w-full max-w-[1600px] min-w-0 items-center justify-between transition-all duration-300 ${
            headerCompact ? "gap-2 sm:gap-3" : "gap-2 sm:gap-4"
          }`}
        >
        <BrandLogo className="min-w-0 shrink" compact={headerCompact} />
        <div className={`flex min-w-0 shrink-0 flex-wrap items-center justify-end transition-all duration-300 ${headerCompact ? "gap-1 sm:gap-2" : "gap-1.5 sm:gap-3"}`}>
          <div
            className={`hidden sm:inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 font-medium text-brand-700 transition-all duration-300 hover:border-brand-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:text-brand-300 dark:hover:border-brand-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] ${
              headerCompact ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
            }`}
          >
            <span className="relative inline-flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-400 opacity-75"></span>
              <span className="relative inline-flex size-2 rounded-full bg-success-400"></span>
            </span>
            {t("liveMarket")}
          </div>

          <button
            type="button"
            onClick={() =>
              isAuthenticated
                ? navigate(isSuperAdmin ? "/super-admin" : "/admin")
                : setIsBusinessLoginOpen(true)
            }
            className={`${headerBtnClass} max-w-[9.5rem] truncate border-ink-300 bg-white text-ink-700 transition-all duration-300 hover:border-brand-400 hover:text-brand-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-white/10 dark:bg-ink-950/60 dark:text-ink-200 dark:hover:border-brand-400 dark:hover:text-brand-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] sm:max-w-none`}
          >
            {isAuthenticated
              ? isSuperAdmin
                ? t("adminPanel")
                : t("businessPanel")
              : t("businessLogin")}
          </button>

          {isAuthenticated && (
            <button
              type="button"
              onClick={handleLogout}
              className={`inline-flex min-h-[2.75rem] items-center gap-2 rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 font-semibold text-danger-700 dark:text-danger-400 transition-all duration-300 hover:bg-danger-500/20 hover:border-danger-500/60 dark:text-danger-200 ${
                headerCompact ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
              }`}
              title={t("logout")}
            >
              <LogOut className={headerCompact ? "size-3.5" : "size-4"} />
              <span className="hidden md:inline">{t("logout")}</span>
            </button>
          )}

          <button
            type="button"
            onClick={scrollToPartnership}
            className={`hidden sm:inline-flex items-center min-h-[2.75rem] px-3.5 rounded-full border border-ink-300 bg-white font-semibold text-ink-700 transition-all duration-300 hover:border-brand-400 hover:text-brand-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-white/10 dark:bg-ink-950/60 dark:text-ink-200 dark:hover:border-brand-400 dark:hover:text-brand-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] ${
              headerCompact ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
            }`}
          >
            {t("partnership")}
          </button>

          <HeaderActions compact={headerCompact} />
        </div>
        </div>
      </header>
      <BusinessLoginModal isOpen={isBusinessLoginOpen} onClose={() => setIsBusinessLoginOpen(false)} />
      <div className="pointer-events-none fixed -left-60 -top-40 z-0 h-[40rem] w-[40rem] rounded-full bg-brand-500/15 blur-[140px] dark:bg-brand-500/20"></div>
      <div className="pointer-events-none fixed -right-40 top-10 z-0 h-[45rem] w-[45rem] rounded-full bg-brand-500/15 blur-[140px] dark:bg-brand-500/20"></div>
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.05] dark:opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(56,189,248,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.22) 1px, transparent 1px)",
          backgroundSize: "38px 38px",
        }}
      />
      <div className="relative z-raised mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 pb-10 pt-6 sm:px-4 md:gap-8 md:px-8 md:pb-12 md:pt-8">
      <div className="flex w-full flex-col gap-1">
        <h1>{t("homeH1")}</h1>
        <p className="text-sm text-ink-600 dark:text-ink-400">{t("homeLead")}</p>
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white/80 p-4 shadow-xl backdrop-blur-lg transition-all hover:border-brand-500/30 dark:border-white/10 dark:bg-ink-900/60 md:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">{t("marketSummary")}</h2>
            <p className="text-sm text-ink-500 mt-1 dark:text-ink-400">
              {t("marketSummaryNote")}
            </p>
          </div>
          {/* ✅ YENİ: Filtre Butonu (Saatlik / Günlük / Haftalık / Aylık) - Kur Temasıyla Uyumlu */}
          <div className="flex w-full max-w-full flex-wrap gap-1 bg-ink-100/80 p-1 rounded-lg border border-ink-200 backdrop-blur-md dark:bg-ink-950/70 dark:border-white/10 sm:w-auto">
            {[
              { key: "Saatlik", label: t("periodHourly") },
              { key: "Günlük", label: t("periodDaily") },
              { key: "Haftalık", label: t("periodWeekly") },
              { key: "Aylık", label: t("periodMonthly") },
              { key: "Yıllık", label: t("periodYearly") },
            ].map(({ key, label }) => (
              <button 
                key={key}
                onClick={() => setChartPeriod(key)}
                className={`min-h-[2.75rem] px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded-md transition-all duration-300 ease-in-out ${
                  chartPeriod === key 
                    ? 'bg-brand-gradient text-white shadow-lg shadow-brand-500/20 sm:scale-105' 
                    : 'text-ink-600 hover:text-ink-900 bg-transparent hover:bg-ink-200/60 dark:text-ink-300 dark:hover:text-white dark:hover:bg-ink-900/40'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        
        {/* ✅ SADELEŞTIRILMIŞ: Sadece USD, EUR, GBP - GERÇEK VERİ */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {['USD', 'EUR', 'GBP'].map((currency) => (
            <MarketSummaryCard 
              key={currency} 
              currency={currency} 
              period={chartPeriod}
            />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white/80 p-4 sm:p-6 shadow-xl backdrop-blur-lg transition-all hover:border-brand-500/30 dark:border-white/10 dark:bg-ink-900/60">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-600 dark:text-ink-300">
            {mode === "exchange"
              ? t("currencyConverter")
              : mode === "interest"
                ? t("depositCalculator")
                : t("loanCalculator")}
          </h2>
        </div>

        {mode === "exchange" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-12">
            {/* 1️⃣ DÖVIZ BİRİMİ (Sol taraf) */}
            <div className="flex min-w-0 flex-col gap-1 xl:col-span-2">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">{t("currencyUnit")}</label>
              <SearchableSelect
                value={exchangeCurrency}
                onChange={setExchangeCurrency}
                placeholder={t("selectCurrency")}
                aria-label={t("currencyUnit")}
                options={[
                  { value: "", label: t("selectCurrency") },
                  { value: "USD", label: "USD" },
                  { value: "EUR", label: "EUR" },
                  { value: "GBP", label: "GBP" },
                ]}
              />
            </div>

            {/* 2️⃣ İŞLEM TÜRÜ (Alış / Satış) */}
            <div className="flex min-w-0 flex-col gap-1 xl:col-span-2">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">{t("operationType")}</label>
              <div className="inline-flex w-full rounded-lg border border-ink-200 bg-ink-50/80 p-1 backdrop-blur-md dark:border-white/10 dark:bg-ink-900/80">
                <button
                  type="button"
                  onClick={() => setExchangeOperation("buy")}
                  className={`min-w-0 flex-1 rounded-md px-2 py-2 text-sm font-bold transition sm:px-3 ${
                    exchangeOperation === "buy"
                      ? "bg-brand-gradient text-white shadow-lg shadow-brand-500/20"
                      : "text-ink-600 dark:text-ink-300"
                  }`}
                >
                  {t("buy")}
                </button>
                <button
                  type="button"
                  onClick={() => setExchangeOperation("sell")}
                  className={`min-w-0 flex-1 rounded-md px-2 py-2 text-sm font-bold transition sm:px-3 ${
                    exchangeOperation === "sell" ? "bg-success-600 text-white shadow-lg shadow-success-500/20" : "text-ink-600 dark:text-ink-300"
                  }`}
                >
                  {t("sell")}
                </button>
              </div>
            </div>

            {/* 3️⃣ DÖVİZ BÜROSU SEÇİN (Dinamik kur gösterimi) */}
            <div className="flex min-w-0 flex-col gap-1 sm:col-span-2 xl:col-span-3">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">{t("selectBank")}</label>
              <SearchableSelect
                value={calculatorBank}
                onChange={(value) => {
                  setCalculatorBank(value);
                  setExchangeAmount("0");
                }}
                placeholder={!exchangeCurrency ? t("selectCurrencyFirst") : t("selectExchangeOffice")}
                disabled={!exchangeCurrency}
                aria-label={t("selectBank")}
                options={[
                  { value: "", label: !exchangeCurrency ? t("selectCurrencyFirst") : t("selectExchangeOffice") },
                  ...(exchangeCurrency ? [...banks]
                    .sort((a, b) => a.name.localeCompare(b.name, localeCode))
                    .map((bank) => {
                      const rate = bank.exchangeRates?.find((r) => r.currency === exchangeCurrency);
                      // Seçilen işlem türü = tabeladaki kur (Alış→buy, Satış→sell)
                      const price = exchangeOperation === "buy"
                        ? (Number.isFinite(rate?.buy) ? rate.buy.toFixed(2) : "—")
                        : (Number.isFinite(rate?.sell) ? rate.sell.toFixed(2) : "—");
                      const operationType = exchangeOperation === "buy" ? t("buy") : t("sell");
                      return {
                        value: bank.name,
                        label: `${bank.name} | ${operationType}: ${price}`,
                      };
                    }) : []),
                ]}
              />
            </div>

            {/* 4️⃣ ÇEVRİLECEK TUTAR — büro seçilince açılır */}
            <div className="flex min-w-0 flex-col gap-1 xl:col-span-2">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">
                {exchangeOperation === "buy"
                  ? // Para birimi henüz seçilmediyse boş parantez gösterme.
                    exchangeCurrency
                    ? `${t("amountCurrency")} (${exchangeCurrency})`
                    : t("amountCurrency")
                  : t("amountTl")}
              </label>
              <input
                type="number"
                min="0"
                disabled={!calculatorBank}
                value={!calculatorBank ? "" : exchangeAmount === "0" ? "" : exchangeAmount}
                onChange={(e) => setExchangeAmount(e.target.value === "" ? "0" : e.target.value)}
                className="h-11 w-full rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 outline-none transition-all duration-300 hover:border-brand-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] focus:border-brand-400 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-ink-700 dark:bg-ink-950 dark:text-ink-100 dark:hover:border-brand-400 dark:focus:border-brand-400 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-ink-300 disabled:hover:shadow-none dark:disabled:hover:border-ink-700"
                placeholder={!calculatorBank ? t("selectOfficePrompt") : t("enterAmount")}
              />
            </div>

            {/* 5️⃣ SONUÇ — tutar girilince açılır */}
            <div className="flex min-w-0 flex-col gap-1 sm:col-span-2 xl:col-span-3">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">
                {exchangeOperation === "buy"
                  ? t("resultSell")
                  : `${t("resultBuy")} ${exchangeCurrency || ""}`.trim()}
              </label>
              <div
                className={`flex h-11 w-full items-center overflow-hidden rounded-lg border px-3 text-sm outline-none transition-all duration-300 dark:border-ink-700 dark:bg-ink-950 ${
                  Number.isFinite(exchangeResult) && calculatorBank && Number(exchangeAmount) > 0
                    ? "border-ink-300 bg-white font-semibold text-ink-900 dark:text-ink-100"
                    : "cursor-not-allowed border-ink-300 bg-white text-ink-600 dark:text-ink-400 opacity-60 dark:text-ink-500"
                }`}
              >
                <span className="truncate">
                {Number.isFinite(exchangeResult) && calculatorBank && Number(exchangeAmount) > 0
                  ? `${exchangeResult.toLocaleString(localeCode, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} ${exchangeOperation === "buy" ? "TL" : exchangeCurrency}`
                  : !calculatorBank
                    ? t("selectOfficePrompt")
                    : t("enterAmountPrompt")}
                </span>
              </div>
            </div>

          </div>
        ) : mode === "interest" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">{t("selectBank")}</label>
              <SearchableSelect
                value={calculatorBank}
                onChange={setCalculatorBank}
                placeholder={t("selectBankPlaceholder")}
                options={[...banks]
                  .sort((a, b) => a.name.localeCompare(b.name, "tr"))
                  .map((bank) => ({ value: bank.name, label: bank.name }))}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">Anapara Tutarı (TL)</label>
              <input
                type="number"
                min="0"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="h-11 w-full rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 outline-none focus:border-brand-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                placeholder="Anapara (TL)"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">Vade Türü</label>
              <SearchableSelect
                value={depositType}
                onChange={setDepositType}
                options={[
                  { value: "daily", label: t("periodDaily") },
                  { value: "monthly", label: t("periodMonthly") },
                  { value: "yearly", label: t("periodYearly") },
                ]}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">Vade Süresi (Gün)</label>
              <input
                type="number"
                min="1"
                value={depositDays}
                onChange={(e) => setDepositDays(e.target.value)}
                className="h-11 w-full rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 outline-none focus:border-brand-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                placeholder="Vade (Gün)"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">Net Getiri</label>
              <div className="flex h-11 items-center overflow-hidden rounded-lg border border-brand-300/60 bg-brand-50 px-3 text-sm text-ink-900 dark:border-brand-700/60 dark:bg-brand-900/50 dark:text-ink-100">
                <span className="truncate">
                {Number.isFinite(depositProfit)
                  ? `${depositProfit.toLocaleString(localeCode, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Net getiri hesaplanamadı"}
                </span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">Vade Sonu Toplam</label>
              <div className="flex h-11 items-center overflow-hidden rounded-lg border border-brand-300/60 bg-brand-50 px-3 text-sm text-ink-900 dark:border-brand-700/60 dark:bg-brand-900/50 dark:text-ink-100">
                <span className="truncate">
                {Number.isFinite(depositTotal)
                  ? `${depositTotal.toLocaleString(localeCode, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Vade sonu bekleniyor"}
                </span>
              </div>
            </div>
            <div className="sm:col-span-2 lg:col-span-3 xl:col-span-6 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-xs text-brand-300">
              {Number.isFinite(selectedDepositRate)
                ? `Kullanılan Faiz Oranı: %${selectedDepositRate.toFixed(2)} (${depositType === "daily" ? "Günlük" : depositType === "monthly" ? "Aylık" : "Yıllık"} baz)`
                : "Faiz oranı döviz bürosu verisine göre belirlenecektir."}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">{t("selectBank")}</label>
              <SearchableSelect
                value={calculatorBank}
                onChange={setCalculatorBank}
                placeholder={t("selectBankPlaceholder")}
                options={[...banks]
                  .sort((a, b) => a.name.localeCompare(b.name, "tr"))
                  .map((bank) => ({ value: bank.name, label: bank.name }))}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">Kredi Türü</label>
              <SearchableSelect
                value={loanType}
                onChange={setLoanType}
                options={[
                  { value: "tasit", label: "Taşıt" },
                  { value: "konut", label: "Konut" },
                  { value: "ihtiyac", label: "İhtiyaç" },
                ]}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">Kredi Tutarı (TL)</label>
              <input
                type="number"
                min="0"
                value={loanAmount}
                onChange={(e) => setLoanAmount(e.target.value)}
                className="h-11 w-full rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 outline-none focus:border-brand-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                placeholder="Kredi Tutarı (TL)"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">Vade (Ay)</label>
              <input
                type="number"
                min="1"
                value={loanMonths}
                onChange={(e) => setLoanMonths(e.target.value)}
                className="h-11 w-full rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 outline-none focus:border-brand-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                placeholder="Vade (Ay)"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">Aylık Taksit Tutarı</label>
              <div className="flex h-11 items-center overflow-hidden rounded-lg border border-brand-300/60 bg-brand-50 px-3 text-sm text-ink-900 dark:border-brand-700/60 dark:bg-brand-900/50 dark:text-ink-100">
                <span className="truncate">
                {Number.isFinite(loanInstallment)
                  ? `${loanInstallment.toLocaleString(localeCode, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Taksit hesaplanamadı"}
                </span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs font-medium text-brand-700 dark:text-brand-300">Toplam Geri Ödeme</label>
              <div className="flex h-11 items-center overflow-hidden rounded-lg border border-brand-300/60 bg-brand-50 px-3 text-sm text-ink-900 dark:border-brand-700/60 dark:bg-brand-900/50 dark:text-ink-100">
                <span className="truncate">
                {Number.isFinite(loanTotal)
                  ? `${loanTotal.toLocaleString(localeCode, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Toplam ödeme bekleniyor"}
                </span>
              </div>
            </div>
            <div className="sm:col-span-2 lg:col-span-3 xl:col-span-6 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-xs text-brand-700 dark:text-brand-300">
              {Number.isFinite(activeLoanRate) && selectedCalculatorBank
                ? `💡 Uygulanan Aylık Faiz: %${activeLoanRate.toFixed(2)} (${selectedCalculatorBank.name} ${
                    loanType === "tasit" ? "Taşıt Kredisi" : loanType === "konut" ? "Konut Kredisi" : "İhtiyaç Kredisi"
                  })`
                : "💡 Uygulanan faiz, seçilen döviz bürosu ve kredi türüne göre belirlenir."}
            </div>
          </div>
        )}
      </div>

      <h2 className="text-lg font-semibold text-ink-900 dark:text-white">{t("homeH2Offices")}</h2>

      {/*
        A-06 / mobil UX: Arama + sıralama + "Şu An Açık" üç kontrolü 375px'te
        dar alana sıkışıyordu. Mobilde arama görünür kalır, sıralama ve filtre
        alttan açılan Sheet'e taşınır; sm+ ekranlarda hepsi eskisi gibi satır içi.
      */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full min-w-0 sm:max-w-xs sm:flex-1 lg:w-64 lg:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-600 dark:text-ink-400" />
            <input
              type="search"
              placeholder={t("searchBanks")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 w-full rounded-lg border border-ink-300 bg-white pl-10 pr-3 text-sm text-ink-900 outline-none transition-all duration-300 hover:border-brand-400 focus:border-brand-400 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-100 dark:hover:border-brand-400 dark:focus:border-brand-400"
            />
          </div>

          {/* Mobil: tek düğme → Sheet */}
          <button
            type="button"
            onClick={() => setFilterSheetOpen(true)}
            className="btn-ghost w-full justify-between sm:hidden"
          >
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
              {t("sortLabel")}
            </span>
            {activeFilterCount > 0 ? (
              <span className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-brand-600 px-1.5 py-0.5 text-xs font-bold text-white">
                {activeFilterCount}
              </span>
            ) : null}
          </button>

          {/* sm+ : satır içi kontroller */}
          <div className="hidden w-full min-w-0 sm:block sm:max-w-[14rem] sm:flex-1 lg:w-56 lg:flex-none">
            {sortControl}
          </div>
          <div className="hidden sm:block">{openNowControl}</div>
        </div>
      </div>

      <Sheet
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        title={t("sortLabel")}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setSortBy("none");
                setOpenNowOnly(false);
              }}
            >
              {t("clearFilters")}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setFilterSheetOpen(false)}
            >
              {t("showResults")} ({filteredAndSortedBanks.length})
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pt-1">
          {sortControl}
          {openNowControl}
        </div>
      </Sheet>

      {geoToast ? (
        <div className="rounded-lg border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-sm text-warning-800 dark:text-warning-200">
          {geoToast}
        </div>
      ) : null}

      {showLocationConsent ? (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-ink-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-5 shadow-2xl dark:border-ink-700 dark:bg-ink-900">
            <h3 className="text-base font-bold text-ink-900 dark:text-white">
              {t("locationShareTitle")}
            </h3>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
              {t("locationShareConfirm")}
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  setShowLocationConsent(false);
                  setSortBy("none");
                  setGeoToast(t("locationPermissionRequired"));
                }}
                className="btn-ghost flex-1"
              >
                {t("locationShareDeny")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLocationConsent(false);
                  requestNearestSort();
                }}
                className="btn-primary flex-1"
              >
                {t("locationShareAllow")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {banks.length === 0 ? (
        <div className="rounded-2xl border border-ink-200 bg-white/80 p-6 py-10 text-center text-ink-600 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-ink-900/60 dark:text-ink-300">
          {t("banksLoading")}
        </div>
      ) : filteredAndSortedBanks.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8 lg:grid-cols-3 md:gap-10">
          {filteredAndSortedBanks.map((bank) => (
            <V0BankCard
              key={bank.institutionId || bank.id}
              bank={bank}
              mode={mode}
              bestRates={bestRates}
              branches={
                branchesByInstitution[bank.institutionId] ||
                branchesByInstitution[normalizeText(bank.name)] ||
                []
              }
              showNearestBranch={sortBy === "nearest" && Boolean(userLocation)}
              onSelect={(biz) => {
                const name = String(biz?.name || "")
                  .replace(/\s*\([Tt]est\)\s*/g, "")
                  .trim();
                trackBusinessClick(name || biz?.name);
                const nearest = biz?.nearestBranch;
                const slug = nearest?.id
                  ? buildBranchSlug(nearest, name || biz?.name)
                  : biz?.slug ||
                    buildBusinessSlug({
                      institutionId: biz?.institutionId,
                      name: name || biz?.name,
                    });
                navigate(exchangeOfficePath(slug));
              }}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-ink-200 bg-white/80 p-6 py-10 text-center text-ink-600 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-ink-900/60 dark:text-ink-300">
          {t("noBanksMatch")}
        </div>
      )}

      {lastUpdated ? (
        <div className="mt-10 flex justify-center px-2">
          <div className="rounded-lg border border-ink-200 bg-white/80 px-4 py-2.5 text-center text-xs tracking-wide text-ink-500 shadow-sm dark:border-ink-700/80 dark:bg-ink-950/60">
            {/* U-05: bu değer sunucunun son kontrol anı, bültenin tarihi değil. */}
            {`${t("lastChecked")}: ${new Date(lastUpdated).toLocaleDateString(localeCode)} - ${new Date(lastUpdated).toLocaleTimeString(localeCode)}`}
          </div>
        </div>
      ) : null}

        <PartnershipForm />

        {/* ✅ FIXED MODAL - ÇIKIS */}
        {showLogoutPopup && (
          <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
            <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-ink-700 bg-[#1a1f2e] p-6 shadow-2xl transition-all sm:p-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-danger-500/20 animate-spin">
                <svg className="h-8 w-8 text-danger-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <h3 className="text-center text-lg font-bold text-white sm:text-xl">Çıkış Yapılıyor...</h3>
              <p className="mt-2 text-center text-sm text-ink-300">Anasayfaya yönlendiriliyorsunuz</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
