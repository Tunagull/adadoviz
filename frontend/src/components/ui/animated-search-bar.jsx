import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LazyMotion, m, useReducedMotion } from "framer-motion";
import clsx from "clsx";
import { Building2, Check, Loader2, Search } from "lucide-react";

/*
  ⚠️ PERF: `motion` (tam) yerine `m` (mini) + LazyMotion. `motion` HER zaman
  bütün özellik setini (layout, 3D, drag…) paketler; bu bileşen yalnızca
  variant + AnimatePresence + hover/tap kullanıyor. `domAnimation` özellikleri
  ilk boyamadan sonra ayrı bir parçadan yükleniyor — framer'ın ilk açılış
  yükü ~40 kB gzip'ten belirgin şekilde iniyor. `strict` ile yanlışlıkla
  kalan `motion.*` kullanımı çalışma anında yakalanır.
*/
const loadDomAnimation = () =>
  import("framer-motion").then((mod) => mod.domAnimation);

/**
 * Gooey arama çubuğu.
 *
 * Kaynak: shadcn + TypeScript + dummy dil listesi. Bu kod tabanı JSX; arama
 * gerçek döviz bürolarını süzer. İki uyarlama bilinçli:
 *
 * 1. Sahte 500 ms ağ gecikmesi YOK — liste zaten istemcide, bekletmek yalan
 *    bir yükleme göstergesi olurdu.
 * 2. `placement="up"` alt çubuk (downbar) için: sonuçlar aşağı değil YUKARI
 *    damlar, yoksa viewport'un altına taşar.
 *
 * Gooey SVG filtresi Safari / iOS Chrome'da bozuk; o tarayıcılarda filtre
 * kapatılır (kaynak bileşenle aynı tespit).
 */

export function isUnsupportedBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  const isSafari =
    ua.includes("safari") &&
    !ua.includes("chrome") &&
    !ua.includes("chromium") &&
    !ua.includes("android") &&
    !ua.includes("firefox");
  const isChromeOniOS = ua.includes("crios");
  return isSafari || isChromeOniOS;
}

/*
  Sonuç satırı animasyonu — kaynaktan alınan açılır menü diliyle aynı:
  soldan kısa bir kayma + solma, satır sırasına göre kademeli gecikme.
  Eski "baloncuk yığını" (her öğe 50 px arayla, yaylı) yerine düz liste.
  `isUnsupported` artık kullanılmıyor (gooey SVG filtresi menüden kaldırıldı).
*/
function getResultItemVariants(index, isUnsupported, placement, reduceMotion, scrollMax = 0) {
  void isUnsupported;
  void scrollMax;
  if (reduceMotion) {
    return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
  }
  const x = placement === "up" ? 12 : -12;
  return {
    initial: { opacity: 0, x },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: x / 2 },
  };
}

function getResultItemTransition(index, reduceMotion, scrollMax = 0) {
  if (reduceMotion) return { duration: 0.12 };
  // Katlamanın altındaki satırlar (kaydırmalı listede) gecikmesiz gelsin.
  const belowFold = scrollMax > 0 && index >= scrollMax;
  return {
    duration: 0.14,
    ease: "easeOut",
    delay: belowFold ? 0 : Math.min(index, 6) * 0.025,
  };
}

function collapsedWidthFor(label) {
  return Math.min(220, Math.max(118, String(label || "").length * 9 + 36));
}

/**
 * @param {object} props
 * @param {{ id: string, label: string, hint?: string }[]} props.items
 * @param {string} [props.value]
 * @param {(next: string) => void} [props.onChange]
 * @param {(item: { id: string, label: string, hint?: string }) => void} [props.onSelect]
 * @param {string} [props.collapsedLabel]
 * @param {string} [props.placeholder]
 * @param {string} [props.emptyLabel]
 * @param {"down" | "up"} [props.placement]
 * @param {string} [props.className]
 * @param {number} [props.maxResults]
 * @param {"filter" | "select"} [props.mode]
 * @param {string} [props.selectedId]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.fill]
 * @param {number} [props.expandedWidth]
 * @param {import("react").ComponentType<{ className?: string }>} [props.resultIcon]
 * @param {boolean} [props.hideOrb]
 * @param {string} [props.neutralSelectedId] Varsayılan seçimde collapsedLabel göster (ör. sıralama/konum)
 */
export function GooeySearchBar({
  items = [],
  value,
  onChange,
  onSelect,
  collapsedLabel = "Search",
  placeholder = "Type to search",
  emptyLabel = "No results",
  placement = "down",
  className = "",
  maxResults = 6,
  mode = "filter",
  selectedId,
  disabled = false,
  fill = false,
  expandedWidth = 240,
  scrollMax = 0,
  resultIcon: ResultIcon = Building2,
  hideOrb = false,
  neutralSelectedId,
  /**
   * Kökteki `title` — devre dışıyken sebebini imleçle göstermek için.
   * Uyarıyı düğmenin ETİKETİ yapmak, kontrolün ne olduğunu okunmaz kılıyordu.
   */
  title,
  "aria-label": ariaLabel,
}) {
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const reduceMotion = useReducedMotion();
  // Safari/iOS Chrome tespiti — artık yalnızca menü giriş gecikmesini kısaltmak için.
  const isUnsupported = useMemo(() => isUnsupportedBrowser(), []);
  const isSelect = mode === "select";

  const [step, setStep] = useState(1);
  const [innerText, setInnerText] = useState(value ?? "");
  const [highlight, setHighlight] = useState(0);

  const searchText = isSelect ? innerText : value !== undefined ? value : innerText;

  useEffect(() => {
    if (isSelect || value === undefined) return;
    setInnerText(value);
  }, [value, isSelect]);

  const results = useMemo(() => {
    const q = searchText.trim().toLocaleLowerCase("tr-TR");
    const pool = Array.isArray(items) ? items : [];
    const filtered = q
      ? pool.filter((item) => String(item.label || "").toLocaleLowerCase("tr-TR").includes(q))
      : pool;
    return filtered.slice(0, maxResults);
  }, [items, searchText, maxResults]);

  useEffect(() => {
    setHighlight(0);
  }, [searchText, step]);

  useEffect(() => {
    if (step === 2) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 40);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [step]);

  useEffect(() => {
    if (step !== 2) return undefined;
    const onDoc = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setStep(1);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setStep(1);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [step]);

  const selectedItem = useMemo(() => {
    if (!isSelect) return null;
    const pool = Array.isArray(items) ? items : [];
    return pool.find((item) => String(item.id) === String(selectedId)) || null;
  }, [isSelect, items, selectedId]);

  const isNeutralSelection =
    isSelect &&
    neutralSelectedId != null &&
    String(selectedId) === String(neutralSelectedId);
  const collapsedText = isNeutralSelection
    ? collapsedLabel
    : selectedItem?.label || collapsedLabel;

  const commit = useCallback(
    (item) => {
      if (!item) return;
      if (isSelect) {
        setInnerText("");
        onSelect?.(item);
        onChange?.(item.id);
        setStep(1);
        return;
      }
      if (value === undefined) setInnerText(item.label);
      onChange?.(item.label);
      onSelect?.(item);
      setStep(1);
    },
    [isSelect, onChange, onSelect, value]
  );

  const handleSearch = (event) => {
    const next = event.target.value;
    if (isSelect || value === undefined) setInnerText(next);
    if (!isSelect) onChange?.(next);
  };

  const onInputKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit(results[highlight]);
    }
  };

  const expanded = step === 2;
  const showSpinner = expanded && searchText.trim().length > 0 && results.length === 0 && items.length === 0;
  const btnCollapsedWidth = fill ? "100%" : collapsedWidthFor(collapsedText);
  const btnExpandedWidth = fill ? "100%" : expandedWidth;
  const useScrollList = Number(scrollMax) > 0;

  const openBar = () => {
    if (disabled || expanded) return;
    if (isSelect) setInnerText("");
    setStep(2);
  };

  const renderResultItems = () => (
    <>
      <AnimatePresence mode="popLayout">
        {results.map((item, index) => (
          <m.button
            type="button"
            key={item.id || item.label}
            /*
              ⚠️ PERF: `whileHover={{ scale: 1.02 }}` fare her kıpırdadığında
              SVG filtresini yeniden rasterize ediyordu. Vurgu geri bildirimi
              zaten `onMouseEnter` → `is-active` sınıfıyla (CSS) veriliyor.
            */
            variants={getResultItemVariants(
              index,
              isUnsupported,
              placement,
              reduceMotion,
              useScrollList ? scrollMax : 0
            )}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={getResultItemTransition(index, reduceMotion, useScrollList ? scrollMax : 0)}
            className={clsx(
              "gooey-search__result",
              index === highlight && "is-active",
              isSelect && String(item.id) === String(selectedId) && "is-selected"
            )}
            role="option"
            aria-selected={index === highlight}
            onMouseEnter={() => setHighlight(index)}
            onClick={() => commit(item)}
          >
            {ResultIcon ? <ResultIcon className="gooey-search__info" aria-hidden="true" /> : null}
            <span className="gooey-search__result-label">{item.label}</span>
            {item.hint ? <span className="gooey-search__result-hint">{item.hint}</span> : null}
            {isSelect && String(item.id) === String(selectedId) ? (
              <m.span
                className="gooey-search__result-check"
                initial={reduceMotion ? false : { scale: 0 }}
                animate={{ scale: 1 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 500, damping: 30 }
                }
              >
                <Check aria-hidden="true" />
              </m.span>
            ) : null}
          </m.button>
        ))}
      </AnimatePresence>
      {expanded && results.length === 0 && !showSpinner ? (
        <m.div
          key="empty"
          className="gooey-search__result is-empty"
          variants={getResultItemVariants(
            0,
            isUnsupported,
            placement,
            reduceMotion,
            useScrollList ? scrollMax : 0
          )}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={getResultItemTransition(0, reduceMotion, useScrollList ? scrollMax : 0)}
        >
          <span className="gooey-search__result-label">{emptyLabel}</span>
        </m.div>
      ) : null}
    </>
  );

  return (
    <LazyMotion features={loadDomAnimation} strict>
    <div
      ref={rootRef}
      className={clsx(
        "gooey-search",
        fill && "gooey-search--fill",
        disabled && "gooey-search--disabled",
        className
      )}
      data-placement={placement}
      data-expanded={expanded ? "" : undefined}
      title={title}
    >
      <div className="gooey-search__stage">
        <m.div
          className="gooey-search__inner"
          initial={false}
          animate={expanded ? "step2" : "step1"}
          transition={
            reduceMotion
              ? { duration: 0.12 }
              : { type: "spring", stiffness: 420, damping: 34 }
          }
        >
          <AnimatePresence mode="popLayout">
            {expanded ? (
              <m.div
                key="search-results"
                className="gooey-search__results"
                role="listbox"
                aria-label={ariaLabel || collapsedLabel}
                style={{ "--gooey-scroll-max": Number(scrollMax) > 0 ? scrollMax : 5 }}
                /*
                  Açılır panel artık kaynaktaki sade dil: aşağı (ya da `up`'ta
                  yukarı) doğru kısa bir kayma + solma. Giriş, düğme genişledikten
                  SONRA (gecikme durumun içinde); çıkış gecikmesiz — açılış/kapanış
                  yine birbirinin aynası, sadece yön ve süre sadeleşti.
                */
                initial={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: placement === "up" ? 8 : -8 }
                }
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: {
                    // Panel, hap genişlerken hemen hemen aynı anda açılsın —
                    // eski 0.32 sn gecikme "tıkladım, bir şey olmadı" hissi veriyordu.
                    delay: reduceMotion || isUnsupported ? 0.02 : 0.08,
                    duration: reduceMotion ? 0.1 : 0.16,
                    ease: [0.16, 1, 0.3, 1],
                  },
                }}
                exit={
                  reduceMotion
                    ? { opacity: 0, transition: { duration: 0.1 } }
                    : {
                        opacity: 0,
                        y: placement === "up" ? 6 : -6,
                        transition: { duration: 0.16 },
                      }
                }
              >
                {renderResultItems()}
              </m.div>
            ) : null}
          </AnimatePresence>

          <m.div
            className="gooey-search__btn"
            variants={{
              step1: { x: 0, width: btnCollapsedWidth },
              step2: { x: 0, width: btnExpandedWidth },
            }}
            role={expanded ? undefined : "button"}
            tabIndex={expanded || disabled ? undefined : 0}
            aria-disabled={disabled || undefined}
            onClick={openBar}
            onKeyDown={(event) => {
              if (expanded) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openBar();
              }
            }}
            whileHover={reduceMotion || expanded || disabled ? undefined : { scale: 1.05 }}
            whileTap={reduceMotion || disabled ? undefined : { scale: 0.95 }}
          >
            {expanded ? (
              <input
                ref={inputRef}
                type="search"
                className="gooey-search__input"
                placeholder={placeholder}
                aria-label={ariaLabel || collapsedLabel}
                aria-expanded={expanded}
                autoComplete="off"
                value={searchText}
                onChange={handleSearch}
                onKeyDown={onInputKeyDown}
              />
            ) : (
              <span className="gooey-search__label">{collapsedText}</span>
            )}
          </m.div>

          <AnimatePresence mode="wait">
            {expanded && !fill && !hideOrb ? (
              <m.div
                key="orb"
                className="gooey-search__orb"
                initial={reduceMotion ? { opacity: 0 } : { x: -36, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { x: -36, opacity: 0 }}
                transition={
                  reduceMotion
                    ? { duration: 0.12 }
                    : { type: "spring", stiffness: 420, damping: 34 }
                }
              >
                {showSpinner ? (
                  <Loader2 className="gooey-search__spinner" aria-hidden="true" />
                ) : (
                  <Search className="gooey-search__glyph" aria-hidden="true" />
                )}
              </m.div>
            ) : null}
          </AnimatePresence>
        </m.div>
      </div>
    </div>
    </LazyMotion>
  );
}

export default GooeySearchBar;

export function GooeyPillField({
  label,
  value = "",
  onChange,
  type = "text",
  disabled = false,
  readOnly = false,
  muted = false,
  tone = "default",
  placeholder = "",
  min,
  className = "",
  title,
  "aria-label": ariaLabel,
}) {
  const hasValue = String(value || "").trim().length > 0;
  const showActiveResult = readOnly && !muted && hasValue;
  const showPlaceholder = Boolean(placeholder) && !hasValue;
  const isDarkTone = tone === "dark";

  return (
    <div
      className={clsx(
        "gooey-pill-field",
        disabled && "is-disabled",
        readOnly && "is-readonly",
        muted && "is-muted",
        isDarkTone && "is-dark-tone",
        showActiveResult && "has-value",
        !readOnly && hasValue && "has-input-value",
        (disabled || (readOnly && !hasValue && title)) && "is-locked",
        className
      )}
      title={title}
    >
      {label ? <span className="gooey-pill-field__label">{label}</span> : null}
      {/*
        `surface-neon` — Buy/Sell'in aktif hapıyla AYNI token: koyu temada
        beyaz zemin + siyah yazı, açık temada siyah zemin + beyaz yazı (+neon
        ışıma). Kullanıcı "Buy, Sell gibi olacak" dedi; bunu taklit etmek
        yerine sitenin zaten paylaştığı vurgu yüzeyini birebir kullanıyoruz.
      */}
      <div
        className={clsx(
          "gooey-pill-field__surface surface-neon",
          !readOnly && "gooey-pill-field__surface--edit",
          isDarkTone && !readOnly && "gooey-pill-field__surface--dark",
          isDarkTone && readOnly && "gooey-pill-field__surface--dark-readonly",
          showActiveResult && "gooey-pill-field__surface--active"
        )}
      >
        {readOnly ? (
          <span className={clsx("gooey-pill-field__value", showPlaceholder && "is-placeholder")}>
            {value || (showPlaceholder ? placeholder : "")}
          </span>
        ) : (
          <input
            type={type}
            min={min}
            className="gooey-pill-field__input"
            disabled={disabled}
            value={value}
            placeholder={placeholder}
            aria-label={ariaLabel || label}
            onChange={(event) => onChange?.(event.target.value)}
          />
        )}
      </div>
    </div>
  );
}

export function GooeyField({
  label,
  value = "",
  onChange,
  type = "text",
  disabled = false,
  readOnly = false,
  muted = false,
  placeholder = "",
  min,
  className = "",
  "aria-label": ariaLabel,
}) {
  return (
    <div
      className={clsx(
        "gooey-field",
        disabled && "is-disabled",
        muted && "is-muted",
        readOnly && "is-readonly",
        className
      )}
    >
      {label ? <span className="gooey-field__label">{label}</span> : null}
      <input
        type={type}
        min={min}
        className="gooey-field__input"
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel || label}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </div>
  );
}

export function GooeyToggle({
  label,
  checked = false,
  onChange,
  className = "",
  icon: Icon,
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={clsx("gooey-toggle", !checked && "is-off", className)}
      onClick={() => onChange?.(!checked)}
    >
      {Icon ? <Icon className="gooey-toggle__icon" aria-hidden="true" /> : null}
      <span className="gooey-toggle__label">{label}</span>
      <span className="gooey-toggle__track" aria-hidden="true">
        <span className="gooey-toggle__knob" />
      </span>
    </button>
  );
}

export function GooeySegment({ options = [], value, onChange, className = "", "aria-label": ariaLabel }) {
  return (
    <div className={clsx("gooey-segment", className)} role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const on = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            className={clsx("gooey-segment__btn", on && "is-on")}
            onClick={() => onChange?.(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

