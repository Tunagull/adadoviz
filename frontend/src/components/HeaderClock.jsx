import { useEffect, useState } from "react";
import { SlidingNumber } from "./ui/sliding-number";

/**
 * Başlıktaki canlı saat (SS:DD:SS, 24 saat).
 *
 * Kendi state'inde tik atıyor: saniyelik `setState` yalnızca bu küçük ağacı
 * yeniden çiziyor, dev V0FinancialDashboard'ı değil. Bu yüzden ayrı bir
 * bileşen — saati başlığın içine gömmek panonun tamamını saniyede bir
 * render ederdi.
 *
 * `sm` altında gizli: mobil başlık zaten dar ve sarılıyor (flex-wrap).
 * Salt dekoratif olduğu için `aria-hidden` — ekran okuyucu her saniye
 * "saat değişti" diye anons etmesin.
 */
export function HeaderClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="hidden select-none items-center gap-0.5 font-mono text-sm tabular-nums text-ink-500 dark:text-ink-400 sm:flex"
    >
      <SlidingNumber value={now.getHours()} padStart />
      <span className="text-ink-400 dark:text-ink-500">:</span>
      <SlidingNumber value={now.getMinutes()} padStart />
      <span className="text-ink-400 dark:text-ink-500">:</span>
      <SlidingNumber value={now.getSeconds()} padStart />
    </div>
  );
}
