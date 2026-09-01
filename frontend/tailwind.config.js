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
         * ⚠️ TASARIM YÖNÜ (mat siyah + beyaz neon): Vurgunun artık RENK TONU
         * YOK. Önce teal, sonra magenta denendi; ikisi de mat siyah + beyaz
         * neon dilinin içinde yabancı kaldı — ekranda "siyah, beyaz ve bir de
         * pembe" diye üçüncü bir ses oluyordu.
         *
         * Vurgu artık PARLAKLIKLA yapılıyor: nötr grafit ölçeği taşıyıcı,
         * dikkat çekmesi gereken öğe beyaza çıkıp ışıyor (bkz. `.surface-neon`
         * ve `shadow-neon`). Renk yalnızca semantik rollerde kaldı — yeşil
         * yükseldi, kırmızı düştü, amber uyarı. Böylece ekranda renk gördüğün
         * her yer bir ANLAM taşıyor.
         *
         * Ölçek, eski markanın açıklık yapısını korur; dolayısıyla mevcut
         * eşleşmeler geçerli kalıyor:
         *   brand-500 (#6f6f7b) üzerine beyaz  → 4.92 (topuz, rozet)
         *   brand-600 (#55555f) üzerine beyaz  → 7.02
         *   brand-700 (#41414a) beyaz üzerine  → 9.42
         *   brand-300 (#c2c2ca) ink-900 üstünde → 8.98
         */
        brand: {
          50: "#f6f6f7",
          100: "#ebebee",
          200: "#dcdce1",
          300: "#c2c2ca",
          400: "#9d9da8",
          500: "#6f6f7b",
          600: "#55555f",
          700: "#41414a",
          800: "#33333a",
          900: "#26262c",
          950: "#16161a",
        },

        /**
         * Nötr — MAT SİYAH ölçeği. Eski nötr hafif sıcak griydi (#1a1917 gibi
         * kahve yanı olan tonlar); saf siyah zeminde bu sıcaklık "eski kağıt"
         * gibi okunuyor ve neon vurgunun altını oyuyordu. Yeni ölçek kromadan
         * arındırılmış: koyu uç mat siyah, açık uç nötr beyaz-gri.
         *
         * Kontrast ilişkileri korundu veya iyileşti:
         *   ink-900 (#16161a) / beyaz  → 17.9
         *   ink-600 (#4f4f57) / beyaz  → 7.75
         *   ink-400 (#97979f) / ink-950 → 8.4
         */
        ink: {
          50: "#f7f7f8",
          100: "#eeeef0",
          200: "#e0e0e3",
          300: "#c9c9ce",
          400: "#97979f",
          500: "#6b6b74",
          600: "#4f4f57",
          700: "#2f2f35",
          800: "#1e1e22",
          900: "#16161a",
          950: "#08080a",
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
        card: "0 1px 2px rgba(8,8,10,.06), 0 8px 24px -12px rgba(8,8,10,.18)",
        /**
         * Mat siyah zeminde gölge iş görmez — siyah üstüne siyah görünmez.
         * Karanlık kart bu yüzden gölge yerine üstten ince bir ışık çizgisiyle
         * (inset) zeminden ayrılır; derinlik hissini o veriyor.
         */
        "card-dark":
          "inset 0 1px 0 rgba(255,255,255,.06), 0 1px 2px rgba(0,0,0,.6), 0 16px 40px -24px rgba(0,0,0,.9)",
        focus: "0 0 0 3px rgba(255,255,255,.35)",
        /**
         * Beyaz neon ışıma — aktif/birincil yüzeyler için. İki katman: yüzeye
         * oturan sıkı halka + duvara vuran geniş saçılma. Tek geniş gölge
         * yazmak ışık değil bulanıklık verir.
         */
        neon: "0 0 0 1px rgba(255,255,255,.5), 0 0 20px -4px rgba(255,255,255,.45), 0 0 44px -12px rgba(255,255,255,.3)",
      },

      /**
       * D-01: TEK marka gradyanı (eski 5 varyantın yerine).
       *
       * D-20: Gradyan #06b6d4'ten başlıyordu ve beyaz metin o uçta AA'da
       * kalıyordu (2.43). Artık iki uç da yeterince koyu — beyaz metin en
       * açık noktada bile 7.02 kontrast alıyor. Aralık ayrıca daraltıldı:
       * geniş açıklık farkı olan gradyan, düz renge göre daha "şablon"
       * görünüyordu; bu hâli neredeyse düz bir yüzey gibi okunur.
       *
       * (beyaz neon) Gradyan nötr grafite döndü. Bu token 9 yerde SABİT
       * `text-white` ile eşleşiyor; beyaza çevirmek beyaz üstüne beyaz metin
       * demek olurdu. En görünür yerlerde (aktif sekme, topuz, birincil
       * buton) grafit yüzey yerine `.surface-neon` kullanılıyor.
       */
      backgroundImage: {
        "brand-gradient": "linear-gradient(90deg, #55555f 0%, #3a3a42 100%)",
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
