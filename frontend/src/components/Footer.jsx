import { MessageCircle } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white/70 px-4 py-6 backdrop-blur-lg dark:border-white/10 dark:bg-slate-950/60">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-4 flex items-center justify-center gap-6">
          {/* WhatsApp */}
          <a
            href="https://wa.me/YOUR_WHATSAPP_NUMBER"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg transition hover:brightness-110"
            aria-label="WhatsApp iletişim"
            title="WhatsApp ile iletişim kurun"
          >
            <MessageCircle className="size-5 text-[#25D366]" />
            <span className="text-xs font-semibold text-[#25D366]">WhatsApp</span>
          </a>

          {/* Instagram - Emoji + Gradient Text */}
          <a
            href="https://instagram.com/YOUR_INSTAGRAM_HANDLE"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg transition hover:opacity-80"
            aria-label="Instagram profili"
            title="Instagram'da bizi takip edin"
          >
            <span className="text-lg">📷</span>
            <span className="text-xs font-semibold bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888] text-transparent bg-clip-text">Instagram</span>
          </a>
        </div>

        <div className="text-center text-xs text-slate-500">
          Kuzey Kıbrıs&apos;ın Döviz Adresi | FinSight
        </div>
      </div>
    </footer>
  );
}
