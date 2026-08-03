/**
 * SEO slug yardımcıları — frontend ve backend aynı kuralları kullanmalı.
 */

const CITY_RULES = [
  { slug: "lefkosa", patterns: [/lefko[sş]a/i, /\bnicosia\b/i] },
  { slug: "girne", patterns: [/\bgirne\b/i, /\bkyrenia\b/i] },
  { slug: "gazimagusa", patterns: [/gazima[gğ]usa/i, /\bma[gğ]usa\b/i, /\bfamagusta\b/i] },
  { slug: "guzelyurt", patterns: [/g[uü]zelyurt/i, /\bmorphou\b/i] },
  { slug: "iskele", patterns: [/\biskele\b/i, /\btrikomo\b/i] },
];

const TR_CHAR_MAP = {
  ç: "c",
  Ç: "c",
  ğ: "g",
  Ğ: "g",
  ı: "i",
  I: "i",
  İ: "i",
  ö: "o",
  Ö: "o",
  ş: "s",
  Ş: "s",
  ü: "u",
  Ü: "u",
};

function slugify(input) {
  const replaced = String(input || "")
    .split("")
    .map((ch) => TR_CHAR_MAP[ch] || ch)
    .join("");
  return replaced
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractCitySlug(address) {
  const text = String(address || "");
  if (!text.trim()) return "";
  for (const rule of CITY_RULES) {
    if (rule.patterns.some((re) => re.test(text))) return rule.slug;
  }
  return "";
}

function cityDisplayName(citySlug, lang = "tr") {
  const mapTr = {
    lefkosa: "Lefkoşa",
    girne: "Girne",
    gazimagusa: "Gazimağusa",
    guzelyurt: "Güzelyurt",
    iskele: "İskele",
  };
  const mapEn = {
    lefkosa: "Nicosia (Lefkoşa)",
    girne: "Kyrenia (Girne)",
    gazimagusa: "Famagusta (Gazimağusa)",
    guzelyurt: "Morphou (Güzelyurt)",
    iskele: "İskele",
  };
  const key = String(citySlug || "").toLowerCase();
  if (lang === "en") return mapEn[key] || "Northern Cyprus";
  return mapTr[key] || "KKTC";
}

/** İşletme genel slug: institution_id (varsa) veya isim */
function buildBusinessSlug({ institutionId, institution_id, name, institution_name } = {}) {
  const id = String(institutionId || institution_id || "").trim();
  if (id) {
    const fromId = slugify(id);
    if (fromId) return fromId;
  }
  const fromName = slugify(
    String(name || institution_name || "")
      .replace(/\s*\([Tt]est\)\s*/g, " ")
      .trim()
  );
  return fromName || "doviz-burosu";
}

/** Şube slug: sehir-sube-adi (örn. lefkosa-merkez-doviz) */
function buildBranchSlug(branch, institutionName = "") {
  const city = extractCitySlug(branch?.address);
  const branchName = slugify(branch?.name || "");
  const bizName = slugify(
    String(institutionName || "")
      .replace(/\s*\([Tt]est\)\s*/g, " ")
      .trim()
  );
  const namePart = branchName || bizName || "sube";
  if (city) return `${city}-${namePart}`;
  return namePart;
}

function exchangeOfficePath(slug) {
  const clean = slugify(slug);
  return clean ? `/doviz-burosu/${clean}` : "/";
}

module.exports = {
  CITY_RULES,
  slugify,
  extractCitySlug,
  cityDisplayName,
  buildBusinessSlug,
  buildBranchSlug,
  exchangeOfficePath,
};
