import { Component } from "react";

/**
 * Gerçek React error boundary.
 *
 * ⚠️ KOD SAĞLIĞI DÜZELTMESİ (denetim bulgusu P-03): InstitutionAdminPage.jsx'te
 * 1.400 satırlık JSX bir `try { return (<div…/>) } catch` bloğuna sarılmıştı.
 * React JSX'i o anda render etmediği için bu catch render hatalarını HİÇBİR
 * ZAMAN yakalamıyordu — ESLint'in 275 `react-hooks/error-boundaries` hatası
 * tam olarak bunu söylüyordu (338 sorunun 289'u tek dosyadaydı).
 *
 * Ayrıca eski fallback: sabit Türkçe metin, temadan bağımsız koyu arka plan,
 * `window.location.href` ile tam sayfa yenileme ve ham `err.message`'ın
 * işletme sahibine gösterilmesi.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary]", error, info?.componentStack);
    } else if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // Prod render crash'i sessiz kalmasın — hafif beacon.
      try {
        const payload = JSON.stringify({
          type: "render-error",
          message: String(error?.message || error),
          stack: String(info?.componentStack || "").slice(0, 2000),
          path: typeof location !== "undefined" ? location.pathname : "",
          ua: navigator.userAgent,
          ts: Date.now(),
        });
        navigator.sendBeacon("/api/client-error", new Blob([payload], { type: "application/json" }));
      } catch {
        /* beacon best-effort */
      }
    }
  }

  componentDidUpdate(prevProps) {
    // F-H1: rota değişince (veya resetKey değişince) hata ekranını temizle,
    // yoksa "Ana sayfa" URL'i değiştirir ama fallback ekranda kalır.
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleNavigateHome = () => {
    this.props.onNavigateHome?.();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { fallbackTitle, fallbackMessage, onNavigateHome, homeLabel } = this.props;

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16">
        <div className="surface-card w-full max-w-md p-6 text-center">
          <h1 className="text-lg font-semibold text-ink-900 dark:text-white">
            {fallbackTitle || "Bu bölüm yüklenemedi"}
          </h1>
          <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
            {fallbackMessage ||
              "Beklenmeyen bir sorun oluştu. Sayfayı yeniden denemek sorunu genellikle çözer."}
          </p>
          {import.meta.env.DEV ? (
            <pre className="mt-3 max-h-40 overflow-auto rounded-control bg-ink-100 p-2 text-left text-[11px] text-ink-700 dark:bg-ink-950 dark:text-ink-300">
              {String(error?.message || error)}
            </pre>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={this.handleRetry} className="btn-primary">
              Yeniden dene
            </button>
            {onNavigateHome ? (
              <button type="button" onClick={this.handleNavigateHome} className="btn-ghost">
                {homeLabel || "Ana sayfa"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
