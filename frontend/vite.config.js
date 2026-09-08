import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  resolve: {
    dedupe: ["react", "react-dom", "react-is", "clsx"],
  },

  /**
   * MapLibre GL, tile ayrıştırmasını bir web worker'a devrediyor. Vite'in dep
   * optimizer'ı bu worker girişini (`maplibre-gl-worker.mjs`) bozup dev'de
   * haritanın döşeme çekmemesine yol açıyor. Hariç tutulunca Vite paketi
   * olduğu gibi (ESM) sunuyor ve worker düzgün çözülüyor. Prod build etkilenmez.
   */
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },

  /**
   * ⚠️ OPTİMİZASYON (O-01): Ana paket 993 kB / 297 kB gzip'e çıkmıştı ve Vite
   * açıkça uyarıyordu ("Some chunks are larger than 500 kB"). Satıcı
   * kütüphaneleri tek bir dosyada toplanıyordu; bu hem ilk yüklemeyi tek büyük
   * indirmeye bağlıyor hem de uygulama kodundaki her küçük değişiklikte
   * kullanıcının TÜM satıcı kodunu yeniden indirmesine yol açıyordu.
   *
   * Satıcılar rol bazında ayrıldı: React çekirdeği neredeyse hiç değişmez,
   * grafik/harita/takvim kütüphaneleri ise yalnızca ilgili ekranlarda gerekir.
   * Böylece paralel indirme ve uzun ömürlü önbellek elde edilir.
   */
  build: {
    rollupOptions: {
      output: {
        /*
          ⚠️ Rolldown'ın `manualChunks` FONKSİYON biçimi, CJS ile sarmalanan
          çekirdek modüller (react/react-dom `require()` sarmalayıcıları) için
          dönüş değerini yok sayıyor: React çekirdeği recharts'la aynı yığına
          düşüyor ve o 113 kB'lık yığın `lazy()` grafiğe rağmen ana sayfada
          preload'a giriyordu. Rolldown'ın yerel `advancedChunks` API'si bu
          sarmalayıcıları da doğru gruba alıyor.
        */
        advancedChunks: {
          groups: [
            {
              name: "vendor-react",
              test: /[\\/]node_modules[\\/](react|react-dom|react-is|scheduler|clsx|prop-types|react-router|react-router-dom|react-helmet-async|react-fast-compare|shallowequal|invariant|object-assign|use-sync-external-store)[\\/]/,
              priority: 100,
            },
            {
              name: "vendor-icons",
              test: /[\\/]node_modules[\\/]lucide-react[\\/]/,
              priority: 90,
            },
            {
              name: "vendor-charts",
              test: /[\\/]node_modules[\\/](recharts|d3-|victory-|internmap|delaunator|robust-predicates)[\\/]/,
              priority: 80,
            },
            {
              name: "vendor-motion",
              test: /[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/,
              priority: 80,
            },
            {
              name: "vendor-datepicker",
              test: /[\\/]node_modules[\\/](react-day-picker|date-fns)[\\/]/,
              priority: 80,
            },
            /*
             * MapLibre GL'i ELLE gruplama! Ayrı `maplibre-gl-worker.mjs`
             * asset'ini `new URL(..., import.meta.url)` ile üretiyor; manuel
             * chunk'a alınca bundler o worker dosyasını EMIT ETMİYOR → prod'da
             * döşemeler sessizce yüklenmiyor (worker 404 → index.html). Rolldown
             * kendi böler; /harita zaten lazy route, yine ayrı chunk'a düşer.
             */
            {
              name: "vendor-map",
              test: /[\\/]node_modules[\\/](leaflet|react-leaflet)[\\/]/,
              priority: 80,
            },
          ],
        },
      },
    },
  },


  /**
   * ✅ ADIM 1: Vite Proxy Configuration
   * 
   * Frontend'in (Vite dev server: localhost:5173) /api isteklerini
   * backend sunucusuna (localhost:5000) yönlendir.
   * 
   * Example:
   * Frontend: fetch('/api/historical-rates?period=Günlük&currency=USD')
   * → Proxy: http://localhost:5000/api/historical-rates?period=Günlük&currency=USD
   */
  server: {
    proxy: {
      // ✅ /api ile başlayan tüm istekler backend'e yönlendir
      '/api': {
        target: 'http://localhost:5000',  // Backend sunucusu
        changeOrigin: true,               // CORS header'larını düzelt
        rewrite: (path) => path,          // Path'i olduğu gibi ilet
        ws: true,                         // WebSocket desteği (SSE için)
        timeout: 30000,                   // 30 saniye timeout
        proxyTimeout: 30000,              // Proxy timeout
      }
    }
  }
})
