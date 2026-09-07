/**
 * P3.2 — kur alarmı kontrol job'ı (C3).
 *
 * `refreshRatesCacheWithChangeDetection` her başarılı kur güncellemesinden sonra
 * `runRateAlertCheck(centralBankRates)` çağırır. Doğrulanmış + aktif alarmlar
 * için KKTC MB alış/satış kuru eşikle karşılaştırılır.
 *
 * "armed" bayrağı yalnızca eşik GEÇİŞİNDE tetikler: koşul önce FALSE olmalı,
 * sonra TRUE olunca bir kez e-posta gider (ayrıca 12 saat debounce). Koşul
 * yeniden FALSE olunca armed=1 — böylece sabit kalan kur her döngüde spam etmez.
 */
const {
  getActiveVerifiedRateAlerts,
  recordRateAlertFired,
  setRateAlertArmed,
  getRateAlertByToken,
  RATE_ALERT_DEBOUNCE_HOURS,
} = require("../db");
const { isMailConfigured, getFrontendBaseUrl, sendRateAlertEmail } = require("../email");

function currentRateFor(centralBankRates, currency, side) {
  const pair = centralBankRates && centralBankRates[currency];
  if (!pair) return null;
  const v = Number(side === "sell" ? pair.sell : pair.buy);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function conditionMet(direction, current, threshold) {
  return direction === "below" ? current <= threshold : current >= threshold;
}

/** Tek alarmı değerlendir — tetiklendiyse e-posta yollar, armed/last_fired günceller. */
async function evaluateAlert(
  alert,
  centralBankRates,
  { debounceHours = RATE_ALERT_DEBOUNCE_HOURS } = {}
) {
  if (!alert || !alert.active || !alert.verified) return { fired: false };
  const current = currentRateFor(centralBankRates, alert.currency, alert.side);
  if (current == null) return { fired: false };

  const met = conditionMet(alert.direction, current, alert.threshold);

  if (!met) {
    if (!alert.armed) setRateAlertArmed(alert.id, true);
    return { fired: false };
  }
  if (!alert.armed) return { fired: false }; // önceki tetikten sonra reset bekliyor
  const lastMs = alert.last_fired_at ? Date.parse(alert.last_fired_at) : 0;
  if (lastMs && Date.now() - lastMs < debounceHours * 3600 * 1000) {
    return { fired: false };
  }

  let emailed = false;
  if (isMailConfigured()) {
    try {
      await sendRateAlertEmail({
        to: alert.email,
        currency: alert.currency,
        side: alert.side,
        direction: alert.direction,
        threshold: alert.threshold,
        currentRate: current,
        manageUrl: `${getFrontendBaseUrl()}/alarm/${alert.manage_token}`,
      });
      emailed = true;
    } catch (err) {
      console.warn(`[JOB] rateAlert e-posta gönderilemedi (#${alert.id}):`, err.message);
    }
  }
  recordRateAlertFired(alert.id);
  return { fired: true, emailed, current };
}

async function runRateAlertCheck(centralBankRates) {
  if (!centralBankRates || typeof centralBankRates !== "object") {
    return { ok: false, reason: "no_rates" };
  }
  let alerts = [];
  try {
    alerts = getActiveVerifiedRateAlerts();
  } catch (err) {
    console.error("[JOB] rateAlerts liste hatası:", err.message);
    return { ok: false, error: err.message };
  }
  let fired = 0;
  let emailed = 0;
  for (const alert of alerts) {
    try {
      const r = await evaluateAlert(alert, centralBankRates);
      if (r.fired) fired += 1;
      if (r.emailed) emailed += 1;
    } catch (err) {
      console.warn(`[JOB] rateAlert değerlendirme hatası (#${alert.id}):`, err.message);
    }
  }
  if (fired > 0) {
    console.log(
      `[JOB] rateAlerts: ${fired} alarm tetiklendi, ${emailed} e-posta gönderildi (${alerts.length} aktif).`
    );
  }
  return { ok: true, checked: alerts.length, fired, emailed };
}

/** Doğrulama anında: bu token'in alarmını hemen bir kez değerlendir. */
async function checkSingleAlertNow(token, centralBankRates) {
  try {
    const alert = getRateAlertByToken(token);
    if (!alert) return { fired: false };
    return await evaluateAlert(alert, centralBankRates);
  } catch (err) {
    console.warn("[JOB] checkSingleAlertNow hatası:", err.message);
    return { fired: false };
  }
}

module.exports = { runRateAlertCheck, checkSingleAlertNow };
