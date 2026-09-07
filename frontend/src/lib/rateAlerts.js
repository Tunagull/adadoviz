import { apiUrl } from "./api";

/**
 * P3.2 — kur alarmı public API sarmalayıcıları (C3).
 * Yönetim token'lıdır (`/alarm/:token`); admin uçları `lib/auth.js`'te.
 */

export const RATE_ALERT_CURRENCIES = ["USD", "EUR", "GBP"];

export async function createRateAlert(payload) {
  const res = await fetch(apiUrl("/api/rate-alerts"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Alarm kurulamadı.");
  return data;
}

export async function fetchRateAlertManage(token) {
  const res = await fetch(apiUrl(`/api/rate-alerts/manage/${encodeURIComponent(token)}`));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Alarmlar alınamadı.");
  return data;
}

export async function verifyRateAlert(token) {
  const res = await fetch(
    apiUrl(`/api/rate-alerts/verify/${encodeURIComponent(token)}`),
    { method: "POST" }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Doğrulanamadı.");
  return data;
}

export async function setRateAlertActive(token, id, active) {
  const res = await fetch(
    apiUrl(`/api/rate-alerts/${id}?token=${encodeURIComponent(token)}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Güncellenemedi.");
  return data;
}

export async function deleteRateAlert(token, id) {
  const res = await fetch(
    apiUrl(`/api/rate-alerts/${id}?token=${encodeURIComponent(token)}`),
    { method: "DELETE" }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Silinemedi.");
  return data;
}

export async function unsubscribeAllRateAlerts(token) {
  const res = await fetch(apiUrl("/api/rate-alerts/unsubscribe-all"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "İşlem başarısız.");
  return data;
}
