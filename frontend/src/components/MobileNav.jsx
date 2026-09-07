import { useState } from "react";
import {
  BarChart3,
  Building2,
  LineChart,
  LogIn,
  LogOut,
  Mail,
  MapPinned,
  Menu as MenuIcon,
  Tag,
  Trophy,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useHomeSectionNav } from "../hooks/useHomeSectionNav";
import { Sheet } from "./Sheet";

/**
 * Mobil başlık gezinmesi (`md` altında).
 *
 * `SiteNav` telefonda gizli — bu yüzden başlıktan hiçbir sayfaya geçilemiyor
 * ve "İşletme Girişi" yalnızca ana sayfada görünüyordu. Bu hamburger, her
 * sayfanın başlığında durur: alttan açılan sheet'te 6 gezinme hedefi + giriş
 * / panel / çıkış aksiyonları.
 */
export function MobileNav({ className = "" }) {
  const { t } = useLanguage();
  const nav = useHomeSectionNav();
  const navigate = useNavigate();
  const { isAuthenticated, isSuperAdmin, logout, openLoginModal } = useAuth();
  const [open, setOpen] = useState(false);

  const links = [
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

  const rowBase =
    "flex w-full items-center gap-3 rounded-control px-3 py-3 text-sm font-medium transition-colors duration-base ease-out";

  return (
    <div className={`md:hidden ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("navMenuTitle")}
        className="inline-flex size-10 items-center justify-center rounded-full border border-ink-300 bg-white text-ink-700 transition-colors hover:text-ink-950 dark:border-white/10 dark:bg-ink-950/60 dark:text-ink-200 dark:hover:text-white"
      >
        <MenuIcon className="size-5" aria-hidden="true" />
      </button>

      <Sheet open={open} onOpenChange={setOpen} title={t("navMenuTitle")}>
        <nav className="flex flex-col gap-1 py-1">
          {links.map((item) => (
            <Link
              key={item.key}
              to={item.to}
              onClick={() => setOpen(false)}
              aria-current={item.active ? "page" : undefined}
              className={`${rowBase} ${
                item.active
                  ? "surface-neon"
                  : "text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-white/5"
              }`}
            >
              <item.icon className="size-5 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          ))}

          <div className="my-2 h-px bg-ink-200 dark:bg-white/10" />

          {isAuthenticated ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(isSuperAdmin ? "/super-admin" : "/admin");
                }}
                className={`${rowBase} text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-white/5`}
              >
                <Building2 className="size-5 shrink-0" aria-hidden="true" />
                {isSuperAdmin ? t("adminPanel") : t("businessPanel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  logout();
                  navigate("/");
                }}
                className={`${rowBase} text-danger-700 hover:bg-danger-500/10 dark:text-danger-300`}
              >
                <LogOut className="size-5 shrink-0" aria-hidden="true" />
                {t("logout")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openLoginModal();
              }}
              className={`${rowBase} text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-white/5`}
            >
              <LogIn className="size-5 shrink-0" aria-hidden="true" />
              {t("businessLogin")}
            </button>
          )}
        </nav>
      </Sheet>
    </div>
  );
}

export default MobileNav;
