/**
 * Tek periyot sözlüğü (project_audit_report.md §1.3).
 *
 * Önceden SQLite `periodToHoursBack`, Supabase `PERIOD_HOURS` ve
 * `VIEW_SPAN_HOURS` birbirinden sapıyordu (örn. Günlük: 7 gün vs 24 saat).
 * Tüm backend okuma/yüzde/agregasyon yolları bu sözlüğü kullanır.
 *
 * - fetchHours: işletme grafiği / geçmiş çekim derinliği
 * - viewHours:  görüntü penceresi (meta / "X gün gerekli")
 * - pctHours:   yüzde değişim karşılaştırma aralığı (= viewHours)
 * - bucket:     'hour' | 'day' — piyasa özeti agregasyonu
 */
const PERIOD_SPEC = Object.freeze({
  Saatlik: Object.freeze({
    fetchHours: 24,
    viewHours: 24,
    pctHours: 24,
    bucket: "hour",
  }),
  Günlük: Object.freeze({
    fetchHours: 24 * 7,
    viewHours: 24 * 7,
    pctHours: 24 * 7,
    bucket: "hour",
  }),
  Haftalık: Object.freeze({
    fetchHours: 24 * 30,
    viewHours: 24 * 30,
    pctHours: 24 * 30,
    bucket: "day",
  }),
  Aylık: Object.freeze({
    fetchHours: 24 * 365,
    viewHours: 24 * 365,
    pctHours: 24 * 365,
    bucket: "day",
  }),
  Yıllık: Object.freeze({
    fetchHours: 24 * 365 * 5,
    viewHours: 24 * 365 * 5,
    pctHours: 24 * 365 * 5,
    bucket: "day",
  }),
});

/** Piyasa Özeti sol ok navigasyonu: periyottan bağımsız tam arşiv derinliği */
const MARKET_ARCHIVE_HOURS = 24 * 365 * 6;

function resolvePeriodSpec(period) {
  return PERIOD_SPEC[period] || PERIOD_SPEC.Günlük;
}

function periodToHoursBack(period) {
  return resolvePeriodSpec(period).fetchHours;
}

module.exports = {
  PERIOD_SPEC,
  MARKET_ARCHIVE_HOURS,
  resolvePeriodSpec,
  periodToHoursBack,
};
