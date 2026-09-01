import { forwardRef } from "react";
import { cn } from "../../lib/utils";

/**
 * Origin UI `Input` primitifinin JSX uyarlaması.
 *
 * Kaynak shadcn token'ları (`border-input`, `bg-background`, `ring`) bu
 * kod tabanında yok; aynı ölçü ve odak davranışı `ink` paletiyle kuruldu.
 * Formların görünen yüzü `FloatingInput` — bu dosya o bileşenin dayandığı
 * çıplak kontrol ve dosya/arama tipi ayrıntıları için duruyor.
 */
const Input = forwardRef(function Input({ className, type, ...props }, ref) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 shadow-sm shadow-black/5 transition-shadow placeholder:text-ink-400 focus-visible:border-ink-900 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ink-900/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-100 dark:placeholder:text-ink-500 dark:focus-visible:border-white dark:focus-visible:ring-white/20",
        type === "search" &&
          "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
        type === "file" &&
          "p-0 pr-3 italic text-ink-500 file:me-3 file:h-full file:border-0 file:border-r file:border-solid file:border-ink-300 file:bg-transparent file:px-3 file:text-sm file:font-medium file:not-italic file:text-ink-900 dark:text-ink-400 dark:file:border-ink-700 dark:file:text-ink-100",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});

Input.displayName = "Input";

export { Input };
