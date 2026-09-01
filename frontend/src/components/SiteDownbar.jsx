import { useEffect, useState } from "react";
import { BarChart3, Building2, LineChart, Tag } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { useOfficeSearch } from "../context/OfficeSearchContext";
import { GooeySearchBar } from "./ui/animated-search-bar";
import {
  scrollToPartnership,
  scrollToRates,
  useHomeSectionNav,
} from "../hooks/useHomeSectionNav";

/**
 * Mobil alt çubuk (downbar). Üst SiteNav `md` altında gizlendiği için
 * Kurlar / Kıyasla / İşletme burada yaşar; ortadaki hap gooey aramadır.
 *
 * Sinematik footer açılınca çubuk kaybolur — iki sabit katman üst üste
 * binmesin diye. Çerez banner'ı `z-modal` olduğu için bunun ÜSTÜNDE kalır.
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
    { key: "business", label: t("navBusiness"), icon: Building2, to: "#partnership" },
  ];

  const isActive = (item) => {
    if (item.key === "business") return nav.isBusinessActive;
    if (item.key === "rates") return nav.isRatesActive;
    return nav.isCompareActive;
  };

  const go = (item) => {
    if (item.key === "business") {
      nav.activateBusiness();
      if (location.pathname === "/") {
        scrollToPartnership();
        return;
      }
      navigate("/#partnership");
      return;
    }
    if (item.key === "rates") {
      nav.activateRates();
      if (location.pathname === "/") {
        scrollToRates();
        return;
      }
      navigate("/");
      return;
    }
    navigate(item.to);
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
              onClick={() => go(item)}
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
            onClick={() => go(items[2])}
            aria-current={isActive(items[2]) ? "page" : undefined}
            className="site-downbar__item"
          >
            <Building2 className="size-4" aria-hidden="true" />
            {t("navBusiness")}
          </button>
        )}

        {hasOffices ? (
          <button
            type="button"
            onClick={() => go(items[2])}
            aria-current={isActive(items[2]) ? "page" : undefined}
            className="site-downbar__item"
          >
            <Building2 className="size-4" aria-hidden="true" />
            {t("navBusiness")}
          </button>
        ) : null}
      </div>
    </nav>
  );
}
