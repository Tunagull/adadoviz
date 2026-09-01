import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { CONSENT_KEY, startAnalyticsSession } from "../lib/analytics";

/**
 * KVKK / çerez onay banner'ı — mat siyah + beyaz neon cildi.
 * Kabul → session + POST /api/analytics/start
 */
export function CookieConsent() {
  const { t } = useLanguage();
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
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-modal p-3 max-md:bottom-[4.75rem] sm:p-4"
      role="dialog"
      aria-live="polite"
      aria-label={t("cookieConsentAccept")}
    >
      <div className="pointer-events-auto mx-auto flex w-[95%] max-w-4xl flex-col gap-4 rounded-2xl border border-ink-200 bg-white/95 p-4 shadow-card backdrop-blur-md dark:border-white/10 dark:bg-ink-950/95 dark:shadow-card-dark sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-ink-50 text-ink-700 dark:border-white/10 dark:bg-ink-900 dark:text-white">
            <Cookie className="size-4" aria-hidden="true" />
          </span>
          <p className="text-xs leading-relaxed text-ink-600 sm:text-sm dark:text-ink-400">
            {t("cookieConsentMessage")}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-2.5">
          <button
            type="button"
            onClick={handleReject}
            className="min-h-[2.75rem] rounded-full border border-ink-300 bg-transparent px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50 dark:border-white/15 dark:text-ink-300 dark:hover:bg-white/5 dark:hover:text-white"
          >
            {t("cookieConsentReject")}
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="min-h-[2.75rem] rounded-full px-5 py-2 text-sm font-semibold surface-neon shadow-sm transition-opacity hover:opacity-90"
          >
            {t("cookieConsentAccept")}
          </button>
        </div>
      </div>
    </div>
  );
}
