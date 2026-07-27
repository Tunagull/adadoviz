import { apiUrl } from "./api";

export const CONSENT_KEY = "cookieConsent";
export const SESSION_KEY = "analyticsSessionId";

export function hasAnalyticsConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

export function getAnalyticsSessionId() {
  try {
    return localStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Çerez kabulü sonrası anonim oturum başlat */
export async function startAnalyticsSession() {
  const session_id = createSessionId();
  try {
    localStorage.setItem(SESSION_KEY, session_id);
    localStorage.setItem(CONSENT_KEY, "accepted");
  } catch {
    /* ignore */
  }

  try {
    await fetch(apiUrl("/api/analytics/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id }),
    });
  } catch (err) {
    console.warn("[analytics] start:", err);
  }
  return session_id;
}

/** Sessiz etkileşim güncellemesi (GDPR: yalnızca onaylı oturum) */
export async function trackAnalyticsUpdate(payload = {}) {
  if (!hasAnalyticsConsent()) return;
  const session_id = getAnalyticsSessionId();
  if (!session_id) return;

  try {
    await fetch(apiUrl("/api/analytics/update"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, ...payload }),
    });
  } catch (err) {
    console.warn("[analytics] update:", err);
  }
}

export function trackBusinessClick(businessName) {
  const name = String(businessName || "").trim();
  if (!name) return;
  trackAnalyticsUpdate({ business: name });
}

export function trackCurrencyView(currency) {
  const code = String(currency || "").trim().toUpperCase();
  if (!code) return;
  trackAnalyticsUpdate({ currency: code });
}
