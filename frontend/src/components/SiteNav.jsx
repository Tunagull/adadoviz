import { BarChart3, LineChart, Mail, Tag } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { useHomeSectionNav } from "../hooks/useHomeSectionNav";

/**
 * Üst başlıktaki ana gezinme: Kurlar / Kıyasla / Paketler / İletişim.
 * Her sekme kendi sayfasına gider.
 */
export function SiteNav({ compact = false, className = "" }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const nav = useHomeSectionNav();

  const items = [
    { key: "rates", label: t("navRates"), icon: LineChart, to: "/" },
    { key: "compare", label: t("navCompare"), icon: BarChart3, to: "/kiyasla" },
    { key: "pricing", label: t("navPricing"), icon: Tag, to: "/paketler" },
    { key: "contact", label: t("navContact"), icon: Mail, to: "/iletisim" },
  ];

  const isActive = (item) => {
    if (item.key === "contact") return nav.isContactActive;
    if (item.key === "rates") return nav.isRatesActive;
    if (item.key === "compare") return nav.isCompareActive;
    if (item.key === "pricing") return nav.isPricingActive;
    return false;
  };

  return (
    <nav
      aria-label={
        t("navRates") + " / " + t("navCompare") + " / " + t("navPricing") + " / " + t("navContact")
      }
      className={`hidden items-center gap-1 md:flex ${className}`}
    >
      {items.map((item) => {
        const active = isActive(item);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => navigate(item.to)}
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
