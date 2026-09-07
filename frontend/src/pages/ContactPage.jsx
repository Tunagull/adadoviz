import { Helmet } from "react-helmet-async";
import { BrandLogo } from "../components/BrandLogo";
import { HeaderActions } from "../components/HeaderActions";
import { MobileNav } from "../components/MobileNav";
import { RadialOrbitalContact } from "../components/RadialOrbitalContact";
import { SiteNav } from "../components/SiteNav";
import { useLanguage } from "../context/LanguageContext";

/**
 * İletişim — tek içeriği orbital kanal çarkı.
 *
 * Çark önce `contact-shell` adlı koyu bir panelin içinde, altında da
 * partnerlik formuyla duruyordu. Panel kompozisyonu daraltıyordu; kaldırıldı
 * ve çark doğrudan sayfa zeminine, tam genişlikte kuruldu. Form kendi
 * sayfasına (`/partnerlik`) taşındı; çarkın "Partnerlik formu" düğümü oraya
 * bağlanıyor.
 */
export function ContactPage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900 dark:bg-ink-950 dark:text-white">
      <Helmet>
        <title>{`${t("navContact")} | AdaDöviz`}</title>
        <meta name="description" content={t("contactPageLead")} />
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

      <main className="relative z-raised mx-auto w-full max-w-[1600px] px-4 py-8 sm:py-10">
        <div className="mx-auto mb-2 max-w-2xl text-center sm:mb-4">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("navContact")}</h1>
          <p className="mt-3 text-sm text-ink-600 dark:text-ink-400 sm:text-base">
            {t("contactPageLead")}
          </p>
        </div>

        <RadialOrbitalContact formTo="/partnerlik" />
      </main>
    </div>
  );
}

export default ContactPage;
