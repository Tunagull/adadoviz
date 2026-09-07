import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";

/**
 * Shared TR/EN + Light/Dark controls for dashboard and admin headers.
 *
 * `compact` sürüm çoğunlukla modal/overlay başlıklarında, mutlak konumda,
 * başlığın yanında duruyor. Dar telefon ekranında (< sm) tema + dil hapları
 * modal başlığının üstüne biniyordu (bkz. mobil denetim). O bağlamda
 * gizleniyor — kontroller zaten modalın ARKASINDAKİ sayfa başlığında var.
 * Bir SAYFA başlığında compact kullanılıyorsa (tek erişim noktası) `alwaysShow`
 * ile geri açılır.
 */
export function HeaderActions({ className = "", compact = false, alwaysShow = false }) {
  return (
    <div
      className={`flex items-center rounded-full border border-ink-300 bg-white/80 transition-all duration-300 dark:border-white/10 dark:bg-ink-950/60 ${
        compact ? "gap-1 p-0.5" : "gap-1.5 p-0.5"
      } ${compact && !alwaysShow ? "max-sm:hidden" : ""} ${className}`}
    >
      {/* Tema anahtarı ayrı bir bileşene taşındı (kayan pill tasarımı). */}
      <ThemeToggle compact={compact} />
      {/* Dil anahtarı da tema anahtarıyla aynı kayan pill yapısında. */}
      <LanguageToggle compact={compact} />
    </div>
  );
}
