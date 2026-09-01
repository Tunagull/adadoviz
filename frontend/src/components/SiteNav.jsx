import { BarChart3, Building2, LineChart, Tag } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import {
  scrollToPartnership,
  scrollToRates,
  useHomeSectionNav,
} from "../hooks/useHomeSectionNav";

/**
 * Üst başlıktaki ana gezinme: Kurlar / Kıyasla / Paketler / İşletme.
 *
 * "İşletme" ayrı bir sayfa değil, anasayfadaki partnerlik (işletme başvurusu)
 * bölümüdür; anasayfadaysak kaydırır, değilsek anasayfaya dönüp oraya gider.
 * Vurgu kaydırmayı izler: bölümdeyken İşletme, yukarıda Kurlar.
 */
export function SiteNav({ compact = false, className = "" }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const nav = useHomeSectionNav();

  const items = [
    { key: "rates", label: t("navRates"), icon: LineChart, to: "/" },
    { key: "compare", label: t("navCompare"), icon: BarChart3, to: "/kiyasla" },
    { key: "pricing", label: t("navPricing"), icon: Tag, to: "/paketler" },
    { key: "business", label: t("navBusiness"), icon: Building2, to: "#partnership" },
  ];

  const isActive = (item) => {
    if (item.key === "business") return nav.isBusinessActive;
    if (item.key === "rates") return nav.isRatesActive;
    if (item.key === "compare") return nav.isCompareActive;
    if (item.key === "pricing") return nav.isPricingActive;
    return false;
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

  return (
    <nav
      aria-label={
        t("navRates") +
        " / " +
        t("navCompare") +
        " / " +
        t("navPricing") +
        " / " +
        t("navBusiness")
      }
      className={`hidden items-center gap-1 md:flex ${className}`}
    >
      {items.map((item) => {
        const active = isActive(item);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => go(item)}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full font-medium transition-all duration-300 ${
              compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
            } ${
              active
                ? "surface-neon shadow-sm"
                : "text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-white/5 dark:hover:text-ink-100"
            }`}
          >
            <item.icon className={compact ? "size-3.5" : "size-4"} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
