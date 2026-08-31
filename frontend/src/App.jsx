import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { LanguageProvider } from "./context/LanguageContext";
import { V0FinancialDashboard } from "./components/V0FinancialDashboard";
import { Footer } from "./components/Footer";
import { CookieConsent } from "./components/CookieConsent";
import { SeoHead } from "./components/SeoHead";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ModalA11yGuard } from "./components/ModalA11yGuard";

/**
 * ⚠️ PERFORMANS DÜZELTMESİ (denetim bulgusu P-01): Uygulama tek parça
 * derleniyordu — 1.115 KB ham / 313 KB gzip, sıfır kod bölme. Yani dolar kuruna
 * bakmak için gelen müşteri, SuperAdminDashboard (2.920 satır) ve
 * InstitutionAdminPage (2.866 satır) dahil iki admin panelini de indiriyordu.
 *
 * Admin rotaları artık talep üzerine yükleniyor.
 */
const InstitutionAdminPage = lazy(() =>
  import("./pages/InstitutionAdminPage").then((m) => ({ default: m.InstitutionAdminPage }))
);
const SuperAdminDashboard = lazy(() =>
  import("./pages/SuperAdminDashboard").then((m) => ({ default: m.SuperAdminDashboard }))
);
const ExchangeOfficePage = lazy(() =>
  import("./pages/ExchangeOfficePage").then((m) => ({ default: m.ExchangeOfficePage }))
);
const ResetPasswordPage = lazy(() =>
  import("./pages/ResetPassword").then((m) => ({ default: m.ResetPasswordPage }))
);

/** Rotalar arası geçişte kısa bekleme durumu. */
function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
      <span className="text-sm text-ink-500 dark:text-ink-400">Yükleniyor…</span>
    </div>
  );
}

/**
 * ⚠️ UX DÜZELTMESİ (denetim bulgusu U-08): Footer ve çerez banner'ı tüm
 * rotaların dışında render ediliyordu; süper admin panelinde WhatsApp/Instagram
 * linkleri ve KVKK onay kutusu çıkıyor, yönetici çalışmaya başlamadan önce
 * banner'ı kapatmak zorunda kalıyordu. Artık yalnızca public rotalarda.
 */
const ADMIN_PATH_PREFIXES = ["/admin", "/super-admin", "/reset-password"];

function isAdminRoute(pathname) {
  return ADMIN_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const adminRoute = isAdminRoute(location.pathname);

  return (
    <main className="flex min-h-screen flex-col bg-ink-50 text-ink-900 dark:bg-ink-950 dark:text-ink-100">
      {/* Klavye kullanıcıları için içeriğe atlama bağlantısı (A-01). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-toast focus:rounded-control focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        İçeriğe geç
      </a>

      <div id="main-content" className="flex-1">
        <ErrorBoundary onNavigateHome={() => navigate("/")} homeLabel="Ana sayfa">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<V0FinancialDashboard />} />
              <Route path="/doviz-burosu/:slug" element={<ExchangeOfficePage />} />
              <Route path="/admin" element={<InstitutionAdminPage />} />
              <Route path="/super-admin" element={<SuperAdminDashboard />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/dashboard" element={<Navigate to="/" replace />} />
              <Route path="/partnership" element={<Navigate to="/#partnership" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </div>

      {!adminRoute ? <Footer /> : null}
      {!adminRoute ? <CookieConsent /> : null}
    </main>
  );
}

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          {/*
            U-09: Site geneli meta YALNIZCA burada tanımlanır. Sayfa/bölüm
            bileşenlerindeki rakip <Helmet> blokları kaldırıldı.
          */}
          <SeoHead />
          {/* A-03: tüm modallara odak tuzağı + Esc + erişilebilir ad. */}
          <ModalA11yGuard />
          <AppShell />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
