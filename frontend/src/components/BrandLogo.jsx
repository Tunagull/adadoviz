import { Link, useLocation } from "react-router-dom";

/**
 * AdaDöviz marka kimliği — satır içi vektör işaret + gerçek metin kelime markası.
 *
 * ⚠️ TASARIM DÜZELTMESİ: Eski logo `public/adadoviz-logo.svg` idi ve aslında bir
 * vektör değildi — bir bitmap'in otomatik vektörleştirilmiş hâliydi:
 *   · 911 ayrı <path> (elle çizilmiş bir logoda ~10–20 olur)
 *   · 3.52121839 gibi 8 ondalık basamaklı koordinatlar (trace çıktısı imzası)
 *   · viewBox YOK → ölçeklenemiyor, 1690×608'e sabit
 *   · 822 KB — sayfadaki en ağır tek varlık
 *   · açık temada okunur olsun diye brightness/contrast/saturate filtresi
 *     uygulanıyordu; yani logo temaya uymuyor, zorlanıyordu
 *
 * Yenisi: işaret 655 baytlık temiz bir vektör (viewBox'lı, 4 path), kelime markası
 * ise gerçek HTML metni — böylece uygulamanın Inter yazı tipini kullanır, her
 * ekran yoğunluğunda keskin kalır, temaya kendiliğinden uyar ve filtre gerekmez.
 */
function Mark({ className = "" }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="adaBrandMark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#0e7490" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#adaBrandMark)" />
      {/* Karşılıklı akan iki ok — döviz değişiminin evrensel jesti. */}
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 25h22" />
        <path d="M34.5 19.5 40 25l-5.5 5.5" />
        <path d="M46 39H24" opacity=".88" />
        <path d="M29.5 33.5 24 39l5.5 5.5" opacity=".88" />
      </g>
    </svg>
  );
}

export function BrandLogo({ className = "", compact = false }) {
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
      className={`group inline-flex items-center leading-none rounded-control transition-opacity duration-300 hover:opacity-90 ${
        compact ? "gap-2" : "gap-2.5"
      } ${className}`}
    >
      <Mark
        className={`shrink-0 ${
          compact ? "size-8" : "size-9 sm:size-10"
        } transition-transform duration-300 group-hover:scale-[1.04]`}
      />

      {/*
        Kelime markası ağırlık kontrastıyla kuruluyor (renk kontrastıyla değil):
        "Ada" orta ağırlık ve yumuşak ton, "Döviz" kalın ve tam kontrast.
        Renk vurgusunu işaret taşıyor — bu hem gradyanlı metinden daha olgun
        durur hem de kontrast sorunu yaratmaz (bkz. denetim bulgusu A-05).
      */}
      <span
        className={`whitespace-nowrap font-sans tracking-tight ${
          compact ? "text-lg" : "text-xl sm:text-2xl"
        }`}
      >
        <span className="font-medium text-ink-600 dark:text-ink-300">Ada</span>
        <span className="font-extrabold text-ink-900 dark:text-white">Döviz</span>
      </span>
    </Link>
  );
}
