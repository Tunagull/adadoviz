import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";
import { apiUrl } from "../lib/api";

const DEFAULT_BASE = "https://adadoviz.tunahangul.com";

/** Arama motoruna kapalı olması gereken yollar. */
const PRIVATE_PATHS = /^\/(admin|super-admin|reset-password)(\/|$)/;

/**
 * Super Admin SEO ayarlarından site geneli meta + WebSite/Organization JSON-LD.
 *
 * ⚠️ HATA DÜZELTMESİ (S-01): Bu bileşen App kabuğunda global mount ediliyor ve
 * ROTA FARKINDALIĞI YOKTU. `prioritizeSeoTags` ile site geneli `<title>` ve
 * sabit `<link rel="canonical">` basıyordu. Ölçülen sonuç:
 *
 *   /kiyasla  → başlık ana sayfanınki, canonical → ana sayfa
 *               (arama motoruna "beni indeksleme, aslım şurada" demek)
 *   /paketler → sayfanın kendi Helmet'i eziliyor, document.title BOŞ kalıyor
 *
 * Ayrıca koşulsuz `robots: index, follow` yayıyordu; yönetim sayfalarının
 * kendi `noindex` etiketini ezme riski taşıyordu.
 *
 * Artık: canonical geçerli yoldan türetilir, başlık/açıklama YALNIZCA ana
 * sayfada basılır (diğer sayfalar kendi Helmet'lerini kullanır) ve yönetim
 * yolları her hâlükârda `noindex` alır.
 */
export function SeoHead() {
  const [seo, setSeo] = useState(null);
  const { pathname } = useLocation();

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

  /** S-01: her rota kendi kanonik adresini bildirir. */
  const isHome = pathname === "/";
  const isPrivate = PRIVATE_PATHS.test(pathname);
  const canonicalUrl = `${base}${isHome ? "/" : pathname}`;
  /** Yönetim yolları hiçbir koşulda indekslenmez. */
  const robots = isPrivate ? "noindex, nofollow" : seo.robots || "index, follow";

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
        logo: seo.og_image || `${base}/adadoviz-mark.svg`,
        areaServed: {
          "@type": "Place",
          name: seo.geo_placename || "Northern Cyprus, KKTC",
        },
      }
    : null;

  return (
    <Helmet prioritizeSeoTags>
      {/*
        S-01: title ve description YALNIZCA ana sayfada. Diğer rotalarda bu
        bileşen sessiz kalır ki sayfanın kendi Helmet'i geçerli olsun —
        `prioritizeSeoTags` aksi hâlde sayfa başlığını eziyordu.
      */}
      {isHome && seo.title ? <title>{seo.title}</title> : null}
      {isHome && seo.description ? (
        <meta name="description" content={seo.description} />
      ) : null}
      {isHome && seo.keywords ? <meta name="keywords" content={seo.keywords} /> : null}
      <meta name="robots" content={robots} />
      {seo.geo_region ? <meta name="geo.region" content={seo.geo_region} /> : null}
      {seo.geo_placename ? <meta name="geo.placename" content={seo.geo_placename} /> : null}
      <meta name="author" content={seo.site_name || "AdaDöviz"} />

      <meta property="og:type" content="website" />
      {seo.site_name ? <meta property="og:site_name" content={seo.site_name} /> : null}
      {isHome && seo.title ? <meta property="og:title" content={seo.title} /> : null}
      {isHome && seo.description ? (
        <meta property="og:description" content={seo.description} />
      ) : null}
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:locale" content={seo.locale || "tr_TR"} />
      {seo.og_image ? <meta property="og:image" content={seo.og_image} /> : null}

      <meta name="twitter:card" content="summary_large_image" />
      {isHome && seo.title ? <meta name="twitter:title" content={seo.title} /> : null}
      {isHome && seo.description ? (
        <meta name="twitter:description" content={seo.description} />
      ) : null}
      {seo.og_image ? <meta name="twitter:image" content={seo.og_image} /> : null}

      {/* S-01: sabit site canonical'ı yerine rotanın kendi adresi. */}
      {isPrivate ? null : <link rel="canonical" href={canonicalUrl} />}

      {websiteLd ? (
        <script type="application/ld+json">{JSON.stringify(websiteLd)}</script>
      ) : null}
      {orgLd ? <script type="application/ld+json">{JSON.stringify(orgLd)}</script> : null}
    </Helmet>
  );
}
