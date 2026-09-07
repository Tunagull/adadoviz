import { Helmet } from "react-helmet-async";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { BrandLogo } from "../components/BrandLogo";
import { SiteNav } from "../components/SiteNav";
import { HeaderActions } from "../components/HeaderActions";
import { MobileNav } from "../components/MobileNav";
import { Faq } from "../components/Faq";
import { useLanguage } from "../context/LanguageContext";
import { getContentPage } from "../content/contentPages";

const BASE = "https://adadoviz.tunahangul.com";

/**
 * P3.5 — statik içerik / landing sayfası (C9).
 * Rota: /rehber/:slug · /kur/:slug · /sehir/:slug (`type` prop ile ayrışır).
 * İçerik `content/contentPages.js`'ten; SeoHead site-geneli meta basmadığı
 * için title/description/canonical + JSON-LD burada üretilir.
 */
export function ContentPage({ type }) {
  const { slug } = useParams();
  const { t, lang } = useLanguage();
  const entry = getContentPage(type, slug);

  if (!entry) return <Navigate to="/" replace />;

  const c = entry[lang === "en" ? "en" : "tr"] || entry.tr;
  const url = `${BASE}/${type}/${entry.slug}`;
  const locale = lang === "en" ? "en_US" : "tr_TR";

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "AdaDöviz", item: `${BASE}/` },
      { "@type": "ListItem", position: 2, name: c.h1, item: url },
    ],
  };

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: c.h1,
    description: c.description,
    inLanguage: lang === "en" ? "en" : "tr-TR",
    mainEntityOfPage: url,
    datePublished: entry.updated,
    dateModified: entry.updated,
    author: { "@type": "Organization", name: "AdaDöviz", url: `${BASE}/` },
    publisher: {
      "@type": "Organization",
      name: "AdaDöviz",
      logo: { "@type": "ImageObject", url: `${BASE}/adadoviz-mark.svg` },
    },
  };

  const faqLd = c.faq?.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: c.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }
    : null;

  return (
    <div className="min-h-screen">
      <Helmet>
        <title>{`${c.title} | AdaDöviz`}</title>
        <meta name="description" content={c.description} />
        <link rel="canonical" href={url} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={c.title} />
        <meta property="og:description" content={c.description} />
        <meta property="og:url" content={url} />
        <meta property="og:locale" content={locale} />
        <script type="application/ld+json">{JSON.stringify(breadcrumbLd)}</script>
        <script type="application/ld+json">{JSON.stringify(articleLd)}</script>
        {faqLd ? (
          <script type="application/ld+json">{JSON.stringify(faqLd)}</script>
        ) : null}
      </Helmet>

      <header className="sticky top-0 z-sticky w-full border-b border-ink-200/80 bg-white/80 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80 sm:px-6 sm:py-4 md:py-5">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 sm:gap-4">
          <BrandLogo className="min-w-0 shrink" />
          <SiteNav className="mr-auto ml-2" />
          <HeaderActions />
          <MobileNav />
        </div>
      </header>

      <div
        className="pointer-events-none fixed inset-0 z-0 text-ink-900 opacity-[0.05] dark:text-white dark:opacity-[0.09]"
        style={{
          backgroundImage:
            "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />

      <main className="relative z-raised mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
        <nav
          aria-label={t("contentBreadcrumbLabel")}
          className="mb-6 flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400"
        >
          <Link to="/" className="hover:text-ink-900 dark:hover:text-white">
            {t("contentBreadcrumbHome")}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="truncate text-ink-700 dark:text-ink-300">{c.h1}</span>
        </nav>

        <article>
          <h1 className="text-3xl font-bold tracking-tight text-ink-900 dark:text-white sm:text-4xl">
            {c.h1}
          </h1>
          <p className="mt-3 text-base text-ink-600 dark:text-ink-300">{c.lead}</p>
          <p className="mt-2 text-xs text-ink-400 dark:text-ink-500">
            {t("contentUpdated")}: {entry.updated}
          </p>

          <div className="mt-10 space-y-10">
            {c.sections.map((sec) => (
              <section key={sec.h}>
                <h2 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-white">
                  {sec.h}
                </h2>
                {(sec.p || []).map((para, i) => (
                  <p
                    key={i}
                    className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-ink-300"
                  >
                    {para}
                  </p>
                ))}
                {sec.list?.length ? (
                  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                    {sec.list.map((li) => (
                      <li key={li}>{li}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </article>

        <Faq items={c.faq} title={t("contentFaqTitle")} />

        {c.related?.length ? (
          <section className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-white">
              {t("contentRelated")}
            </h2>
            <ul className="mt-4 space-y-2">
              {c.related.map((r) => (
                <li key={r.to}>
                  <Link
                    to={r.to}
                    className="group inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
                  >
                    {r.label}
                    <ArrowRight className="size-3.5 transition-transform duration-base ease-out-strong group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-14 rounded-2xl border border-ink-200 bg-white p-5 text-center dark:border-white/10 dark:bg-ink-950">
          <p className="text-sm text-ink-600 dark:text-ink-300">{t("contentCtaLead")}</p>
          <Link
            to="/en-iyi-kur"
            className="surface-neon mt-3 inline-flex h-10 items-center justify-center rounded-full px-5 text-sm font-semibold"
          >
            {t("contentCtaButton")}
          </Link>
        </div>
      </main>
    </div>
  );
}

export default ContentPage;
