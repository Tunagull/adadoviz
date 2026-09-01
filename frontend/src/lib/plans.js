/**
 * Abonelik paketleri — backend `DEFAULT_PLANS` ile aynı varsayılanlar.
 * Super Admin fiyatı değişince `/api/plans` bu değerlerin üzerine yazar.
 */
export const FALLBACK_PLANS = [
  { code: "deneme", ad: "Deneme", sure_gun: 14, fiyat: 0, sira: 1 },
  { code: "aylik", ad: "Aylık Abonelik", sure_gun: 30, fiyat: 500, sira: 2 },
  { code: "yillik", ad: "Yıllık Abonelik", sure_gun: 365, fiyat: 5000, sira: 3 },
  { code: "ucretsiz", ad: "Ücretsiz Listeleme", sure_gun: 0, fiyat: 0, sira: 4 },
];

export function plansByCode(plans) {
  const map = {};
  for (const plan of plans || []) {
    if (plan?.code) map[plan.code] = plan;
  }
  return map;
}

export function annualSavingsPercent(monthly, yearly) {
  const m = Number(monthly);
  const y = Number(yearly);
  if (!(m > 0) || !(y > 0)) return 0;
  const fullYear = m * 12;
  if (!(fullYear > y)) return 0;
  return Math.round((1 - y / fullYear) * 100);
}

export function formatTry(amount, locale = "tr-TR") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString(locale, { maximumFractionDigits: 0 })} ₺`;
}
