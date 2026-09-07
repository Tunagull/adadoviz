import { useEffect, useState } from "react";
import { BarChart3, LineChart, Mail } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { useOfficeSearch } from "../context/officeSearchStore";
import { GooeySearchBar } from "./ui/animated-search-bar";
import { useHomeSectionNav } from "../hooks/useHomeSectionNav";

/**
 * Mobil alt çubuk (downbar) — başparmakla erişilen HIZLI kısayollar:
 * Kurlar / Kıyasla / İletişim + (katalog yüklüyse) büro arama hapı.
 *
 * TAM gezinme (6 hedef + İşletme Girişi) artık her sayfanın başlığındaki
 * <MobileNav /> hamburgerinde — burada tekrar etmiyoruz.
 */
export function SiteDownbar() {
  const { t } = useLanguage();
  const location = useLocation();
  const officeSearch = useOfficeSearch();
  const nav = useHomeSectionNav();
  const [footerOpen, setFooterOpen] = useState(false);

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

  if (footerOpen) return null;

  const hasOffices = (officeSearch?.items || []).length > 0;

  return (
    <nav
      className="site-downbar md:hidden"
      aria-label={t("navRates") + " / " + t("navCompare") + " / " + t("navContact")}
    >
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

        <Link
          to="/iletisim"
          aria-current={nav.isContactActive ? "page" : undefined}
          className="site-downbar__item"
        >
          <Mail className="size-4" aria-hidden="true" />
          {t("navContact")}
        </Link>
      </div>
    </nav>
  );
}
