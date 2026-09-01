/**
 * Şehir filtresi etiketleri.
 *
 * Şehir slug'ı backend'de adresten türetilir (backend/src/slug.js →
 * extractCitySlug) ve /api/branches yanıtında `city` alanı olarak gelir.
 * Burada yalnızca gösterim adı tutulur.
 */
const CITY_LABELS = {
  lefkosa: { tr: "Lefkoşa", en: "Nicosia (Lefkoşa)" },
  girne: { tr: "Girne", en: "Kyrenia (Girne)" },
  gazimagusa: { tr: "Gazimağusa", en: "Famagusta (Gazimağusa)" },
  guzelyurt: { tr: "Güzelyurt", en: "Morphou (Güzelyurt)" },
  iskele: { tr: "İskele", en: "İskele" },
};

export function cityLabel(slug, lang = "tr") {
  const entry = CITY_LABELS[slug];
  if (!entry) return slug || "";
  return entry[lang] || entry.tr;
}

/** Şube listesinden, gerçekten şubesi olan şehirleri alfabetik döndürür. */
export function cityOptionsFromBranches(branchGroups, lang = "tr") {
  const slugs = new Set();
  for (const list of Object.values(branchGroups || {})) {
    for (const branch of list || []) {
      if (branch?.city) slugs.add(branch.city);
    }
  }
  return [...slugs]
    .map((slug) => ({ slug, label: cityLabel(slug, lang) }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

export { CITY_LABELS };
