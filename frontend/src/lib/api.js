
/** P-04: bilgilendirici log yalnızca geliştirmede. */
const devLog = (...args) => {
  if (import.meta.env.DEV) console.log(...args);
};

/**
 * Backend API base URL.
 *
 * Priority:
 * 1) VITE_API_BASE_URL or VITE_API_URL (Vercel / .env)
 * 2) Local dev → http://localhost:5000
 * 3) Production fallback → Render backend (so SSE/charts never hit Vercel /api)
 *
 * Production'da Vercel'de VITE_API_BASE_URL=https://adadoviz-backend.onrender.com
 * tanımlı olmalı; bu dosya canlıya gömülü localhost yazmaz (yalnızca DEV fallback).
 */
const PRODUCTION_API_FALLBACK = "https://adadoviz-backend.onrender.com";

const envBase = String(
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || ""
)
  .trim()
  .replace(/\/$/, "");

export const API_BASE =
  envBase ||
  (import.meta.env.DEV ? "http://localhost:5000" : PRODUCTION_API_FALLBACK);

export function getApiBase() {
  return API_BASE;
}

/** Build full API URL from a path like "/api/kurlar" or "/api/foo?bar=1" */
export function apiUrl(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

/** Public media (logo path `/api/logos/:id`, data URL, or absolute http). */
export function mediaUrl(path) {
  if (!path) return null;
  const value = String(path);
  if (
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    /^https?:\/\//i.test(value)
  ) {
    return value;
  }
  return apiUrl(value);
}

/** SSE EventSource URL — localde localhost, production'da Render / env */
export function ratesStreamUrl() {
  return apiUrl("/api/rates-stream");
}

/**
 * Kur listesi URL'i — mümkünse Vercel edge-önbellekli proxy üzerinden.
 *
 * `VITE_API_BASE_URL` AÇIKÇA verilmemişse same-origin `/api/kurlar` döner:
 *   - dev'de Vite proxy backend'e iletir
 *   - production'da `frontend/api/kurlar.js` Vercel fonksiyonu devreye girer
 *     (CDN önbelleği → Render soğuk başlatması ilk yüklemeyi bloklamaz)
 * Açık bir API base ayarlanmışsa ona saygı gösterilir (proxy atlanır).
 */
export function cachedRatesUrl() {
  return envBase ? `${envBase}/api/kurlar` : "/api/kurlar";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Kur listesini soğuk-başlangıç toleranslı çeker.
 *
 * Render ücretsiz katmanı ~15 dk boştan sonra uyanırken `/api/kurlar` 503
 * döner (30–60 sn). Bu döngü 503 / ağ hatasında üstel bekleyişle yeniden
 * dener (toplam ~55 sn) ve edge-önbellekli proxy'yi (`cachedRatesUrl`)
 * kullanır. Hem dashboard hem ComparePage aynı davranışı paylaşsın diye
 * buraya çıkarıldı (F-H3).
 *
 * @param {object} [opts]
 * @param {() => boolean} [opts.isCancelled] - true dönerse döngü sessizce durur
 * @param {(info: {attempt: number, delayMs: number}) => void} [opts.onRetry]
 * @returns {Promise<any>} parse edilmiş JSON gövdesi
 */
export async function fetchRatesWithRetry(opts = {}) {
  const { isCancelled, onRetry } = opts;
  const RETRY_DELAYS_MS = [2000, 3000, 5000, 8000, 12000, 12000, 12000];
  let data = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (isCancelled?.()) return null;
    try {
      const res = await fetch(cachedRatesUrl());
      if (res.ok) {
        data = await res.json();
        break;
      }
      if (res.status !== 503 || attempt === RETRY_DELAYS_MS.length) {
        throw new Error(`Kurlar API error: ${res.status}`);
      }
    } catch (err) {
      if (attempt === RETRY_DELAYS_MS.length) throw err;
    }
    onRetry?.({ attempt: attempt + 1, delayMs: RETRY_DELAYS_MS[attempt] });
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
  if (!data) throw new Error("Kurlar alınamadı (zaman aşımı).");
  return data;
}

if (import.meta.env.DEV) {
  // Tek seferlik teşhis: hangi API'ye gidildiğini konsolda göster
  devLog(`[API] base = ${API_BASE}`);
}
