/**
 * TEST rozeti: yalnızca gerçek test (sınırsız) hesaplarda.
 * Süreli abonelik (gelecek end_date / kalan gün) varsa TEST gösterme.
 */
export function shouldShowTestBadge({
  subscription_type,
  subscription_end_date,
  days_remaining,
} = {}) {
  const type = String(subscription_type || "Test");
  if (type !== "Test") return false;

  const days = Number(days_remaining);
  if (Number.isFinite(days) && days > 0) return false;

  if (subscription_end_date) {
    const end = new Date(subscription_end_date).getTime();
    if (Number.isFinite(end) && end > Date.now()) return false;
  }

  return true;
}
