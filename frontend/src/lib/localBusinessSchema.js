import { cityDisplayName, extractCitySlug, exchangeOfficePath } from "./slug";

const SITE = "https://adadoviz.tunahangul.com";

const DAY_TO_SCHEMA = {
  pazartesi: "Monday",
  sali: "Tuesday",
  carsamba: "Wednesday",
  persembe: "Thursday",
  cuma: "Friday",
  cumartesi: "Saturday",
  pazar: "Sunday",
};

function minutesToIsoTime(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return null;
  const m = Math.max(0, Math.min(1440, Number(minutes)));
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseWorkingHours(raw) {
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

/** Schema.org OpeningHoursSpecification[] */
export function buildOpeningHoursSpecification(workingHours) {
  const hours = parseWorkingHours(workingHours);
  if (!hours || hours._legacy) return undefined;

  const specs = [];
  for (const [key, schemaDay] of Object.entries(DAY_TO_SCHEMA)) {
    const slot = hours[key];
    if (!Array.isArray(slot) || slot[0] == null || slot[1] == null) continue;
    const opens = minutesToIsoTime(slot[0]);
    const closes = minutesToIsoTime(slot[1]);
    if (!opens || !closes) continue;
    specs.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: schemaDay,
      opens,
      closes,
    });
  }
  return specs.length ? specs : undefined;
}

/**
 * Tek şube / işletme için LocalBusiness + FinancialService JSON-LD.
 */
export function buildLocalBusinessJsonLd({
  name,
  slug,
  address,
  phone,
  workingHours,
  lat,
  lng,
  logoUrl,
  description,
  lang = "tr",
} = {}) {
  const citySlug = extractCitySlug(address);
  const city = cityDisplayName(citySlug, lang);
  const path = exchangeOfficePath(slug);
  const url = `${SITE}${path}`;
  const openingHoursSpecification = buildOpeningHoursSpecification(workingHours);

  const postalAddress = {
    "@type": "PostalAddress",
    streetAddress: String(address || "").trim() || undefined,
    addressLocality: city,
    addressRegion: lang === "en" ? "Northern Cyprus" : "KKTC",
    addressCountry: "CY",
  };

  return {
    "@context": "https://schema.org",
    "@type": ["FinancialService", "LocalBusiness"],
    name: String(name || "").trim() || "AdaDöviz Bürosu",
    description:
      description ||
      (lang === "en"
        ? `Currency exchange office in ${city}, Northern Cyprus (KKTC). Live USD, EUR and GBP rates.`
        : `${city}, KKTC döviz bürosu. Güncel USD, EUR ve GBP kurları.`),
    url,
    image: logoUrl || `${SITE}/adadoviz-logo.svg`,
    telephone: phone || undefined,
    address: postalAddress,
    areaServed: {
      "@type": "AdministrativeArea",
      name: lang === "en" ? "Northern Cyprus (KKTC)" : "Kuzey Kıbrıs Türk Cumhuriyeti (KKTC)",
    },
    ...(openingHoursSpecification ? { openingHoursSpecification } : {}),
    ...(Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: Number(lat),
            longitude: Number(lng),
          },
        }
      : {}),
    currenciesAccepted: "TRY, USD, EUR, GBP",
    paymentAccepted: "Cash",
    priceRange: "$$",
  };
}

/** İşletme + şubeler → @graph JSON-LD */
export function buildExchangeOfficeGraphJsonLd({
  businessName,
  businessSlug,
  workingHours,
  phone,
  logoUrl,
  branches = [],
  lang = "tr",
} = {}) {
  const nodes = [];

  if (!branches.length) {
    nodes.push(
      buildLocalBusinessJsonLd({
        name: businessName,
        slug: businessSlug,
        address: "KKTC",
        phone,
        workingHours,
        logoUrl,
        lang,
      })
    );
  } else {
    for (const branch of branches) {
      nodes.push(
        buildLocalBusinessJsonLd({
          name: `${businessName} — ${branch.name || "Şube"}`,
          slug: branch.slug || businessSlug,
          address: branch.address || "KKTC",
          phone: branch.phone || phone,
          workingHours,
          lat: branch.lat,
          lng: branch.lng,
          logoUrl,
          lang,
        })
      );
    }
  }

  return {
    "@context": "https://schema.org",
    "@graph": nodes,
  };
}
