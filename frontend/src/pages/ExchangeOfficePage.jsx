import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, MessageCircle, Phone } from "lucide-react";
import { BusinessDetailModal } from "../components/BusinessDetailModal";
import { HeaderActions } from "../components/HeaderActions";
import { MobileNav } from "../components/MobileNav";
import { BrandLogo } from "../components/BrandLogo";
import { useLanguage } from "../context/LanguageContext";
import { apiUrl, mediaUrl } from "../lib/api";
import { whatsappHref } from "../lib/contact";
import { trackEvent } from "../lib/analytics";
import { buildExchangeOfficeGraphJsonLd } from "../lib/localBusinessSchema";
import { cityDisplayName, exchangeOfficePath, extractCitySlug, slugify } from "../lib/slug";

const SITE = "https://adadoviz.tunahangul.com";

export function ExchangeOfficePage() {
  const { slug: rawSlug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  // M2: hata kod olarak saklanır, render'da çevrilir — `t` fetch-effect
  // bağımlılığı olmaktan çıkar (dil değişimi tüm ofis yükünü refetch etmesin).
  const [errorCode, setErrorCode] = useState("");
  const [serverError, setServerError] = useState("");
  const [payload, setPayload] = useState(null);
  /**
   * Ana sayfadan kart tıklanınca modal açılır (state.openDetail).
   * Doğrudan URL / SEO ziyaretinde modal kapalı kalır; sayfa içeriği görünür.
   * Modal kapanınca ana sayfadan gelindiyse geri dönülür — boş sayfada kalmayı önler.
   */
  const openedFromDashboard = Boolean(location.state?.openDetail);
  const [detailOpen, setDetailOpen] = useState(openedFromDashboard);

  const slug = slugify(rawSlug);

  useEffect(() => {
    setDetailOpen(openedFromDashboard);
  }, [slug, openedFromDashboard]);

  const handleCloseDetail = () => {
    if (openedFromDashboard) {
      if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate("/", { replace: true });
      }
      return;
    }
    setDetailOpen(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErrorCode("");
      setServerError("");
      try {
        const res = await fetch(apiUrl(`/api/doviz-burosu/${encodeURIComponent(slug)}`));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (cancelled) return;
          setPayload(null);
          if (data?.error) setServerError(String(data.error));
          else setErrorCode("exchangeOfficeNotFound");
          return;
        }
        if (cancelled) return;
        if (data.slug && data.slug !== slug) {
          navigate(exchangeOfficePath(data.slug), { replace: true });
        }
        setPayload(data);
      } catch {
        if (!cancelled) {
          setPayload(null);
          setErrorCode("exchangeOfficeNotFound");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, navigate]);

  const business = payload?.business || null;
  /*
    ⚠️ OPTİMİZASYON (O-03): `payload?.branches || []` her render'da YENİ bir
    dizi üretiyordu. Bu değer aşağıdaki iki `useMemo`'nun bağımlılığı olduğu
    için memoizasyon hiçbir zaman tutmuyor, hesaplama her render tekrarlanıyordu.
    Referansı sabitlemek memo'yu gerçekten çalışır hâle getirir.
  */
  const branches = useMemo(() => payload?.branches || [], [payload]);
  const displayName = String(business?.name || "").trim();

  const primaryCity = useMemo(() => {
    const focused = branches.find((b) => String(b.id) === String(payload?.matchedBranchId));
    const citySlug =
      extractCitySlug(focused?.address) ||
      extractCitySlug(branches[0]?.address) ||
      "";
    return cityDisplayName(citySlug, lang);
  }, [branches, payload?.matchedBranchId, lang]);

  // P2.5 — büro sayfası görüntülenme olayı: kurum başına bir kez.
  const viewTrackedRef = useRef(null);
  useEffect(() => {
    const id = business?.id;
    if (!id || viewTrackedRef.current === id) return;
    viewTrackedRef.current = id;
    trackEvent("view", { institutionId: id, city: primaryCity || undefined });
  }, [business?.id, primaryCity]);

  const trackOfficeAction = (event) => {
    if (!business?.id) return;
    trackEvent(event, { institutionId: business.id, city: primaryCity || undefined });
  };

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
      logoUrl: mediaUrl(business.logo_url),
      branches: branches.map((b) => ({
        ...b,
        slug: b.slug || payload?.businessSlug || slug,
      })),
      lang,
    });
  }, [business, branches, displayName, payload?.businessSlug, slug, lang]);

  const canonical = `${SITE}${exchangeOfficePath(payload?.slug || slug)}`;

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900 dark:bg-ink-950 dark:text-ink-100">
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

      <header className="sticky top-0 z-sticky border-b border-ink-200/80 bg-white/80 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo className="min-w-0 shrink" />
            <Link
              to="/"
              className="hidden items-center gap-1.5 rounded-full border border-ink-300 px-3 py-1 text-xs font-semibold text-ink-700 transition hover:border-brand-400 hover:text-brand-700 dark:border-white/10 dark:text-ink-200 dark:hover:border-brand-400 dark:hover:text-brand-300 sm:inline-flex"
            >
              <ArrowLeft size={14} />
              {lang === "en" ? "Home" : "Ana Sayfa"}
            </Link>
          </div>
          <HeaderActions compact alwaysShow />
          <MobileNav />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-10">
        {loading ? (
          <p className="text-sm text-ink-500 dark:text-ink-400">
            {t("loadingShort") || "Yükleniyor..."}
          </p>
        ) : errorCode || serverError ? (
          <div role="alert" className="rounded-2xl border border-danger-200 bg-white p-6 dark:border-danger-900/50 dark:bg-ink-900">
            <h1 className="text-lg font-semibold text-ink-900 dark:text-white">
              {lang === "en" ? "Exchange office not found" : "Döviz bürosu bulunamadı"}
            </h1>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
              {serverError ||
                (errorCode && t(errorCode) !== errorCode
                  ? t(errorCode)
                  : lang === "en"
                    ? "This exchange office could not be found."
                    : "Bu döviz bürosu bulunamadı.")}
            </p>
            <Link to="/" className="mt-4 inline-block text-sm font-semibold text-brand-600 hover:underline">
              {lang === "en" ? "Back to live rates" : "Canlı kurlara dön"}
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-white sm:text-3xl">
              {displayName}
            </h1>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
              {/* Şehir tespit edilemediğinde "KKTC, KKTC …" gibi tekrar oluşmasın. */}
              {(() => {
                const city = primaryCity && primaryCity !== "KKTC" ? primaryCity : "";
                if (lang === "en") {
                  return city
                    ? `Currency exchange in ${city}, Northern Cyprus (KKTC)`
                    : "Currency exchange in Northern Cyprus (KKTC)";
                }
                return city
                  ? `${city}, KKTC döviz bürosu — canlı kurlar, adres ve çalışma saatleri`
                  : "KKTC döviz bürosu — canlı kurlar, adres ve çalışma saatleri";
              })()}
            </p>
            {branches.length > 0 ? (
              <ul className="mt-6 space-y-3">
                {branches.map((branch) => (
                  <li
                    key={branch.id}
                    className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900"
                  >
                    <p className="font-semibold text-ink-900 dark:text-white">{branch.name}</p>
                    <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
                      {branch.address || "KKTC"}
                    </p>
                    {branch.phone ? (
                      // U-01: telefon düz metindi; mobilde tıklanabilir olmalı.
                      <a
                        href={`tel:${String(branch.phone).replace(/[^\d+]/g, "")}`}
                        onClick={() => trackOfficeAction("call")}
                        className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
                      >
                        <Phone size={14} aria-hidden="true" />
                        {branch.phone}
                      </a>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailOpen(true)}
                        className="btn-subtle btn-sm min-h-[2.25rem]"
                      >
                        {lang === "en" ? "Rates & chart" : "Kurlar ve grafik"}
                      </button>
                      {Number.isFinite(Number(branch.lat)) && Number.isFinite(Number(branch.lng)) ? (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${branch.lat},${branch.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => trackOfficeAction("directions")}
                          className="btn-ghost btn-sm min-h-[2.25rem]"
                        >
                          <MapPin size={14} aria-hidden="true" />
                          {lang === "en" ? "Directions" : "Yol tarifi"}
                        </a>
                      ) : null}
                      {whatsappHref(branch.whatsapp || branch.phone) ? (
                        <a
                          href={whatsappHref(branch.whatsapp || branch.phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => trackOfficeAction("whatsapp")}
                          className="btn-ghost btn-sm min-h-[2.25rem] text-success-600 dark:text-success-400"
                        >
                          <MessageCircle size={14} aria-hidden="true" />
                          WhatsApp
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-8 rounded-2xl border border-ink-200 bg-white p-6 text-center dark:border-white/10 dark:bg-ink-900/60">
                <p className="text-sm text-ink-600 dark:text-ink-400">
                  {lang === "en"
                    ? "View live rates, charts and branch details for this office."
                    : "Bu büronun canlı kurlarını, grafiğini ve şube bilgilerini görüntüleyin."}
                </p>
                <button
                  type="button"
                  onClick={() => setDetailOpen(true)}
                  className="btn-primary mt-4 min-h-[2.75rem] px-5"
                >
                  {lang === "en" ? "Open rates & chart" : "Kurları ve grafiği aç"}
                </button>
              </div>
            )}
            {!detailOpen ? (
              <p className="mt-8 text-center">
                <Link
                  to="/"
                  className="text-sm font-semibold text-ink-600 underline-offset-4 hover:underline dark:text-ink-300"
                >
                  {lang === "en" ? "← Back to live rates" : "← Canlı kurlara dön"}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </div>

      {business && !loading && !errorCode && !serverError && detailOpen ? (
        <BusinessDetailModal
          business={business}
          initialBranchId={payload?.matchedBranchId ?? null}
          initialView={payload?.matchedVia === "branch" ? "konum" : "grafik"}
          onClose={handleCloseDetail}
        />
      ) : null}
    </div>
  );
}
