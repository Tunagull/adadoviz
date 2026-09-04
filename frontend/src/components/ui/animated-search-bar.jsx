import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, LazyMotion, m, useReducedMotion } from "framer-motion";
import clsx from "clsx";
import { Building2, Loader2, Search } from "lucide-react";

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

function GooeyFilter({ id }) {
  return (
    <svg className="gooey-search__svg" aria-hidden="true" width="0" height="0">
      <defs>
        <filter id={id}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -15"
            result="goo"
          />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
  );
}

function getResultItemVariants(index, isUnsupported, placement, reduceMotion, scrollMax = 0) {
  const stack = (index + 1) * STACK_STEP_PX;
  const y = placement === "up" ? -stack : stack;
  const skipStackMotion = scrollMax > 0 && index >= scrollMax;

  if (reduceMotion || skipStackMotion) {
    return {
      initial: { y, opacity: 0 },
      animate: { y, opacity: 1 },
      exit: { opacity: 0 },
    };
  }
  /*
    ⚠️ PERF: Her sonuç baloncuğu ayrıca `filter: blur(10px) → blur(0)` anime
    ediyordu. Kök `<div>` zaten SVG `feGaussianBlur` filtresi altında olduğu
    için bu, her karede filtre grafiğinin öğe başına + kapsayıcı olmak üzere
    İKİ KEZ CPU'da yeniden rasterize edilmesi demekti — açılışta takılmanın
    baş sebebi. "Gooey" birleşme efekti zaten kapsayıcı filtresinden geliyor;
    öğe başına blur'u kaldırmak efekti bozmaz, kare maliyetini düşürür.
    Kalan hareket y + scale + opacity — üçü de compositable.
  */
  void isUnsupported;
  return {
    initial: { y: 0, scale: 0.3, opacity: 0.6 },
    animate: { y, scale: 1, opacity: 1 },
    exit: {
      y: placement === "up" ? 4 : -4,
      scale: 0.8,
      opacity: 0,
    },
  };
}

function getResultItemTransition(index, reduceMotion, scrollMax = 0) {
  if (reduceMotion) return { duration: 0.15 };
  if (scrollMax > 0 && index >= scrollMax) {
    return { duration: 0.12, delay: 0 };
  }
  return {
    duration: 0.75,
    delay: index * 0.08,
    type: "spring",
    bounce: 0.35,
    exit: { duration: Math.min(index * 0.08, 0.24) },
  };
}

function collapsedWidthFor(label) {
  return Math.min(220, Math.max(118, String(label || "").length * 9 + 36));
}

const STACK_STEP_PX = 50;

function getStackInnerHeight(count) {
  return Math.max(count, 1) * STACK_STEP_PX;
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
  const reactId = useId().replace(/:/g, "");
  const filterId = `goo-effect-${reactId}`;
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const isUnsupported = useMemo(() => isUnsupportedBrowser(), []);
  const isSelect = mode === "select";

  const [step, setStep] = useState(1);
  const [innerText, setInnerText] = useState(value ?? "");
  const [highlight, setHighlight] = useState(0);
  /*
    ⚠️ PERF: SVG gooey filtresi (`filter: url(#…)`) GPU'da compose edilemez —
    kapsadığı ağaç her karede CPU'da yeniden rasterize edilir. Sayfada birden
    çok GooeySearchBar var; hepsinin filtresi boşta dururken bile sürekli
    açık kalması ana sayfayı ağırlaştırıyordu. Filtre yalnızca kullanıcı
    kutuyla etkileşirken (açılış + kapanış animasyonu boyunca) aktif; kapalı
    tek hap durumdayken zaten hiçbir şeyi "birleştirmediği" için gereksiz.
  */
  const [filterActive, setFilterActive] = useState(false);

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
      const t = window.setTimeout(() => inputRef.current?.focus(), 120);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [step]);

  // Filtreyi etkileşim penceresiyle sınırla: açılırken hemen aç, kapanırken
  // çıkış animasyonu bitene kadar (≈400 ms) açık tut, sonra kapat.
  useEffect(() => {
    if (step === 2) {
      setFilterActive(true);
      return undefined;
    }
    const t = window.setTimeout(() => setFilterActive(false), 420);
    return () => window.clearTimeout(t);
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
  const stackInnerHeight = getStackInnerHeight(results.length);

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
            className={clsx("gooey-search__result", index === highlight && "is-active")}
            role="option"
            aria-selected={index === highlight}
            onMouseEnter={() => setHighlight(index)}
            onClick={() => commit(item)}
          >
            {ResultIcon ? <ResultIcon className="gooey-search__info" aria-hidden="true" /> : null}
            <span className="gooey-search__result-label">{item.label}</span>
            {item.hint ? <span className="gooey-search__result-hint">{item.hint}</span> : null}
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
        isUnsupported && "no-goo",
        fill && "gooey-search--fill",
        disabled && "gooey-search--disabled",
        useScrollList && "gooey-search--stack-scroll",
        className
      )}
      data-placement={placement}
      data-expanded={expanded ? "" : undefined}
      title={title}
      style={isUnsupported || !filterActive ? undefined : { filter: `url(#${filterId})` }}
    >
      <GooeyFilter id={filterId} />

      <div className="gooey-search__stage">
        <m.div
          className="gooey-search__inner"
          initial={false}
          animate={expanded ? "step2" : "step1"}
          transition={
            reduceMotion
              ? { duration: 0.15 }
              : { duration: 0.75, type: "spring", bounce: 0.15 }
          }
        >
          <AnimatePresence mode="popLayout">
            {expanded ? (
              <m.div
                key="search-results"
                className={clsx("gooey-search__results", useScrollList && "is-stack-scroll")}
                role="listbox"
                aria-label={ariaLabel || collapsedLabel}
                style={
                  useScrollList
                    ? { "--gooey-scroll-max": scrollMax, "--gooey-stack-height": `${stackInnerHeight}px` }
                    : undefined
                }
                /*
                  Açılış ve kapanış artık BİRBİRİNİN AYNASI.

                  Eskiden `initial`/`animate` hiç yoktu — liste açılışta
                  animasyonsuz beliriyordu. Tek `transition` ise hem girişe hem
                  ÇIKIŞA uygulanıyordu ve içinde `delay: 0.35` vardı: kapanırken
                  liste önce 350 ms hiçbir şey yapmadan duruyor, sonra birden
                  siliniyordu. Gecikmenin sebebi girişte düğmenin önce genişlemesi;
                  çıkışta ise ters sıra gerekiyor — önce liste küçülsün.

                  Gecikme bu yüzden `transition` yerine durumların İÇİNE taşındı:
                  girişte var, çıkışta yok.
                */
                initial={reduceMotion ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: 1,
                  transition: {
                    delay: reduceMotion || isUnsupported ? 0.05 : 0.35,
                    duration: reduceMotion ? 0.15 : 0.35,
                  },
                }}
                exit={
                  reduceMotion
                    ? { opacity: 0, transition: { duration: 0.12 } }
                    : { scale: 0.6, opacity: 0, transition: { delay: 0, duration: 0.24 } }
                }
              >
                {useScrollList ? (
                  <div className="gooey-search__stack-inner" style={{ height: `${stackInnerHeight}px` }}>
                    {renderResultItems()}
                  </div>
                ) : (
                  renderResultItems()
                )}
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
                    ? { duration: 0.15 }
                    : { delay: 0.08, duration: 0.85, type: "spring", bounce: 0.15 }
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

