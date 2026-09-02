import { useEffect, useState } from "react";
import { BarChart3, LineChart, Mail } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { useOfficeSearch } from "../context/OfficeSearchContext";
import { GooeySearchBar } from "./ui/animated-search-bar";
import { useHomeSectionNav } from "../hooks/useHomeSectionNav";

/**
 * Mobil alt çubuk (downbar). Üst SiteNav `md` altında gizlendiği için
 * Kurlar / Kıyasla / İletişim burada yaşar; ortadaki hap gooey aramadır.
 */
export function SiteDownbar() {
  const { t } = useLanguage();
  const navigate = useNavigate();
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

  const items = [
    { key: "rates", label: t("navRates"), icon: LineChart, to: "/" },
    { key: "compare", label: t("navCompare"), icon: BarChart3, to: "/kiyasla" },
    { key: "contact", label: t("navContact"), icon: Mail, to: "/iletisim" },
  ];

  const isActive = (item) => {
    if (item.key === "contact") return nav.isContactActive;
    if (item.key === "rates") return nav.isRatesActive;
    return nav.isCompareActive;
  };

  const hasOffices = (officeSearch?.items || []).length > 0;

  return (
    <nav className="site-downbar md:hidden" aria-label={t("navRates") + " / " + t("navCompare")}>
      <div className="site-downbar__inner">
        {items.slice(0, 2).map((item) => {
          const active = isActive(item);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.to)}
              aria-current={active ? "page" : undefined}
              className="site-downbar__item"
            >
              <item.icon className="size-4" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}

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
        ) : (
          <button
            type="button"
            onClick={() => navigate(items[2].to)}
            aria-current={isActive(items[2]) ? "page" : undefined}
            className="site-downbar__item"
          >
            <Mail className="size-4" aria-hidden="true" />
            {t("navContact")}
          </button>
        )}

        {hasOffices ? (
          <button
            type="button"
            onClick={() => navigate(items[2].to)}
            aria-current={isActive(items[2]) ? "page" : undefined}
            className="site-downbar__item"
          >
            <Mail className="size-4" aria-hidden="true" />
            {t("navContact")}
          </button>
        ) : null}
      </div>
    </nav>
  );
}
