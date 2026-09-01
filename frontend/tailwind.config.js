/**
 * AdaDöviz tasarım sistemi.
 *
 * ⚠️ TASARIM DÜZELTMESİ (denetim bulgusu D-03): Bu dosyada daha önce YALNIZCA
 * fontFamily tanımlıydı — renk, aralık, gölge, yarıçap ve katman ölçeği yoktu.
 * Dolayısıyla teknik olarak bir "marka rengi" mevcut değildi ve her bileşen
 * Tailwind'in ham paletinden kendi seçimini yapıyordu. Ölçüm sonucu:
 *   · 10 renk ailesi (cyan+teal+indigo+blue hepsi "vurgu", rose+red "tehlike")
 *   · 5 farklı "ana buton" gradyanı (biri diğerinin ters yönü)
 *   · 5 yarıçap, 11 farklı z-index (z-[9999], z-[10000], z-[2000] …)
 *
 * Kural: bileşenler artık `bg-cyan-500` değil `bg-brand-500`, `z-[9999]` değil
 * `z-modal` yazar. Rol başına TEK renk vardır.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],

  /**
   * ⚠️ HAREKET DÜZELTMESİ (M-03): Dokunmatik cihazda `hover:` sınıfları
   * dokunuşta tetiklenir ve parmak kalktıktan sonra da EKRANDA KALIR — kart
   * vurgulu, buton renkli takılı kalır. Kod tabanında 200'den fazla `hover:`
   * kullanımı vardı ve hiçbiri işaretçi tipine göre korunmuyordu.
   *
   * Bu bayrak her `hover:` yardımcı sınıfını `@media (hover: hover)` içine
   * alır; tek tek dosya düzenlemeden tüm uygulamayı düzeltir.
   */
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Segoe UI", "Tahoma", "Geneva", "Verdana", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },

      colors: {
        /** Marka / vurgu — TEK aile. Eski cyan·teal·indigo·blue karmaşasının yerine. */
        brand: {
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
          700: "#0e7490",
          800: "#155e75",
          900: "#164e63",
        },
        /** Nötr — TEK aile (slate tabanlı). `gray-*` kullanımı kaldırıldı. */
        ink: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },
        /** Semantik roller — vurgudan bağımsız, rol başına tek renk. */
        success: {
          50: "#ecfdf5",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
        },
        warning: {
          50: "#fffbeb",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
        },
        danger: {
          50: "#fef2f2",
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
        },
      },

      /** D-05: keyfi z-[9999] / z-[10000] yerine anlamlı katman ölçeği. */
      zIndex: {
        base: "0",
        raised: "10",
        sticky: "100",
        dropdown: "200",
        overlay: "300",
        modal: "400",
        toast: "500",
      },

      borderRadius: {
        card: "0.875rem",
        control: "0.5rem",
      },

      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,.06), 0 8px 24px -12px rgba(15,23,42,.18)",
        "card-dark": "0 1px 2px rgba(0,0,0,.4), 0 8px 24px -12px rgba(0,0,0,.6)",
        focus: "0 0 0 3px rgba(6,182,212,.35)",
      },

      /** D-01: TEK marka gradyanı (eski 5 varyantın yerine). */
      backgroundImage: {
        "brand-gradient": "linear-gradient(90deg, #06b6d4 0%, #0e7490 100%)",
      },

      /**
       * ⚠️ HAREKET DÜZELTMESİ (M-01): Kod tabanında tanımlı TEK BİR özel easing
       * eğrisi yoktu; her geçiş Tailwind'in varsayılan
       * `cubic-bezier(0.4, 0, 0.2, 1)` eğrisini kullanıyordu. Varsayılan
       * eğriler zayıftır — hareketi kasıtlı hissettiren "tokat" yoktur.
       *
       * Kullanım kuralı:
       *   giren/çıkan öğe (dropdown, toast, modal) → ease-out-strong
       *   ekranda yer/şekil değiştiren öğe          → ease-in-out-strong
       *   çekmece / bottom sheet                    → ease-drawer
       *   hover ve renk geçişi                      → varsayılan `ease`
       *
       * `ease-in` BİLİNÇLİ OLARAK YOK: yavaş başladığı için arayüzü ağır
       * hissettirir ve kullanıcının en dikkatli baktığı ilk anı geciktirir.
       */
      transitionTimingFunction: {
        "out-strong": "cubic-bezier(0.23, 1, 0.32, 1)",
        "in-out-strong": "cubic-bezier(0.77, 0, 0.175, 1)",
        drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
      },

      /**
       * Süre ölçeği. Kural: arayüz animasyonları 300 ms'in ALTINDA kalır.
       * Ölçüm: kod tabanında 300 ms ve üzeri 57 süre kullanımı vardı.
       */
      transitionDuration: {
        press: "100ms",
        instant: "125ms",
        fast: "160ms",
        base: "200ms",
        slow: "260ms",
      },
    },
  },
  plugins: [],
};
