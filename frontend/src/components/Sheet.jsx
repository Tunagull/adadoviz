import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Drawer } from "vaul";
import useMeasure from "react-use-measure";
import { ChevronLeft, X } from "lucide-react";

/**
 * Alttan açılır sheet (bottom drawer) — yüksekliği içeriğe göre yumuşakça uyarlanır.
 *
 * Kaynak desen `animated-drawer` bileşeninden alındı, bu projenin gerçek yığınına
 * uyarlandı:
 *   · TSX → JSX (projede TypeScript yok: 0 adet .ts/.tsx, 36 adet .js/.jsx)
 *   · "use client" kaldırıldı (Next.js direktifi; burada Vite + React Router var)
 *   · `@/` takma adı yerine göreli import (vite.config.js'te alias tanımlı değil)
 *   · shadcn `Button`/`cn()` yerine projenin `.btn-*` sınıfları (index.css)
 *   · `motion/react` animasyonu yerine düz CSS geçişi — framer-motion bu
 *     bileşen için ~50 KB gzip ekliyordu (ölçüm: müşteri ilk yükü
 *     230 → 290 KB). Aynı görsel sonuç, sıfır ek bağımlılık.
 *   · neutral/red/sky renkleri yerine tasarım token'ları: ink / brand / danger
 *     (bkz. tailwind.config.js — 10 renk ailesi 5 semantik role indirilmişti)
 *   · `z-10` yerine `z-modal` katman ölçeği
 *   · `rounded-[36px]` yerine `rounded-card`
 *
 * Erişilebilirlik: vaul `role="dialog"` ve `aria-labelledby` üretir, odak
 * tuzağını / Esc'i / scroll kilidini de kendisi yönetir — ama `aria-modal`
 * VERMEZ, o yüzden aşağıda elle ekleniyor. App.jsx'teki <ModalA11yGuard />
 * `[data-vaul-drawer]` taşıyan panelleri bilinçli olarak atlar; aksi halde iki
 * ayrı odak tuzağı aynı anda çalışırdı.
 *
 * İki kullanım biçimi:
 *
 *   1) Tek görünüm:
 *      <Sheet open={open} onOpenChange={setOpen} title="Filtreler">
 *        …içerik…
 *      </Sheet>
 *
 *   2) Çok görünümlü (kaynak bileşendeki view-switching davranışı):
 *      <Sheet
 *        open={open}
 *        onOpenChange={setOpen}
 *        views={{
 *          default: { title: "Ayarlar", render: ({ go }) => <button onClick={() => go("confirm")}>…</button> },
 *          confirm: { title: "Emin misiniz?", back: "default", render: ({ go, close }) => … },
 *        }}
 *      />
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  views,
  initialView = "default",
  footer,
  showHandle = true,
  contentClassName = "",
}) {
  const [elementRef, bounds] = useMeasure();
  const [view, setView] = useState(initialView);
  const headingId = `sheet-title-${useId()}`;

  // Kapanınca ilk görünüme dön — yeniden açılışta yarım kalmış akış görünmesin.
  useEffect(() => {
    if (open) return undefined;
    const t = setTimeout(() => setView(initialView), 250);
    return () => clearTimeout(t);
  }, [open, initialView]);

  const close = useCallback(() => onOpenChange?.(false), [onOpenChange]);
  const go = useCallback((next) => setView(next), []);

  const active = views?.[view] || null;
  const heading = active?.title ?? title;
  const sub = active?.description ?? description;
  const backTo = active?.back;

  const body = useMemo(() => {
    if (active?.render) return active.render({ go, close, view });
    return children;
  }, [active, go, close, view, children]);

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-modal bg-ink-950/60 backdrop-blur-[2px]" />
        <Drawer.Content
          // vaul role="dialog" + aria-labelledby üretir ama aria-modal vermez.
          aria-modal="true"
          aria-labelledby={heading ? headingId : undefined}
          className={`fixed inset-x-0 bottom-0 z-modal mx-auto flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-card border border-b-0 border-ink-200 bg-white outline-none dark:border-white/10 dark:bg-ink-900 sm:inset-x-4 sm:bottom-4 sm:rounded-card ${contentClassName}`}
        >
          {/*
            Yüksekliği içeriğe göre animasyonla uyarla (kaynak desenin özü).
            react-use-measure ölçtüğü yüksekliği veriyor, geçişi CSS yapıyor —
            prefers-reduced-motion index.css'te global olarak saygı görüyor.
          */}
          <div
            className="overflow-hidden transition-[height] duration-300 ease-out"
            style={{ height: bounds.height ? `${bounds.height}px` : "auto" }}
          >
            <div ref={elementRef} className="flex max-h-[92vh] flex-col">
              {showHandle ? (
                <div className="flex shrink-0 justify-center pt-3 sm:hidden">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-10 rounded-full bg-ink-300 dark:bg-ink-700"
                  />
                </div>
              ) : null}

              {heading ? (
                <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-4">
                  <div className="flex min-w-0 items-start gap-2">
                    {backTo ? (
                      <button
                        type="button"
                        onClick={() => go(backTo)}
                        aria-label="Geri"
                        className="btn btn-sm -ml-1 mt-0.5 min-h-[2.25rem] min-w-[2.25rem] shrink-0 text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
                      >
                        <ChevronLeft size={18} aria-hidden="true" />
                      </button>
                    ) : null}
                    <div className="min-w-0">
                      <Drawer.Title
                        id={headingId}
                        className="truncate text-base font-semibold text-ink-900 dark:text-white"
                      >
                        {heading}
                      </Drawer.Title>
                      {sub ? (
                        <Drawer.Description className="mt-0.5 text-sm text-ink-600 dark:text-ink-400">
                          {sub}
                        </Drawer.Description>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={close}
                    aria-label="Kapat"
                    className="btn btn-sm -mr-1 min-h-[2.75rem] min-w-[2.75rem] shrink-0 text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{body}</div>

              {footer ? (
                <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-ink-200 px-5 py-4 dark:border-white/10">
                  {footer}
                </div>
              ) : null}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export default Sheet;
