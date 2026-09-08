/**
 * ── ADADÖVİZ HARİTA STİLİ (MapLibre GL + KENDİ SUNUCUMUZDA PMTiles) ─────────
 *
 * Vektör döşemeleri artık TAMAMEN kendi altyapımızda:
 *   · `public/map/cyprus.pmtiles`  — Kıbrıs çıkarımı (Protomaps planet build'inden
 *     `pmtiles extract` ile alındı, z0-13, ~15 MB, tek dosya). Vercel statik
 *     olarak sunuyor, HTTP range request destekli.
 *   · `public/fonts/*`            — Noto Sans Regular/Medium/Italic glyph'leri.
 *   · sprite YOK                  — minimal stil ikon kullanmıyor.
 *
 * Hiçbir üçüncü-parti kutu (OpenFreeMap / MapTiler / CARTO) çalışma zamanında
 * çağrılmıyor → dış servis kesintisi haritayı etkilemez, kota / anahtar yok.
 *
 * Şema: Protomaps basemaps v4 (`earth`, `water`, `landuse`, `roads`,
 * `boundaries`, `places`, `buildings`). OpenMapTiles'tan farklı — katman ve
 * alan adları buna göre.
 *
 * Renkler tailwind.config.js `ink` ölçeğinden; harita kartların/gövdenin
 * zeminiyle aynı değerlere oturur. İki tema kasıtlı tasarlandı (CSS filtre
 * hilesi yok).
 */

/** Statik kök — dev'de `/`, prod'da yine `/` (Vercel). */
const BASE = import.meta.env.BASE_URL || "/";

/** pmtiles protokolü MUTLAK URL ister (blob/worker içinden çözülüyor). */
export function pmtilesUrl() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `pmtiles://${origin}${BASE}map/cyprus.pmtiles`;
}

const GLYPHS = `${BASE}fonts/{fontstack}/{range}.pbf`;

/** tailwind.config.js → colors.ink (mat siyah ölçeği). */
const ink = {
  50: "#f7f7f8",
  100: "#eeeef0",
  200: "#e0e0e3",
  300: "#c9c9ce",
  400: "#97979f",
  500: "#6b6b74",
  600: "#4f4f57",
  700: "#2f2f35",
  800: "#1e1e22",
  900: "#16161a",
  950: "#08080a",
};

const PALETTES = {
  light: {
    land: ink[50],
    green: "#e9efe9", // park / orman — neredeyse nötr, hafif yeşil
    residential: "#f1f1f2",
    water: "#d5dde6",
    waterLine: "#bcc8d4",
    building: "#e7e7ea",
    roadMinor: ink[200],
    roadMed: ink[300],
    roadMajor: "#c0c0c7",
    roadMajorCasing: "#a9a9b1",
    roadHighway: "#b7b7bf",
    roadHighwayCasing: "#9c9ca5",
    rail: ink[300],
    boundary: ink[300],
    boundaryCountry: ink[400],
    label: ink[700],
    labelMinor: ink[500],
    labelRoad: ink[400],
    labelWater: "#8b95a1",
    halo: "#ffffff",
  },
  dark: {
    land: "#0e0e11",
    green: "#111411",
    residential: "#131316",
    water: "#1b2531", // karadan ayrışsın diye hafif mavi-gri
    waterLine: "#243040",
    building: "#1a1a1f",
    roadMinor: "#26262b",
    roadMed: "#2f2f35",
    roadMajor: "#33333a",
    roadMajorCasing: "#242429",
    roadHighway: "#3c3c44",
    roadHighwayCasing: "#26262c",
    rail: "#2c2c32",
    boundary: "#33333a",
    boundaryCountry: "#4a4a53",
    label: ink[200],
    labelMinor: ink[400],
    labelRoad: ink[500],
    labelWater: "#5b6470",
    halo: ink[950],
  },
};

const w = (stops) => ({ type: "exponential", base: 1.4, stops });
/**
 * Etiket adı: KKTC yerleşimlerinde OSM yerel adı zaten Türkçe ("Girne",
 * "Gazimağusa"); Güney Kıbrıs'ta Yunanca. KKTC odaklı site için önce `name:tr`,
 * sonra İngilizce, sonra yerel ad.
 */
const NAME = ["coalesce", ["get", "name:tr"], ["get", "name:en"], ["get", "name"]];
const RANK = ["coalesce", ["get", "population_rank"], 0];

/**
 * @param {"light"|"dark"} mode
 * @returns {import("maplibre-gl").StyleSpecification}
 */
export function buildMapStyle(mode) {
  const c = PALETTES[mode] || PALETTES.light;

  return {
    version: 8,
    name: `adadoviz-${mode}`,
    glyphs: GLYPHS,
    sources: {
      ada: {
        type: "vector",
        url: pmtilesUrl(),
        attribution:
          '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> © ' +
          '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": c.land } },

      {
        id: "earth",
        type: "fill",
        source: "ada",
        "source-layer": "earth",
        paint: { "fill-color": c.land },
      },

      /* ---- Arazi kullanımı (çok soluk) -------------------------------- */
      {
        id: "landuse-green",
        type: "fill",
        source: "ada",
        "source-layer": "landuse",
        filter: [
          "match",
          ["get", "kind"],
          ["park", "forest", "wood", "nature_reserve", "national_park", "protected_area",
           "grass", "meadow", "garden", "village_green", "golf_course", "recreation_ground",
           "scrub", "cemetery", "farmland", "pitch"],
          true,
          false,
        ],
        paint: {
          "fill-color": c.green,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0, 10, 0.7],
        },
      },
      {
        id: "landuse-residential",
        type: "fill",
        source: "ada",
        "source-layer": "landuse",
        filter: ["==", ["get", "kind"], "residential"],
        paint: {
          "fill-color": c.residential,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 12, 0.7],
        },
      },

      /* ---- Su --------------------------------------------------------- */
      {
        id: "water",
        type: "fill",
        source: "ada",
        "source-layer": "water",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": c.water },
      },
      {
        id: "water-line",
        type: "line",
        source: "ada",
        "source-layer": "water",
        filter: [
          "all",
          ["==", ["geometry-type"], "LineString"],
          ["match", ["get", "kind"], ["river", "stream", "canal"], true, false],
        ],
        paint: {
          "line-color": c.waterLine,
          "line-width": w([[10, 0.4], [14, 1.4], [17, 3]]),
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0, 11, 1],
        },
      },

      /* ---- Binalar (yüksek zoom, ince) ------------------------------ */
      {
        id: "buildings",
        type: "fill",
        source: "ada",
        "source-layer": "buildings",
        minzoom: 13,
        paint: {
          "fill-color": c.building,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, 0.6],
        },
      },

      /* ---- Demiryolu ---------------------------------------------- */
      {
        id: "rail",
        type: "line",
        source: "ada",
        "source-layer": "roads",
        filter: ["==", ["get", "kind"], "rail"],
        minzoom: 10,
        paint: {
          "line-color": c.rail,
          "line-width": w([[10, 0.5], [16, 1.5]]),
          "line-dasharray": [3, 3],
          "line-opacity": 0.7,
        },
      },

      /* ---- Yollar: kılıf + dolgu -------------------------------- */
      {
        id: "road-highway-casing",
        type: "line",
        source: "ada",
        "source-layer": "roads",
        filter: ["==", ["get", "kind"], "highway"],
        minzoom: 6,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.roadHighwayCasing,
          "line-width": w([[6, 1.1], [10, 3.4], [16, 12]]),
        },
      },
      {
        id: "road-major-casing",
        type: "line",
        source: "ada",
        "source-layer": "roads",
        filter: ["==", ["get", "kind"], "major_road"],
        minzoom: 9,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.roadMajorCasing,
          "line-width": w([[9, 0.8], [12, 2], [16, 8]]),
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0, 10, 1],
        },
      },
      {
        id: "road-minor",
        type: "line",
        source: "ada",
        "source-layer": "roads",
        filter: ["match", ["get", "kind"], ["minor_road", "medium_road"], true, false],
        minzoom: 11,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.roadMinor,
          "line-width": w([[11, 0.4], [14, 1.6], [18, 9]]),
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0, 12, 1],
        },
      },
      {
        id: "road-major",
        type: "line",
        source: "ada",
        "source-layer": "roads",
        filter: ["==", ["get", "kind"], "major_road"],
        minzoom: 9,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.roadMajor,
          "line-width": w([[9, 0.6], [12, 1.5], [16, 6]]),
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0, 10, 1],
        },
      },
      {
        id: "road-highway",
        type: "line",
        source: "ada",
        "source-layer": "roads",
        filter: ["==", ["get", "kind"], "highway"],
        minzoom: 6,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.roadHighway,
          "line-width": w([[6, 0.7], [10, 2.2], [16, 9]]),
        },
      },

      /* ---- İdari sınırlar ------------------------------------- */
      {
        id: "boundary-region",
        type: "line",
        source: "ada",
        "source-layer": "boundaries",
        filter: [">=", ["get", "kind_detail"], 3],
        minzoom: 5,
        paint: {
          "line-color": c.boundary,
          "line-width": w([[5, 0.4], [12, 1.1]]),
          "line-dasharray": [2, 3],
          "line-opacity": 0.55,
        },
      },
      {
        id: "boundary-country",
        type: "line",
        source: "ada",
        "source-layer": "boundaries",
        filter: ["<=", ["get", "kind_detail"], 2],
        paint: {
          "line-color": c.boundaryCountry,
          "line-width": w([[2, 0.6], [6, 1.4], [12, 2.6]]),
          "line-dasharray": [3, 2],
        },
      },

      /* ---- Etiketler: su ------------------------------------- */
      {
        id: "label-water",
        type: "symbol",
        source: "ada",
        "source-layer": "water",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "name"]],
        layout: {
          "text-field": NAME,
          "text-font": ["Noto Sans Italic"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 12, 14],
          "text-max-width": 6,
        },
        paint: {
          "text-color": c.labelWater,
          "text-halo-color": c.halo,
          "text-halo-width": 1,
        },
      },

      /* ---- Etiketler: yol adları (ana yollar, yüksek zoom) --- */
      {
        id: "label-road",
        type: "symbol",
        source: "ada",
        "source-layer": "roads",
        filter: ["match", ["get", "kind"], ["highway", "major_road"], true, false],
        minzoom: 12,
        layout: {
          "symbol-placement": "line",
          "text-field": NAME,
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-max-width": 8,
          "text-letter-spacing": 0.02,
        },
        paint: {
          "text-color": c.labelRoad,
          "text-halo-color": c.halo,
          "text-halo-width": 1.5,
        },
      },

      /* ---- Etiketler: yerleşim (3 kademe: şehir / kasaba / köy) ---- */
      {
        id: "label-locality-minor",
        type: "symbol",
        source: "ada",
        "source-layer": "places",
        filter: ["all", ["==", ["get", "kind"], "locality"], ["<", RANK, 4]],
        minzoom: 12,
        layout: {
          "text-field": NAME,
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 15, 12.5],
          "text-max-width": 7,
        },
        paint: {
          "text-color": c.labelMinor,
          "text-halo-color": c.halo,
          "text-halo-width": 1.25,
        },
      },
      {
        id: "label-locality-town",
        type: "symbol",
        source: "ada",
        "source-layer": "places",
        filter: ["all", ["==", ["get", "kind"], "locality"], [">=", RANK, 4], ["<", RANK, 6]],
        minzoom: 10,
        layout: {
          "text-field": NAME,
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11, 15, 13.5],
          "text-max-width": 7,
        },
        paint: {
          "text-color": c.labelMinor,
          "text-halo-color": c.halo,
          "text-halo-width": 1.4,
        },
      },
      {
        id: "label-locality-city",
        type: "symbol",
        source: "ada",
        "source-layer": "places",
        filter: ["all", ["==", ["get", "kind"], "locality"], [">=", RANK, 6]],
        layout: {
          "text-field": NAME,
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 10, 14, 13, 18],
          "text-max-width": 8,
          "text-letter-spacing": 0.01,
        },
        paint: {
          "text-color": c.label,
          "text-halo-color": c.halo,
          "text-halo-width": 1.75,
        },
      },
      {
        id: "label-country",
        type: "symbol",
        source: "ada",
        "source-layer": "places",
        filter: ["==", ["get", "kind"], "country"],
        maxzoom: 9,
        layout: {
          "text-field": NAME,
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 8, 15],
          "text-max-width": 8,
          "text-letter-spacing": 0.06,
        },
        paint: {
          "text-color": c.labelMinor,
          "text-halo-color": c.halo,
          "text-halo-width": 1.75,
        },
      },
    ],
  };
}

/** Plain-text atıf (yedek). */
export const MAP_ATTRIBUTION_TEXT = "© Protomaps © OpenStreetMap";
