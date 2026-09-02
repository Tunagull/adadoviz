import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowUpRight, Check, ClipboardList, Copy, Gauge, Link2, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { BrandMark } from "./BrandLogo";
import { contactDisplay, contactLinks } from "../lib/contact";
import { GmailIcon, InstagramIcon, WhatsAppIcon } from "./ui/brand-icons";

/**
 * İletişim kanalları — yörüngede dönen çark.
 *
 * Her düğüm bir kanal: WhatsApp, Instagram, Gmail, telefon ve partnerlik
 * formu. Tıklanan düğüm çarkın tepesine (270°) döndürülüyor, kartı da onun
 * altında açılıyor; böylece kart hangi düğüm seçilirse seçilsin sahnenin
 * içinde ve ortada kalıyor.
 *
 * Yörünge daire değil ELİPS: yatay ve dikey yarıçap ayrı hesaplanıyor.
 * Dairede genişliği ekran yüksekliği sınırlıyordu ve geniş ekranda iki yan
 * bomboş kalıyordu; elips sahnenin gerçek en–boy oranını dolduruyor.
 *
 * DÖNÜŞ ANİMASYONU React'in dışında yürüyor. Önceki sürüm 50 ms'lik bir
 * setInterval ile state güncelliyor, düğümlerde de `transition: transform
 * 700ms` vardı: her tik 700 ms'lik geçişi baştan başlatıyordu, yani düğümler
 * hedefe hiç varamadan yeniden yola çıkıyor ve saniyede 20 kez tüm ağaç
 * yeniden render ediliyordu — takılmanın sebebi buydu. Artık tek bir rAF
 * döngüsü açıyı ilerletip transform'ları doğrudan DOM'a yazıyor; CSS'te
 * transform geçişi yok, React kare başına render etmiyor.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Serbest dönüş hızı (derece/ms) — tam tur ~60 sn. */
const SPIN_PER_MS = 0.006;
/** Seçilen düğümün tepeye oturduğu açı (ekran koordinatlarında yukarı). */
const TOP_ANGLE = 270;

/**
 * matchMedia aboneliği: hareket tercihi değişince yeniden çizer.
 * useEffect + setState yerine useSyncExternalStore: ilk boyama zaten doğru
 * değerle yapılıyor, ekstra bir render turu oluşmuyor.
 */
function useMediaQuery(query) {
  const subscribe = useCallback(
    (onStoreChange) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query]
  );

  const getSnapshot = useCallback(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
    [query]
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** İki açı arasındaki en kısa işaretli fark, [-180, 180). */
function shortestDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Elipsin yarıçapları sahnenin ölçülen kutusundan geliyor.
 *
 * İç boşluklar düğümün ve etiketinin sahne dışına taşmasını engelliyor:
 * yatayda etiketin yarı genişliği (index.css'teki `.orbital-contact__title`
 * max-width'i), dikeyde düğüm yarıçapı + etiket yüksekliği kadar.
 */
function computeGeometry(width, height, viewportWidth) {
  if (!width || !height) return { rx: 240, ry: 160 };

  const labelHalf = Math.min(56, viewportWidth * 0.11) + 8;
  const rx = Math.max(88, width / 2 - (labelHalf + 24));
  let ry = Math.max(78, height / 2 - 80);

  // Aşırı basık/uzun elips düğümleri üst üste bindiriyor; oran sınırlanıyor.
  ry = Math.min(ry, rx * 1.9);
  return { rx: Math.min(rx, ry * 3.4), ry };
}

export function RadialOrbitalContact({ formTo = "/partnerlik" }) {
  const { t } = useLanguage();
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);

  const [activeId, setActiveId] = useState(null);
  const [hovering, setHovering] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const containerRef = useRef(null);
  const orbitRef = useRef(null);
  const observerRef = useRef(null);
  const copyTimerRef = useRef(null);

  // Animasyon durumu — hiçbiri render tetiklemiyor.
  const nodeElsRef = useRef([]);
  const angleRef = useRef(TOP_ANGLE);
  const targetAngleRef = useRef(null);
  const pausedRef = useRef(false);
  const geometryRef = useRef({ rx: 240, ry: 160 });

  const channels = useMemo(
    () => [
      {
        id: 1,
        key: "Whatsapp",
        Icon: WhatsAppIcon,
        accent: "#25d366",
        href: contactLinks.whatsapp,
        value: contactDisplay.whatsapp,
        copyable: true,
        external: true,
        speed: 100,
        relatedIds: [4, 5],
      },
      {
        id: 2,
        key: "Instagram",
        Icon: InstagramIcon,
        accent: "#e1306c",
        href: contactLinks.instagram,
        value: contactDisplay.instagram,
        copyable: false,
        external: true,
        speed: 70,
        relatedIds: [1],
      },
      {
        id: 3,
        key: "Gmail",
        Icon: GmailIcon,
        accent: "#ea4335",
        href: contactLinks.email,
        value: contactDisplay.email,
        copyable: true,
        external: false,
        speed: 55,
        relatedIds: [5],
      },
      {
        id: 4,
        key: "Phone",
        Icon: Phone,
        accent: "#38bdf8",
        href: contactLinks.phone,
        value: contactDisplay.phone,
        copyable: true,
        external: false,
        speed: 90,
        relatedIds: [1],
      },
      {
        // Diğerleriyle aynı format: kartı açılıyor, eylemi uygulama içi bir
        // yönlendirme (`to`) olduğu için CTA <Link> olarak basılıyor.
        id: 5,
        key: "Form",
        Icon: ClipboardList,
        accent: "#a78bfa",
        to: formTo,
        value: null,
        copyable: false,
        external: false,
        speed: 45,
        relatedIds: [1, 3],
      },
    ],
    [formTo]
  );

  const relatedOf = useCallback(
    (id) => channels.find((channel) => channel.id === id)?.relatedIds ?? [],
    [channels]
  );

  /** Düğüm konumlarını doğrudan DOM'a yazar — React render'ı devrede değil. */
  const applyTransforms = useCallback(() => {
    const { rx, ry } = geometryRef.current;
    const total = channels.length;

    for (let i = 0; i < total; i += 1) {
      const el = nodeElsRef.current[i];
      if (!el) continue;

      const radian = (((i / total) * 360 + angleRef.current) * Math.PI) / 180;
      const cos = Math.cos(radian);
      const sin = Math.sin(radian);
      const expanded = el.dataset.expanded === "true";

      el.style.transform = `translate3d(${(rx * cos).toFixed(2)}px, ${(ry * sin).toFixed(2)}px, 0)`;
      el.style.zIndex = expanded ? "200" : String(Math.round(100 + 50 * cos));
      // Alt yarıdaki düğümler soluyor: derinlik hissi ve tepedeki seçili
      // düğümün öne çıkması için.
      el.style.opacity = expanded
        ? "1"
        : Math.max(0.45, Math.min(1, 0.45 + 0.55 * ((1 + sin) / 2))).toFixed(3);
    }
  }, [channels.length]);

  // Tek bir rAF döngüsü bileşen bağlıyken hep dönüyor. Duraklatma ve oturma
  // yalnızca ref okuyor, döngü hiç durdurulup başlatılmıyor: "kuyrukta kare
  // var mı" tarzı bir bayrak tutmak, iptal edilmiş bir id geride kaldığında
  // çarkı büsbütün durduran bir hata sınıfı doğuruyordu. Duraklatmada kare
  // başına iki ref okuması yapılıyor, DOM'a dokunulmuyor.
  useEffect(() => {
    let raf = 0;
    let last = 0;

    const tick = (now) => {
      raf = window.requestAnimationFrame(tick);
      // Sekme arka plandayken rAF durur; dönüşte tek karede sıçramasın diye
      // fark üst sınırlanıyor.
      const dt = last ? Math.min(50, now - last) : 0;
      last = now;

      if (targetAngleRef.current != null) {
        const delta = shortestDelta(angleRef.current, targetAngleRef.current);
        if (Math.abs(delta) < 0.15) {
          angleRef.current = targetAngleRef.current;
          targetAngleRef.current = null;
        } else {
          // Üstel yaklaşım: hızlı başlar, hedefe yumuşak oturur.
          angleRef.current += delta * (1 - Math.exp(-dt / 90));
        }
      } else if (!pausedRef.current) {
        angleRef.current = (angleRef.current + SPIN_PER_MS * dt) % 360;
      } else {
        return;
      }

      applyTransforms();
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [applyTransforms]);

  const openNode = useCallback(
    (id) => {
      if (activeId === id) {
        setActiveId(null);
        return;
      }

      const index = channels.findIndex((channel) => channel.id === id);
      if (index >= 0) {
        // Seçilen düğümü tepeye taşı: kart sahnenin ortasına açılsın.
        const target = (((TOP_ANGLE - (index / channels.length) * 360) % 360) + 360) % 360;
        if (reducedMotion) {
          angleRef.current = target;
          targetAngleRef.current = null;
        } else {
          targetAngleRef.current = target;
        }
      }

      setActiveId(id);
    },
    [activeId, channels, reducedMotion]
  );

  const closeNode = useCallback(() => setActiveId(null), []);

  // Yarıçaplar sahnenin ölçülen boyutundan geliyor; kırılım noktasına
  // sabitlenmiş bir değer, kabuk kalkıp kompozisyon tam genişliğe açılınca
  // tutmuyordu.
  //
  // Ölçüm callback ref'te, useEffect'te değil: element bağlanır bağlanmaz
  // okunuyor, böylece ilk boyama ResizeObserver'ın ilk teslimatını beklemiyor
  // (beklerse tek kare de olsa varsayılan yarıçapla çizilirdi).
  const stageRef = useCallback((node) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    setStageSize({ width: rect.width, height: rect.height });

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setStageSize({ width: box.width, height: box.height });
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  const geometry = useMemo(
    () =>
      computeGeometry(
        stageSize.width,
        stageSize.height,
        typeof window === "undefined" ? 1280 : window.innerWidth
      ),
    [stageSize]
  );

  // Her render'dan sonra geometriyi tazeleyip konumları yeniden yaz: transform
  // JSX'te değil burada üretiliyor, aksi hâlde React her render'da düğümleri
  // stilsiz bırakırdı.
  useLayoutEffect(() => {
    geometryRef.current = geometry;
    applyTransforms();
  });

  // Duraklatma: kart açıkken, imleç bir düğümün/kartın üzerindeyken veya
  // kullanıcı hareketi azalttığında serbest dönüş durur (seçilen düğümün
  // tepeye oturma animasyonu yine de tamamlanır).
  useEffect(() => {
    pausedRef.current = reducedMotion || activeId !== null || hovering;
  }, [reducedMotion, activeId, hovering]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      window.clearTimeout(copyTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (activeId === null) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeNode();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, closeNode]);

  const copyValue = useCallback(async (channel) => {
    if (!channel.value || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(channel.value);
      setCopiedId(channel.id);
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Pano izni yoksa sessizce geç: değer zaten kartta seçilebilir hâlde.
    }
  }, []);

  const handleBackdropClick = (event) => {
    if (event.target === containerRef.current || event.target === orbitRef.current) {
      closeNode();
    }
  };

  const hoverProps = {
    onMouseEnter: () => setHovering(true),
    onMouseLeave: () => setHovering(false),
  };

  const activeChannel = channels.find((channel) => channel.id === activeId) ?? null;
  const activeCardId = activeChannel
    ? `orbital-channel-${activeChannel.key.toLowerCase()}`
    : undefined;
  const iconSize = geometry.ry >= 190 ? 22 : 17;

  return (
    <div
      ref={containerRef}
      className="orbital-contact"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <p className="orbital-contact__hint">{t("contactOrbitalHint")}</p>

      {/* Yarıçaplar tek kaynaktan: halkanın boyutu ve kartın dikey konumu da
          ölçülen değerlerden türüyor, JS ile CSS ayrışamıyor. */}
      <div
        ref={stageRef}
        className="orbital-contact__stage"
        style={{ "--orbital-rx": `${geometry.rx}px`, "--orbital-ry": `${geometry.ry}px` }}
      >
        <div ref={orbitRef} className="orbital-contact__orbit">
          <div
            className={`orbital-contact__core ${activeChannel ? "is-dimmed" : ""}`}
            aria-hidden="true"
          >
            <span className="orbital-contact__core-ring orbital-contact__core-ring--outer" />
            <span className="orbital-contact__core-ring orbital-contact__core-ring--inner" />
            <BrandMark className="orbital-contact__core-mark" />
          </div>

          <div className="orbital-contact__ring" aria-hidden="true" />

          {channels.map((channel, index) => {
            const isExpanded = activeId === channel.id;
            const isRelated = activeId !== null && relatedOf(activeId).includes(channel.id);
            const { Icon } = channel;
            const label = t(`contactChannel${channel.key}Label`);

            return (
              <div
                key={channel.id}
                // transform/zIndex/opacity JSX'te YOK: rAF döngüsü yazıyor.
                ref={(el) => {
                  nodeElsRef.current[index] = el;
                }}
                data-expanded={isExpanded ? "true" : "false"}
                className="orbital-contact__node"
                style={{ "--orbital-accent": channel.accent }}
              >
                <button
                  type="button"
                  className={`orbital-contact__trigger ${
                    isExpanded ? "is-expanded" : isRelated ? "is-related" : ""
                  }`}
                  aria-expanded={isExpanded}
                  // Kart kapalıyken o id'li düğüm DOM'da yok; geçersiz bir
                  // IDREF bırakmamak için öznitelik tamamen kaldırılıyor.
                  aria-controls={isExpanded ? activeCardId : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    openNode(channel.id);
                  }}
                  {...hoverProps}
                >
                  <span className="orbital-contact__glow" aria-hidden="true" />
                  <span className="orbital-contact__icon">
                    <Icon size={iconSize} aria-hidden="true" />
                  </span>
                  <span className="orbital-contact__title">{label}</span>
                </button>
              </div>
            );
          })}

          {/* Kart düğümün değil sahnenin çocuğu: seçilen düğüm her zaman
              tepeye geldiği için kartın son konumu sabit. Düğüme bağlıyken
              soldaki/sağdaki düğümlerde sahnenin dışına taşıyordu ve oturma
              animasyonu boyunca ekranda uçuşuyordu. */}
          {activeChannel ? (
            <div
              id={activeCardId}
              className="orbital-contact__card"
              style={{ "--orbital-accent": activeChannel.accent }}
              onClick={(event) => event.stopPropagation()}
              role="presentation"
              {...hoverProps}
            >
              <div className="orbital-contact__card-connector" aria-hidden="true" />

              <span className="orbital-contact__badge">
                {t(`contactChannel${activeChannel.key}Badge`)}
              </span>
              <h3 className="orbital-contact__card-title">
                {t(`contactChannel${activeChannel.key}Label`)}
              </h3>
              <p className="orbital-contact__card-copy">
                {t(`contactChannel${activeChannel.key}Desc`)}
              </p>

              {activeChannel.value ? (
                <div className="orbital-contact__value">
                  <span className="orbital-contact__value-text">{activeChannel.value}</span>
                  {activeChannel.copyable ? (
                    <button
                      type="button"
                      className="orbital-contact__copy"
                      onClick={() => copyValue(activeChannel)}
                      aria-label={
                        copiedId === activeChannel.id
                          ? t("contactOrbitalCopied")
                          : t("contactOrbitalCopy")
                      }
                      title={
                        copiedId === activeChannel.id
                          ? t("contactOrbitalCopied")
                          : t("contactOrbitalCopy")
                      }
                    >
                      {copiedId === activeChannel.id ? (
                        <Check size={13} aria-hidden="true" />
                      ) : (
                        <Copy size={13} aria-hidden="true" />
                      )}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="orbital-contact__meter">
                <div className="orbital-contact__meter-label">
                  <Gauge size={12} aria-hidden="true" />
                  <span>{t("contactOrbitalResponse")}</span>
                  <span className="orbital-contact__meter-value">
                    {t(`contactChannel${activeChannel.key}Speed`)}
                  </span>
                </div>
                <div className="orbital-contact__meter-track">
                  <div
                    className="orbital-contact__meter-fill"
                    style={{ width: `${activeChannel.speed}%` }}
                  />
                </div>
              </div>

              {activeChannel.to ? (
                <Link className="orbital-contact__cta" to={activeChannel.to}>
                  {t(`contactChannel${activeChannel.key}Action`)}
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              ) : (
                <a
                  className="orbital-contact__cta"
                  href={activeChannel.href}
                  {...(activeChannel.external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {t(`contactChannel${activeChannel.key}Action`)}
                  <ArrowUpRight size={15} aria-hidden="true" />
                </a>
              )}

              {activeChannel.relatedIds.length > 0 ? (
                <div className="orbital-contact__related">
                  <div className="orbital-contact__related-label">
                    <Link2 size={12} aria-hidden="true" />
                    <span>{t("contactOrbitalConnected")}</span>
                  </div>
                  <div className="orbital-contact__related-list">
                    {activeChannel.relatedIds.map((relatedId) => {
                      const related = channels.find((entry) => entry.id === relatedId);
                      if (!related) return null;
                      return (
                        <button
                          key={relatedId}
                          type="button"
                          className="orbital-contact__related-btn"
                          onClick={() => openNode(relatedId)}
                        >
                          {t(`contactChannel${related.key}Label`)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default RadialOrbitalContact;
