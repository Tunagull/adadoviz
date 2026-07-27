import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";

/**
 * Shared TR/EN + Light/Dark controls for dashboard and admin headers.
 */
export function HeaderActions({ className = "", compact = false }) {
  const { theme, toggleTheme } = useTheme();
  const { lang, toggleLang, t } = useLanguage();

  return (
    <div
      className={`flex items-center rounded-full border border-slate-300 bg-white/80 transition-all duration-300 dark:border-white/10 dark:bg-slate-950/60 ${
        compact ? "gap-1 p-0.5" : "gap-1.5 p-0.5"
      } ${className}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleTheme();
        }}
        className={`inline-flex items-center justify-center rounded-full text-slate-600 transition-all duration-300 hover:bg-slate-100 hover:text-amber-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-amber-300 ${
          compact ? "size-7" : "size-8"
        }`}
        title={theme === "dark" ? t("themeLight") : t("themeDark")}
        aria-label={theme === "dark" ? t("themeLight") : t("themeDark")}
      >
        {theme === "dark" ? <Sun className={compact ? "size-3.5" : "size-4"} /> : <Moon className={compact ? "size-3.5" : "size-4"} />}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleLang();
        }}
        className={`inline-flex items-center justify-center rounded-full font-bold tracking-wide text-slate-700 transition-all duration-300 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 ${
          compact ? "h-7 min-w-[2.75rem] px-1.5 text-[10px]" : "h-8 min-w-[3.25rem] px-2 text-[11px]"
        }`}
        title="TR / EN"
        aria-label="Language"
      >
        <span className={lang === "tr" ? "text-teal-600 dark:text-teal-300" : "text-slate-400"}>
          {t("langTr")}
        </span>
        <span className="mx-0.5 text-slate-400">|</span>
        <span className={lang === "en" ? "text-teal-600 dark:text-teal-300" : "text-slate-400"}>
          {t("langEn")}
        </span>
      </button>
    </div>
  );
}
