import { useEffect, useState } from "react";
import { CONSENT_KEY, startAnalyticsSession } from "../lib/analytics";

/**
 * GDPR uyumlu çerez onay banner'ı (fixed bottom).
 * Kabul → session + POST /api/analytics/start
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const consent = localStorage.getItem(CONSENT_KEY);
      if (!consent) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const handleAccept = async () => {
    setVisible(false);
    await startAnalyticsSession();
  };

  const handleReject = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "rejected");
      localStorage.removeItem("analyticsSessionId");
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[4000] p-3 sm:p-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto flex w-[95%] max-w-4xl flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-2xl shadow-black/10 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900/95 dark:shadow-black/40">
        <p className="text-xs leading-relaxed text-slate-600 sm:text-sm dark:text-slate-300">
          Size daha iyi bir hizmet sunabilmek ve site trafiğimizi analiz edebilmek için çerezleri
          kullanıyoruz. Kabul ederek GDPR/KVKK standartlarına uygun olarak anonim veri işlememize
          izin vermiş olursunuz.
        </p>
        <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-3">
          <button
            type="button"
            onClick={handleReject}
            className="px-4 py-2 text-sm font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
          >
            Reddet
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500"
          >
            Kabul Et
          </button>
        </div>
      </div>
    </div>
  );
}
