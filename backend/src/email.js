const nodemailer = require("nodemailer");

// Email konfigürasyonu (Gmail example — environment variables'dan yüklenir)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER || "your-email@gmail.com",
    pass: process.env.GMAIL_PASS || "your-app-password",
  },
});

/**
 * Partnership başvurusunu e-posta ile gönder
 */
async function sendPartnershipEmail(data) {
  const { institution_name, contact_person, email, phone, message } = data;

  const emailContent = `
    <h2>FinSight Partnerlik Başvurusu</h2>
    <hr />
    <p><strong>Kurum Adı:</strong> ${institution_name}</p>
    <p><strong>Yetkili Kişi:</strong> ${contact_person}</p>
    <p><strong>E-posta:</strong> ${email}</p>
    <p><strong>Telefon:</strong> ${phone}</p>
    <hr />
    <h3>Mesaj:</h3>
    <p>${message || "Mesaj yok"}</p>
  `;

  try {
    const mailOptions = {
      from: process.env.GMAIL_USER || "your-email@gmail.com",
      to: "Tunahan.guul@gmail.com",
      subject: `Yeni Partnerlik Başvurusu: ${institution_name}`,
      html: emailContent,
      replyTo: email,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Gönderildi (${institution_name}):`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("[EMAIL] Gönderme başarısız:", error.message);
    throw error;
  }
}

/**
 * Şifre sıfırlama e-postası gönder
 */
async function sendPasswordResetEmail({ to, resetUrl, institutionName }) {
  const name = institutionName || "FinSight";
  const emailContent = `
    <h2>Şifre Sıfırlama Talebi</h2>
    <hr />
    <p>Merhaba,</p>
    <p><strong>${name}</strong> hesabınız için bir şifre sıfırlama talebi aldık.</p>
    <p>Şifrenizi yenilemek için aşağıdaki bağlantıya tıklayın (1 saat geçerlidir):</p>
    <p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#14b8a6;color:#fff;text-decoration:none;border-radius:8px;">Şifremi Sıfırla</a></p>
    <p style="color:#64748b;font-size:12px;word-break:break-all;">${resetUrl}</p>
    <hr />
    <p style="color:#94a3b8;font-size:12px;">Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>
  `;

  try {
    const mailOptions = {
      from: process.env.GMAIL_USER || "your-email@gmail.com",
      to,
      subject: "FinSight — Şifre Sıfırlama",
      html: emailContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Şifre sıfırlama gönderildi (${to}):`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("[EMAIL] Şifre sıfırlama gönderimi başarısız:", error.message);
    throw error;
  }
}

module.exports = {
  sendPartnershipEmail,
  sendPasswordResetEmail,
};
