/**
 * Tek iletişim kaynağı.
 *
 * Hem iletişim sayfasındaki orbital kanal çarkı hem de footer buradan
 * besleniyor; numara/e-posta/hesap değiştiğinde tek dosya güncelleniyor.
 * Değerler Vite ortam değişkenlerinden okunuyor, tanımlı değilse aşağıdaki
 * yer tutucular devreye giriyor — hepsi bilinçli olarak "000", canlıya
 * çıkmadan önce `.env` (veya Vercel → Environment Variables) doldurulmalı.
 */

function pick(value, fallback) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

/** wa.me yalnızca rakam kabul ediyor: +, boşluk ve parantez temizleniyor. */
function digitsOnly(value) {
  return String(value).replace(/\D/g, "");
}

/** tel: şemasında + korunur, geri kalan biçimlendirme atılır. */
function dialable(value) {
  return String(value).replace(/[^\d+]/g, "");
}

/**
 * Serbest girilmiş bir telefon numarasını uluslararası biçime çevirir.
 * KKTC numaraları genelde `0533…` / `0548…` (mobil) veya `0392…` (sabit) yazılır;
 * wa.me ülke kodu ister. `0` → `90`, `+`/`00` kırpılır, zaten `90…` ise dokunulmaz.
 */
export function toIntlDigits(raw) {
  let d = digitsOnly(raw);
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = `90${d.slice(1)}`;
  else if (!d.startsWith("90") && d.length <= 10) d = `90${d}`;
  return d;
}

/** Bir şube/işletme numarası için wa.me linki (geçersizse null). */
export function whatsappHref(raw) {
  const d = toIntlDigits(raw);
  return d.length >= 10 ? `https://wa.me/${d}` : null;
}

/** Bir şube/işletme numarası için tel: linki (geçersizse null). */
export function telHref(raw) {
  const cleaned = dialable(raw);
  return cleaned.replace(/\D/g, "").length >= 7 ? `tel:${cleaned}` : null;
}

const env = import.meta.env;

const FALLBACK_PHONE = "+90 533 000 00 00";

export const contactInfo = {
  /** Görünen telefon numarası (biçimlendirilmiş hâliyle ekrana basılır). */
  phone: pick(env.VITE_CONTACT_PHONE, FALLBACK_PHONE),
  /** WhatsApp hattı; ayrı tanımlanmazsa telefon numarasıyla aynı. */
  whatsapp: pick(env.VITE_CONTACT_WHATSAPP, pick(env.VITE_CONTACT_PHONE, FALLBACK_PHONE)),
  email: pick(env.VITE_CONTACT_EMAIL, "iletisim@adadoviz.com"),
  /** Kullanıcı başına "@" yazarsa da çalışsın diye baştaki @ kırpılıyor. */
  instagram: pick(env.VITE_CONTACT_INSTAGRAM, "adadoviz").replace(/^@/, ""),
};

export const contactLinks = {
  whatsapp: `https://wa.me/${digitsOnly(contactInfo.whatsapp)}`,
  phone: `tel:${dialable(contactInfo.phone)}`,
  email: `mailto:${contactInfo.email}`,
  instagram: `https://instagram.com/${contactInfo.instagram}`,
};

export const contactDisplay = {
  whatsapp: contactInfo.whatsapp,
  phone: contactInfo.phone,
  email: contactInfo.email,
  instagram: `@${contactInfo.instagram}`,
};
