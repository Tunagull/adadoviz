/**
 * Backend API base URL.
 *
 * Priority:
 * 1) VITE_API_BASE_URL (Vercel / .env)
 * 2) Local dev → http://localhost:5000
 * 3) Production fallback → Render backend (so SSE/charts never hit Vercel /api)
 */
const PRODUCTION_API_FALLBACK = "https://adadoviz-api.onrender.com";

const envBase = String(import.meta.env.VITE_API_BASE_URL || "")
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
