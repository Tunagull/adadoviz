import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { buildMapStyle } from "../lib/mapStyle";

import "maplibre-gl/dist/maplibre-gl.css";
/*
 * ⚠️ Vite + MapLibre GL v5/v6: prod derlemesinde MapLibre worker'ını
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)` ile arıyor ama bundler
 * o dosyayı EMIT ETMİYOR → worker 404 → hiçbir vektör döşemesi yüklenmiyor,
 * HATA DA VERMİYOR (harita bomboş). Çözüm: worker'ı `?worker&url` ile Vite'in
 * worker hattından geçirip kendi kendine yeten bir chunk olarak yayınlat ve
 * `setWorkerUrl` ile bildir. (Düz `?url` yetmez — worker `maplibre-gl-shared.mjs`
 * kardeşini import ediyor.)
 */
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

/** `pmtiles://` protokolünü bir kez kaydet (kendi sunucumuzdaki tek dosya döşeme). */
let pmtilesReady = false;
function ensurePmtilesProtocol() {
  if (pmtilesReady) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  pmtilesReady = true;
}

/**
 * ── AdaDöviz döviz-bürosu haritası ─────────────────────────────────────────
 *
 * MapLibre GL JS + OpenFreeMap vektör döşemeleri. Tema (`isDark`) değişince
 * harita YENİDEN OLUŞTURULMAZ — yalnızca `map.setStyle(..., { diff: true })`
 * çağrılır; kamera konumu, işaretçiler ve açık popup korunur.
 *
 * İşaretçiler DOM tabanlı (`maplibregl.Marker`): şube sayısı KKTC ölçeğinde
 * düşük (<100) ve DOM işaretçi tasarım sistemine (CSS token) doğrudan bağlanıp
 * seçili/açık durumları kolayca canlandırdığı için tercih edildi.
 *
 * Tüm zorunlu (imperative) harita mantığı tek bir mount effect'i içinde yaşar
 * ve `apiRef` üzerinden diğer effect'lere açılır — böylece bileşen kapsamında
 * mutasyon yapan fonksiyon kalmaz (react-hooks/immutability).
 *
 * Props:
 *   points          görünür şube listesi (MapPage `visible`)
 *   selectedId      seçili şube id'si (yan liste ile senkron)
 *   userLoc         { lat, lng } | null
 *   focus           { lat, lng, zoom } | null — uçuş hedefi
 *   isDark          site teması
 *   onSelectPoint   (point | null) => void — işaretçi/zemin tıklaması / popup kapatma
 *   popupRenderer   (point) => ReactNode — popup içeriği (i18n MapPage'de kalır)
 *   labels          { zoomIn, zoomOut, youAreHere, openNow } — a11y metinleri
 */

const CYPRUS_CENTER = [33.55, 35.28]; // [lng, lat] — KKTC kara kütlesi üzerinde
const CYPRUS_ZOOM = 9.2;
// PMTiles çıkarımı 32.2–34.72 / 34.5–35.8; sınırları o kutunun içinde tut.
const CYPRUS_MAX_BOUNDS = [
  [32.0, 34.5],
  [35.0, 35.95],
];

const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const MARKER_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>' +
  '<circle cx="12" cy="10" r="2.6"/></svg>';

export function OfficeMap({
  points = [],
  selectedId = null,
  userLoc = null,
  focus = null,
  isDark = true,
  onSelectPoint,
  popupRenderer,
  labels = {},
}) {
  const containerRef = useRef(null);
  const readyRef = useRef(false);
  const apiRef = useRef({});

  // En güncel prop'ları imperative kod'a sızdırmak için ref aynası (render sonrası).
  const onSelectRef = useRef(onSelectPoint);
  const rendererRef = useRef(popupRenderer);
  const pointsRef = useRef(points);
  const labelsRef = useRef(labels);
  useEffect(() => {
    onSelectRef.current = onSelectPoint;
    rendererRef.current = popupRenderer;
    pointsRef.current = points;
    labelsRef.current = labels;
  });

  /* ── Harita kurulumu + tüm imperative mantık (tek sefer) ─────────────── */
  useEffect(() => {
    if (!containerRef.current) return undefined;
    ensurePmtilesProtocol();

    const markers = new Map(); // id -> { marker, el }
    let userMarker = null;
    let popupId = null;
    let programmatic = false;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(isDark ? "dark" : "light"),
      center: CYPRUS_CENTER,
      zoom: CYPRUS_ZOOM,
      minZoom: 7.5,
      maxZoom: 18,
      maxBounds: CYPRUS_MAX_BOUNDS,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 120,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const popupEl = document.createElement("div");
    const popupRoot = createRoot(popupEl);
    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: "19rem",
      // İşaretçinin ÜSTÜNde aç (anchor: bottom) — flyTo işaretçiyi ortaladığı
      // için popup ekran içinde kalır; alt kenara taşmaz.
      anchor: "bottom",
      offset: 22,
      className: "ada-popup",
    }).setDOMContent(popupEl);
    popup.on("close", () => {
      popupId = null;
      if (!programmatic) onSelectRef.current?.(null);
    });

    function syncMarkers(list) {
      const next = new Set();
      for (const p of list) {
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        next.add(p.id);
        let entry = markers.get(p.id);
        if (!entry) {
          const el = document.createElement("button");
          el.type = "button";
          el.className = "ada-marker";
          el.innerHTML =
            `<span class="ada-marker__pin" aria-hidden="true">${MARKER_SVG}</span>` +
            '<span class="ada-marker__open" aria-hidden="true"></span>';
          el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const fresh = pointsRef.current.find((x) => x.id === p.id) || p;
            onSelectRef.current?.(fresh);
          });
          const marker = new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([lng, lat])
            .addTo(map);
          entry = { marker, el };
          markers.set(p.id, entry);
        } else {
          entry.marker.setLngLat([lng, lat]);
        }
        const openNow = labelsRef.current.openNow || "open";
        entry.el.setAttribute(
          "aria-label",
          `${p.institutionName || p.name}${p.open === "open" ? ` · ${openNow}` : ""}`
        );
        entry.el.classList.toggle("is-open", p.open === "open");
      }
      for (const [id, entry] of markers) {
        if (!next.has(id)) {
          entry.marker.remove();
          markers.delete(id);
        }
      }
    }

    function syncUser(loc) {
      if (!loc) {
        userMarker?.remove();
        userMarker = null;
        return;
      }
      if (!userMarker) {
        const el = document.createElement("div");
        el.className = "ada-user-dot";
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", labelsRef.current.youAreHere || "You are here");
        el.innerHTML =
          '<span class="ada-user-dot__pulse"></span><span class="ada-user-dot__core"></span>';
        userMarker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([loc.lng, loc.lat])
          .addTo(map);
      } else {
        userMarker.setLngLat([loc.lng, loc.lat]);
      }
    }

    function syncSelected(id) {
      for (const [mid, entry] of markers) {
        entry.el.classList.toggle("is-active", mid === id);
        entry.el.style.zIndex = mid === id ? "3" : "";
      }
      if (id == null) {
        if (popupId != null) {
          programmatic = true;
          popup.remove();
          programmatic = false;
        }
        return;
      }
      const p = pointsRef.current.find((x) => x.id === id);
      if (!p || !Number.isFinite(Number(p.lat))) return;
      popupRoot.render(rendererRef.current?.(p) ?? null);
      popup.setLngLat([Number(p.lng), Number(p.lat)]);
      if (popupId !== id) {
        programmatic = true;
        popup.addTo(map);
        programmatic = false;
      }
      popupId = id;
    }

    /** Açık popup'ın içeriğini tazele (dil değişimi vb. — id sabit). */
    function rerenderPopup() {
      if (popupId == null) return;
      const p = pointsRef.current.find((x) => x.id === popupId);
      if (p) popupRoot.render(rendererRef.current?.(p) ?? null);
    }

    function flyTo(target) {
      if (!target) return;
      // Nokta seçiminde popup işaretçinin ÜSTÜnde açılır; işaretçiyi merkezin
      // biraz ALTına al ki uzun popup harita kabına taşmasın.
      const h = map.getContainer().clientHeight || 0;
      const offset = target.popup ? [0, Math.min(150, Math.round(h * 0.24))] : [0, 0];
      map.flyTo({
        center: [target.lng, target.lat],
        zoom: target.zoom ?? map.getZoom(),
        offset,
        duration: reducedMotion() ? 0 : 700,
        essential: true,
      });
    }

    apiRef.current = { syncMarkers, syncUser, syncSelected, rerenderPopup, flyTo, map };
    if (import.meta.env.DEV) {
      window.__adaMap = map;
      map.on("error", (e) => console.error("[maplibre]", e?.error?.message || e));
    }

    map.on("click", () => onSelectRef.current?.(null));

    map.once("load", () => {
      readyRef.current = true;
      const root = containerRef.current;
      const l = labelsRef.current;
      if (root) {
        const zin = root.querySelector(".maplibregl-ctrl-zoom-in");
        const zout = root.querySelector(".maplibregl-ctrl-zoom-out");
        if (zin && l.zoomIn) {
          zin.setAttribute("aria-label", l.zoomIn);
          zin.setAttribute("title", l.zoomIn);
        }
        if (zout && l.zoomOut) {
          zout.setAttribute("aria-label", l.zoomOut);
          zout.setAttribute("title", l.zoomOut);
        }
      }
      syncMarkers(pointsRef.current);
      syncUser(userLoc);
      syncSelected(selectedId);
      flyTo(focus);
    });

    return () => {
      apiRef.current = {};
      readyRef.current = false;
      setTimeout(() => popupRoot.unmount(), 0);
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Tema değişimi: yalnızca stil diff'i (harita korunur) ────────────── */
  useEffect(() => {
    const map = apiRef.current.map;
    if (!map || !readyRef.current) return;
    map.setStyle(buildMapStyle(isDark ? "dark" : "light"), { diff: true });
  }, [isDark]);

  /* ── Prop → harita senkronu ─────────────────────────────────────────── */
  useEffect(() => {
    if (readyRef.current) apiRef.current.syncMarkers?.(points);
  }, [points, labels.openNow]);

  useEffect(() => {
    if (readyRef.current) apiRef.current.syncUser?.(userLoc);
  }, [userLoc]);

  useEffect(() => {
    if (readyRef.current) apiRef.current.syncSelected?.(selectedId);
  }, [selectedId, points]);

  // Dil/çeviri değişince açık popup içeriğini yeniden çiz.
  useEffect(() => {
    if (readyRef.current) apiRef.current.rerenderPopup?.();
  }, [popupRenderer]);

  useEffect(() => {
    if (readyRef.current) apiRef.current.flyTo?.(focus);
  }, [focus]);

  return <div ref={containerRef} className="ada-map h-full w-full" />;
}

export default OfficeMap;
