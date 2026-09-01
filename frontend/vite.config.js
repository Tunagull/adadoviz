import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

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
          NOT: Vite 8 rolldown kullanıyor ve `manualChunks`'ı nesne değil
          FONKSİYON olarak bekliyor ("Expected Function but received Object").
        */
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id))
            return "vendor-react";
          if (/[\\/]node_modules[\\/](recharts|d3-|victory-|internmap|delaunator|robust-predicates)/.test(id))
            return "vendor-charts";
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id))
            return "vendor-motion";
          if (/[\\/]node_modules[\\/](react-day-picker|date-fns)[\\/]/.test(id))
            return "vendor-datepicker";
          if (/[\\/]node_modules[\\/](leaflet|react-leaflet)[\\/]/.test(id))
            return "vendor-map";
          return undefined;
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
