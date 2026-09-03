import { useCallback, useLayoutEffect, useRef } from "react";
import clsx from "clsx";

/**
 * Kayan göstergeli sekme şeridi.
 *
 * Aktif sekme, arka planı anında değiştirmek yerine tema anahtarındaki
 * (ThemeToggle) kayan topuz gibi hareket ediyor: dolgu tek bir katman ve
 * sekmeler arasında süzülüyor.
 *
 * Gösterge konumu ÖLÇÜMDEN geliyor — sekme etiketleri farklı genişlikte
 * ("Saatlik" ile "Haftalık" bir değil), eşit paylı bir CSS çözümü şeridin
 * görünümünü değiştirirdi. Ölçüm sonucu doğrudan DOM'a yazılıyor; state'e
 * taşımak her ölçümde fazladan bir render turu demekti.
 */
export function SlidingTabs({
  items,
  value,
  onChange,
  ariaLabel,
  className = "",
  /** Sekmelerin paylaştığı ek sınıf — ör. eşit paylı şeritte `flex-1`. */
  tabClassName = "",
}) {
  const indicatorRef = useRef(null);
  const tabRefs = useRef([]);
  const observerRef = useRef(null);
  const settledRef = useRef(false);

  const activeIndex = items.findIndex((item) => item.key === value);

  /**
   * Bağımlılığı yok: aktif sekmeyi kapanıştan değil DOM'dan (`aria-selected`)
   * okuyor. Böylece ResizeObserver de aynı kararlı fonksiyonu çağırabiliyor,
   * bayat bir indeksle yanlış sekmeyi işaretleme riski kalmıyor.
   */
  const applyIndicator = useCallback(() => {
    const el = indicatorRef.current;
    if (!el) return;

    const tab = tabRefs.current.find((node) => node?.getAttribute("aria-selected") === "true");
    if (!tab) {
      if (el.style.opacity !== "0") el.style.opacity = "0";
      return;
    }

    /*
      ÖNCE ÖLÇ, SONRA YAZ.

      İlk sürüm `el.style.opacity` yazıp hemen ardından `tab.offsetLeft`
      okuyordu; yazma stili geçersiz kıldığı için okuma tarayıcıyı senkron
      layout'a zorluyordu. Bu `useLayoutEffect` her render'da çalıştığından
      maliyet birikiyordu — Chrome trace'inde 85 ms forced reflow ile sayfanın
      en pahalı tek kalemiydi.

      Değer değişmediyse hiç yazmıyoruz: gereksiz stil geçersizleştirmesi yok.
    */
    const left = tab.offsetLeft;
    const width = tab.offsetWidth;
    const nextTransform = `translateX(${left}px)`;
    const nextWidth = `${width}px`;

    if (
      el.style.transform === nextTransform &&
      el.style.width === nextWidth &&
      el.style.opacity === "1"
    ) {
      return;
    }

    el.style.opacity = "1";
    el.style.transform = nextTransform;
    el.style.width = nextWidth;

    if (!settledRef.current) {
      settledRef.current = true;
      // İlk yerleşim soldan kayarak gelmesin: geçişi kapat, yerleştir, aç.
      el.style.transition = "none";
      void el.offsetWidth;
      el.style.transition = "";
    }
  }, []);

  useLayoutEffect(applyIndicator);

  const listRef = useCallback(
    (node) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || typeof ResizeObserver === "undefined") return;

      // Yazı tipi yüklendiğinde, dil değiştiğinde veya şerit yeniden
      // boyutlandığında sekme genişlikleri kayıyor.
      const observer = new ResizeObserver(() => applyIndicator());
      observer.observe(node);
      observerRef.current = observer;
    },
    [applyIndicator]
  );

  useLayoutEffect(() => () => observerRef.current?.disconnect(), []);

  const handleKeyDown = (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step || items.length === 0) return;
    event.preventDefault();
    const next = (Math.max(0, activeIndex) + step + items.length) % items.length;
    onChange?.(items[next].key);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={clsx("sliding-tabs", className)}
    >
      <span ref={indicatorRef} className="sliding-tabs__indicator surface-neon" aria-hidden="true" />

      {items.map((item, index) => {
        const isActive = item.key === value;
        return (
          <button
            key={item.key}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            // Şerit tek bir sekme durağı: içinde ok tuşlarıyla geziliyor.
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange?.(item.key)}
            className={clsx(
              "sliding-tabs__tab press",
              tabClassName,
              isActive ? "text-white dark:text-ink-950" : "text-ink-600 dark:text-ink-400"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default SlidingTabs;
