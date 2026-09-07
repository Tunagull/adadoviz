import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>,
)

/*
  PWA service worker — yalnızca production derlemesinde. Dev'de kayıt YAPMA:
  Vite HMR ile SW önbelleği çakışır, "neden eski kodu görüyorum" tuzağı doğar.
*/
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* kayıt başarısızsa uygulama yine çalışır */
    })
  })
}
