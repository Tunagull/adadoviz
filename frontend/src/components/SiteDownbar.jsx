import { useEffect, useState } from "react";
import {
  BarChart3,
  LineChart,
  Mail,
  MapPinned,
  Menu as MenuIcon,
  Tag,
  Trophy,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { useOfficeSearch } from "../context/officeSearchStore";
import { GooeySearchBar } from "./ui/animated-search-bar";
import { useHomeSectionNav } from "../hooks/useHomeSectionNav";
import { Sheet } from "./Sheet";

/**
 * Mobil alt çubuk (downbar). Üst SiteNav `md` altında GİZLİ olduğu için
 * telefonda tek gezinme burasıdır.
 *
 * ⚠️ MOBİL DÜZELTME: "En iyi kur" ve "Harita" sekmeleri SiteNav'e eklenmişti
 * ama SiteNav `hidden md:flex` — yani telefonda bu iki sayfaya hiçbir menüden
 * ulaşılamıyordu. Downbar'a 6 sekmeyi de sığdırmak dar ekranda mümkün değil;
 * bunun yerine Kurlar / Kıyasla + arama hapı yanına bir "Menü" düğmesi kondu.
 * Menü, alttan açılan bir sheet'te TÜM gezinme hedeflerini listeler.
 */
export function SiteDownbar() {
  const { t } = useLanguage();
  const location = useLocation();
  const officeSearch = useOfficeSearch();
  const nav = useHomeSectionNav();
  const [footerOpen, setFooterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const footer = document.querySelector(".cinematic-footer");
    if (!footer) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setFooterOpen(entry.isIntersecting && entry.intersectionRatio > 0.12),
      { threshold: [0, 0.12, 0.4] }
    );
    observer.observe(footer);
    return () => observer.disconnect();
  }, [location.pathname]);

  const menuItems = [
    { key: "rates", label: t("navRates"), icon: LineChart, to: "/", active: nav.isRatesActive },
    {
      key: "bestRate",
      label: t("navBestRate"),
      icon: Trophy,
      to: "/en-iyi-kur",
      active: nav.isBestRateActive,
    },
    { key: "map", label: t("navMap"), icon: MapPinned, to: "/harita", active: nav.isMapActive },
    {
      key: "compare",
      label: t("navCompare"),
      icon: BarChart3,
      to: "/kiyasla",
      active: nav.isCompareActive,
    },
    { key: "pricing", label: t("navPricing"), icon: Tag, to: "/paketler", active: nav.isPricingActive },
    { key: "contact", label: t("navContact"), icon: Mail, to: "/iletisim", active: nav.isContactActive },
  ];

  const hasOffices = (officeSearch?.items || []).length > 0;

  if (footerOpen) return null;

  return (
    <>
      <nav className="site-downbar md:hidden" aria-label={t("navMenuTitle")}>
        <div className="site-downbar__inner">
          <Link
            to="/"
            aria-current={nav.isRatesActive ? "page" : undefined}
            className="site-downbar__item"
          >
            <LineChart className="size-4" aria-hidden="true" />
            {t("navRates")}
          </Link>
          <Link
            to="/kiyasla"
            aria-current={nav.isCompareActive ? "page" : undefined}
            className="site-downbar__item"
          >
            <BarChart3 className="size-4" aria-hidden="true" />
            {t("navCompare")}
          </Link>

          {hasOffices ? (
            <div className="site-downbar__search">
              <GooeySearchBar
                placement="up"
                fill
                hideOrb
                items={officeSearch.items}
                value={officeSearch.query}
                onChange={officeSearch.onQuery}
                onSelect={officeSearch.onPick}
                collapsedLabel={t("searchBanks")}
                placeholder={t("searchBanks")}
                emptyLabel={t("noResults")}
                aria-label={t("searchBanks")}
              />
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="site-downbar__item"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
          >
            <MenuIcon className="size-4" aria-hidden="true" />
            {t("navMenu")}
          </button>
        </div>
      </nav>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title={t("navMenuTitle")}>
        <ul className="flex flex-col gap-1 py-1">
          {menuItems.map((item) => (
            <li key={item.key}>
              <Link
                to={item.to}
                onClick={() => setMenuOpen(false)}
                aria-current={item.active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-control px-3 py-3 text-sm font-medium transition-colors duration-base ease-out ${
                  item.active
                    ? "surface-neon"
                    : "text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-white/5"
                }`}
              >
                <item.icon className="size-5 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
