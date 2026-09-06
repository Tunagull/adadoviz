/**
 * P1.5 — Abonelik-bitiş hatırlatma job'ı.
 *
 * Günde bir çalışır (server.js scheduler). Bitişe 7 / 3 / 1 / 0 gün kalan
 * aktif işletmelere `subscription_reminder`, süresi yeni geçmiş (0..-7 gün)
 * işletmelere bir kez `subscription_expired` in-app bildirimi + e-posta yollar.
 * Her koşuda operatöre (superadmin) kısa bir özet bildirimi bırakır.
 */
const {
  listBusinesses,
  hasRecentBusinessNotification,
} = require("../db");
const {
  getFrontendBaseUrl,
  sendSubscriptionReminderEmail,
  sendSubscriptionExpiredEmail,
} = require("../email");
const { emitBusinessNotification, emitAdminNotification } = require("../notifications");

const REMINDER_DAYS = new Set([7, 3, 1, 0]);
const EXPIRED_GRACE_DAYS = 7; // 0..-7 gün arası "yeni süresi geçmiş"

function reminderCopy(name, days) {
  if (days <= 0) {
    return {
      title: "Aboneliğiniz bugün doluyor",
      message:
        `${name} aboneliğinizin son günü. Kesintisiz listelenmeye devam etmek için ` +
        `bugün yenileyin.`,
    };
  }
  const unit = days === 1 ? "1 gün" : `${days} gün`;
  return {
    title: `Aboneliğinizin bitmesine ${unit} kaldı`,
    message:
      `${name} aboneliğiniz ${unit} sonra sona eriyor. Kesinti yaşamamak için ` +
      `yenileme talebinizi şimdi iletin.`,
  };
}

function expiredCopy(name) {
  return {
    title: "Aboneliğinizin süresi doldu",
    message:
      `${name} aboneliğinizin süresi doldu ve işletmeniz herkese açık listeden ` +
      `kaldırıldı. Yeniden yayına almak için aboneliğinizi yenileyin.`,
  };
}

async function runSubscriptionReminders() {
  const panelUrl = `${getFrontendBaseUrl()}/admin`;
  let reminded = 0;
  let expired = 0;
  const soon = []; // operatör özeti için

  let businesses = [];
  try {
    businesses = listBusinesses();
  } catch (err) {
    console.error("[JOB] subscriptionReminders listBusinesses hatası:", err.message);
    return { ok: false, error: err.message };
  }

  for (const b of businesses) {
    const days = b.days_remaining;
    if (days == null || !Number.isFinite(Number(days))) continue;
    const d = Number(days);
    const name = b.institution_name || b.institution_id || "İşletme";

    if (REMINDER_DAYS.has(d)) {
      soon.push({ name, days: d });
      if (hasRecentBusinessNotification(b.id, "subscription_reminder", 20)) continue;
      const { title, message } = reminderCopy(name, d);
      try {
        await emitBusinessNotification(b.id, {
          type: "subscription_reminder",
          title,
          message,
          emailFn: b.email
            ? () =>
                sendSubscriptionReminderEmail({
                  to: b.email,
                  institutionName: name,
                  daysRemaining: d,
                  endDate: b.subscription_end_date,
                  panelUrl,
                })
            : undefined,
        });
        reminded += 1;
      } catch (err) {
        console.warn(`[JOB] reminder emit hatası (${name}):`, err.message);
      }
    } else if (d < 0 && d >= -EXPIRED_GRACE_DAYS) {
      // Süresi geçmiş — 30 gün penceresiyle dedup: pratikte bir kez.
      if (hasRecentBusinessNotification(b.id, "subscription_expired", 24 * 30)) continue;
      const { title, message } = expiredCopy(name);
      try {
        await emitBusinessNotification(b.id, {
          type: "subscription_expired",
          title,
          message,
          emailFn: b.email
            ? () =>
                sendSubscriptionExpiredEmail({
                  to: b.email,
                  institutionName: name,
                  panelUrl,
                })
            : undefined,
        });
        expired += 1;
      } catch (err) {
        console.warn(`[JOB] expired emit hatası (${name}):`, err.message);
      }
    }
  }

  // Operatör özeti — yalnızca bu koşuda yeni bir bildirim oluşturulduysa
  // (aksi halde günlük tekrar spam olur).
  if (reminded > 0 || expired > 0) {
    const parts = [];
    if (soon.length) parts.push(`${soon.length} abonelik 7 gün içinde bitiyor`);
    if (expired > 0) parts.push(`${expired} abonelik yeni süresini doldurdu`);
    emitAdminNotification({
      type: "subscription_digest",
      title: "Abonelik hatırlatmaları gönderildi",
      message:
        `${reminded} hatırlatma, ${expired} süre-doldu bildirimi gönderildi.` +
        (parts.length ? ` (${parts.join("; ")})` : ""),
      data: { reminded, expired, soon },
    });
  }

  console.log(
    `[JOB] subscriptionReminders: reminded=${reminded} expired=${expired} soonCount=${soon.length}`
  );
  return { ok: true, reminded, expired, soonCount: soon.length };
}

module.exports = { runSubscriptionReminders };
