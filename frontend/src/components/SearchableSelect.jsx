import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";

const MENU_MAX_HEIGHT = 280;
const MENU_GAP = 4;

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
  "aria-label": ariaLabel,
}) {
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
    const q = query.trim().toLocaleLowerCase("tr-TR");
    if (!q) return options;
    return options.filter((o) =>
      String(o.label || "")
        .toLocaleLowerCase("tr-TR")
        .includes(q)
    );
  }, [options, query]);

  const updateMenuPosition = () => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow;
    setPlacement(openUp ? "top" : "bottom");
    setMenuStyle({
      left: rect.left,
      width: rect.width,
      top: openUp ? rect.top - MENU_GAP : rect.bottom + MENU_GAP,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onResizeOrScroll = () => updateMenuPosition();
    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    return () => {
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
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
    const ch = char.toLocaleLowerCase("tr-TR");
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
        .toLocaleLowerCase("tr-TR")
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

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="presentation"
            style={{
              position: "fixed",
              left: menuStyle.left,
              width: menuStyle.width,
              top: menuStyle.top,
              zIndex: 9999,
              transform: placement === "top" ? "translateY(-100%)" : undefined,
            }}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onKeyDown={onListKeyDown}
          >
            <div className="relative border-b border-slate-200 p-2 dark:border-slate-700">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onListKeyDown}
                placeholder="Ara..."
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-900 outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              className="max-h-56 overflow-y-auto py-1"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-xs text-slate-500">Sonuç yok</li>
              ) : (
                filtered.map((opt, idx) => {
                  const active = String(opt.value) === String(value);
                  const hi = idx === highlight;
                  return (
                    <li
                      key={`${opt.value}-${idx}`}
                      data-idx={idx}
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setHighlight(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        commit(opt);
                      }}
                      className={`cursor-pointer px-3 py-2 text-sm transition ${
                        hi
                          ? "bg-slate-950 border-l-2 border-l-cyan-400 text-cyan-300 dark:bg-slate-950 dark:text-cyan-300"
                          : active
                            ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                            : "text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      {opt.label}
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel || placeholder}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm text-slate-900 outline-none transition-all duration-300 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-cyan-400 dark:focus:border-cyan-400 disabled:opacity-60 disabled:hover:border-slate-300 disabled:hover:shadow-none dark:disabled:hover:border-slate-700"
      >
        <span className={`truncate ${selected ? "" : "text-slate-400 dark:text-slate-500"}`}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {menu}
    </div>
  );
}
