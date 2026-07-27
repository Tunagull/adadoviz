/**
 * Backend API base URL.
 *
 * Local (npm run dev):
 *   - Unset → http://localhost:5000 (Vite proxy or direct)
 *
 * Production (Vercel build):
 *   - MUST set VITE_API_BASE_URL to your live backend origin
 *     e.g. https://adadoviz-api.up.railway.app
 *   - No trailing slash
 *   - Rebuild after changing the env var (Vite bakes it at build time)
 */
const envBase = String(import.meta.env.VITE_API_BASE_URL || "")
  .trim()
  .replace(/\/$/, "");

export const API_BASE =
  envBase || (import.meta.env.DEV ? "http://localhost:5000" : "");

if (typeof window !== "undefined" && !import.meta.env.DEV && !API_BASE) {
  console.error(
    "[AdaDöviz] VITE_API_BASE_URL is not set. API calls (SSE, charts, rates) will hit this site and return 404. Set VITE_API_BASE_URL in Vercel to your backend URL and redeploy."
  );
}

export function getApiBase() {
  return API_BASE;
}

/** Build full API URL from a path like "/api/kurlar" or "/api/foo?bar=1" */
export function apiUrl(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE) {
    return normalized;
  }
  return `${API_BASE}${normalized}`;
}
