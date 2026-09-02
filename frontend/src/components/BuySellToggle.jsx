import { useLanguage } from "../context/LanguageContext";
import { useTheme } from "../context/ThemeContext";

/**
 * Alış / Satış anahtarı — ThemeToggle ve LanguageToggle ile aynı kayan pill dili.
 * Seçili olmayan taraf mat siyah zemin üzerinde soluk etiket olarak kalır.
 */
export function BuySellToggle({ value = "buy", onChange, className = "" }) {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isSell = value === "sell";
  const isDark = theme === "dark";

  return (
    <div
      className={`relative flex h-11 w-full items-center rounded-full border p-1 transition-colors duration-300 ${
        isDark ? "border-ink-700 bg-ink-950" : "border-ink-200 bg-ink-100"
      } ${className}`}
      role="group"
      aria-label={t("operationType")}
    >
      <span
        aria-hidden="true"
        className={`surface-neon absolute bottom-1 left-1 top-1 w-[calc(50%-0.25rem)] rounded-full transition-transform duration-300 ease-out ${
          isSell ? "translate-x-[calc(100%+0.125rem)]" : "translate-x-0"
        }`}
      />

      <button
        type="button"
        aria-pressed={!isSell}
        onClick={() => onChange?.("buy")}
        className={`relative z-raised flex-1 rounded-full py-2 text-center text-xs font-bold tracking-wide transition-colors duration-300 ${
          !isSell
            ? "text-white dark:text-ink-950"
            : isDark
              ? "text-ink-500"
              : "text-ink-400"
        }`}
      >
        {t("buy")}
      </button>
      <button
        type="button"
        aria-pressed={isSell}
        onClick={() => onChange?.("sell")}
        className={`relative z-raised flex-1 rounded-full py-2 text-center text-xs font-bold tracking-wide transition-colors duration-300 ${
          isSell
            ? "text-white dark:text-ink-950"
            : isDark
              ? "text-ink-500"
              : "text-ink-400"
        }`}
      >
        {t("sell")}
      </button>
    </div>
  );
}

export default BuySellToggle;
