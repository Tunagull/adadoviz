import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { LocateFixed, MapPin, Navigation, Phone } from "lucide-react";
import { BrandLogo } from "../components/BrandLogo";
import { SiteNav } from "../components/SiteNav";
import { HeaderActions } from "../components/HeaderActions";
import { FloatingSelect } from "../components/ui/floating-label";
import { useLanguage } from "../context/LanguageContext";
import { apiUrl, fetchRatesWithRetry, mediaUrl } from "../lib/api";
import { cityLabel } from "../lib/cities";
import { whatsappHref, telHref } from "../lib/contact";
import { buildBusinessSlug, exchangeOfficePath } from "../lib/slug";
import { trackBusinessClick, trackEvent } from "../lib/analytics";

import "leaflet/dist/leaflet.css";

/* DealerManagement.jsx ile aynı düzeltme: Vite'te varsayılan Leaflet marker
   ikon yolları kırılıyor; import edilen asset'lerle yeniden bağlanıyor. */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const KKTC_CENTER = [35.1856, 33.3823];
const KKTC_ZOOM = 9;
/** SSE yok — sekme görünürken kurları 60 sn'de bir tazele (BestRatePage ile aynı). */
const REFRESH_MS = 60_000;
const CURRENCIES = ["USD", "EUR", "GBP"];

/** V0FinancialDashboard `isOpenNow` mantığının bağımsız kopyası (oradan export edilmiyor). */
function openState(workingHours) {
  if (!workingHours) return "unknown";
  try {
    if (typeof workingHours === "object" && !Array.isArray(workingHours)) {
      const dayKeys = ["pazar", "pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi"];
      const slot = workingHours[dayKeys[new Date().getDay()]];
      if (!Array.isArray(slot) || slot[0] == null || slot[1] == null) return "unknown";
      const now = new Date();
      const cur = now.getHours() * 60 + now.getMinutes();
      return cur >= Number(slot[0]) && cur <= Number(slot[1]) ? "open" : "closed";
    }
    const [start, end] = String(workingHours).split("-").map((s) => s.trim());
    if (!start || !end) return "unknown";
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    if (![sh, sm, eh, em].every(Number.isFinite)) return "unknown";
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    return cur >= sh * 60 + sm && cur <= eh * 60 + em ? "open" : "closed";
  } catch {
    return "unknown";
  }
}

function parseRateNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = String(value).trim().replace(/\s/g, "");
  if (!trimmed) return null;
  const lastDot = trimmed.lastIndexOf(".");
  const lastComma = trimmed.lastIndexOf(",");
  let normalized = trimmed.replace(/[^\d.,-]/g, "");
  if (!normalized) return null;
  if (lastComma > lastDot) normalized = normalized.replace(/\./g, "").replace(",", ".");
  else normalized = normalized.replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function bankRate(apiBank, currency) {
  const arr = Array.isArray(apiBank?.exchangeRates) ? apiBank.exchangeRates : [];
  const fromArr = arr.find((r) => r.currency === currency);
  const fromObj = apiBank?.rates?.[currency];
  return {
    buy: parseRateNumber(fromArr?.buy ?? fromObj?.buy),
    sell: parseRateNumber(fromArr?.sell ?? fromObj?.sell),
  };
}

function isListable(apiBank) {
  const active =
    apiBank?.is_active !== false && apiBank?.is_active !== 0 && apiBank?.is_active !== "0";
  if (!active) return false;
  if (apiBank?.subscription_end_date) {
    const end = new Date(apiBank.subscription_end_date).getTime();
    if (Number.isFinite(end) && end <= Date.now()) return false;
  }
  return true;
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

const cleanName = (s) => String(s || "").replace(/\s*\([Tt]est\)\s*/g, " ").trim();

/** Harita örneğini konum/şehir değişince yumuşakça yeniden ortalar. */
function MapController({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    map.flyTo([focus.lat, focus.lng], focus.zoom ?? map.getZoom(), { duration: 0.6 });
  }, [focus, map]);
  return null;
}

export function MapPage() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "tr-TR";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [branches, setBranches] = useState([]);
  const [banksById, setBanksById] = useState({});
  const [status, setStatus] = useState("loading"); // loading | waking | ready | error
  const [userLoc, setUserLoc] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  const [focus, setFocus] = useState(null);

  const cityParam = searchParams.get("sehir") || "";
  const openOnly = searchParams.get("acik") === "1";

  const setParam = useCallback(
    (patch) => {
      const p = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(patch)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // Şubeler (koordinatlı, tek sefer) — /api/branches backend'i değişmedi.
  useEffect(() => {
    let alive = true;
    fetch(apiUrl("/api/branches"))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!alive) return;
        const list = (Array.isArray(data?.branches) ? data.branches : []).filter(
          (b) => Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng))
        );
        setBranches(list);
      })
      .catch(() => {
        if (alive) setStatus((s) => (s === "ready" ? s : "error"));
      });
    return () => {
      alive = false;
    };
  }, []);

  // Kurlar — soğuk-backend toleranslı, sekme görünürken 60 sn tazeleme.
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchRatesWithRetry({
        isCancelled: () => !alive,
        onRetry: () => {
          if (alive) setStatus((s) => (s === "ready" ? s : "waking"));
        },
      })
        .then((data) => {
          if (!alive || !data) return;
          const map = {};
          for (const b of Array.isArray(data?.banks) ? data.banks : []) {
            if (!isListable(b)) continue;
            const id = b?.institutionId;
            if (id) map[id] = b;
          }
          setBanksById(map);
          setStatus("ready");
        })
        .catch(() => {
          if (alive) setStatus((s) => (s === "ready" ? s : "error"));
        });
    };
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Şube + kur birleşimi (kurumun anlık kuru + çalışma saati + logo/slug).
  const points = useMemo(() => {
    return branches.map((b) => {
      const bank = banksById[b.institution_id] || null;
      const rates = {};
      for (const c of CURRENCIES) rates[c] = bank ? bankRate(bank, c) : { buy: null, sell: null };
      const dist =
        userLoc && Number.isFinite(b.lat) && Number.isFinite(b.lng)
          ? haversineKm(userLoc.lat, userLoc.lng, b.lat, b.lng)
          : null;
      return {
        ...b,
        name: cleanName(b.name) || cleanName(b.institution_name),
        institutionName: cleanName(b.institution_name),
        logo_url: bank?.logo_url || null,
        slug: bank?.slug || null,
        rates,
        open: openState(bank?.working_hours ?? bank?.workingHours),
        dist,
      };
    });
  }, [branches, banksById, userLoc]);

  const cityOptions = useMemo(() => {
    const slugs = new Set();
    for (const p of points) if (p.city) slugs.add(p.city);
    return [...slugs]
      .map((slug) => ({ slug, label: cityLabel(slug, lang) }))
      .sort((a, b) => a.label.localeCompare(b.label, "tr"));
  }, [points, lang]);

  const visible = useMemo(() => {
    let list = points;
    if (cityParam) list = list.filter((p) => p.city === cityParam);
    if (openOnly) list = list.filter((p) => p.open !== "closed");
    return [...list].sort((a, b) => {
      if (a.dist != null && b.dist != null) return a.dist - b.dist;
      return String(a.name).localeCompare(String(b.name), "tr");
    });
  }, [points, cityParam, openOnly]);

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) {
      setLocError(t("mapLocateUnsupported"));
      return;
    }
    setLocating(true);
    setLocError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(loc);
        setFocus({ ...loc, zoom: 12 });
        setLocating(false);
      },
      () => {
        setLocError(t("mapLocateError"));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }, [t]);

  const pinEvent = (p, event) =>
    trackEvent(event, { institutionId: p.institution_id, city: cityLabel(p.city, lang) || undefined });

  const goToOffice = (p) => {
    trackBusinessClick(p.institutionName || p.name, p.institution_id);
    pinEvent(p, "view");
    const slug = p.slug || buildBusinessSlug({ institutionId: p.institution_id, name: p.institutionName });
    navigate(exchangeOfficePath(slug), { state: { openDetail: true } });
  };

  const fmt = (v) =>
    v == null ? "—" : v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  return (
    <div className="min-h-screen">
      <Helmet>
        <title>{`${t("mapTitle")} | AdaDöviz`}</title>
        <meta name="description" content={t("mapLead")} />
      </Helmet>

      <header className="sticky top-0 z-sticky w-full border-b border-ink-200/80 bg-white/80 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80 sm:px-6 sm:py-4 md:py-5">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 sm:gap-4">
          <BrandLogo className="min-w-0 shrink" />
          <SiteNav className="mr-auto ml-2" />
          <HeaderActions />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6">
        <section className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("mapTitle")}</h1>
          <p className="text-sm text-ink-600 dark:text-ink-400">{t("mapLead")}</p>
        </section>

        {/* Filtre çubuğu */}
        <section className="flex flex-wrap items-center gap-3">
          <FloatingSelect
            label={t("cityFilterLabel")}
            size="sm"
            className="min-w-[12rem]"
            value={cityParam}
            onChange={(e) => setParam({ sehir: e.target.value })}
          >
            <option value="">{t("mapAllCities")}</option>
            {cityOptions.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </FloatingSelect>

          <button
            type="button"
            aria-pressed={openOnly}
            onClick={() => setParam({ acik: openOnly ? "" : "1" })}
            className={`btn ${openOnly ? "btn-primary" : "btn-ghost"} h-9`}
          >
            {t("mapOpenNow")}
          </button>

          <button
            type="button"
            onClick={locateMe}
            disabled={locating}
            className="btn btn-ghost h-9 gap-1.5"
          >
            <LocateFixed size={15} aria-hidden="true" />
            {locating ? t("mapLocating") : t("mapNearMe")}
          </button>

          <span className="ml-auto text-xs text-ink-500 dark:text-ink-400">
            {t("mapBranchCount").replace("{n}", String(visible.length))}
          </span>
        </section>

        {locError ? (
          <p role="alert" className="text-xs text-danger-600 dark:text-danger-400">
            {locError}
          </p>
        ) : null}

        {status === "error" && points.length === 0 ? (
          <div role="alert" className="surface-card p-8 text-center text-sm text-danger-600 dark:text-danger-400">
            {t("compareError")}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
            {/* Harita */}
            <div className="surface-card overflow-hidden p-0">
              <MapContainer
                center={KKTC_CENTER}
                zoom={KKTC_ZOOM}
                scrollWheelZoom
                style={{ height: "min(70vh, 640px)", width: "100%" }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapController focus={focus} />
                {userLoc ? (
                  <Marker
                    position={[userLoc.lat, userLoc.lng]}
                    icon={L.divIcon({
                      className: "",
                      html: '<div style="width:14px;height:14px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 2px rgba(37,99,235,.4)"></div>',
                      iconSize: [14, 14],
                      iconAnchor: [7, 7],
                    })}
                  >
                    <Popup>{t("mapYouAreHere")}</Popup>
                  </Marker>
                ) : null}

                {visible.map((p) => (
                  <Marker key={p.id} position={[p.lat, p.lng]}>
                    <Popup>
                      <div className="min-w-[15rem] space-y-2">
                        <div className="flex items-center gap-2">
                          {p.logo_url ? (
                            <img
                              src={mediaUrl(p.logo_url)}
                              alt=""
                              className="h-7 w-7 shrink-0 rounded-full bg-white object-cover p-0.5 shadow-sm"
                            />
                          ) : null}
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink-900">{p.institutionName || p.name}</p>
                            <p className="truncate text-xs text-ink-500">{p.name}</p>
                          </div>
                        </div>

                        {p.open !== "unknown" ? (
                          <span
                            className={`inline-flex items-center rounded-control px-1.5 py-0.5 text-[11px] font-semibold ${
                              p.open === "open"
                                ? "bg-success-600 text-white"
                                : "bg-ink-200 text-ink-600"
                            }`}
                          >
                            {p.open === "open" ? t("openNow") : t("mapClosed")}
                          </span>
                        ) : null}

                        <table className="w-full text-xs tabular-nums">
                          <tbody>
                            {CURRENCIES.map((c) => (
                              <tr key={c}>
                                <td className="py-0.5 pr-2 font-medium text-ink-500">{c}</td>
                                <td className="py-0.5 text-right">{fmt(p.rates[c].buy)}</td>
                                <td className="py-0.5 pl-1 text-right">{fmt(p.rates[c].sell)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="text-[10px] uppercase tracking-wide text-ink-400">
                          {t("buyShort")} / {t("sellShort")}
                        </p>

                        {p.address ? (
                          <p className="text-xs text-ink-500">{p.address}</p>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <a
                            className="btn btn-ghost h-8 gap-1 text-xs"
                            href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => pinEvent(p, "directions")}
                          >
                            <Navigation size={13} aria-hidden="true" />
                            {t("mapDirections")}
                          </a>
                          {whatsappHref(p.whatsapp || p.phone) ? (
                            <a
                              className="btn btn-ghost h-8 gap-1 text-xs text-success-600"
                              href={whatsappHref(p.whatsapp || p.phone)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => pinEvent(p, "whatsapp")}
                            >
                              WhatsApp
                            </a>
                          ) : telHref(p.phone) ? (
                            <a
                              className="btn btn-ghost h-8 gap-1 text-xs"
                              href={telHref(p.phone)}
                              onClick={() => pinEvent(p, "call")}
                            >
                              <Phone size={13} aria-hidden="true" />
                              {t("phoneLabel")}
                            </a>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => goToOffice(p)}
                            className="btn btn-primary h-8 text-xs"
                          >
                            {t("mapDetail")}
                          </button>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>

            {/* Yan liste — konum bilinirse mesafeye göre sıralı */}
            <aside className="surface-card max-h-[min(70vh,640px)] overflow-y-auto p-0">
              {visible.length === 0 ? (
                <p className="p-6 text-center text-sm text-ink-500 dark:text-ink-400">
                  {status === "ready" ? t("mapEmpty") : t("compareLoading")}
                </p>
              ) : (
                <ul className="divide-y divide-ink-200 dark:divide-ink-700/60">
                  {visible.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setFocus({ lat: p.lat, lng: p.lng, zoom: 15 })}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50 dark:hover:bg-white/5"
                      >
                        <MapPin size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-400" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-ink-900 dark:text-white">
                              {p.institutionName || p.name}
                            </span>
                            {p.open === "open" ? (
                              <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-success-500" title={t("openNow")} />
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
                            {p.city ? cityLabel(p.city, lang) : p.name}
                            {p.dist != null ? ` · ${p.dist.toLocaleString(locale, { maximumFractionDigits: 1 })} km` : ""}
                          </span>
                          <span className="mt-0.5 block text-xs tabular-nums text-ink-600 dark:text-ink-300">
                            USD {fmt(p.rates.USD.buy)} / {fmt(p.rates.USD.sell)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
