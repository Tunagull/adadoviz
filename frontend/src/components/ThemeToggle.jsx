import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";

/**
 * Açık/koyu tema anahtarı — kayan pill tasarımı.
 *
 * Kaynak `theme-toggle` bileşeninden alındı, bu projeye uyarlandı:
 *
 *   · TSX arayüzü → JSX (projede TypeScript yok)
 *   · "use client" kaldırıldı (Next.js direktifi; burada Vite + React Router var)
 *   · `cn()` / `@/lib/utils` yok → şablon dizesi (tailwind-merge kurulu değil)
 *   · zinc/gray renkleri → ink/brand token'ları (tailwind.config.js)
 *
 * Kaynaktaki iki gerçek hata da düzeltildi:
 *
 *   1) Bileşen kendi `useState(true)`'sunu tutuyordu — yani temayı GERÇEKTEN
 *      değiştirmiyordu, sadece kendi içinde animasyon oynatan sahte bir
 *      kontroldü. Artık uygulamanın `useTheme()` bağlamına bağlı.
 *
 *   2) `<div role="button" tabIndex={0}>` yalnızca `onClick` taşıyordu:
 *      klavyeyle odaklanılabiliyor ama Space/Enter ile çalışmıyordu; erişilebilir
 *      adı da yoktu. Artık gerçek bir `<button role="switch" aria-checked>` —
 *      klavye davranışı tarayıcıdan geliyor (denetim bulguları A-01 / A-02).
 */
export function ThemeToggle({ className = "", compact = false }) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useLanguage();

  const isDark = theme === "dark";
  const label = isDark ? t("themeLight") : t("themeDark");

  // Pill görsel olarak 56×28 (compact) / 64×32; dokunma hedefi ise 44px (A-06).
  const pill = compact ? "h-7 w-14" : "h-8 w-16";
  const knob = compact ? "size-5" : "size-6";
  const icon = compact ? "size-3" : "size-3.5";
  const shift = compact ? "translate-x-7" : "translate-x-8";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleTheme();
      }}
      /*
        ⚠️ DÜZELTME: Önceki sürüm dış butona hover'da kenarlık+arka plan
        ekliyordu — bu Saatlik/Günlük/Haftalık'ın (SlidingTabs) yaptığı şey
        değil. SlidingTabs'ta zemin/kenarlık hiç değişmiyor, yalnızca metin
        soluktan tam kontrasta geçiyor. Buradaki karşılığı: sönük ikon
        (`group-hover` ile aşağıda).

        Basma geri bildirimi ayrıca YAZILMIYOR: sitedeki her buton için zaten
        `transform 160ms ease-out-strong` + `:active scale-97` otomatik
        uygulanıyor (M-04, index.css). Kendim tekrar tanımlasaydım AYNI
        değerlere çıkardı — gereksiz tekrar.
      */
      className={`group inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-1 ${className}`}
    >
      <span
        className={`relative flex items-center rounded-full border transition-colors duration-300 ${pill} ${
          isDark ? "border-ink-700 bg-ink-950" : "border-ink-200 bg-white"
        }`}
      >
        {/*
          Sönük ikon — hangi temaya geçileceğini gösterir. Hover'da SlidingTabs
          pasif sekmesiyle AYNI davranış: soluk renk tam kontrasta geçiyor
          (`group-hover`, 200ms `ease-out`), zemin/kenarlık değişmiyor.
        */}
        <span
          className={`pointer-events-none absolute flex items-center justify-center transition-all duration-300 ${knob} ${
            isDark ? `left-1 ${shift}` : "left-1"
          }`}
        >
          {isDark ? (
            <Sun
              className={`${icon} text-ink-500 transition-colors duration-base ease-out group-hover:text-white`}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          ) : (
            <Moon
              className={`${icon} text-ink-500 dark:text-ink-400 transition-colors duration-base ease-out group-hover:text-ink-950`}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          )}
        </span>

        {/* Kayan topuz */}
        <span
          className={`absolute left-1 flex items-center justify-center rounded-full transition-transform duration-300 ease-out ${knob} ${
            /* (beyaz neon) Aydınlık taraftaki topuz vurgu rengiyle (magenta)
               doluyordu; palette artık renkli vurgu yok, topuz mat siyah. */
            isDark ? "translate-x-0 bg-ink-800" : `${shift} bg-ink-950`
          }`}
        >
          {isDark ? (
            <Moon className={`${icon} text-white`} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Sun className={`${icon} text-white`} strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
      </span>
    </button>
  );
}

export default ThemeToggle;
