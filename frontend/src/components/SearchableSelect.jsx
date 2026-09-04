import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, LazyMotion, m, useReducedMotion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { FloatingInput } from "./ui/floating-label";

const MENU_MAX_HEIGHT = 280;
const MENU_GAP = 4;

/*
  Açılır menü animasyonu framer-motion ile: `motion` (tam) yerine `m` (mini) +
  tembel `domAnimation` — GooeySearchBar'la aynı özellik paketi, aynı yığın,
  `LazyMotion` önbelleğiyle tekilleştiriliyor (ek maliyet yok).
*/
const loadDomAnimation = () =>
  import("framer-motion").then((mod) => mod.domAnimation);

/** Menü giriş/çıkışı — kısa, güçlü yavaşlayan eğri. */
const MENU_TRANSITION = { duration: 0.14, ease: [0.16, 1, 0.3, 1] };

/**
 * Accessible searchable select with typeahead (keyboard jump + filter input).
 * Dropdown menu is portaled to document.body to avoid z-index stacking issues.
 * options: [{ value: string, label: string }]
 */
export function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = "Seçiniz",
  className = "",
  disabled = false,
  /** Verilmezse yer tutucu, yüzen etiket olur — boş kutuda iki yazı üst üste binmez. */
  label,
  /** "sm": araç çubuğu yüksekliği. */
  size,
  "aria-label": ariaLabel,
}) {
  const { t, lang } = useLanguage();
  const localeCode = lang === "en" ? "en-US" : "tr-TR";
  const reduceMotion = useReducedMotion();
  const listId = useId();
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const typeaheadRef = useRef({ buffer: "", timer: null });

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [placement, setPlacement] = useState("bottom");
  const [menuStyle, setMenuStyle] = useState({ top: 0, left: 0, width: 0 });

  const selected = useMemo(
    () => options.find((o) => String(o.value) === String(value)) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(localeCode);
    if (!q) return options;
    return options.filter((o) =>
      String(o.label || "")
        .toLocaleLowerCase(localeCode)
        .includes(q)
    );
  }, [options, query, localeCode]);

  const updateMenuPosition = () => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow;
    const edge = 8;
    const width = Math.min(Math.max(rect.width, 160), window.innerWidth - edge * 2);
    const left = Math.min(
      Math.max(rect.left, edge),
      Math.max(edge, window.innerWidth - width - edge)
    );
    setPlacement(openUp ? "top" : "bottom");
    setMenuStyle({
      left,
      width,
      top: openUp ? rect.top - MENU_GAP : rect.bottom + MENU_GAP,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, filtered.length]);

  useEffect(() => {
    if (!open) return;
    /*
      ⚠️ PERF: Bu dinleyici `capture` fazında ve `passive` DEĞİLDİ; sayfadaki
      HER kaydırma olayında (menünün kendi listesini kaydırmak dahil)
      `getBoundingClientRect()` + iki `setState` çalıştırıyordu — açık
      dropdown'da kaydırma takılmasının sebebi buydu. Artık: passive,
      rAF ile tek kareye indirilmiş, ve menü içi kaydırmalar yok sayılıyor.
    */
    let frame = 0;
    const schedule = (e) => {
      if (e?.type === "scroll" && menuRef.current?.contains(e.target)) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateMenuPosition();
      });
    };
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const idx = Math.max(
      0,
      filtered.findIndex((o) => String(o.value) === String(value))
    );
    setHighlight(idx === -1 ? 0 : idx);
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      const target = e.target;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open, filtered]);

  const commit = (opt) => {
    if (!opt) return;
    onChange?.(opt.value);
    setOpen(false);
  };

  const jumpByChar = (char) => {
    const ch = char.toLocaleLowerCase(localeCode);
    if (!ch || ch.length !== 1) return;
    const state = typeaheadRef.current;
    clearTimeout(state.timer);
    state.buffer += ch;
    state.timer = setTimeout(() => {
      state.buffer = "";
    }, 700);

    const buf = state.buffer;
    const pool = filtered.length ? filtered : options;
    const start = highlight + 1;
    const ordered = [...pool.slice(start), ...pool.slice(0, start)];
    const match = ordered.find((o) =>
      String(o.label || "")
        .toLocaleLowerCase(localeCode)
        .startsWith(buf)
    );
    if (match) {
      const idx = pool.findIndex((o) => o.value === match.value);
      if (idx >= 0) setHighlight(idx);
    }
  };

  const onTriggerKeyDown = (e) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setOpen(true);
      jumpByChar(e.key);
    }
  };

  const onListKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit(filtered[highlight]);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.target !== searchRef.current) {
      jumpByChar(e.key);
    }
  };

  // Menü aşağı açılıyorsa yukarıdan (y:-8), yukarı açılıyorsa aşağıdan (y:8) süzülür.
  const menuOffsetY = placement === "top" ? 8 : -8;
  const menuInitial = reduceMotion ? false : { opacity: 0, y: menuOffsetY };
  const menuExit = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: menuOffsetY };

  const menu =
    typeof document !== "undefined"
      ? createPortal(
          <LazyMotion features={loadDomAnimation} strict>
            {/*
              Dış sarmalayıcı KONUM içindir ve hep bağlı durur; `translateY(-100%)`
              (yukarı açılış) sabittir. İç `m.div` yalnızca opacity+y anime eder —
              böyle olmasa framer'ın `y`'si konum transform'unu ezerdi.
            */}
            <div
              style={{
                position: "fixed",
                left: menuStyle.left,
                width: menuStyle.width,
                top: menuStyle.top,
                zIndex: 9999,
                transform:
                  placement === "top" ? "translateY(-100%)" : undefined,
                pointerEvents: open ? "auto" : "none",
              }}
              data-placement={placement}
            >
              <AnimatePresence>
                {open && (
                  <m.div
                    key="ss-menu"
                    ref={menuRef}
                    role="presentation"
                    initial={menuInitial}
                    animate={{ opacity: 1, y: 0 }}
                    exit={menuExit}
                    transition={reduceMotion ? { duration: 0 } : MENU_TRANSITION}
                    className="searchable-select__menu overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900"
                    onKeyDown={onListKeyDown}
                  >
                    <div className="border-b border-ink-200 px-2 pb-2 pt-3 dark:border-ink-700">
                      <FloatingInput
                        ref={searchRef}
                        size="sm"
                        label={t("searchPlaceholder")}
                        type="search"
                        autoComplete="off"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setHighlight(0);
                        }}
                        onKeyDown={onListKeyDown}
                      />
                    </div>
                    <ul
                      ref={listRef}
                      id={listId}
                      role="listbox"
                      className="max-h-56 overflow-y-auto py-1"
                    >
                      {filtered.length === 0 ? (
                        <li className="px-3 py-2 text-xs text-ink-500">
                          {t("noResults")}
                        </li>
                      ) : (
                        filtered.map((opt, idx) => {
                          const active = String(opt.value) === String(value);
                          const hi = idx === highlight;
                          /*
                            Kademeli giriş yalnızca menü ilk açıldığında (arama
                            kutusu boşken); yazarken liste her tuşta yeniden
                            titremesin diye `initial={false}`.
                          */
                          const staggerIn =
                            !reduceMotion && query === ""
                              ? {
                                  initial: { opacity: 0, x: -12 },
                                  animate: { opacity: 1, x: 0 },
                                  transition: {
                                    duration: 0.14,
                                    ease: "easeOut",
                                    delay: Math.min(idx, 6) * 0.02,
                                  },
                                }
                              : { initial: false };
                          return (
                            <m.li
                              key={String(opt.value)}
                              {...staggerIn}
                              data-idx={idx}
                              role="option"
                              aria-selected={active}
                              onMouseEnter={() => setHighlight(idx)}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                commit(opt);
                              }}
                              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm transition-colors duration-150 ${
                                hi
                                  ? "bg-ink-950 text-white dark:bg-white dark:text-ink-950"
                                  : active
                                    ? "bg-ink-100 text-ink-900 dark:bg-ink-800 dark:text-white"
                                    : "text-ink-700 dark:text-ink-200"
                              }`}
                            >
                              <span className="min-w-0 truncate">{opt.label}</span>
                              {active && (
                                <m.span
                                  className="shrink-0"
                                  initial={reduceMotion ? false : { scale: 0 }}
                                  animate={{ scale: 1 }}
                                  transition={
                                    reduceMotion
                                      ? { duration: 0 }
                                      : { type: "spring", stiffness: 500, damping: 30 }
                                  }
                                >
                                  <Check className="size-4" aria-hidden="true" />
                                </m.span>
                              )}
                            </m.li>
                          );
                        })
                      )}
                    </ul>
                  </m.div>
                )}
              </AnimatePresence>
            </div>
          </LazyMotion>,
          document.body
        )
      : null;

  const floatLabel = label || placeholder;

  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-label={ariaLabel || floatLabel}
      onClick={() => !disabled && setOpen((o) => !o)}
      onKeyDown={onTriggerKeyDown}
      className="float-field__control"
    >
      <span className="min-w-0 truncate">
        {selected && String(selected.value) !== "" ? selected.label : ""}
      </span>
      <ChevronDown
        className={`size-4 shrink-0 text-ink-500 transition ${open ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
    </button>
  );

  /*
    Seçim kutusu her zaman yüzen etiket iskeletini kullanır. Etiket hep
    yukarıda: kutunun içi ya seçilen değeri gösterir ya boş kalır — yer
    tutucu artık etiketin kendisi, iki yazı üst üste binmez.

    `<label>` yerine `<span>`: bir düğme etiketlenebilir eleman değil, o yüzden
    bağ `aria-label` üzerinden kuruluyor.
  */
  return (
    <div
      ref={rootRef}
      className={`float-field ${className}`}
      data-float="always"
      data-size={size}
      data-disabled={disabled ? "" : undefined}
    >
      {trigger}
      <span className="float-field__label">{floatLabel}</span>
      <fieldset aria-hidden="true" className="float-field__outline">
        <legend>
          <span>{floatLabel}</span>
        </legend>
      </fieldset>
      {menu}
    </div>
  );
}
