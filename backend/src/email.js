const nodemailer = require("nodemailer");

const PARTNERSHIP_INBOX =
  process.env.PARTNERSHIP_TO_EMAIL || "tunahan.guul@gmail.com";

const DEFAULT_FRONTEND_URL = "https://adadoviz.tunahangul.com";

// Marka: mat siyah başlık, nötr-gri buton (gradyan token'larıyla uyumlu).
const BRAND_INK = "#08080a";
const BRAND_BTN = "#55555f";

function getGmailUser() {
  return String(process.env.GMAIL_USER || "").trim();
}

function getGmailPass() {
  return String(process.env.GMAIL_PASS || "").trim();
}

function isMailConfigured() {
  const user = getGmailUser();
  const pass = getGmailPass();
  if (!user || !pass) return false;
  if (user.includes("your-email")) return false;
  if (pass.includes("your-gmail-app-password") || pass.includes("your-app-password")) {
    return false;
  }
  return true;
}

function getFrontendBaseUrl() {
  const raw = String(process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL).trim();
  return (raw || DEFAULT_FRONTEND_URL).replace(/\/$/, "");
}

function assertMailConfigured() {
  if (!isMailConfigured()) {
    throw new Error(
      "E-posta yapılandırması eksik. Render/ortam değişkenlerinde GMAIL_USER ve GMAIL_PASS (Gmail App Password) tanımlayın."
    );
  }
}

let transporter = null;

function getTransporter() {
  assertMailConfigured();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: getGmailUser(),
        pass: getGmailPass(),
      },
    });
  }
  return transporter;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Başlık satırına giden güvenilmez metin — CR/LF sıyrılır, kısaltılır (S-L5). */
function sanitizeSubject(raw) {
  return String(raw || "Bildirim")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 120);
}

function formatTRY(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "-");
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)} ₺`;
}

function formatDateTR(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

// ---------------------------------------------------------------------------
// P1.6 — ortak HTML şablonu. Mevcut inline stiller yerine tek yerden.
// ---------------------------------------------------------------------------

function renderButton(cta) {
  if (!cta || !cta.text || !cta.url) return "";
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 2px;">
        <tr><td style="border-radius:10px;background:${BRAND_BTN};">
          <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">${escapeHtml(cta.text)}</a>
        </td></tr>
      </table>`;
}

/**
 * `renderEmailShell(title, bodyHtml, cta?)` — markalı e-posta gövdesi.
 * @param {string} title  başlık (düz metin, kaçışlanır)
 * @param {string} bodyHtml  gövde HTML'i (çağıran kaçışlamaktan sorumlu)
 * @param {{text:string,url:string}} [cta]  opsiyonel buton
 */
function renderEmailShell(title, bodyHtml, cta) {
  const safeTitle = escapeHtml(title || "AdaDöviz");
  const base = getFrontendBaseUrl();
  const host = base.replace(/^https?:\/\//, "");
  return `<!doctype html>
<html lang="tr">
<body style="margin:0;padding:0;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5ea;">
        <tr><td style="background:${BRAND_INK};padding:18px 28px;">
          <span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:0.2px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">AdaDöviz</span>
        </td></tr>
        <tr><td style="padding:28px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c1c22;">
          <h1 style="margin:0 0 14px;font-size:18px;font-weight:700;color:${BRAND_INK};">${safeTitle}</h1>
          <div style="font-size:14px;line-height:1.65;color:#3a3a42;">${bodyHtml}</div>
          ${renderButton(cta)}
        </td></tr>
        <tr><td style="padding:16px 28px 22px;border-top:1px solid #eeeef0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
          <p style="margin:0;color:#9a9aa2;font-size:12px;">
            <a href="${escapeHtml(base)}" style="color:#9a9aa2;text-decoration:none;">${escapeHtml(host)}</a> · KKTC döviz kurları
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Markalı e-posta gönderiminin tek çıkış noktası. Konu başlığına otomatik
 * "AdaDöviz — " öneki eklenir ve CR/LF temizlenir.
 */
async function sendBrandedMail({ to, subject, title, bodyHtml, cta, replyTo }) {
  const fromUser = getGmailUser();
  const cleanSubject = sanitizeSubject(subject || title);
  const info = await getTransporter().sendMail({
    from: `"AdaDöviz" <${fromUser}>`,
    to,
    subject: `AdaDöviz — ${cleanSubject}`,
    html: renderEmailShell(title, bodyHtml, cta),
    ...(replyTo ? { replyTo } : {}),
  });
  console.log(`[EMAIL] "${cleanSubject}" gönderildi (${to}):`, info.messageId);
  return { success: true, messageId: info.messageId };
}

/**
 * Mesaj boş bırakıldığında kullanılan şablon metin.
 */
function buildPartnershipDefaultMessage({
  institution_name,
  contact_person,
  email,
  phone,
}) {
  const institution = String(institution_name || "").trim() || "Belirtilmedi";
  const person = String(contact_person || "").trim() || "Belirtilmedi";
  const mail = String(email || "").trim() || "Belirtilmedi";
  const tel = String(phone || "").trim() || "Belirtilmedi";
  return (
    `${institution} kurumundan ${person} adlı yetkili, AdaDöviz partnerlik programına başvurmak istemektedir. ` +
    `İletişim: ${mail} / ${tel}. Lütfen en kısa sürede dönüş yapınız.`
  );
}

/**
 * Partnership başvurusunu e-posta ile gönder (operatör kutusuna — dahili,
 * markalı şablon kullanmaz).
 */
async function sendPartnershipEmail(data) {
  const { institution_name, contact_person, email, phone } = data;
  const message =
    String(data.message || "").trim() ||
    buildPartnershipDefaultMessage({
      institution_name,
      contact_person,
      email,
      phone,
    });

  const emailContent = `
    <h2>AdaDöviz Partnerlik Başvurusu</h2>
    <hr />
    <p><strong>Kurum Adı:</strong> ${escapeHtml(institution_name)}</p>
    <p><strong>Yetkili Kişi:</strong> ${escapeHtml(contact_person)}</p>
    <p><strong>E-posta:</strong> ${escapeHtml(email)}</p>
    <p><strong>Telefon:</strong> ${escapeHtml(phone)}</p>
    <hr />
    <h3>Mesaj:</h3>
    <p>${escapeHtml(message).replace(/\n/g, "<br />")}</p>
  `;

  try {
    const fromUser = getGmailUser();
    const mailOptions = {
      from: `"AdaDöviz" <${fromUser}>`,
      to: PARTNERSHIP_INBOX,
      subject: `Yeni Partnerlik Başvurusu: ${sanitizeSubject(institution_name)}`,
      html: emailContent,
      replyTo: email,
    };

    const info = await getTransporter().sendMail(mailOptions);
    console.log(
      `[EMAIL] Gönderildi → ${PARTNERSHIP_INBOX} (${institution_name}):`,
      info.messageId
    );
    return { success: true, messageId: info.messageId, message };
  } catch (error) {
    console.error("[EMAIL] Gönderme başarısız:", error.message);
    throw error;
  }
}

/**
 * Şifre sıfırlama e-postası gönder
 */
async function sendPasswordResetEmail({ to, resetUrl, institutionName }) {
  const name = institutionName || "AdaDöviz";
  const body = `
    <p style="margin:0 0 12px;">Merhaba,</p>
    <p style="margin:0 0 12px;"><strong>${escapeHtml(name)}</strong> hesabınız için bir şifre sıfırlama
    talebi aldık. Aşağıdaki bağlantı <strong>1 saat</strong> geçerlidir.</p>
    <p style="margin:0 0 4px;color:#9a9aa2;font-size:12px;word-break:break-all;">${escapeHtml(resetUrl)}</p>
    <p style="margin:16px 0 0;color:#9a9aa2;font-size:12px;">Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>
  `;
  try {
    return await sendBrandedMail({
      to,
      subject: "Şifre Sıfırlama",
      title: "Şifre sıfırlama talebi",
      bodyHtml: body,
      cta: { text: "Şifremi sıfırla", url: resetUrl },
    });
  } catch (error) {
    console.error("[EMAIL] Şifre sıfırlama gönderimi başarısız:", error.message);
    throw error;
  }
}

/**
 * P1.5 — genel amaçlı in-app bildirim e-postası. Artık ortak `renderEmailShell`
 * kullanır.
 */
async function sendGenericNotificationEmail({ to, title, message, ctaText, ctaUrl }) {
  const body = `<p style="margin:0;line-height:1.65;">${escapeHtml(message || "").replace(/\n/g, "<br />")}</p>`;
  const cta = ctaText && ctaUrl ? { text: ctaText, url: ctaUrl } : undefined;
  return sendBrandedMail({
    to,
    subject: title || "Bildirim",
    title: title || "AdaDöviz",
    bodyHtml: body,
    cta,
  });
}

// ---------------------------------------------------------------------------
// P1.6 — işlemsel e-postalar
// ---------------------------------------------------------------------------

/** Hesap oluşturulduğunda / onaylandığında. */
async function sendWelcomeEmail({ to, institutionName, username, loginUrl }) {
  const name = String(institutionName || "").trim() || "AdaDöviz işletmesi";
  const login = loginUrl || `${getFrontendBaseUrl()}/admin`;
  const body = `
    <p style="margin:0 0 12px;">Merhaba,</p>
    <p style="margin:0 0 12px;"><strong>${escapeHtml(name)}</strong> için AdaDöviz işletme paneliniz hazır.
    Panelden kurlarınızı ve marjlarınızı, şubelerinizi ve abonelik durumunuzu yönetebilirsiniz.</p>
    ${username ? `<p style="margin:0 0 12px;">Giriş ID'niz: <strong>${escapeHtml(username)}</strong></p>` : ""}
    <p style="margin:0;">Başlamak için panelinize giriş yapın ve profilinizi tamamlayın (logo, çalışma
    saatleri, en az bir şube).</p>
  `;
  return sendBrandedMail({
    to,
    subject: "İşletme paneliniz hazır",
    title: "AdaDöviz'e hoş geldiniz",
    bodyHtml: body,
    cta: { text: "Panele giriş yap", url: login },
  });
}

/** Abonelik bitişine 7 / 3 / 1 / 0 gün kala. */
async function sendSubscriptionReminderEmail({
  to,
  institutionName,
  daysRemaining,
  endDate,
  panelUrl,
}) {
  const name = String(institutionName || "").trim() || "İşletmeniz";
  const url = panelUrl || `${getFrontendBaseUrl()}/admin`;
  const d = Number(daysRemaining);
  const when = !Number.isFinite(d)
    ? "yakında sona eriyor"
    : d <= 0
      ? "bugün doluyor"
      : d === 1
        ? "yarın doluyor"
        : `${d} gün sonra doluyor`;
  const dateLine = endDate
    ? `<p style="margin:0 0 12px;">Bitiş tarihi: <strong>${escapeHtml(formatDateTR(endDate))}</strong></p>`
    : "";
  const body = `
    <p style="margin:0 0 12px;">Merhaba,</p>
    <p style="margin:0 0 12px;"><strong>${escapeHtml(name)}</strong> aboneliğiniz <strong>${when}</strong>.
    Herkese açık listede kesintisiz kalmak için yenileme talebinizi şimdi iletin.</p>
    ${dateLine}
  `;
  const title =
    Number.isFinite(d) && d <= 0
      ? "Aboneliğiniz bugün doluyor"
      : "Abonelik yenileme hatırlatması";
  return sendBrandedMail({
    to,
    subject: title,
    title,
    bodyHtml: body,
    cta: { text: "Panele git", url },
  });
}

/** Abonelik süresi dolduğunda (bir kez). */
async function sendSubscriptionExpiredEmail({ to, institutionName, panelUrl }) {
  const name = String(institutionName || "").trim() || "İşletmeniz";
  const url = panelUrl || `${getFrontendBaseUrl()}/admin`;
  const body = `
    <p style="margin:0 0 12px;">Merhaba,</p>
    <p style="margin:0;"><strong>${escapeHtml(name)}</strong> aboneliğinizin süresi doldu ve işletmeniz
    herkese açık listeden kaldırıldı. Yeniden yayına almak için aboneliğinizi yenileyin.</p>
  `;
  return sendBrandedMail({
    to,
    subject: "Aboneliğinizin süresi doldu",
    title: "Aboneliğinizin süresi doldu",
    bodyHtml: body,
    cta: { text: "Panele git", url },
  });
}

/** Ödeme / tahsilat kaydedildiğinde makbuz. */
async function sendPaymentReceiptEmail({
  to,
  institutionName,
  planName,
  planCode,
  amount,
  vat,
  periodStart,
  periodEnd,
  invoiceNo,
  method,
  paidAt,
}) {
  const name = String(institutionName || "").trim() || "İşletmeniz";
  const rows = [
    ["Paket", planName || planCode || "-"],
    ["Tutar", formatTRY(amount)],
    Number(vat) > 0 ? ["KDV", formatTRY(vat)] : null,
    ["Dönem", `${formatDateTR(periodStart)} – ${formatDateTR(periodEnd)}`],
    method ? ["Ödeme yöntemi", String(method)] : null,
    invoiceNo ? ["Fatura no", String(invoiceNo)] : null,
    paidAt ? ["Ödeme tarihi", formatDateTR(paidAt)] : null,
  ].filter(Boolean);
  const table = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:12px 0 2px;border-collapse:collapse;">
      ${rows
        .map(
          ([k, v]) => `<tr>
        <td style="padding:7px 0;color:#9a9aa2;font-size:13px;border-bottom:1px solid #f0f0f2;">${escapeHtml(k)}</td>
        <td style="padding:7px 0;color:#1c1c22;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f2;">${escapeHtml(String(v))}</td>
      </tr>`
        )
        .join("")}
    </table>`;
  const body = `
    <p style="margin:0 0 12px;">Merhaba,</p>
    <p style="margin:0 0 4px;"><strong>${escapeHtml(name)}</strong> için ödemeniz alındı. Teşekkür ederiz.</p>
    ${table}
  `;
  return sendBrandedMail({
    to,
    subject: "Ödeme makbuzu",
    title: "Ödemeniz alındı",
    bodyHtml: body,
    cta: { text: "Abonelik detayları", url: `${getFrontendBaseUrl()}/admin` },
  });
}

/** Şube talebi (yeni/yenileme) onaylandı veya reddedildi. */
async function sendBranchRequestResultEmail({
  to,
  institutionName,
  branchName,
  approved,
  isRenewal,
  adminNote,
  panelUrl,
}) {
  const branch = String(branchName || "").trim() || "şube";
  const url = panelUrl || `${getFrontendBaseUrl()}/admin`;
  const action = isRenewal ? "yenileme talebiniz" : "şube başvurunuz";
  const verdict = approved ? "onaylandı" : "reddedildi";
  const extra =
    approved && isRenewal
      ? " Şube 30 gün boyunca yeniden aktif."
      : approved
        ? " Şube artık herkese açık listede görünüyor."
        : "";
  const note = adminNote
    ? `<p style="margin:14px 0 0;padding:12px 14px;background:#f4f4f5;border-radius:10px;font-size:13px;color:#3a3a42;">Yönetici notu: ${escapeHtml(adminNote)}</p>`
    : "";
  const body = `
    <p style="margin:0 0 12px;">Merhaba,</p>
    <p style="margin:0;"><strong>"${escapeHtml(branch)}"</strong> için ${action} <strong>${verdict}</strong>.${extra}</p>
    ${note}
  `;
  const title = `Şube ${isRenewal ? "yenileme" : "başvurusu"} ${verdict}`;
  return sendBrandedMail({
    to,
    subject: title,
    title,
    bodyHtml: body,
    cta: { text: "Panele git", url },
  });
}

// --- Self-signup (P3.1'de bağlanacak; şablonlar burada hazır) ---------------

/** Başvuru alındı (hesap OLUŞTURULMAZ). */
async function sendSignupReceivedEmail({ to, institutionName, contactPerson }) {
  const name = String(institutionName || "").trim() || "kurumunuz";
  const person = String(contactPerson || "").trim();
  const body = `
    <p style="margin:0 0 12px;">Merhaba${person ? " " + escapeHtml(person) : ""},</p>
    <p style="margin:0 0 12px;"><strong>${escapeHtml(name)}</strong> için AdaDöviz listeleme başvurunuzu aldık.</p>
    <p style="margin:0;">Başvurunuzu en kısa sürede inceleyip size döneceğiz. Hesabınız yalnızca
    onaydan sonra oluşturulur.</p>
  `;
  return sendBrandedMail({
    to,
    subject: "Başvurunuz alındı",
    title: "Başvurunuz alındı",
    bodyHtml: body,
  });
}

/** Başvuru onaylandı — parola belirleme linkiyle. */
async function sendSignupApprovedEmail({ to, institutionName, setPasswordUrl }) {
  const name = String(institutionName || "").trim() || "kurumunuz";
  const body = `
    <p style="margin:0 0 12px;">Merhaba,</p>
    <p style="margin:0 0 12px;"><strong>${escapeHtml(name)}</strong> için AdaDöviz listeleme başvurunuz
    onaylandı. Panelinize girmek için önce bir parola belirleyin (bağlantı sınırlı süre geçerlidir).</p>
    ${setPasswordUrl ? `<p style="margin:0;color:#9a9aa2;font-size:12px;word-break:break-all;">${escapeHtml(setPasswordUrl)}</p>` : ""}
  `;
  return sendBrandedMail({
    to,
    subject: "Başvurunuz onaylandı",
    title: "Başvurunuz onaylandı",
    bodyHtml: body,
    cta: setPasswordUrl ? { text: "Parola belirle", url: setPasswordUrl } : undefined,
  });
}

/** Başvuru reddedildi — sebep ile. */
async function sendSignupRejectedEmail({ to, institutionName, reason }) {
  const name = String(institutionName || "").trim() || "kurumunuz";
  const note = reason
    ? `<p style="margin:14px 0 0;padding:12px 14px;background:#f4f4f5;border-radius:10px;font-size:13px;color:#3a3a42;">Sebep: ${escapeHtml(reason)}</p>`
    : "";
  const body = `
    <p style="margin:0 0 12px;">Merhaba,</p>
    <p style="margin:0;"><strong>${escapeHtml(name)}</strong> için AdaDöviz listeleme başvurunuz şu an
    için onaylanmadı.</p>
    ${note}
  `;
  return sendBrandedMail({
    to,
    subject: "Başvuru sonucu",
    title: "Başvuru sonucu",
    bodyHtml: body,
  });
}

// --- P1.7 destek talepleri -------------------------------------------------

/** Yeni destek talebi — operatör kutusuna (dahili, markasız). */
async function sendSupportTicketEmail({ subject, message, reporterUsername, businessName, reporterRole }) {
  const html = `
    <h2>AdaDöviz — Destek / Sorun Bildirimi</h2>
    <hr />
    <p><strong>İşletme:</strong> ${escapeHtml(businessName || "-")}</p>
    <p><strong>Bildiren:</strong> ${escapeHtml(reporterUsername || "-")} (${escapeHtml(reporterRole || "business")})</p>
    <p><strong>Konu:</strong> ${escapeHtml(subject || "-")}</p>
    <hr />
    <p>${escapeHtml(message || "").replace(/\n/g, "<br />")}</p>
  `;
  const fromUser = getGmailUser();
  const info = await getTransporter().sendMail({
    from: `"AdaDöviz" <${fromUser}>`,
    to: PARTNERSHIP_INBOX,
    subject: `Destek: ${sanitizeSubject(subject)}`,
    html,
  });
  console.log(`[EMAIL] Destek talebi → ${PARTNERSHIP_INBOX}:`, info.messageId);
  return { success: true, messageId: info.messageId };
}

/** Operatör yanıtladı — işletmeye (markalı). */
async function sendSupportReplyEmail({ to, institutionName, subject, reply, panelUrl }) {
  const name = String(institutionName || "").trim() || "İşletmeniz";
  const url = panelUrl || `${getFrontendBaseUrl()}/admin`;
  const body = `
    <p style="margin:0 0 12px;">Merhaba,</p>
    <p style="margin:0 0 12px;"><strong>${escapeHtml(name)}</strong> — "<strong>${escapeHtml(subject || "destek talebiniz")}</strong>" konulu talebinize yanıt verildi:</p>
    <p style="margin:0;padding:12px 14px;background:#f4f4f5;border-radius:10px;color:#3a3a42;">${escapeHtml(reply || "").replace(/\n/g, "<br />")}</p>
  `;
  return sendBrandedMail({
    to,
    subject: "Destek talebinize yanıt",
    title: "Destek talebinize yanıt verildi",
    bodyHtml: body,
    cta: { text: "Panele git", url },
  });
}

function logMailConfigOnBoot() {
  console.log(
    `[EMAIL] Yapılandırma: configured=${isMailConfigured()} user=${getGmailUser() || "(yok)"} frontend=${getFrontendBaseUrl()}`
  );
}

module.exports = {
  sendPartnershipEmail,
  sendPasswordResetEmail,
  sendGenericNotificationEmail,
  sendWelcomeEmail,
  sendSubscriptionReminderEmail,
  sendSubscriptionExpiredEmail,
  sendPaymentReceiptEmail,
  sendBranchRequestResultEmail,
  sendSignupReceivedEmail,
  sendSignupApprovedEmail,
  sendSignupRejectedEmail,
  sendSupportTicketEmail,
  sendSupportReplyEmail,
  buildPartnershipDefaultMessage,
  renderEmailShell,
  isMailConfigured,
  getFrontendBaseUrl,
  assertMailConfigured,
  logMailConfigOnBoot,
};
