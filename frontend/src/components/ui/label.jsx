import { forwardRef } from "react";
import { cn } from "../../lib/utils";

/**
 * Origin UI `Label` primitifinin JSX uyarlaması.
 * Görünen form etiketleri `FloatingField` içinde yaşıyor; bu çıplak
 * `<label>` dosya yükleme ve onay kutusu gibi yüzen iskelete girmeyen
 * kontroller için duruyor.
 */
const Label = forwardRef(function Label({ className, ...props }, ref) {
  return (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-4 text-ink-900 peer-disabled:cursor-not-allowed peer-disabled:opacity-70 dark:text-ink-100",
        className
      )}
      {...props}
    />
  );
});

Label.displayName = "Label";

export { Label };
