import { MessageCircle } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";

/**
 * ⚠️ TASARIM + ERİŞİLEBİLİRLİK DÜZELTMESİ:
 *
 * D-07: Instagram, lucide ikon setinin yanında 📷 EMOJİ ile çiziliyordu. Emoji
 * işletim sistemine göre değişir, temaya uyum sağlamaz, boyutu kontrol edilemez
 * — ve bu her sayfanın altında görünüyordu. Artık gerçek bir SVG ikon.
 *
 * A-05: Marka renkleri beyaz zeminde okunamıyordu (ölçüm: WhatsApp yazısı
 * kontrast oranı 1.96, gereken 4.5). İkon marka renginde kaldı, METİN okunur
 * bir nötr tona alındı.
 *
 * A-06: Dokunma hedefleri 44px'in altındaydı; artık min-h-[2.75rem].
 */
function InstagramIcon({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

export function Footer() {
  const { t } = useLanguage();

  const linkClass =
    "inline-flex min-h-[2.75rem] items-center gap-2 rounded-control px-3 text-sm font-semibold " +
    "text-ink-700 transition hover:text-ink-900 dark:text-ink-300 dark:hover:text-white";

  return (
    <footer className="border-t border-ink-200 bg-white/70 px-4 py-6 backdrop-blur-lg dark:border-white/10 dark:bg-ink-950/60">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-4 flex items-center justify-center gap-4">
          <a
            href="https://wa.me/YOUR_WHATSAPP_NUMBER"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            aria-label="WhatsApp ile iletişim kurun"
          >
            <MessageCircle
              className="size-5 shrink-0 text-[#128C4A] dark:text-[#25D366]"
              aria-hidden="true"
            />
            <span>WhatsApp</span>
          </a>

          <a
            href="https://instagram.com/YOUR_INSTAGRAM_HANDLE"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            aria-label="Instagram'da bizi takip edin"
          >
            <InstagramIcon className="size-5 shrink-0 text-[#A4276B] dark:text-[#E1306C]" />
            <span>Instagram</span>
          </a>
        </div>

        <div className="text-center text-xs text-ink-600 dark:text-ink-400">
          {t("footerTagline")} | AdaDöviz
        </div>
      </div>
    </footer>
  );
}
