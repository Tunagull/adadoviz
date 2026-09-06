/**
 * P1.5 — Bildirim omurgası (ince sarmalayıcı).
 *
 * `db.js` içindeki düşük seviyeli `createBusinessNotification` /
 * `createAdminNotification` üzerine, isteğe bağlı e-posta gönderimi ekler.
 * E-posta patlarsa in-app kaydı yine de durur (hata yutulur, loglanır).
 */
const {
  createBusinessNotification,
  createAdminNotification,
} = require("./db");
const { isMailConfigured, sendGenericNotificationEmail } = require("./email");

/**
 * İşletmeye bildirim: in-app kayıt + (email verildiyse ve mail yapılandırılmışsa) e-posta.
 * `emailFn` verilirse (P1.6 işlemsel şablonlar) genel e-posta yerine o çağrılır.
 * @param {number} businessNumericId institutions.id (NUMERİK PK)
 * @param {{type:string,title:string,message:string,email?:string,ctaText?:string,ctaUrl?:string,emailFn?:Function}} opts
 */
async function emitBusinessNotification(businessNumericId, opts = {}) {
  const { type, title, message, email, ctaText, ctaUrl, emailFn } = opts;
  const record = createBusinessNotification({
    business_id: businessNumericId,
    type,
    title,
    message,
  });

  if ((emailFn || email) && isMailConfigured()) {
    try {
      if (typeof emailFn === "function") {
        await emailFn();
      } else {
        await sendGenericNotificationEmail({ to: email, title, message, ctaText, ctaUrl });
      }
    } catch (err) {
      console.warn(
        `[NOTIF] emitBusinessNotification e-posta gönderilemedi (${email || "emailFn"}):`,
        err.message
      );
    }
  }
  return record;
}

/**
 * Operatöre (superadmin) bildirim: yalnızca in-app.
 * @param {{type:string,title:string,message:string,data?:any}} opts
 */
function emitAdminNotification(opts = {}) {
  const { type, title, message, data = null } = opts;
  try {
    return createAdminNotification({ type, title, message, data });
  } catch (err) {
    console.error("[NOTIF] emitAdminNotification başarısız:", err.message);
    return null;
  }
}

module.exports = {
  emitBusinessNotification,
  emitAdminNotification,
};
