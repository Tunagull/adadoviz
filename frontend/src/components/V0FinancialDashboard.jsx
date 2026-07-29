import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  X,
  Clock,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { V0BankCard } from "./V0BankCard";
import { BusinessDetailModal } from "./BusinessDetailModal";
import { BusinessLoginModal } from "./BusinessLoginModal";
import { SearchableSelect } from "./SearchableSelect";
import { HeaderActions } from "./HeaderActions";
import { BrandLogo } from "./BrandLogo";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { trackBusinessClick, trackCurrencyView } from "../lib/analytics";
import { apiUrl } from "../lib/api";

/**
 * ✅ Piyasa Özeti Kartı - Gerçek Geçmiş Veri Grafiği ve SSE Canlı Güncellemeleri
 */
function MarketSummaryCard({ currency = 'USD', period = 'Günlük' }) {
  const { theme } = useTheme();
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
    return sortedRates.map((rate) => ({
      timeMs: new Date(rate.recorded_at).getTime(),
      buy: rate.buy_rate,
      sell: rate.sell_rate,
      mid: (rate.buy_rate + rate.sell_rate) / 2,
      recorded_at: rate.recorded_at,
      buy_rate: rate.buy_rate,
      sell_rate: rate.sell_rate,
    }));
  }, [rates, period]);

  // ✅ Tüm periyotlar: kesin takvim (Calendar Date) kaydırması + özel tarih clamp
  const timeWindow = useMemo(() => {
    const now = new Date();
    const endDate = new Date(now);
    const startDate = new Date(now);

    // Seçilen periyoda göre tam takvim kaydırması (Sliding Window)
    switch (period) {
      case 'Yıllık':
        endDate.setFullYear(endDate.getFullYear() - timeOffset);
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
      case 'Aylık':
        endDate.setMonth(endDate.getMonth() - timeOffset);
        startDate.setMonth(endDate.getMonth() - 1);
        break;
      case 'Haftalık':
        endDate.setDate(endDate.getDate() - (timeOffset * 7));
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'Günlük':
        endDate.setDate(endDate.getDate() - (timeOffset * 1));
        startDate.setDate(endDate.getDate() - 1);
        break;
      case 'Saatlik':
      default:
        endDate.setHours(endDate.getHours() - (timeOffset * 24));
        startDate.setHours(endDate.getHours() - 24);
        break;
    }

    const defaultEnd = endDate.getTime();
    const defaultStart = startDate.getTime();

    // Özel tarih seçildiyse onu kullan; geleceği sınırla
    const actualStart = customDateRange.start ? Math.min(customDateRange.start, Date.now()) : defaultStart;
    const actualEnd = customDateRange.end ? Math.min(customDateRange.end, Date.now()) : defaultEnd;
    const windowStart = Math.min(actualStart, actualEnd);
    const windowEnd = Math.max(actualStart, actualEnd);
    const span = Math.max(windowEnd - windowStart, 1);

    // Ham serideki en eski veri — sol ok sadece buraya kadar kaydırılabilir
    const oldestDataTime = chartData.length > 0 ? chartData[0].timeMs : Date.now();
    const isLeftDisabled = windowStart <= oldestDataTime;

    return {
      windowStart,
      windowEnd,
      oldestDataTime,
      isLeftDisabled,
      customTicks: [
        windowStart,
        windowStart + (span * 0.25),
        windowStart + (span * 0.50),
        windowStart + (span * 0.75),
        windowEnd,
      ],
    };
  }, [period, timeOffset, chartData, customDateRange]);

  // Inputlar için YYYY-MM-DD (timezone kaymasını önlemek için yerel zaman)
  // Ham custom değer gösterilir (klavye yazımını bozmamak için); grafik clamp'i timeWindow'da
  const formatForInput = (ms) => {
    const d = new Date(ms);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
  };

  const startDateStr = formatForInput(
    customDateRange.start != null ? customDateRange.start : timeWindow.windowStart
  );
  const endDateStr = formatForInput(
    customDateRange.end != null ? customDateRange.end : timeWindow.windowEnd
  );
  const todayStr = formatForInput(Date.now());

  // ✅ Pencere filtresi + Saatlik yoğun forward-fill (24 eşit nokta) / diğerlerinde boundary fill
  const displayChartData = useMemo(() => {
    const { windowStart, windowEnd } = timeWindow;
    if (!chartData.length) return [];

    const sortedRates = [...chartData].sort((a, b) => a.timeMs - b.timeMs);
    let processedData = [];

    if (period === "Saatlik") {
      // Saatlik: her 1 saatte bir nokta — bilinen son kuru enjekte et (eğri/gradient tam yayılsın)
      const stepMs = 60 * 60 * 1000;
      const startAligned = Math.floor(windowStart / stepMs) * stepMs;
      const endCap = Math.min(windowEnd, Date.now());

      for (let t = startAligned; t <= endCap; t += stepMs) {
        if (t < windowStart) continue;
        const pastRates = sortedRates.filter((r) => r.timeMs <= t);
        const closestRate =
          pastRates.length > 0 ? pastRates[pastRates.length - 1] : sortedRates[0];
        if (closestRate) {
          processedData.push({
            ...closestRate,
            recorded_at: new Date(t).toISOString(),
            timeMs: t,
            buy: closestRate.buy ?? closestRate.buy_rate,
            sell: closestRate.sell ?? closestRate.sell_rate,
            mid:
              ((closestRate.buy ?? closestRate.buy_rate) +
                (closestRate.sell ?? closestRate.sell_rate)) /
              2,
            is_padded: true,
          });
        }
      }

      // Pencere sonuna kadar uzat (son saat dilimi ile end arasında boşluk kalmasın)
      if (processedData.length > 0) {
        const last = processedData[processedData.length - 1];
        if (last.timeMs < endCap) {
          processedData.push({
            ...last,
            recorded_at: new Date(endCap).toISOString(),
            timeMs: endCap,
            is_padded: true,
          });
        }
      }
    } else {
      processedData = sortedRates.filter(
        (r) => r.timeMs >= windowStart && r.timeMs <= windowEnd
      );

      const priorData = sortedRates.filter((d) => d.timeMs <= windowStart);
      const lastKnownPoint = priorData.length > 0 ? priorData[priorData.length - 1] : null;

      if (
        lastKnownPoint &&
        (processedData.length === 0 || processedData[0].timeMs > windowStart)
      ) {
        processedData = [
          { ...lastKnownPoint, timeMs: windowStart, is_padded: true },
          ...processedData,
        ];
      }

      if (processedData.length > 0) {
        const lastPoint = processedData[processedData.length - 1];
        const capTime = Math.min(windowEnd, Date.now());
        if (lastPoint.timeMs < capTime) {
          processedData = [
            ...processedData,
            { ...lastPoint, timeMs: capTime, is_padded: true },
          ];
        }
      }
    }

    return processedData.map((rate) => ({
      timeMs: rate.timeMs ?? new Date(rate.recorded_at).getTime(),
      buy: rate.buy ?? rate.buy_rate,
      sell: rate.sell ?? rate.sell_rate,
      mid:
        rate.mid ??
        ((rate.buy ?? rate.buy_rate) + (rate.sell ?? rate.sell_rate)) / 2,
      is_padded: rate.is_padded || false,
    }));
  }, [chartData, timeWindow, period]);

  // ✅ Yüzde: pencerenin gerçek ilk/son noktası (tüm periyotlar)
  const displayPercentage = useMemo(() => {
    if (displayChartData.length === 0) return 0;
    const firstPoint = displayChartData[0];
    const lastPoint = displayChartData[displayChartData.length - 1];
    const firstMid = (firstPoint.buy + firstPoint.sell) / 2;
    const lastMid = (lastPoint.buy + lastPoint.sell) / 2;
    if (!(firstMid > 0) || displayChartData.length < 2) return 0;
    return ((lastMid - firstMid) / firstMid) * 100;
  }, [displayChartData]);

  // Google Finance stili: pozitif yeşil, negatif kırmızı
  const strokeColor = displayPercentage >= 0 ? '#10b981' : '#ef4444';
  const gradientId = `colorValue-${currency}`;

  // ✅ Domain: her zaman aktif zaman penceresi
  const chartDomain = useMemo(
    () => [timeWindow.windowStart, timeWindow.windowEnd],
    [timeWindow]
  );

  // ✅ Sabit domain üzerinde eşit aralıklı 5 tick
  const xAxisTicks = useMemo(() => timeWindow.customTicks, [timeWindow]);

  // Kart üstü tarih aralığı etiketi (Gün Ay Yıl)
  const formatHeaderDate = (ms) => {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // ✅ X ekseni: Saatlik/Günlük → saat; Yıllık → ay-yıl; diğerleri → gün-ay
  const formatXAxis = (ms) => {
    if (!ms) return "";
    const d = new Date(ms);
    if (isNaN(d.getTime())) return "";
    if (period === 'Saatlik' || period === 'Günlük') {
      return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    }
    if (period === 'Yıllık') {
      return d.toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' });
    }
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  };

  // Düz çizgilerde (min≈max) Y ekseninin çökmesini önle
  const getAxisDomain = ([dataMin, dataMax]) => {
    if (Math.abs(dataMax - dataMin) < 0.0001) {
      return [dataMin * 0.998, dataMax * 1.002];
    }
    return [dataMin, dataMax];
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 backdrop-blur-md h-32 flex items-center justify-center dark:border-slate-800 dark:bg-slate-900/80">
        <p className="text-xs text-slate-500 dark:text-slate-400">Yükleniyor...</p>
      </div>
    );
  }

  if (error || displayChartData.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 backdrop-blur-md h-32 flex items-center justify-center dark:border-slate-800 dark:bg-slate-900/80">
        <p className="text-xs text-slate-500 dark:text-slate-400">{error ? `❌ ${error}` : '📊 Veri yok'}</p>
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
  // ✅ Sol ve sağ ok butonları TEK ortak stil setini paylaşır (simetri için)
  const chartNavBtnDisabled = isDark
    ? "text-slate-600 opacity-40 cursor-not-allowed border-white/10 bg-slate-900/90"
    : "text-slate-400 opacity-40 cursor-not-allowed border-slate-200 bg-white";
  const chartNavBtnActive = isDark
    ? "text-slate-300 hover:bg-slate-800 hover:text-white border-white/10 bg-slate-900/90"
    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 border-slate-200 bg-white shadow-sm";

  // ✅ DRY: Aynı grafik hem küçük kartta hem tam ekran modalda kullanılır
  const renderChartContent = (isExpanded = false) => {
    const tickFont = isExpanded ? 12 : 11;
    const chevronSize = isExpanded ? 22 : 16;
    const btnPad = isExpanded ? 'p-2.5' : 'p-1.5';
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
          domain={getAxisDomain}
          width={45}
          tickFormatter={(val) => Number(val).toFixed(2)}
          tick={{ fontSize: tickFont, fill: tickFill }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          labelFormatter={(val) => new Date(val).toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          formatter={(value) => [Number(value).toFixed(4) + ' ₺', 'Kur']}
          contentStyle={{ backgroundColor: tooltipBg, border: tooltipBorder, borderRadius: '8px', color: tooltipColor }}
        />
        <Area
          type="monotone"
          dataKey="buy"
          stroke={strokeColor}
          strokeWidth={isExpanded ? 2.5 : 2}
          fillOpacity={1}
          fill={`url(#${gradId})`}
          activeDot={{ r: isExpanded ? 6 : 5, fill: strokeColor, stroke: isDark ? '#fff' : '#0f172a', strokeWidth: 2 }}
        />
      </AreaChart>
    );

    return (
      <div className={`relative w-full ${isExpanded ? 'h-full' : ''}`}>
        <button
          type="button"
          onClick={() => {
            setCustomDateRange({ start: null, end: null });
            setTimeOffset((prev) => prev + 1);
          }}
          disabled={timeWindow.isLeftDisabled}
          className={`absolute left-2 md:left-4 top-1/2 z-10 -translate-y-1/2 rounded-full ${btnPad} transition-all border ${
            timeWindow.isLeftDisabled ? chartNavBtnDisabled : chartNavBtnActive
          }`}
          aria-label="Önceki dönem"
        >
          <ChevronLeft size={chevronSize} />
        </button>
        <button
          type="button"
          onClick={() => {
            setCustomDateRange({ start: null, end: null });
            setTimeOffset((prev) => Math.max(0, prev - 1));
          }}
          disabled={timeOffset === 0}
          className={`absolute right-2 md:right-4 top-1/2 z-10 -translate-y-1/2 rounded-full ${btnPad} transition-all border ${
            timeOffset === 0 ? chartNavBtnDisabled : chartNavBtnActive
          }`}
          aria-label="Sonraki dönem"
        >
          <ChevronRight size={chevronSize} />
        </button>

        {/* px-12: oklar grafiğe binmesin */}
        <div
          className={`w-full px-12 ${isExpanded ? 'h-full' : ''}`}
          style={isExpanded ? { height: '100%' } : { height: 200 }}
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
      <div className="rounded-xl border border-slate-200 bg-white p-4 relative dark:border-slate-800 dark:bg-slate-900">
        {/* Merkez Kısım: Tarih Aralığı ve Büyüteç İkonu */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center gap-1 z-10">
          <span className="text-[10px] text-slate-500 font-medium whitespace-nowrap dark:text-slate-400">
            {formatHeaderDate(timeWindow.windowStart)} - {formatHeaderDate(timeWindow.windowEnd)}
          </span>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="text-slate-500 hover:text-slate-800 transition-colors p-1 dark:text-slate-400 dark:hover:text-white"
            title="Detaylı Analiz"
            aria-label="Grafiği büyüt"
          >
            <ZoomIn size={16} />
          </button>
        </div>

        {/* Üst başlık */}
        <div className="relative flex items-center justify-between mb-3 min-h-[4.5rem]">
          <div>
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">{currency}/TRY</p>
            <p className="text-lg font-bold text-slate-800 mt-1 dark:text-slate-100">{last.toFixed(4)}</p>
            <span className={`text-xs font-semibold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {isPositive ? '+' : ''}{change}%
            </span>
            {dataInfo?.isLimitedByAvailableData && period !== 'Yıllık' && (
              <p className="text-[10px] text-amber-600/90 mt-1 dark:text-amber-400/80">
                Sınırlı geçmiş veri ({dataInfo.actualSpanDays} gün / {dataInfo.requestedSpanDays} gün gerekli)
              </p>
            )}
          </div>

          {isPositive ? <TrendingUp size={20} className="text-emerald-600 dark:text-emerald-400" /> : <TrendingDown size={20} className="text-rose-600 dark:text-rose-400" />}
        </div>

        {renderChartContent(false)}
      </div>

      {isModalOpen && createPortal(
        <div
          className="fixed inset-0 z-[99999] w-screen h-screen flex items-center justify-center bg-slate-950/50 backdrop-blur-md p-4 md:p-6 dark:bg-slate-950/80"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-white/95 backdrop-blur-xl border border-slate-200 rounded-2xl w-full max-w-6xl max-h-[90vh] shadow-2xl relative flex flex-col overflow-hidden dark:bg-slate-900/70 dark:border-slate-600/60 dark:border-t-slate-400/50"
            onClick={(e) => e.stopPropagation()}
          >
            <X
              size={24}
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors z-10"
              aria-label="Kapat"
            />

            {/* Özel Tarih Seçici (Sadece Modal Açıkken Sol Üstte) */}
            <div className="absolute top-4 left-4 md:left-6 flex items-center gap-2 z-20 bg-slate-50/90 p-1.5 rounded-lg border border-slate-200 backdrop-blur-sm dark:bg-slate-900/50 dark:border-slate-700/50">
              {/* Başlangıç Tarihi Input'u */}
              <input
                type="date"
                lang="tr-TR"
                value={startDateStr}
                max={endDateStr || todayStr}
                onChange={(e) => {
                  const newStartMs = new Date(e.target.value).getTime();
                  if (newStartMs) setCustomDateRange((prev) => ({ ...prev, start: newStartMs }));
                }}
                className="bg-white text-slate-800 border border-slate-300 rounded px-2 py-1 text-xs md:text-sm focus:outline-none focus:border-emerald-500 cursor-pointer dark:bg-slate-800/80 dark:text-slate-200 dark:border-slate-600"
              />
              <span className="text-slate-400 text-sm">-</span>
              {/* Bitiş Tarihi Input'u */}
              <input
                type="date"
                lang="tr-TR"
                value={endDateStr}
                min={startDateStr}
                max={todayStr}
                onChange={(e) => {
                  const newEndMs = new Date(e.target.value).getTime();
                  if (newEndMs) setCustomDateRange((prev) => ({ ...prev, end: newEndMs }));
                }}
                className="bg-white text-slate-800 border border-slate-300 rounded px-2 py-1 text-xs md:text-sm focus:outline-none focus:border-emerald-500 cursor-pointer dark:bg-slate-800/80 dark:text-slate-200 dark:border-slate-600"
              />
            </div>

            <div className="p-4 md:p-6 pb-0 flex flex-col items-center flex-shrink-0">
              <h2 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100">{currency}/TRY Detaylı Analiz</h2>
              <span className={`text-lg md:text-xl font-bold mt-1 ${displayPercentage >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {displayPercentage > 0 ? '+' : ''}{displayPercentage.toFixed(2)}%
              </span>
            </div>

            {/* Büyük Grafik Wrapper'ı - Tüm sekmeler için sabit yükseklik */}
            <div className="w-full p-4 md:p-8 h-[400px] relative block">
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

  const partnershipInputClass =
    "h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-all duration-300 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-cyan-400 dark:focus:border-cyan-400";

  const handleChange = (e) => {
    const { name, value } = e.target;
    let next = value;
    if (name === "contact_person") {
      // Harf, boşluk ve Türkçe karakterler; sayı yok
      next = value.replace(/[0-9]/g, "");
    } else if (name === "phone") {
      // Sadece rakam, +, boşluk, parantez
      next = value.replace(/[^\d+\s()]/g, "");
    }
    setFormData((prev) => ({ ...prev, [name]: next }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(apiUrl("/api/partnership-apply"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSubmitted(true);
      setFormData({
        institution_name: "",
        contact_person: "",
        email: "",
        phone: "",
        message: "",
      });
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
      className="mt-12 scroll-mt-28 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-slate-900/60"
    >
      <div className="mb-6">
        <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t("partnership")}</h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t("partnershipDesc")}</p>
      </div>

      {submitted ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">
          {t("applicationSuccess")}
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{t("institutionName")}</label>
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
                <label className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{t("contactPerson")}</label>
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
                <label className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{t("emailLabel")}</label>
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
                <label className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{t("phoneLabel")}</label>
                <input
                  type="tel"
                  name="phone"
                  placeholder={t("phonePlaceholder")}
                  value={formData.phone}
                  onChange={handleChange}
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  className={partnershipInputClass}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{t("messageLabel")}</label>
              <textarea
                name="message"
                rows={4}
                placeholder={t("messagePlaceholder")}
                value={formData.message}
                onChange={handleChange}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all duration-300 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-cyan-400 dark:focus:border-cyan-400"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg border border-transparent bg-gradient-to-r from-teal-400 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 transition-all duration-300 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] hover:brightness-110 disabled:opacity-60"
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

const EXCHANGE_SORT_OPTIONS = [
  { value: "nearest", labelKey: "sortNearest" },
  { value: "none", labelKey: "sortNone" },
  { value: "gbp-buy-high", labelKey: "sortGbpBuyHigh" },
  { value: "gbp-buy-low", labelKey: "sortGbpBuyLow" },
  { value: "usd-buy-high", labelKey: "sortUsdBuyHigh" },
  { value: "usd-buy-low", labelKey: "sortUsdBuyLow" },
  { value: "eur-buy-high", labelKey: "sortEurBuyHigh" },
  { value: "eur-buy-low", labelKey: "sortEurBuyLow" },
];

/** Çalışma saati aralığına göre şu an açık mı? Örn: "09:00 - 17:30" */
function isOpenNow(workingHours) {
  if (!workingHours) return false;
  try {
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

/** İşletmenin kullanıcıya en yakın şube mesafesi (km); şube yoksa Infinity */
function nearestBranchDistanceKm(bank, userLat, userLng, branchesByInstitution) {
  const id = bank.institutionId;
  const nameKey = normalizeText(bank.name || "");
  const list =
    (id && branchesByInstitution[id]) ||
    branchesByInstitution[nameKey] ||
    [];
  if (!list.length) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (const branch of list) {
    const lat = Number(branch.lat);
    const lng = Number(branch.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const d = haversineKm(userLat, userLng, lat, lng);
    if (d < min) min = d;
  }
  return min;
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

/**
 * Dinamik Final Kur Hesaplama:
 * Baz Fiyat (Fixed): Final = XML_Kur + Margin_Value
 * Yüzde (Percent): Final = XML_Kur + (XML_Kur * Margin_Value / 100)
 */
function applyMarginToRawRate(rawRate, marginType, marginValue) {
  const base = Number(rawRate);
  const m = Math.max(0, Number(marginValue) || 0);
  if (!Number.isFinite(base) || !Number.isFinite(m)) return base;
  if (marginType === "percent") {
    return base + (base * m) / 100;
  }
  return base + m;
}

function getBestGBPBuyRate(bankList) {
  let best = null;
  for (const bank of bankList) {
    const gbpRate = bank.exchangeRates.find((r) => r.currency === "GBP");
    const gbpBuy = toNumberForCompare(gbpRate?.buy);
    if (gbpBuy > 0 && (!best || gbpBuy > best.rate)) {
      best = { bank, rate: gbpBuy };
    }
  }
  return best;
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

function getBestDepositRate(bankList) {
  let best = null;
  for (const bank of bankList) {
    const rate = getDepositRate(bank);
    if (rate > 0 && (!best || rate > best.rate)) {
      best = { bank, rate };
    }
  }
  return best;
}

export function V0FinancialDashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, isSuperAdmin, logout } = useAuth();
  const { t } = useLanguage();

  const handleLogout = () => {
    // ✅ FIXED MODAL POPUP GÖSTER
    setShowLogoutPopup(true);
    
    // ✅ 1 SANIYE SONRA LOGOUT VE TAM YENILEME
    setTimeout(() => {
      const themePref = localStorage.getItem("finsight-theme");
      const langPref = localStorage.getItem("finsight-lang");
      logout();
      localStorage.clear();
      if (themePref) localStorage.setItem("finsight-theme", themePref);
      if (langPref) localStorage.setItem("finsight-lang", langPref);
      window.location.href = "/";  // ✅ React Router'dan önce tam yenileme
    }, 1000);
  };
  const [mode, setMode] = useState("exchange");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("none");
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [userLocation, setUserLocation] = useState(null); // { lat, lng }
  const [branchesByInstitution, setBranchesByInstitution] = useState({});
  const [geoToast, setGeoToast] = useState("");
  const [banks, setBanks] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [lastUpdateTime, setLastUpdateTime] = useState(null);
  const [rawCentralBankRates, setRawCentralBankRates] = useState(null); // ✅ SAF XML kurları
  const [marginAdjustments, setMarginAdjustments] = useState({}); // ✅ DB'den gelen marjlar
  const [calculatorBank, setCalculatorBank] = useState("");
  const [isBusinessLoginOpen, setIsBusinessLoginOpen] = useState(false);
  const [showLogoutPopup, setShowLogoutPopup] = useState(false);  // ✅ YENİ: Çıkış Modal
  const [chartPeriod, setChartPeriod] = useState('Günlük');  // ✅ YENİ: Market Summary filtresi
  const [liveRates, setLiveRates] = useState(null); // ✅ TEK merkezi SSE mesajı - tüm banka kartları bunu paylaşır
  const [selectedBusiness, setSelectedBusiness] = useState(null);
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

    const connect = () => {
      eventSource = new EventSource("https://adadoviz-backend.onrender.com/api/rates-stream");

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "rate_update" && data.rates) {
            setLiveRates(data.rates);
          }
        } catch (err) {
          // Sessizce yut - tekil mesaj parse hatası kritik değil
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        if (isMounted) {
          reconnectTimer = setTimeout(connect, 3000);
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
  const [exchangeAmountTl, setExchangeAmountTl] = useState("0");
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
        // ✅ Kurlar ve marjları parallel olarak çek
        const [ratesRes, marginsRes] = await Promise.all([
          fetch(apiUrl("/api/kurlar")),
          fetch(apiUrl("/api/margins")),
        ]);
        
        if (!ratesRes.ok) {
          throw new Error(`Kurlar API error: ${ratesRes.status}`);
        }
        
        const data = await ratesRes.json();
        console.log("[DASHBOARD] Backend'den Gelen Veri:", data);
        
        // Marjları yükle (hata olsa bile devam et)
        let marginsData = {};
        if (marginsRes.ok) {
          const margins = await marginsRes.json();
          marginsData = margins?.margins || {};
          setMarginAdjustments(marginsData);
          console.log("[DASHBOARD] Marjlar yüklendi:", marginsData);
        } else {
          console.warn("[DASHBOARD] Marjlar alınamadı, varsayılanlar kullanılacak");
        }
        
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
          
          // SAF kurlarından başla, marjları ekle
          let exchangeRates = [
            { currency: "EUR", buy: null, sell: null },
            { currency: "USD", buy: null, sell: null },
            { currency: "GBP", buy: null, sell: null },
          ];
          
          if (data?.rawCentralBankRates && institutionId) {
            // ✅ SADECE bu bankanın marjlarını bul (dış bankaların marjlarını değil!)
            const currentBankMargins = marginsData[institutionId] || {};
            console.log(`[DASHBOARD] ${apiName} (${institutionId}) marjları:`, currentBankMargins);
            
            exchangeRates = ["EUR", "USD", "GBP"].map((currency) => {
              const rawKur = data.rawCentralBankRates[currency];
              if (!rawKur) return { currency, buy: null, sell: null };
              
              // ✅ SADECE bu banka için: buyMargin ve sellMargin bul
              const buyMargin = currentBankMargins[`${currency}_buy`] || { margin_type: "fixed", margin_value: 0 };
              const sellMargin = currentBankMargins[`${currency}_sell`] || { margin_type: "fixed", margin_value: 0 };
              
              // ✅ FORMÜL: Final = XML_Kur + Margin (Fixed) veya Final = XML_Kur * (1 + Margin/100) (Percent)
              const finalBuy = applyMarginToRawRate(rawKur.buy, buyMargin.margin_type, buyMargin.margin_value);
              const finalSell = applyMarginToRawRate(rawKur.sell, sellMargin.margin_type, sellMargin.margin_value);
              
              return { currency, buy: finalBuy, sell: finalSell };
            });
          } else if (data?.rawCentralBankRates) {
            // Fallback: institutionId yoksa, saf XML kurlarını kullan
            exchangeRates = ["EUR", "USD", "GBP"].map((currency) => {
              const rawKur = data.rawCentralBankRates[currency];
              return { currency, buy: rawKur?.buy || null, sell: rawKur?.sell || null };
            });
          } else {
            // Fallback: Backend'den gelen hesaplanmış kurları kullan
            exchangeRates = mapApiBankToExchangeRows(apiBank);
          }

          return {
            id: `api-bank-${index + 1}`,
            name: apiName,
            websiteUrl,
            institutionId,
            exchangeRates,
            workingHours:
              apiBank?.workingHours ||
              apiBank?.working_hours ||
              "09:00 - 17:00",
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
          console.log("[DASHBOARD] SAF XML kurları kaydedildi:", data.rawCentralBankRates);
        }

        if (mounted) {
          setBanks(mappedBanks);
          setLastUpdated(data?.updatedAt ?? null);
          setLastUpdateTime(new Date().toLocaleTimeString('tr-TR'));
          console.log(`[DASHBOARD] ${mappedBanks.length} banka yüklendi, FirstBank: ${mappedBanks[0]?.name || "N/A"}`);
        }
      } catch (error) {
        console.error("[DASHBOARD] Kur verisi alınamadı:", error);
        if (mounted) {
          setBanks([]);
          setLastUpdated(null);
        }
      }
    };

    fetchBanks();
    const intervalId = setInterval(fetchBanks, 300000); // 5 dakika = 300000ms
    
    console.log("[DASHBOARD] Otomatik yenileme başlatıldı - 5 dakika aralığıyla");

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

  // Şube koordinatlarını yükle (En Yakın sıralaması için)
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
    const t = setTimeout(() => setGeoToast(""), 4000);
    return () => clearTimeout(t);
  }, [geoToast]);

  const requestNearestSort = () => {
    if (!navigator.geolocation) {
      setGeoToast("Tarayıcınız konum servisini desteklemiyor.");
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
        setGeoToast("Konum izni verilmedi. En Yakın sıralaması kullanılamıyor.");
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
      requestNearestSort();
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

  // ✅ DEAD CODE REMOVED: depositType effect kaldırıldı (Interest mode kaldırıldı)

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

    // ID / institutionId / isim bazlı tekilleştirme (aynı işletmenin çift kartını engelle)
    const byIdOrInstitution = Array.from(
      new Map(
        result.map((business) => [
          business.institutionId || business.id,
          business,
        ])
      ).values()
    );
    // Aynı görünen isim (Örn: Sun Döviz) farklı institutionId ile geldiyse yine tek tut
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

    if (sortBy === "nearest") {
      if (userLocation?.lat != null && userLocation?.lng != null) {
        result.sort((a, b) => {
          const da = nearestBranchDistanceKm(
            a,
            userLocation.lat,
            userLocation.lng,
            branchesByInstitution
          );
          const db = nearestBranchDistanceKm(
            b,
            userLocation.lat,
            userLocation.lng,
            branchesByInstitution
          );
          return da - db;
        });
      }
    } else if (sortBy !== "none") {
      result.sort((a, b) => {
        const [currency, type, direction] = sortBy.split("-");
        const currencyUpper = currency.toUpperCase();
        const rateA = getRate(a, currencyUpper, type);
        const rateB = getRate(b, currencyUpper, type);
        return direction === "high" ? rateB - rateA : rateA - rateB;
      });
    } else {
      result.sort((a, b) => a.name.localeCompare(b.name, "tr"));
    }

    return result;
  }, [banks, searchQuery, sortBy, mode, userLocation, branchesByInstitution, openNowOnly]);

  const bestDeposit = getBestDepositRate(banks);
  const selectedCalculatorBank = banks.find((b) => b.name === calculatorBank) ?? null;
  const selectedExchangePair =
    selectedCalculatorBank?.exchangeRates?.find((r) => r.currency === exchangeCurrency) ?? null;
  const selectedExchangeSellRate = selectedExchangePair?.sell ?? null;
  const selectedExchangeBuyRate = selectedExchangePair?.buy ?? null;
  const exchangeTl = Number.parseFloat(exchangeAmountTl);
  const exchangeResult =
    Number.isFinite(exchangeTl) &&
    exchangeTl > 0 &&
    (exchangeOperation === "buy" ? Number.isFinite(selectedExchangeSellRate) : Number.isFinite(selectedExchangeBuyRate))
      ? exchangeOperation === "buy"
        ? exchangeTl / selectedExchangeSellRate
        : exchangeTl * selectedExchangeBuyRate
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
  const headerBtnClass = headerCompact
    ? "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-all duration-300"
    : "rounded-full border px-3 py-1 text-xs font-semibold transition-all duration-300";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 relative dark:bg-[#020617] dark:text-white">
      <header
        className={`sticky top-0 z-[100] w-full border-b border-slate-200/80 bg-white/80 backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-[#020617]/80 ${
          headerCompact ? "px-4 py-2 shadow-sm sm:px-6 sm:py-2.5" : "px-4 py-4 sm:px-6 sm:py-4 md:py-5"
        }`}
      >
        <div
          className={`mx-auto flex w-full max-w-[1600px] items-center justify-between transition-all duration-300 ${
            headerCompact ? "gap-3" : "gap-4"
          }`}
        >
        <BrandLogo className="shrink-0" compact={headerCompact} />
        <div className={`flex shrink-0 items-center transition-all duration-300 ${headerCompact ? "gap-1.5 sm:gap-2" : "gap-2 sm:gap-3"}`}>
          <div
            className={`hidden sm:inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 font-medium text-cyan-700 transition-all duration-300 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:text-cyan-300 dark:hover:border-cyan-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] ${
              headerCompact ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
            }`}
          >
            <span className="relative inline-flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400"></span>
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
            className={`${headerBtnClass} border-slate-300 bg-white text-slate-700 transition-all duration-300 hover:border-cyan-400 hover:text-cyan-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:border-cyan-400 dark:hover:text-cyan-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]`}
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
              className={`inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 font-semibold text-red-600 transition-all duration-300 hover:bg-red-500/20 hover:border-red-500/60 dark:text-red-200 ${
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
            className={`hidden sm:inline-flex rounded-full border border-slate-300 bg-white font-semibold text-slate-700 transition-all duration-300 hover:border-cyan-400 hover:text-cyan-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:border-cyan-400 dark:hover:text-cyan-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] ${
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
      <div className="pointer-events-none fixed -left-60 -top-40 z-0 h-[40rem] w-[40rem] rounded-full bg-teal-500/15 blur-[140px] dark:bg-teal-500/20"></div>
      <div className="pointer-events-none fixed -right-40 top-10 z-0 h-[45rem] w-[45rem] rounded-full bg-indigo-500/15 blur-[140px] dark:bg-indigo-500/20"></div>
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.05] dark:opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(56,189,248,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.22) 1px, transparent 1px)",
          backgroundSize: "38px 38px",
        }}
      />
      <div className="relative z-10 w-full max-w-[1600px] mx-auto px-3 sm:px-4 md:px-8 pb-10 md:pb-12 flex flex-col gap-6 md:gap-8">
      <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 md:p-6 shadow-xl backdrop-blur-lg transition-all hover:border-teal-500/30 dark:border-white/10 dark:bg-slate-900/60">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">{t("marketSummary")}</h3>
            <p className="text-sm text-slate-500 mt-1 dark:text-slate-400">
              {t("marketSummaryNote")}
            </p>
          </div>
          {/* ✅ YENİ: Filtre Butonu (Saatlik / Günlük / Haftalık / Aylık) - Kur Temasıyla Uyumlu */}
          <div className="flex flex-wrap gap-1 bg-slate-100/80 p-1 rounded-lg border border-slate-200 backdrop-blur-md dark:bg-slate-950/70 dark:border-white/10">
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
                className={`px-2.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-md transition-all duration-300 ease-in-out ${
                  chartPeriod === key 
                    ? 'bg-gradient-to-r from-teal-400 to-indigo-500 text-white shadow-lg shadow-teal-500/20 scale-105' 
                    : 'text-slate-600 hover:text-slate-900 bg-transparent hover:bg-slate-200/60 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-900/40'
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

      <div className="rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-xl backdrop-blur-lg transition-all hover:border-teal-500/30 dark:border-white/10 dark:bg-slate-900/60">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            {mode === "exchange"
              ? t("currencyConverter")
              : mode === "interest"
                ? t("depositCalculator")
                : t("loanCalculator")}
          </h3>
        </div>

        {mode === "exchange" ? (
          <div className="grid gap-4 sm:grid-cols-12">
            {/* 1️⃣ DÖVIZ BİRİMİ (Sol taraf) */}
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">{t("currencyUnit")}</label>
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
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">{t("operationType")}</label>
              <div className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-50/80 p-1 backdrop-blur-md dark:border-white/10 dark:bg-slate-900/80">
                <button
                  type="button"
                  onClick={() => setExchangeOperation("buy")}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-bold transition ${
                    exchangeOperation === "buy"
                      ? "bg-gradient-to-r from-teal-400 to-indigo-500 text-white shadow-lg shadow-teal-500/20"
                      : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {t("buy")}
                </button>
                <button
                  type="button"
                  onClick={() => setExchangeOperation("sell")}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-bold transition ${
                    exchangeOperation === "sell" ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/20" : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {t("sell")}
                </button>
              </div>
            </div>

            {/* 3️⃣ DÖVİZ BÜROSU SEÇİN (Dinamik kur gösterimi) */}
            <div className="flex flex-col gap-1 sm:col-span-3">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">{t("selectBank")}</label>
              <SearchableSelect
                value={calculatorBank}
                onChange={setCalculatorBank}
                placeholder={!exchangeCurrency ? "Lütfen önce Döviz Birimi seçin" : "Bir döviz bürosu seçin"}
                disabled={!exchangeCurrency}
                aria-label={t("selectBank")}
                options={[
                  { value: "", label: !exchangeCurrency ? "Lütfen önce Döviz Birimi seçin" : "Bir döviz bürosu seçin" },
                  ...(exchangeCurrency ? [...banks]
                    .sort((a, b) => a.name.localeCompare(b.name, "tr"))
                    .map((bank) => {
                      const rate = bank.exchangeRates?.find((r) => r.currency === exchangeCurrency);
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

            {/* 4️⃣ ÇEVRİLECEK TUTAR (Başlangıç: 0) */}
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">
                {exchangeOperation === "buy" ? t("amountTl") : `${t("amountCurrency")} (${exchangeCurrency})`}
              </label>
              <input
                type="number"
                min="0"
                disabled={!exchangeCurrency}
                value={exchangeAmountTl}
                onChange={(e) => setExchangeAmountTl(e.target.value)}
                className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed"
                placeholder={!exchangeCurrency ? "Döviz Seçiniz" : !calculatorBank ? "Döviz Bürosu Seçin" : "Tutar giriniz"}
              />
              {exchangeAmountTl !== "0" && (!exchangeCurrency || !calculatorBank) && (
                <p className="text-xs text-indigo-600 dark:text-indigo-300 mt-1">
                  ⚠️ Döviz birimi ya da şube seçilmedi
                </p>
              )}
            </div>

            {/* 5️⃣ SONUÇ (En sağda) */}
            <div className="flex flex-col gap-1 sm:col-span-3">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">
                {exchangeOperation === "buy" ? `${t("resultBuy")} ${exchangeCurrency}` : t("resultSell")}
              </label>
              <div className={`flex h-11 items-center rounded-lg border px-3 text-sm font-semibold ${
                Number.isFinite(exchangeResult)
                  ? "border-indigo-300/60 bg-indigo-50 text-slate-900 dark:border-indigo-700/60 dark:bg-indigo-900/50 dark:text-slate-100"
                  : "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-not-allowed"
              }`}>
                {Number.isFinite(exchangeResult)
                  ? `${exchangeResult.toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} ${exchangeOperation === "buy" ? exchangeCurrency : "TL"}`
                  : !exchangeCurrency
                    ? "Döviz Seçiniz"
                    : !calculatorBank
                      ? "Döviz Bürosu Seçin"
                      : (exchangeAmountTl === "0" || exchangeAmountTl === "")
                        ? "Dönüştürmek istediğiniz tutarı giriniz"
                        : t("resultWaiting")}
              </div>
            </div>

          </div>
        ) : mode === "interest" ? (
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">{t("selectBank")}</label>
              <SearchableSelect
                value={calculatorBank}
                onChange={setCalculatorBank}
                placeholder={t("selectBankPlaceholder")}
                options={[...banks]
                  .sort((a, b) => a.name.localeCompare(b.name, "tr"))
                  .map((bank) => ({ value: bank.name, label: bank.name }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">Anapara Tutarı (TL)</label>
              <input
                type="number"
                min="0"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="Anapara (TL)"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">Vade Türü</label>
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
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">Vade Süresi (Gün)</label>
              <input
                type="number"
                min="1"
                value={depositDays}
                onChange={(e) => setDepositDays(e.target.value)}
                className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="Vade (Gün)"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">Net Getiri</label>
              <div className="flex h-11 items-center rounded-lg border border-indigo-300/60 bg-indigo-50 px-3 text-sm text-slate-900 dark:border-indigo-700/60 dark:bg-indigo-900/50 dark:text-slate-100">
                {Number.isFinite(depositProfit)
                  ? `${depositProfit.toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Net getiri hesaplanamadı"}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">Vade Sonu Toplam</label>
              <div className="flex h-11 items-center rounded-lg border border-indigo-300/60 bg-indigo-50 px-3 text-sm text-slate-900 dark:border-indigo-700/60 dark:bg-indigo-900/50 dark:text-slate-100">
                {Number.isFinite(depositTotal)
                  ? `${depositTotal.toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Vade sonu bekleniyor"}
              </div>
            </div>
            <div className="sm:col-span-6 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
              {Number.isFinite(selectedDepositRate)
                ? `Kullanılan Faiz Oranı: %${selectedDepositRate.toFixed(2)} (${depositType === "daily" ? "Günlük" : depositType === "monthly" ? "Aylık" : "Yıllık"} baz)`
                : "Faiz oranı döviz bürosu verisine göre belirlenecektir."}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">{t("selectBank")}</label>
              <SearchableSelect
                value={calculatorBank}
                onChange={setCalculatorBank}
                placeholder={t("selectBankPlaceholder")}
                options={[...banks]
                  .sort((a, b) => a.name.localeCompare(b.name, "tr"))
                  .map((bank) => ({ value: bank.name, label: bank.name }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">Kredi Türü</label>
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
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">Kredi Tutarı (TL)</label>
              <input
                type="number"
                min="0"
                value={loanAmount}
                onChange={(e) => setLoanAmount(e.target.value)}
                className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="Kredi Tutarı (TL)"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">Vade (Ay)</label>
              <input
                type="number"
                min="1"
                value={loanMonths}
                onChange={(e) => setLoanMonths(e.target.value)}
                className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="Vade (Ay)"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">Aylık Taksit Tutarı</label>
              <div className="flex h-11 items-center rounded-lg border border-indigo-300/60 bg-indigo-50 px-3 text-sm text-slate-900 dark:border-indigo-700/60 dark:bg-indigo-900/50 dark:text-slate-100">
                {Number.isFinite(loanInstallment)
                  ? `${loanInstallment.toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Taksit hesaplanamadı"}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-indigo-600 dark:text-indigo-300">Toplam Geri Ödeme</label>
              <div className="flex h-11 items-center rounded-lg border border-indigo-300/60 bg-indigo-50 px-3 text-sm text-slate-900 dark:border-indigo-700/60 dark:bg-indigo-900/50 dark:text-slate-100">
                {Number.isFinite(loanTotal)
                  ? `${loanTotal.toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} TL`
                  : "Toplam ödeme bekleniyor"}
              </div>
            </div>
            <div className="sm:col-span-6 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300">
              {Number.isFinite(activeLoanRate) && selectedCalculatorBank
                ? `💡 Uygulanan Aylık Faiz: %${activeLoanRate.toFixed(2)} (${selectedCalculatorBank.name} ${
                    loanType === "tasit" ? "Taşıt Kredisi" : loanType === "konut" ? "Konut Kredisi" : "İhtiyaç Kredisi"
                  })`
                : "💡 Uygulanan faiz, seçilen döviz bürosu ve kredi türüne göre belirlenir."}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="search"
              placeholder={t("searchBanks")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition-all duration-300 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-cyan-400 dark:focus:border-cyan-400"
            />
          </div>

          <div className="w-full sm:w-56">
            <SearchableSelect
              value={sortBy}
              onChange={handleSortChange}
              options={currentSortOptions}
              placeholder={t("sortLabel")}
              aria-label={t("sortLabel")}
              className="w-full"
            />
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={openNowOnly}
            onClick={() => setOpenNowOnly((v) => !v)}
            className={`inline-flex h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-all duration-300 ${
              openNowOnly
                ? "border-cyan-400 bg-gradient-to-r from-cyan-500/15 to-indigo-500/20 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                : "border-slate-300 bg-white text-slate-600 hover:border-cyan-400 hover:text-cyan-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-cyan-400 dark:hover:text-cyan-400"
            }`}
            title={t("openNow")}
          >
            <Clock className={`size-4 shrink-0 transition-colors duration-300 ${openNowOnly ? "text-cyan-400" : ""}`} />
            <span className="whitespace-nowrap">{t("openNow")}</span>
            <span
              className={`relative ml-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-all duration-300 ${
                openNowOnly
                  ? "border-cyan-400/60 bg-gradient-to-r from-cyan-500 to-indigo-500 shadow-[0_0_10px_rgba(34,211,238,0.55)]"
                  : "border-slate-400 bg-slate-300 dark:border-slate-600 dark:bg-slate-700"
              }`}
            >
              <span
                className={`inline-block size-3.5 rounded-full bg-white shadow transition ${
                  openNowOnly ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </span>
          </button>
        </div>
      </div>

      {geoToast ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          {geoToast}
        </div>
      ) : null}

      {banks.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white/80 p-6 py-10 text-center text-slate-600 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300">
          {t("banksLoading")}
        </div>
      ) : filteredAndSortedBanks.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8 lg:grid-cols-3 md:gap-10">
          {filteredAndSortedBanks.map((bank) => (
            <V0BankCard
              key={bank.institutionId || bank.id}
              bank={bank}
              mode={mode}
              liveRates={liveRates}
              onSelect={(biz) => {
                const name = String(biz?.name || "")
                  .replace(/\s*\([Tt]est\)\s*/g, "")
                  .trim();
                trackBusinessClick(name || biz?.name);
                setSelectedBusiness(biz);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white/80 p-6 py-10 text-center text-slate-600 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300">
          {t("noBanksMatch")}
        </div>
      )}

      {selectedBusiness ? (
        <BusinessDetailModal
          business={selectedBusiness}
          onClose={() => setSelectedBusiness(null)}
        />
      ) : null}

      {lastUpdateTime ? (
        <div className="mt-10 flex justify-center px-2">
          <div className="rounded-lg border border-slate-200 bg-white/80 px-4 py-2.5 text-center text-xs tracking-wide text-slate-500 shadow-sm dark:border-slate-700/80 dark:bg-slate-950/60">
            {`Son Güncelleme: ${new Date().toLocaleDateString("tr-TR")} - ${lastUpdateTime}`}
          </div>
        </div>
      ) : null}

        <PartnershipForm />

        {/* ✅ FIXED MODAL - ÇIKIS */}
        {showLogoutPopup && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md">
            <div className="bg-[#1a1f2e] border border-gray-700 p-8 rounded-2xl shadow-2xl flex flex-col items-center transform transition-all">
              <div className="w-16 h-16 bg-rose-500/20 rounded-full flex items-center justify-center mb-4 animate-spin">
                <svg className="w-8 h-8 text-rose-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <h3 className="text-white text-xl font-bold">Çıkış Yapılıyor...</h3>
              <p className="text-slate-300 text-sm mt-2">Anasayfaya yönlendiriliyorsunuz</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
