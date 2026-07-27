import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  
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
