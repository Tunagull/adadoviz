import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { LanguageProvider } from "./context/LanguageContext";
import { V0FinancialDashboard } from "./components/V0FinancialDashboard";
import { InstitutionAdminPage } from "./pages/InstitutionAdminPage";
import { SuperAdminDashboard } from "./pages/SuperAdminDashboard";
import { ResetPasswordPage } from "./pages/ResetPassword";
import { Footer } from "./components/Footer";
import { CookieConsent } from "./components/CookieConsent";

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <main className="min-h-screen bg-slate-50 text-slate-900 flex flex-col dark:bg-slate-950 dark:text-slate-100">
            <div className="flex-1">
              <Routes>
                <Route
                  path="/"
                  element={
                    <div className="mx-auto max-w-7xl px-3 py-6 sm:px-6 md:py-12">
                      <V0FinancialDashboard />
                    </div>
                  }
                />
                <Route path="/admin" element={<InstitutionAdminPage />} />
                <Route path="/super-admin" element={<SuperAdminDashboard />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/dashboard" element={<Navigate to="/" replace />} />
                <Route path="/partnership" element={<Navigate to="/#partnership" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
            <Footer />
            <CookieConsent />
          </main>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
