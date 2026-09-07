import { Helmet } from "react-helmet-async";
import { BrandLogo } from "../components/BrandLogo";
import { HeaderActions } from "../components/HeaderActions";
import { MobileNav } from "../components/MobileNav";
import { PartnershipForm } from "../components/PartnershipForm";
import { SiteNav } from "../components/SiteNav";
import { useLanguage } from "../context/LanguageContext";

/**
 * Partnerlik başvurusu — kendi sayfası.
 *
 * Form önce iletişim sayfasının altında, orbital çarkın hemen ardında
 * duruyordu; çark tam genişlikte bir kompozisyona büyüyünce oraya sığmıyordu.
 * Artık iletişim sayfasındaki "Partnerlik formu" düğümü buraya bağlanıyor.
 *
 * `?paket=` parametresi paket sayfasından geliyor; form zaten sayfanın tek
 * içeriği olduğu için ayrıca kaydırmaya gerek yok.
 */
export function PartnershipPage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900 dark:bg-ink-950 dark:text-white">
      <Helmet>
        <title>{`${t("partnership")} | AdaDöviz`}</title>
        <meta name="description" content={t("partnershipDesc")} />
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

      <main className="relative z-raised mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("partnership")}</h1>
          <p className="mt-3 text-sm text-ink-600 dark:text-ink-400 sm:text-base">
            {t("partnershipPageLead")}
          </p>
        </div>

        <PartnershipForm hideHeading />
      </main>
    </div>
  );
}

export default PartnershipPage;
