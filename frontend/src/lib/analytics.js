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

export function trackBusinessClick(businessName, businessId) {
  const name = String(businessName || "").trim();
  const id = businessId != null ? String(businessId).trim() : "";
  if (!name && !id) return;
  // S7: id birincil eşleşme anahtarı; isim geriye dönük uyum için hâlâ gönderiliyor.
  trackAnalyticsUpdate({ business: name || undefined, business_id: id || undefined });
}

/**
 * P2.5 — işletme analitik olayı (B3): view | call | whatsapp | directions |
 * search_impression. Çerez onayı yoksa sessizce atlanır; oturum kimliği varsa
 * eklenir. Fire-and-forget (`keepalive` ile sayfa geçişinde de teslim edilir).
 */
export function trackEvent(event, { institutionId, currency, city } = {}) {
  if (!hasAnalyticsConsent()) return;
  const type = String(event || "").trim();
  if (!type) return;
  const body = {
    event: type,
    institution_id: institutionId != null ? Number(institutionId) : undefined,
    session_id: getAnalyticsSessionId() || undefined,
    currency: currency ? String(currency).toUpperCase() : undefined,
    city: city ? String(city) : undefined,
  };
  try {
    fetch(apiUrl("/api/analytics/event"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analitik hiçbir zaman akışı bozmasın */
  }
}

/**
 * P3.4 — anasayfa büro araması sonuç bulamadı (S6). Çağıran taraf debounce
 * eder; burada yalnızca fire-and-forget. Kimlik yok, onay şartı yok (yalnızca
 * sorgu metni + şehir — kişisel veri değil).
 */
export function reportSearchMiss(query, city) {
  const q = String(query || "").trim();
  if (q.length < 2) return;
  try {
    fetch(apiUrl("/api/search-miss"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: q.slice(0, 120),
        city: city ? String(city).slice(0, 60) : undefined,
        session_id: getAnalyticsSessionId() || undefined,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* yut */
  }
}

export function trackCurrencyView(currency) {
  const code = String(currency || "").trim().toUpperCase();
  if (!code) return;
  trackAnalyticsUpdate({ currency: code });
}
