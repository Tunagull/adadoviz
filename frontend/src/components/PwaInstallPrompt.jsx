import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";

const DISMISS_KEY = "adadoviz:pwa-dismissed";

/**
 * "Ana ekrana ekle" ipucu — yalnızca bir kez.
 *
 * Chrome/Android `beforeinstallprompt` verdiğinde küçük bir şerit gösterir.
 * Kullanıcı "Ekle" derse yerleşik tarayıcı diyaloğu açılır; "Şimdi değil"
 * veya kurulum tamamlanınca `localStorage`'a yazıp bir daha göstermez.
 * Zaten standalone açıldıysa (kurulu) hiç render edilmez.
 */
export function PwaInstallPrompt() {
  const { t } = useLanguage();
  const [promptEvent, setPromptEvent] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* ignore */
    }
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (standalone) return;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setPromptEvent(e);
      setVisible(true);
    };
    const onInstalled = () => {
      remember();
      setVisible(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function remember() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  const handleInstall = async () => {
    if (!promptEvent) return;
    remember();
    setVisible(false);
    try {
      promptEvent.prompt();
      await promptEvent.userChoice;
    } catch {
      /* ignore */
    }
    setPromptEvent(null);
  };

  const handleDismiss = () => {
    remember();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-modal p-3 max-md:bottom-[4.75rem] sm:p-4"
      role="region"
      aria-label={t("pwaInstallTitle")}
    >
      <div className="pointer-events-auto mx-auto flex w-[95%] max-w-md items-start gap-3 rounded-2xl border border-ink-200 bg-white/95 p-4 shadow-card backdrop-blur-md dark:border-white/10 dark:bg-ink-950/95 dark:shadow-card-dark">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-ink-50 text-ink-700 dark:border-white/10 dark:bg-ink-900 dark:text-white">
          <Download className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-900 dark:text-white">
            {t("pwaInstallTitle")}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-600 dark:text-ink-400">
            {t("pwaInstallBody")}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleInstall}
              className="min-h-[2.5rem] rounded-full px-4 py-1.5 text-sm font-semibold surface-neon shadow-sm transition-opacity hover:opacity-90"
            >
              {t("pwaInstallAction")}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="min-h-[2.5rem] rounded-full border border-ink-300 bg-transparent px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50 dark:border-white/15 dark:text-ink-300 dark:hover:bg-white/5 dark:hover:text-white"
            >
              {t("pwaInstallDismiss")}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("pwaInstallDismiss")}
          className="shrink-0 rounded-full p-1 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/5 dark:hover:text-white"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
