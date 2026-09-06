/**
 * Kur değişimini düz dile çeviren saf yardımcı (C12).
 *
 * Grafik yüzdeyi gösteriyor ama sıradan kullanıcı "%+2,34" ile ne yapacağını
 * bilmiyor — cümle istiyor. `MarketSummaryCard` bunu yüzde rozetinin yanında,
 * bir `aria-live` bölgesinde kullanır.
 */

const PERIOD_PHRASE = {
  tr: {
    Saatlik: "son saatlerde",
    Günlük: "bugün",
    Haftalık: "son haftada",
    Aylık: "son ayda",
    Yıllık: "son yılda",
  },
  en: {
    Saatlik: "in the last few hours",
    Günlük: "today",
    Haftalık: "over the past week",
    Aylık: "over the past month",
    Yıllık: "over the past year",
  },
};

/** Yüzdeyi yerele göre biçimle: TR virgül, tek ondalık. */
function fmtPct(value, lang) {
  const n = Math.abs(Number(value) || 0);
  return n.toLocaleString(lang === "en" ? "en-US" : "tr-TR", {
    minimumFractionDigits: n < 1 ? 2 : 1,
    maximumFractionDigits: n < 1 ? 2 : 1,
  });
}

/**
 * @returns {string} tek cümle, nokta ile biter. Değişim yoksa "yatay" cümlesi.
 */
export function rateTrendSentence({ currency = "USD", period = "Günlük", percent = 0, lang = "tr" }) {
  const p = Number(percent);
  const when = (PERIOD_PHRASE[lang] || PERIOD_PHRASE.tr)[period] || "";
  const pct = fmtPct(p, lang);

  if (!Number.isFinite(p) || Math.abs(p) < 0.05) {
    return lang === "en"
      ? `${currency}/TRY is broadly flat ${when}.`
      : `${currency}/TL ${when} yatay seyrediyor.`;
  }
  if (lang === "en") {
    return p > 0
      ? `${currency}/TRY is up ${pct}% ${when}.`
      : `${currency}/TRY is down ${pct}% ${when}.`;
  }
  return p > 0
    ? `${currency}/TL ${when} %${pct} arttı.`
    : `${currency}/TL ${when} %${pct} düştü.`;
}

/**
 * Alıcı için karar ipucu (opsiyonel ikinci cümle).
 * Sadece belirgin hareketlerde döner, aksi halde boş.
 */
export function rateBuyHint({ percent = 0, lang = "tr" }) {
  const p = Number(percent);
  if (!Number.isFinite(p) || Math.abs(p) < 1) return "";
  if (p >= 1) {
    return lang === "en"
      ? "The foreign currency has gained value recently."
      : "Döviz son dönemde değer kazandı.";
  }
  return lang === "en"
    ? "The foreign currency has eased recently."
    : "Döviz son dönemde geriledi.";
}
