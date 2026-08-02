import { Link, useLocation } from "react-router-dom";

/**
 * AdaDöviz marka logosu — public/adadoviz-logo.svg
 * Dark: orijinal renkler | Light: kontrast için hafif filtre
 */
export function BrandLogo({ className = "", imgClassName = "", compact = false }) {
  const location = useLocation();

  const handleClick = (e) => {
    if (location.pathname === "/") {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <Link
      to="/"
      onClick={handleClick}
      aria-label="AdaDöviz — Ana Sayfa"
      className={`inline-flex items-center leading-none rounded-lg transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 ${className}`}
    >
      <img
        src="/adadoviz-logo.svg"
        alt="AdaDöviz"
        width={compact ? 150 : 260}
        height={compact ? 44 : 80}
        decoding="async"
        className={`block w-auto max-w-[42vw] shrink-0 object-contain object-left transition-all duration-300 hover:opacity-90 brightness-[0.88] contrast-[1.12] saturate-[1.08] dark:brightness-100 dark:contrast-100 dark:saturate-100 sm:max-w-none ${
          compact
            ? "-my-0.5 h-9 sm:h-11"
            : "-my-1.5 h-12 sm:-my-2.5 sm:h-[4.5rem] md:-my-3 md:h-[5rem]"
        } ${imgClassName}`}
      />
    </Link>
  );
}
