import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { MapPin, Navigation, X } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { trackCurrencyView } from "../lib/analytics";
import { apiUrl } from "../lib/api";

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
  { id: "daily", label: "Günlük", apiPeriod: "Saatlik", windowMs: 24 * 60 * 60 * 1000 },
  { id: "weekly", label: "Haftalık", apiPeriod: "Günlük", windowMs: 7 * 24 * 60 * 60 * 1000 },
];

const CURRENCIES = ["USD", "EUR", "GBP"];

function roundDisplay(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

// İşletme grafiği X ekseni zaman formatlayıcı — SADECE bu grafik için kullanılır.
function formatAxisTime(timeMs, periodId) {
  const d = new Date(timeMs);
  if (!Number.isFinite(d.getTime())) return "";
  if (periodId === "daily") {
    return d.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
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
export function BusinessDetailModal({ business, onClose }) {
  const [activeView, setActiveView] = useState("grafik");
  const [periodId, setPeriodId] = useState("daily");
  const [currency, setCurrency] = useState("USD");
  const [chartRows, setChartRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState("");
  const [selectedBranch, setSelectedBranch] = useState(null);

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
          setError(err.message || "Geçmiş kurlar alınamadı.");
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
        setSelectedBranch(rows[0] || null);
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
  }, [institutionId]);

  // Backend zaten "Nihai Kur = MB Kuru + Kâr Marjı" formülüyle hesaplayıp
  // kronolojik sırada döndürüyor; burada sadece grafik için sayısal timeMs +
  // okunabilir label alanları ekleniyor.
  const finalChartData = useMemo(() => {
    if (!chartRows.length) return [];

    return chartRows
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
  }, [chartRows]);

  const yDomain = useMemo(() => {
    if (!finalChartData.length) return ["auto", "auto"];
    let min = Infinity;
    let max = -Infinity;
    for (const row of finalChartData) {
      min = Math.min(min, row.finalBuy, row.finalSell);
      max = Math.max(max, row.finalBuy, row.finalSell);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return ["auto", "auto"];
    const pad = Math.max((max - min) * 0.08, 0.01);
    return [Number((min - pad).toFixed(4)), Number((max + pad).toFixed(4))];
  }, [finalChartData]);

  if (!business) return null;

  const mapCenter = hasValidCoords(selectedBranch)
    ? [Number(selectedBranch.lat), Number(selectedBranch.lng)]
    : KKTC_CENTER;

  return createPortal(
    <div className="fixed inset-0 z-[3000] flex items-center justify-center p-3 sm:p-4">
      <button
        type="button"
        aria-label="Kapat"
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 bg-slate-900 border border-slate-700 rounded-2xl w-[95%] md:w-full max-w-5xl h-[90vh] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl shadow-black/50"
      >
        <X
          size={24}
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors z-10"
          aria-label="Kapat"
        />
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 pr-12">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={
                business.logo_url ||
                `https://www.google.com/s2/favicons?domain=${getFaviconDomain(displayName || business.name)}&sz=128`
              }
              alt=""
              className="h-9 w-9 shrink-0 rounded-full bg-white p-0.5 object-cover shadow-sm"
            />
            <h2 className="truncate text-lg font-semibold text-white">
              {displayName || business.name}
            </h2>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
              <button
                type="button"
                onClick={() => setActiveView("grafik")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeView === "grafik"
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Grafik
              </button>
              <button
                type="button"
                onClick={() => setActiveView("konum")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeView === "konum"
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Konum
              </button>
            </div>
          </div>
        </div>

        {activeView === "grafik" && (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2.5 sm:px-4">
              {PERIOD_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPeriodId(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition sm:px-4 sm:py-2 ${
                    periodId === tab.id
                      ? "border border-teal-500/40 bg-teal-500/20 text-teal-300"
                      : "border border-transparent text-slate-400 hover:bg-slate-800/80 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
              <div className="mx-1 hidden h-6 w-px bg-slate-700 sm:block" />
              {CURRENCIES.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    setCurrency(code);
                    trackCurrencyView(code);
                  }}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                    currency === code
                      ? "bg-slate-100 text-slate-900"
                      : "bg-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>

            <div className="flex min-h-[280px] flex-1 flex-col overflow-hidden px-3 py-3 sm:min-h-0 sm:px-4 md:min-h-[420px]">
              <div className="min-h-[260px] flex-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 p-2 sm:min-h-0">
                {loading ? (
                  <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-slate-400">
                    Yükleniyor...
                  </div>
                ) : error ? (
                  <div className="flex h-full min-h-[280px] items-center justify-center px-4 text-center text-sm text-rose-300">
                    {error}
                  </div>
                ) : finalChartData.length === 0 ? (
                  <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-1 px-4 text-center text-sm text-slate-400">
                    <span>Bu işletme için henüz yeterli veri birikmemiş.</span>
                    <span className="text-xs text-slate-500">
                      Kurlar kaydedildikçe grafik otomatik olarak oluşacaktır.
                    </span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={finalChartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <defs>
                        <linearGradient id="bizBuyFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="bizSellFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#fb7185" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#fb7185" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                      <XAxis
                        dataKey="timeMs"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        scale="time"
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: "#475569" }}
                        minTickGap={40}
                        tickFormatter={(ms) => formatAxisTime(ms, periodId)}
                      />
                      <YAxis
                        domain={yDomain}
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: "#475569" }}
                        width={52}
                        tickFormatter={(v) => Number(v).toFixed(2)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#0f172a",
                          border: "1px solid #334155",
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "#e2e8f0" }}
                        formatter={(value, name) => {
                          const label =
                            name === "finalBuy" ? "Alış" : name === "finalSell" ? "Satış" : name;
                          return [Number(value).toFixed(4), label];
                        }}
                        labelFormatter={(ms) => {
                          const d = new Date(ms);
                          if (!Number.isFinite(d.getTime())) return "";
                          return d.toLocaleString("tr-TR");
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="finalBuy"
                        name="finalBuy"
                        stroke="#34d399"
                        fill="url(#bizBuyFill)"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="finalSell"
                        name="finalSell"
                        stroke="#fb7185"
                        fill="url(#bizSellFill)"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </>
        )}

        {activeView === "konum" && (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-4 md:grid-cols-3 md:overflow-hidden md:min-h-[400px]">
            <div className="col-span-1 flex min-h-0 flex-col gap-4">
              <div className="min-h-0 flex-1 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <MapPin size={12} className="text-teal-400" />
                  Şubeler
                </p>
                {branchesLoading ? (
                  <p className="py-6 text-center text-sm text-slate-400">Şubeler yükleniyor...</p>
                ) : branchesError ? (
                  <p className="py-6 text-center text-sm text-rose-300">{branchesError}</p>
                ) : branches.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">
                    Bu işletmeye henüz şube eklenmemiş.
                  </p>
                ) : (
                  <ul className="max-h-[200px] space-y-1.5 overflow-y-auto pr-1">
                    {branches.map((branch) => {
                      const selected = selectedBranch?.id === branch.id;
                      return (
                        <li key={branch.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedBranch(branch)}
                            className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-all duration-300 ${
                              selected
                                ? "border-cyan-400 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)] bg-slate-950/60"
                                : "border-white/10 bg-slate-950/60 text-slate-200 hover:border-cyan-400 hover:text-cyan-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
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
                <div className="rounded-xl border border-slate-700 bg-slate-900/90 p-4 shadow-lg">
                  <h3 className="mb-3 text-sm font-semibold text-white">{selectedBranch.name}</h3>
                  <dl className="space-y-2.5 text-sm">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-slate-500">Adres</dt>
                      <dd className="mt-0.5 text-slate-200">
                        {selectedBranch.address || "Belirtilmemiş"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-slate-500">Telefon</dt>
                      <dd className="mt-0.5 text-slate-200">
                        {selectedBranch.phone || "Belirtilmemiş"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                        Çalışma Saatleri
                      </dt>
                      <dd className="mt-0.5 text-slate-200">
                        {selectedBranch.workingHours ||
                          selectedBranch.working_hours ||
                          "09:00 - 17:00"}
                      </dd>
                    </div>
                  </dl>
                  {hasValidCoords(selectedBranch) ? (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${selectedBranch.lat},${selectedBranch.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-2.5 text-sm font-semibold text-teal-300 transition hover:bg-teal-500/20"
                    >
                      <Navigation size={16} />
                      Yol Tarifi Al
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="relative col-span-1 min-h-[280px] overflow-hidden rounded-xl border border-slate-800 bg-slate-950 md:col-span-2 md:min-h-0">
              {!selectedBranch ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  Haritada göstermek için bir şube seçin.
                </div>
              ) : !hasValidCoords(selectedBranch) ? (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-400">
                  Bu şube için konum koordinatı tanımlı değil.
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
                    className="absolute bottom-3 right-3 z-[1000] inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-950/90 px-3 py-2 text-xs font-semibold text-teal-300 shadow-lg backdrop-blur transition hover:border-teal-500/50 hover:text-teal-200"
                  >
                    <Navigation size={14} />
                    Yol Tarifi Al
                  </a>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
