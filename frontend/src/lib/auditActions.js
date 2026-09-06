/**
 * audit_log.action kodları için okunabilir etiketler.
 *
 * Backend action isimleri snake_case sabitlerdir (bkz. backend/src/server.js
 * içindeki recordAudit çağrıları). Sözlüğü LanguageContext'e koymak yerine
 * burada tutuyoruz; hem liste uzun hem de yalnızca log ekranlarında lazım.
 */

const AUDIT_ACTION_LABELS = {
  // kimlik / oturum
  business_login: { tr: "Panele giriş", en: "Panel login" },
  superadmin_login: { tr: "Süper admin girişi", en: "Super admin login" },
  password_change: { tr: "Şifre değiştirildi", en: "Password changed" },
  password_reset: { tr: "Şifre sıfırlandı", en: "Password reset" },
  password_reset_requested: { tr: "Şifre sıfırlama talebi", en: "Password reset requested" },

  // işletme profili
  business_profile_update: { tr: "Profil güncellendi", en: "Profile updated" },
  business_logo_update: { tr: "Profil fotoğrafı değiştirildi", en: "Logo changed" },

  // kurlar
  margin_update: { tr: "Kâr marjı güncellendi", en: "Margin updated" },

  // şubeler
  business_branch_update: { tr: "Şube güncellendi", en: "Branch updated" },
  branch_create: { tr: "Şube eklendi", en: "Branch created" },
  branch_update: { tr: "Şube düzenlendi", en: "Branch edited" },
  branch_delete: { tr: "Şube silindi", en: "Branch deleted" },

  // süper admin işlemleri
  business_create: { tr: "İşletme oluşturuldu", en: "Business created" },
  business_update: { tr: "İşletme güncellendi", en: "Business updated" },
  business_delete: { tr: "İşletme silindi", en: "Business deleted" },
  subscription_reset: { tr: "Abonelik sıfırlandı", en: "Subscription reset" },
  plan_update: { tr: "Paket güncellendi", en: "Plan updated" },
  payment_create: { tr: "Ödeme eklendi", en: "Payment added" },
  payment_delete: { tr: "Ödeme silindi", en: "Payment deleted" },
  payment_backfill: { tr: "Geriye dönük tahsilat", en: "Payment backfill" },
  seo_update: { tr: "SEO ayarları güncellendi", en: "SEO settings updated" },
  signup_approved: { tr: "Kayıt başvurusu onaylandı", en: "Signup approved" },
  signup_rejected: { tr: "Kayıt başvurusu reddedildi", en: "Signup rejected" },
};

/** Bilinmeyen action kodları da okunabilir görünsün: snake_case -> "Snake case". */
function humanize(action) {
  return String(action || "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function auditActionLabel(action, lang = "tr") {
  const entry = AUDIT_ACTION_LABELS[action];
  if (!entry) return humanize(action);
  return entry[lang] || entry.tr;
}

/** İşletmenin kendi panelinde anlamlı olmayan süper admin işlemlerini eler. */
const BUSINESS_VISIBLE = new Set([
  "business_login",
  "password_change",
  "password_reset",
  "password_reset_requested",
  "business_profile_update",
  "business_logo_update",
  "margin_update",
  "business_branch_update",
  "branch_create",
  "branch_update",
  "branch_delete",
  "business_update",
  "subscription_reset",
  "payment_create",
]);

export function isBusinessVisibleAction(action) {
  return BUSINESS_VISIBLE.has(action);
}

export { AUDIT_ACTION_LABELS };
