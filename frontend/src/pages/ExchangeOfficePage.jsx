import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { BusinessDetailModal } from "../components/BusinessDetailModal";
import { HeaderActions } from "../components/HeaderActions";
import { BrandLogo } from "../components/BrandLogo";
import { useLanguage } from "../context/LanguageContext";
import { apiUrl } from "../lib/api";
import { buildExchangeOfficeGraphJsonLd } from "../lib/localBusinessSchema";
import { cityDisplayName, exchangeOfficePath, extractCitySlug, slugify } from "../lib/slug";

const SITE = "https://adadoviz.tunahangul.com";

export function ExchangeOfficePage() {
  const { slug: rawSlug } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);

  const slug = slugify(rawSlug);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(apiUrl(`/api/doviz-burosu/${encodeURIComponent(slug)}`));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || t("exchangeOfficeNotFound") || "Döviz bürosu bulunamadı.");
        }
        if (cancelled) return;
        if (data.slug && data.slug !== slug) {
          navigate(exchangeOfficePath(data.slug), { replace: true });
        }
        setPayload(data);
      } catch (err) {
        if (!cancelled) {
          setPayload(null);
          setError(err.message || "Döviz bürosu bulunamadı.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, navigate, t]);

  const business = payload?.business || null;
  const branches = payload?.branches || [];
  const displayName = String(business?.name || "").trim();

  const primaryCity = useMemo(() => {
    const focused = branches.find((b) => String(b.id) === String(payload?.matchedBranchId));
    const citySlug =
      extractCitySlug(focused?.address) ||
      extractCitySlug(branches[0]?.address) ||
      "";
    return cityDisplayName(citySlug, lang);
  }, [branches, payload?.matchedBranchId, lang]);

  const pageTitle = useMemo(() => {
    if (!displayName) return lang === "en" ? "Exchange Office | AdaDöviz" : "Döviz Bürosu | AdaDöviz";
    return lang === "en"
      ? `${displayName} | ${primaryCity} Exchange Office – AdaDöviz KKTC`
      : `${displayName} | ${primaryCity} Döviz Bürosu – AdaDöviz KKTC`;
  }, [displayName, primaryCity, lang]);

  const pageDescription = useMemo(() => {
    if (!displayName) return "";
    return lang === "en"
      ? `Live USD, EUR and GBP rates for ${displayName} in ${primaryCity}, Northern Cyprus (KKTC). Address, opening hours and branch map on AdaDöviz.`
      : `${displayName} — ${primaryCity}, KKTC güncel USD, EUR ve GBP kurları. Adres, çalışma saatleri ve şube konumu AdaDöviz'de.`;
  }, [displayName, primaryCity, lang]);

  const jsonLd = useMemo(() => {
    if (!business) return null;
    return buildExchangeOfficeGraphJsonLd({
      businessName: displayName,
      businessSlug: payload?.businessSlug || slug,
      workingHours: business.workingHours || business.working_hours,
      phone: business.phone,
      logoUrl: business.logo_url,
      branches: branches.map((b) => ({
        ...b,
        slug: b.slug || payload?.businessSlug || slug,
      })),
      lang,
    });
  }, [business, branches, displayName, payload?.businessSlug, slug, lang]);

  const canonical = `${SITE}${exchangeOfficePath(payload?.slug || slug)}`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Helmet prioritizeSeoTags>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonical} />
        <link rel="canonical" href={canonical} />
        {jsonLd ? (
          <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
        ) : null}
      </Helmet>

      <header className="sticky top-0 z-[100] border-b border-slate-200/80 bg-white/80 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-[#020617]/80 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo className="min-w-0 shrink" />
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 dark:border-white/10 dark:text-slate-200 dark:hover:border-cyan-400 dark:hover:text-cyan-300"
            >
              <ArrowLeft size={14} />
              {lang === "en" ? "Home" : "Ana Sayfa"}
            </Link>
          </div>
          <HeaderActions compact />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-10">
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("loadingShort") || "Yükleniyor..."}
          </p>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-white p-6 dark:border-rose-900/50 dark:bg-slate-900">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              {lang === "en" ? "Exchange office not found" : "Döviz bürosu bulunamadı"}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{error}</p>
            <Link to="/" className="mt-4 inline-block text-sm font-semibold text-teal-600 hover:underline">
              {lang === "en" ? "Back to live rates" : "Canlı kurlara dön"}
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              {displayName}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {lang === "en"
                ? `Currency exchange in ${primaryCity}, Northern Cyprus (KKTC)`
                : `${primaryCity}, KKTC döviz bürosu — canlı kurlar, adres ve çalışma saatleri`}
            </p>
            {branches.length > 0 ? (
              <ul className="mt-6 space-y-3">
                {branches.map((branch) => (
                  <li
                    key={branch.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <p className="font-semibold text-slate-900 dark:text-white">{branch.name}</p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {branch.address || "KKTC"}
                    </p>
                    {branch.phone ? (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{branch.phone}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      {business && !loading && !error ? (
        <BusinessDetailModal
          business={business}
          initialBranchId={payload?.matchedBranchId ?? null}
          initialView={payload?.matchedVia === "branch" ? "konum" : "grafik"}
          onClose={() => navigate("/")}
        />
      ) : null}
    </div>
  );
}
