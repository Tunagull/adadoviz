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

/** SSE EventSource URL — localde localhost, production'da Render / env */
export function ratesStreamUrl() {
  return apiUrl("/api/rates-stream");
}

if (import.meta.env.DEV) {
  // Tek seferlik teşhis: hangi API'ye gidildiğini konsolda göster
  console.info(`[API] base = ${API_BASE}`);
}
