import { ThemeToggle } from "./ThemeToggle";
import { useLanguage } from "../context/LanguageContext";

/**
 * Shared TR/EN + Light/Dark controls for dashboard and admin headers.
 */
export function HeaderActions({ className = "", compact = false }) {
  const { lang, toggleLang, t } = useLanguage();

  return (
    <div
      className={`flex items-center rounded-full border border-ink-300 bg-white/80 transition-all duration-300 dark:border-white/10 dark:bg-ink-950/60 ${
        compact ? "gap-1 p-0.5" : "gap-1.5 p-0.5"
      } ${className}`}
    >
      {/* Tema anahtarı ayrı bir bileşene taşındı (kayan pill tasarımı). */}
      <ThemeToggle compact={compact} />
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleLang();
        }}
        className={`inline-flex items-center justify-center rounded-full font-bold tracking-wide text-ink-700 transition-all duration-300 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800 ${
          compact ? "h-9 min-w-[3rem] px-2 text-[11px]" : "min-h-[2.75rem] min-w-[3.5rem] px-2.5 text-xs"
        }`}
        title="TR / EN"
        aria-label="Language"
      >
        <span className={lang === "tr" ? "text-brand-700 dark:text-brand-300" : "text-ink-600 dark:text-ink-400"}>
          {t("langTr")}
        </span>
        <span className="mx-0.5 text-ink-400" aria-hidden="true">|</span>
        <span className={lang === "en" ? "text-brand-700 dark:text-brand-300" : "text-ink-600 dark:text-ink-400"}>
          {t("langEn")}
        </span>
      </button>
    </div>
  );
}
