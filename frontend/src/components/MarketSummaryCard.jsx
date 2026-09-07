import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  X,
  ZoomIn,
} from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartHoverCard, ChartSwatch, ChartTooltip } from "./ui/chart";
import { chartSkin, hollowDot } from "../lib/chartTheme";
import { HeaderActions } from "./HeaderActions";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { trackCurrencyView } from "../lib/analytics";
import { apiUrl } from "../lib/api";
import { useScrollLock } from "../hooks/useScrollLock";
import { rateTrendSentence } from "../lib/rateNarrative";

/*
  ⚠️ OPTİMİZASYON (O-01b): "Piyasa Özeti" grafiği kendi dosyasına taşındı ve
  ana panoya TEMBEL yükleniyor. Böylece recharts + d3 (~113 kB gzip) artık
  ilk açılış paketine girmiyor — kur kartları çizildikten sonra, kullanıcı
  grafiğe kaydırırken (ya da idle'da önceden) indiriliyor.

  ⚠️ OPTİMİZASYON (O-02): DateField, react-day-picker'ı (~21 kB gzip) çekiyor;
  yalnızca grafik büyütme modalında gerekiyor, o yüzden burada da tembel.
*/
const DateField = lazy(() =>
  import("./ui/date-field").then((m) => ({ default: m.DateField }))
);

function RatePointTooltip({ active, payload, label, formatLabel, seriesLabel, color }) {
  if (!active || !payload?.length) return null;
  const buy = payload.find((entry) => entry.dataKey === "buy" && entry.value != null);
  if (!buy) return null;
  return (
    <ChartHoverCard label={formatLabel(label)}>
      <div className="flex items-center gap-2 text-xs">
        <ChartSwatch label={`${seriesLabel}:`} color={color} />
        <span className="font-semibold tabular-nums text-ink-900 dark:text-white">
          {Number(buy.value).toFixed(4)} ₺
        </span>
      </div>
    </ChartHoverCard>
  );
}

/**
 * Kart yüksekliği — dolu kart, yükleme/hata yer tutucusu ve V0FinancialDashboard'daki
 * Suspense fallback'i HEP aynı değeri kullanır; küçük yer tutucu veri gelince sayfayı
 * zıplatır (ölçülen CLS 0.75). x-ekseni etiket bandı da bu yüksekliğe dahildir —
 * eskiden `overflow-hidden` + 294 px, alt satırdaki saat etiketlerini kırpıyordu.
 */
export const CHART_CARD_HEIGHT = 356;

const CHART_CARD_PLACEHOLDER_CLASS =
  "flex items-center justify-center rounded-xl border border-ink-200 " +
  "bg-white p-4 dark:border-ink-800 dark:bg-ink-900";

/**
 * Dönem gezinme oku — grafiğin ÜSTÜNDEKİ kontrol şeridinde, tarih aralığının iki
 * yanında. Eskiden grafiğin üstüne binen iki serbest daireydi (çizgiyi örtüyordu,
 * "yapıya uymuyor"du). Artık mevcut kontrol dili: kare ölçü, `rounded-control`,
 * bas-geri-bildirimi (`active:scale`), tema-farkındalıklı yüzey.
 */
function NavButton({ dir, onClick, disabled, label }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-control border border-ink-200 bg-white text-ink-600 transition-[background-color,color,transform] duration-fast ease-out-strong hover:bg-ink-100 hover:text-ink-900 active:scale-95 disabled:pointer-events-none disabled:opacity-40 dark:border-white/10 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700 dark:hover:text-white"
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}

export function MarketSummaryCard({ currency = 'USD', period = 'Günlük' }) {
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

  // ✅ Modal açıkken arka plan scroll kilidi (M5: ref-sayaçlı, önceki değeri geri yükler)
  useScrollLock(isModalOpen);

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
    // M8: 5 dk → 15 dk ve yalnızca sekme görünürken (soğuk-başlangıç backend'i
    // arka planda gereksiz uyandırmasın).
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchData();
    }, 900000);
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

  // Tek seri: renk semantik (yükseliş yeşil, düşüş kırmızı). Çizgi dili neon cilt.
  const skin = chartSkin(isDark);
  const strokeColor = displayPercentage >= 0 ? skin.up : skin.down;
  const gradientId = `colorValue-${currency}`;
  const chartConfig = {
    buy: { label: t("rateLabel"), color: strokeColor },
  };

  // ✅ Domain: her zaman aktif zaman penceresi
  const chartDomain = useMemo(
    () => [timeWindow.windowStart, timeWindow.windowEnd],
    [timeWindow]
  );

  // X ekseni tick'leri `renderChartContent` içinde kenarlardan içeri kaydırılmış
  // hesaplanır (5 tick, kenarlardan içeri). `timeWindow.customTicks` artık kullanılmıyor.

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

  // Modal başlığı / aria: tam "7 Eylül 2026". Kart navigatörü: kısa "7 Eyl"
  // (1/3 genişliğindeki kartta uzun biçim iki nav butonuyla yan yana sığmıyor).
  const formatHeaderDate = (ms) => {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString(localeCode, { day: "numeric", month: "long", year: "numeric" });
  };
  const formatNavDate = (ms) => {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString(localeCode, { day: "numeric", month: "short" });
  };

  /*
    ⚠️ TASARIM DÜZELTMESİ: X ekseni etiketleri hem BİRBİRİNE BİNİYOR hem de
    ORANSIZ duruyordu. Üç neden vardı:
      1. Tick'ler tam pencere kenarlarına (%0 ve %100) konuyordu → ilk etiket
         Y-eksenine, son etiket kartın kenarına yapışıp kırpılıyordu.
      2. 1/3 genişliğindeki kartta 5 adet "08/09, 14:00" (12 karakter) etiket
         için yer yok.
      3. Tam tarih aralığı zaten kartın üst şeridinde yazıyor; eksende
         tekrar etmek gürültü.
    Çözüm: etiket biçimi PENCERE GENİŞLİĞİNE göre (period'a değil — özel
    aralıklar da doğru olsun): ≤2 gün → sadece saat, ≤~6 hafta → "3 Eyl",
    daha uzun → "Eyl 25". Tick sayısı ve konumu `renderChartContent`'te
    kenarlardan içeri kaydırılmış olarak hesaplanır.
  */
  const formatXAxis = (ms) => {
    if (!ms) return "";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    const spanMs = timeWindow.windowEnd - timeWindow.windowStart;
    const DAY = 86400000;
    if (spanMs <= 2 * DAY) {
      return `${String(d.getHours()).padStart(2, "0")}:00`;
    }
    if (spanMs <= 45 * DAY) {
      return d.toLocaleDateString(localeCode, { day: "numeric", month: "short" });
    }
    return d.toLocaleDateString(localeCode, { month: "short", year: "2-digit" });
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

  /*
    ⚠️ PERFORMANS DÜZELTMESİ (CLS): Bu iki yer tutucu `h-32` (128 px) idi, dolu
    kart ise 294 px. Grafik verisi geldiğinde kart 166 px büyüyor, üç kart yan
    yana durduğu için ALTINDAKİ HER ŞEY (döviz çevirici, büro ızgarası) aşağı
    zıplıyordu. Ölçülen CLS 0.75 — "iyi" sınırı 0.1. Sayfanın oturmamış,
    takılıyormuş gibi hissettirmesinin başlıca sebebi buydu.

    Yer tutucular artık dolu kartla aynı yüksekliği kaplıyor; veri gelince
    içerik yerine oturuyor, kutu kıpırdamıyor.
  */
  if (loading) {
    return (
      <div className={CHART_CARD_PLACEHOLDER_CLASS} style={{ height: CHART_CARD_HEIGHT }}>
        <p className="text-xs text-ink-500 dark:text-ink-400">{t("loadingGeneric")}</p>
      </div>
    );
  }

  // Yalnızca gerçekten hiç rate yoksa "Veri yok" — navigasyon sonrası boş pencere kartı öldürmesin
  if (error || chartData.length === 0) {
    return (
      <div className={CHART_CARD_PLACEHOLDER_CLASS} style={{ height: CHART_CARD_HEIGHT }}>
        <p className="text-xs text-ink-500 dark:text-ink-400">{error ? `❌ ${error}` : t("chartNoData")}</p>
      </div>
    );
  }

  if (displayChartData.length === 0) {
    return (
      <div className={CHART_CARD_PLACEHOLDER_CLASS} style={{ height: CHART_CARD_HEIGHT }}>
        <p className="text-xs text-ink-500 dark:text-ink-400">{t("chartNoPointsInRange")}</p>
      </div>
    );
  }

  const last = displayChartData[displayChartData.length - 1].buy;
  const change = Number(displayPercentage).toFixed(2);
  const isPositive = parseFloat(change) >= 0;

  const areaOpacity = isDark ? 0.3 : 0.18;
  const showDots = displayChartData.length <= 16;
  // ✅ DRY: Aynı grafik hem küçük kartta hem tam ekran modalda kullanılır
  const renderChartContent = (isExpanded = false) => {
    const tickFont = isExpanded ? 12 : 10;
    const gradId = `${gradientId}${isExpanded ? "-modal" : ""}`;
    const dot = hollowDot(strokeColor, skin.dotFill, isExpanded ? 6 : 5);

    // Kenarlardan içeri kaydırılmış eşit aralıklı 5 tick. İlk/son tick kartın
    // kenarına yapışmaz → kırpılma ve Y-ekseniyle çakışma biter.
    const tickCount = 5;
    const inset = isExpanded ? 0.05 : 0.1;
    const span = Math.max(timeWindow.windowEnd - timeWindow.windowStart, 1);
    const axisTicks = Array.from({ length: tickCount }, (_, i) => {
      const f = inset + (i * (1 - 2 * inset)) / (tickCount - 1);
      return Math.round(timeWindow.windowStart + span * f);
    });

    return (
      <div
        className="relative h-full w-full"
        role="img"
        aria-label={`${currency}/TRY ${t("chartDetailedAnalysis")} — ${change >= 0 ? "+" : ""}${change}% (${formatHeaderDate(timeWindow.windowStart)} – ${formatHeaderDate(timeWindow.windowEnd)})`}
      >
        <div
          className="h-full w-full"
          style={
            isExpanded
              ? { height: "100%", paddingLeft: "16px", paddingRight: "16px" }
              : { paddingLeft: "2px", paddingRight: "2px" }
          }
        >
          <ChartContainer
            config={chartConfig}
            className={`aspect-auto h-full w-full [&_.recharts-curve.recharts-tooltip-cursor]:stroke-ink-300 dark:[&_.recharts-curve.recharts-tooltip-cursor]:stroke-white/20 ${
              isExpanded ? "min-h-[400px]" : "min-h-[172px]"
            }`}
          >
            <ComposedChart
              data={displayChartData}
              margin={
                isExpanded
                  ? { top: 20, bottom: 30, left: 8, right: 16 }
                  : { top: 8, bottom: 4, left: 4, right: 12 }
              }
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={strokeColor} stopOpacity={areaOpacity} />
                  <stop offset="100%" stopColor={strokeColor} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke={skin.grid}
                strokeOpacity={1}
                horizontal
                vertical={false}
              />
              <XAxis
                dataKey="timeMs"
                type="number"
                scale="time"
                domain={chartDomain}
                ticks={axisTicks}
                interval={0}
                minTickGap={8}
                tickFormatter={formatXAxis}
                tick={{ fontSize: tickFont, fill: skin.tick }}
                axisLine={false}
                tickLine={false}
                tickMargin={10}
                padding={{ left: 2, right: 2 }}
              />
              <YAxis
                domain={yAxisConfig.domain}
                ticks={yAxisConfig.ticks}
                width={isExpanded ? 48 : 40}
                tickFormatter={(val) => Number(val).toFixed(2)}
                tick={{ fontSize: tickFont, fill: skin.tick }}
                axisLine={false}
                tickLine={false}
                tickMargin={6}
              />
              <ChartTooltip
                content={
                  <RatePointTooltip
                    formatLabel={formatChartTooltipLabel}
                    seriesLabel={t("rateLabel")}
                    color={strokeColor}
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
                dataKey="buy"
                stroke="transparent"
                fill={`url(#${gradId})`}
                strokeWidth={0}
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
              <Line
                type="linear"
                dataKey="buy"
                stroke={strokeColor}
                strokeWidth={isExpanded ? 2.5 : 2}
                dot={showDots ? dot : false}
                activeDot={dot}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
        </div>
      </div>
    );
  };

  const goPrev = () => {
    setCustomDateRange({ start: null, end: null });
    setTimeOffset((prev) => Math.min(prev + 1, maxTimeOffset));
  };
  const goNext = () => {
    setCustomDateRange({ start: null, end: null });
    setTimeOffset((prev) => Math.max(0, prev - 1));
  };

  return (
    <>
      {/*
        ⚠️ TASARIM DÜZELTMESİ (piyasa özeti grafiği): önceki hâlde
          • sol/sağ dönem okları grafiğin ÜSTÜNE binen iki serbest daireydi —
            çizgiyi/alanı örtüyor, "mevcut yapıya uymuyor"du;
          • tarih aralığı `absolute top-3` ile kur/parite etiketiyle AYNI y'de
            duruyor, dar kartta üst üste geliyordu;
          • kart `h-[294px] overflow-hidden` idi ama içerik daha uzundu →
            x-eksenindeki saat etiketleri alttan kırpılıyordu.
        Artık tek bir dikey akış: (1) parite + kur + değişim, (2) dönem
        navigatörü [‹ tarih ›] + büyüteç TEK kontrol şeridi olarak grafiğin
        ÜSTÜNDE, (3) düz-dil trend cümlesi sabit 2 satır, (4) grafik kalan
        alanı kaplar. Yükseklik x-ekseni bandını da içerir (CHART_CARD_HEIGHT).
      */}
      <div
        className="relative flex flex-col overflow-hidden rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900"
        style={{ height: CHART_CARD_HEIGHT }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-500 dark:text-ink-400">{currency}/TRY</p>
            <p className="mt-0.5 font-mono text-xl font-bold tabular-nums tracking-tight text-ink-900 dark:text-white">
              {last.toFixed(4)}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-control px-2 py-1 font-mono text-xs font-semibold tabular-nums ${
              isPositive
                ? "bg-success-500/10 text-success-700 dark:text-success-400"
                : "bg-danger-500/10 text-danger-700 dark:text-danger-400"
            }`}
          >
            {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {isPositive ? "+" : ""}{change}%
          </span>
        </div>

        {/* Dönem navigatörü — tek kontrol şeridi, grafiğin üstünde */}
        <div className="mt-2.5 flex items-center gap-1.5">
          <NavButton
            dir="prev"
            onClick={goPrev}
            disabled={timeWindow.isLeftDisabled}
            label={t("chartPrevPeriod")}
          />
          <span
            className="min-w-0 flex-1 truncate text-center text-[11px] font-medium tabular-nums text-ink-600 dark:text-ink-300"
            title={`${formatHeaderDate(timeWindow.windowStart)} – ${formatHeaderDate(timeWindow.windowEnd)}`}
          >
            {formatNavDate(timeWindow.windowStart)} – {formatNavDate(timeWindow.windowEnd)}
          </span>
          <NavButton
            dir="next"
            onClick={goNext}
            disabled={timeOffset === 0}
            label={t("chartNextPeriod")}
          />
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-control border border-ink-200 bg-white text-ink-500 transition-[background-color,color,transform] duration-fast ease-out-strong hover:bg-ink-100 hover:text-ink-900 active:scale-95 dark:border-white/10 dark:bg-ink-800 dark:text-ink-400 dark:hover:bg-ink-700 dark:hover:text-white"
            title={t("chartDetailedAnalysis")}
            aria-label={t("chartExpand")}
          >
            <ZoomIn size={13} aria-hidden="true" />
          </button>
        </div>

        {/* Düz-dil trend cümlesi — sabit 2 satırlık yuva (grafik kaymasın) */}
        <p
          className="mt-2 line-clamp-2 min-h-[2.25rem] text-[11px] leading-snug text-ink-600 dark:text-ink-300"
          aria-live="polite"
        >
          {rateTrendSentence({ currency, period, percent: displayPercentage, lang })}
        </p>

        {dataInfo?.isLimitedByAvailableData && period !== "Yıllık" && (
          <p className="text-[10px] text-warning-600/90 dark:text-warning-400/80">
            Sınırlı geçmiş veri ({dataInfo.actualSpanDays} gün / {dataInfo.requestedSpanDays} gün gerekli)
          </p>
        )}

        <div className="mt-1 min-h-0 flex-1">{renderChartContent(false)}</div>
      </div>

      {isModalOpen && createPortal(
        <div
          className="fixed inset-0 z-toast flex w-screen items-center justify-center bg-ink-950/50 p-3 backdrop-blur-md sm:p-4 md:p-6 dark:bg-ink-950/80"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="relative flex max-h-[min(92dvh,90vh)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:border-t-white/20 dark:bg-ink-900/70"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute right-2 top-2 z-dropdown flex items-center gap-1.5 sm:right-3 sm:top-3 sm:gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded-full text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label={t("commonClose")}
              >
                <X size={22} />
              </button>
            </div>

            {/* Özel Tarih Seçici — mobilde üst şerit, masaüstünde sol üst */}
            <div className="relative z-raised flex flex-wrap items-center gap-2 border-b border-ink-200/80 bg-ink-50/90 px-3 py-2.5 backdrop-blur-sm dark:border-ink-700/50 dark:bg-ink-900/50 sm:absolute sm:left-4 sm:top-4 sm:max-w-[min(100%,28rem)] sm:rounded-lg sm:border sm:border-ink-200 sm:p-1.5 md:left-6 dark:sm:border-ink-700/50">
              {/* O-02: takvim kütüphanesi modal açılınca yüklenir. */}
              <Suspense fallback={null}>
              <DateField
                label={t("dateRangeStart")}
                className="min-w-0 flex-1 sm:flex-none"
                locale={localeCode}
                value={startDateStr}
                min={formatForInput(oldestDataTime)}
                max={endDateStr || todayStr}
                onChange={(next) => {
                  const newStartMs = parseDateInputToMs(next);
                  if (newStartMs == null) return;
                  setCustomDateRange((prev) => {
                    if (Number.isFinite(prev.end) && newStartMs > prev.end) return prev;
                    const clamped =
                      Number.isFinite(oldestDataTime) && newStartMs < oldestDataTime
                        ? oldestDataTime
                        : newStartMs;
                    return { ...prev, start: clamped };
                  });
                  setTimeOffset(0);
                }}
              />
              <span className="shrink-0 text-sm text-ink-600 dark:text-ink-400">-</span>
              <DateField
                label={t("dateRangeEnd")}
                className="min-w-0 flex-1 sm:flex-none"
                locale={localeCode}
                value={endDateStr}
                min={startDateStr}
                max={todayStr}
                onChange={(next) => {
                  const newEndMs = parseDateInputToMs(next);
                  if (newEndMs == null) return;
                  setCustomDateRange((prev) => {
                    if (Number.isFinite(prev.start) && newEndMs < prev.start) return prev;
                    return { ...prev, end: newEndMs };
                  });
                }}
              />
              </Suspense>
            </div>

            <div className="flex flex-shrink-0 flex-col items-center px-3 pb-0 pt-3 sm:p-4 sm:pb-0 md:p-6 md:pb-0 md:pt-14">
              <h2 className="max-w-full truncate px-12 text-center text-lg font-bold text-ink-800 dark:text-ink-100 sm:px-16 md:text-2xl">{currency}/TRY Detaylı Analiz</h2>
              <span className={`mt-1 text-base font-bold md:text-xl ${displayPercentage >= 0 ? 'text-success-700 dark:text-success-400' : 'text-danger-700 dark:text-danger-400'}`}>
                {displayPercentage >= 0 ? '+' : ''}{displayPercentage.toFixed(2)}%
              </span>
              <p
                className="mt-1.5 max-w-[36ch] text-center text-xs text-ink-600 dark:text-ink-300"
                aria-live="polite"
              >
                {rateTrendSentence({ currency, period, percent: displayPercentage, lang })}
              </p>
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
