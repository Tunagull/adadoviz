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
            /*
              ⚠️ DÜZELTME: Bir önceki sürüm hover'da kendi uydurduğum bir
              kenarlık+arka plan katmanı ekliyordu — SlidingTabs'ın (Piyasa
              Özeti / Saatlik-Günlük-Haftalık) GERÇEK hover'ı bu değil.
              Kaynağı tekrar okudum: `.sliding-tabs__tab:hover` yalnızca
              `color`'ı değiştiriyor (soluktan tam kontrasta), 200ms
              `ease-out`, ne kenarlık ne zemin. Aynısı burada.

              `data-no-press`: sitede HER buton için otomatik bir
              `transition: transform 160ms ...` kuralı var (M-04,
              `:where(button):not([data-no-press])`). `:not()` zincirinin
              özgüllüğü tek bir class'tan yüksek çıkıyor ve rengi HİÇ
              GEÇİŞSİZ bırakıyordu (ölçtüm: computed `transitionProperty`
              hep "transform" çıkıyordu) — o kuraldan opt-out oluyoruz,
              kendi geçişimizi `transition-[color,transform]` ile
              tanımlıyoruz.
            */
            data-no-press
            className={`inline-flex items-center gap-1.5 rounded-full font-medium transition-[color,transform] duration-base ease-out active:scale-[0.97] ${
              compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
            } ${
              active
                ? "surface-neon shadow-sm"
                : "text-ink-600 hover:text-ink-950 dark:text-ink-300 dark:hover:text-white"
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
