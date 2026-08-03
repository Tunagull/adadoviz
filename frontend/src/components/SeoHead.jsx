import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { apiUrl } from "../lib/api";

const DEFAULT_BASE = "https://adadoviz.tunahangul.com";

/**
 * Super Admin SEO ayarlarından site geneli meta + WebSite/Organization JSON-LD.
 * Sayfa bileşenlerindeki Helmet etiketleri title/description'ı geçersiz kılabilir.
 */
export function SeoHead() {
  const [seo, setSeo] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(apiUrl("/api/seo"));
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.seo) return;
        setSeo(data.seo);
      } catch {
        /* SEO fetch başarısız olsa sayfa çalışmaya devam eder */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!seo) return null;

  const base = String(seo.canonical_url || "").replace(/\/$/, "") || DEFAULT_BASE;
  const structuredEnabled = seo.structured_data_enabled !== false;

  const websiteLd = structuredEnabled
    ? {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: seo.site_name || "AdaDöviz",
        url: `${base}/`,
        description: seo.description,
        inLanguage: "tr-TR",
        potentialAction: {
          "@type": "SearchAction",
          target: `${base}/?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      }
    : null;

  const orgLd = structuredEnabled
    ? {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: seo.site_name || "AdaDöviz",
        url: `${base}/`,
        logo: seo.og_image || `${base}/adadoviz-logo.svg`,
        areaServed: {
          "@type": "Place",
          name: seo.geo_placename || "Northern Cyprus, KKTC",
        },
      }
    : null;

  return (
    <Helmet prioritizeSeoTags>
      {seo.title ? <title>{seo.title}</title> : null}
      {seo.description ? <meta name="description" content={seo.description} /> : null}
      {seo.keywords ? <meta name="keywords" content={seo.keywords} /> : null}
      <meta name="robots" content={seo.robots || "index, follow"} />
      {seo.geo_region ? <meta name="geo.region" content={seo.geo_region} /> : null}
      {seo.geo_placename ? <meta name="geo.placename" content={seo.geo_placename} /> : null}
      <meta name="author" content={seo.site_name || "AdaDöviz"} />

      <meta property="og:type" content="website" />
      {seo.site_name ? <meta property="og:site_name" content={seo.site_name} /> : null}
      {seo.title ? <meta property="og:title" content={seo.title} /> : null}
      {seo.description ? <meta property="og:description" content={seo.description} /> : null}
      {seo.canonical_url ? <meta property="og:url" content={seo.canonical_url} /> : null}
      <meta property="og:locale" content={seo.locale || "tr_TR"} />
      {seo.og_image ? <meta property="og:image" content={seo.og_image} /> : null}

      <meta name="twitter:card" content="summary_large_image" />
      {seo.title ? <meta name="twitter:title" content={seo.title} /> : null}
      {seo.description ? <meta name="twitter:description" content={seo.description} /> : null}
      {seo.og_image ? <meta name="twitter:image" content={seo.og_image} /> : null}

      {seo.canonical_url ? <link rel="canonical" href={seo.canonical_url} /> : null}

      {websiteLd ? (
        <script type="application/ld+json">{JSON.stringify(websiteLd)}</script>
      ) : null}
      {orgLd ? <script type="application/ld+json">{JSON.stringify(orgLd)}</script> : null}
    </Helmet>
  );
}
