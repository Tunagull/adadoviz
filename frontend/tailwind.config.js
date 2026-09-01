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
        /**
         * ⚠️ TASARIM DÜZELTMESİ (D-20): Palet KİMLİKSİZDİ. Roller doğru
         * ayrılmıştı ama her hex değeri Tailwind'in stok paletinden geliyordu —
         * cyan-500 vurgu, slate nötr, emerald/amber/red semantik. "Şablondan
         * çıkmış" hissinin kaynağı buydu: yapı vardı, seçim yoktu.
         *
         * Ayrıca ölçülebilir bir erişilebilirlik hatası vardı: birincil buton
         * `bg-brand-gradient` ile çiziliyor ve gradyan #06b6d4'ten başlıyordu.
         * Beyaz metin o uçta 2.43 kontrast veriyor — AA sınırı 4.5. Yani
         * uygulamanın en çok tıklanan öğesinin sol yarısı okunabilirlik
         * testinden kalıyordu.
         *
         * Yeni vurgu: derin deniz mavisi-teal. Elektrik cyan'ın aksine
         * doygunluğu düşük, kurumsal ve KKTC bağlamına (Akdeniz) bağlı.
         * brand-600 üzerine beyaz = 6.70, brand-700 beyaz üzerine = 8.61.
         * Yeşil (success) ile karışmaz çünkü belirgin biçimde mavidir.
         */
        brand: {
          50: "#f0f7f9",
          100: "#dcebf0",
          200: "#b9d8e2",
          300: "#8dbccc",
          400: "#5697ae",
          500: "#2f7b95",
          600: "#22637a",
          700: "#1d5263",
          800: "#1b4453",
          900: "#193a46",
          950: "#102630",
        },

        /**
         * Nötr — soğuk slate yerine hafif sıcak, düşük kromalı gri. Slate,
         * mavi yanı yüzünden vurgu rengiyle yarışıyor ve her arayüzde
         * görüldüğü için tanınmıyordu. Sıcak nötr, mavi vurguyu karşısına
         * alarak onu daha kasıtlı gösterir.
         *
         * Açıklık değerleri bilinçli olarak slate'e yakın tutuldu; böylece
         * mevcut kontrast ilişkileri korunuyor (ink-900/beyaz 17.57,
         * ink-600/beyaz 7.09, ink-400/ink-900 6.83 — hepsi AA).
         */
        ink: {
          50: "#faf9f8",
          100: "#f3f2f0",
          200: "#e6e4e0",
          300: "#d2cfc9",
          400: "#a5a19a",
          500: "#78746c",
          600: "#5b5852",
          700: "#46443f",
          800: "#2c2b28",
          900: "#1a1917",
          950: "#0e0e0c",
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

      /**
       * D-01: TEK marka gradyanı (eski 5 varyantın yerine).
       *
       * D-20: Gradyan #06b6d4'ten başlıyordu ve beyaz metin o uçta AA'da
       * kalıyordu (2.43). Artık iki uç da yeterince koyu — beyaz metin en
       * açık noktada bile 6.70 kontrast alıyor. Aralık ayrıca daraltıldı:
       * geniş açıklık farkı olan gradyan, düz renge göre daha "şablon"
       * görünüyordu; bu hâli neredeyse düz bir yüzey gibi okunur.
       */
      backgroundImage: {
        "brand-gradient": "linear-gradient(90deg, #22637a 0%, #1b4453 100%)",
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
