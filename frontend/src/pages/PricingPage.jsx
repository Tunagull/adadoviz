import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Check, Star, Tag } from "lucide-react";
import { BrandLogo } from "../components/BrandLogo";
import { SiteNav } from "../components/SiteNav";
import { HeaderActions } from "../components/HeaderActions";
import { useLanguage } from "../context/LanguageContext";
import { apiUrl } from "../lib/api";
import {
  FALLBACK_PLANS,
  annualSavingsPercent,
  formatTry,
  plansByCode,
} from "../lib/plans";

function applyCta(navigate, code) {
  navigate(`/partnerlik?paket=${encodeURIComponent(code)}`);
}

export function PricingPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const locale = lang === "en" ? "en-US" : "tr-TR";
  const [cycle, setCycle] = useState("monthly");
  const [plans, setPlans] = useState(FALLBACK_PLANS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/plans"));
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.plans) && data.plans.length) {
          setPlans(data.plans);
        }
      } catch {
        /* varsayılan paketler durur */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byCode = useMemo(() => plansByCode(plans), [plans]);
  const deneme = byCode.deneme || FALLBACK_PLANS[0];
  const aylik = byCode.aylik || FALLBACK_PLANS[1];
  const yillik = byCode.yillik || FALLBACK_PLANS[2];
  const paid = cycle === "annual" ? yillik : aylik;
  const savings = annualSavingsPercent(aylik.fiyat, yillik.fiyat);

  const cards = [
    {
      id: "deneme",
      code: "deneme",
      name: t("pricingStarterName"),
      blurb: t("pricingStarterBlurb"),
      price: formatTry(deneme.fiyat, locale),
      period: t("pricingTrialPeriod").replace("{days}", String(deneme.sure_gun || 14)),
      billed: t("pricingStarterBilled").replace("{days}", String(deneme.sure_gun || 14)),
      features: [
        t("pricingStarterF1").replace("{days}", String(deneme.sure_gun || 14)),
        t("pricingStarterF2"),
        t("pricingStarterF3"),
        t("pricingStarterF4"),
        t("pricingStarterF5"),
      ],
      cta: t("pricingStarterCta"),
      featured: false,
    },
    {
      id: "abonelik",
      code: paid.code,
      name: t("pricingProName"),
      blurb: t("pricingProBlurb"),
      price: formatTry(paid.fiyat, locale),
      period: cycle === "annual" ? t("pricingPerYear") : t("pricingPerMonth"),
      billed: cycle === "annual" ? t("pricingBilledAnnual") : t("pricingBilledMonthly"),
      features: [
        t("pricingProF1"),
        t("pricingProF2"),
        t("pricingProF3"),
        t("pricingProF4"),
        t("pricingProF5"),
      ],
      cta: t("pricingProCta"),
      featured: true,
    },
    {
      id: "kurumsal",
      code: "kurumsal",
      name: t("pricingEntName"),
      blurb: t("pricingEntBlurb"),
      price: t("pricingEntPrice"),
      period: "",
      billed: t("pricingEntBilled"),
      features: [
        t("pricingEntF1"),
        t("pricingEntF2"),
        t("pricingEntF3"),
        t("pricingEntF4"),
      ],
      cta: t("pricingEntCta"),
      featured: false,
    },
  ];

  return (
    <div className="min-h-screen">
      {/*
        ⚠️ HATA DÜZELTMESİ (S-04): Başlık `{t("pricingTitle")} | AdaDöviz`
        biçimindeydi — yani JSX'te İKİ ayrı çocuk düğüm (bir ifade + bir dize).
        react-helmet-async `<title>` içinde TEK bir dize çocuğu bekler; birden
        fazla olduğunda başlığı boş bırakıyordu. Ölçüm: /paketler sayfasında
        `document.title === ""` ve tarayıcı sekmesinde başlık yerine URL
        görünüyordu. Şablon dizesi tek çocuk ürettiği için sorunu çözer.
      */}
      <Helmet>
        <title>{`${t("pricingTitle")} | AdaDöviz`}</title>
        {/* canonical'ı SeoHead rota bazında üretir; burada tekrar edilmez. */}
        <meta name="description" content={t("pricingLead")} />
      </Helmet>

      <header className="sticky top-0 z-sticky w-full border-b border-ink-200/80 bg-white/80 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80 sm:px-6 sm:py-4 md:py-5">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 sm:gap-4">
          <BrandLogo className="min-w-0 shrink" />
          <SiteNav className="mr-auto ml-2" />
          <HeaderActions />
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

      <main className="relative z-raised mx-auto w-full max-w-6xl px-4 py-12 sm:py-16 md:py-20">
        <section className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("pricingTitle")}</h1>
          <p className="mt-3 text-sm text-ink-600 dark:text-ink-400 sm:text-base">{t("pricingLead")}</p>

          <div
            className="mx-auto mt-8 inline-flex rounded-full border border-ink-300 bg-ink-100 p-1 dark:border-white/10 dark:bg-ink-900/80"
            role="radiogroup"
            aria-label={t("pricingCycleLabel")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={cycle === "monthly"}
              onClick={() => setCycle("monthly")}
              className={`inline-flex min-h-[2.75rem] items-center rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                cycle === "monthly"
                  ? "surface-neon"
                  : "text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white"
              }`}
            >
              {t("pricingMonthly")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={cycle === "annual"}
              onClick={() => setCycle("annual")}
              className={`inline-flex min-h-[2.75rem] items-center rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                cycle === "annual"
                  ? "surface-neon"
                  : "text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white"
              }`}
            >
              {savings > 0
                ? t("pricingAnnualSave").replace("{pct}", String(savings))
                : t("pricingAnnual")}
            </button>
          </div>
        </section>

        <section className="mt-12 grid items-center gap-6 lg:grid-cols-3 lg:gap-5">
          {cards.map((card) => (
            <article
              key={card.id}
              className={`relative flex h-full flex-col rounded-2xl border bg-white p-6 shadow-card dark:bg-ink-950 dark:shadow-card-dark sm:p-8 ${
                card.featured
                  ? "border-ink-950 lg:min-h-[34rem] lg:py-10 dark:border-white"
                  : "border-ink-200 dark:border-white/10"
              }`}
            >
              {card.featured ? (
                <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink-950 px-3 py-1 text-[11px] font-semibold text-white dark:bg-white dark:text-ink-950">
                    <Star className="size-3 fill-current" aria-hidden="true" />
                    {t("pricingPopular")}
                  </span>
                </div>
              ) : null}

              <h2 className="text-xl font-semibold tracking-tight">{card.name}</h2>
              <p className="mt-1.5 min-h-[2.5rem] text-sm text-ink-500 dark:text-ink-400">{card.blurb}</p>

              <p className="mt-6 flex flex-wrap items-baseline gap-x-2">
                <span className="text-4xl font-bold tracking-tight text-ink-900 dark:text-white">{card.price}</span>
                {card.period ? (
                  <span className="text-sm text-ink-500 dark:text-ink-400">{card.period}</span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{card.billed}</p>

              <ul className="mt-8 flex flex-1 flex-col gap-3">
                {card.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-ink-700 dark:text-ink-200">
                    <Check className="mt-0.5 size-4 shrink-0 text-ink-900 dark:text-white" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => applyCta(navigate, card.code)}
                className={`mt-8 inline-flex h-11 w-full items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  card.featured
                    ? "surface-neon"
                    : "border border-ink-300 bg-transparent text-ink-900 hover:bg-ink-50 dark:border-white/20 dark:text-white dark:hover:bg-white/5"
                }`}
              >
                {card.cta}
              </button>
            </article>
          ))}
        </section>

        <p className="mt-10 text-center text-xs text-ink-500 dark:text-ink-400">
          <Tag className="mr-1 inline size-3.5 align-text-top" aria-hidden="true" />
          {t("pricingFootnote")}
        </p>
      </main>
    </div>
  );
}
