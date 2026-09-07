import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * P3.5 — SSS akordeonu. Kütüphanesiz; her satır bir <button> + bölge.
 * Açılma/kapanma `grid-template-rows` 1fr/0fr geçişiyle (yükseklik animasyonu
 * için en pürüzsüz yol), `ease-out-strong` + `duration-base`.
 *
 * JSON-LD (FAQPage) çağıran sayfada üretilir — bu bileşen yalnızca görünüm.
 */
export function Faq({ items = [], title }) {
  const [open, setOpen] = useState(() => new Set());
  const baseId = useId();

  if (!items.length) return null;

  const toggle = (i) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section className="mt-12">
      {title ? (
        <h2 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-white">
          {title}
        </h2>
      ) : null}
      <div className="mt-4 divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-white dark:divide-ink-800 dark:border-white/10 dark:bg-ink-950">
        {items.map((item, i) => {
          const isOpen = open.has(i);
          const panelId = `${baseId}-panel-${i}`;
          const btnId = `${baseId}-btn-${i}`;
          return (
            <div key={item.q}>
              <h3>
                <button
                  id={btnId}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(i)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-50 dark:text-white dark:hover:bg-white/5 sm:px-5"
                >
                  <span>{item.q}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-4 shrink-0 text-ink-500 transition-transform duration-base ease-out-strong ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </h3>
              <div
                id={panelId}
                role="region"
                aria-labelledby={btnId}
                className={`grid transition-[grid-template-rows] duration-base ease-out-strong ${
                  isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <p className="px-4 pb-4 text-sm leading-relaxed text-ink-600 dark:text-ink-300 sm:px-5">
                    {item.a}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
