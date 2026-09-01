import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";

/**
 * Shared TR/EN + Light/Dark controls for dashboard and admin headers.
 */
export function HeaderActions({ className = "", compact = false }) {
  return (
    <div
      className={`flex items-center rounded-full border border-ink-300 bg-white/80 transition-all duration-300 dark:border-white/10 dark:bg-ink-950/60 ${
        compact ? "gap-1 p-0.5" : "gap-1.5 p-0.5"
      } ${className}`}
    >
      {/* Tema anahtarı ayrı bir bileşene taşındı (kayan pill tasarımı). */}
      <ThemeToggle compact={compact} />
      {/* Dil anahtarı da tema anahtarıyla aynı kayan pill yapısında. */}
      <LanguageToggle compact={compact} />
    </div>
  );
}
