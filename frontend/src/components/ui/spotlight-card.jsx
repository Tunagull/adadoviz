import { useCallback, useEffect, useRef } from "react";

/**
 * İmleci takip eden neon kenarlık ışıması.
 *
 * Kaynak bileşen TypeScript + shadcn yapısı için yazılmıştı; bu kod tabanı
 * düz JSX olduğu için tipler JSDoc'a taşındı. İki davranış farkı bilinçli:
 *
 * 1. Kaynak sürüm `document`'a pointermove bağlar ve `background-attachment:
 *    fixed` ile görüntü alanı koordinatı kullanır. Bu, imleç NEREDE olursa
 *    olsun ekrandaki TÜM kartların yanması demektir; panoda 16 kart var ve
 *    istenen davranış "üzerine gelince yanması". Burada dinleyici kartın
 *    kendisinde ve koordinat karta göreli.
 * 2. Kaynak sürüm her örnekte ayrı bir <style> etiketi basıyordu (16 kart =
 *    16 kopya). Statik CSS `index.css` içindeki `.glow-card` katmanına taşındı;
 *    bileşen yalnızca iki özel değişken yazıyor.
 *
 * Görünürlük kararını CSS `:hover` veriyor — React state'i yok, dolayısıyla
 * imleç hareketi yeniden render tetiklemiyor.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.children
 * @param {string} [props.className]        Kart yüzeyinin kendi sınıfları (arka plan, kenarlık, dolgu, yarıçap).
 * @param {keyof typeof GLOW_COLORS} [props.glowColor]  Işığın rengi (varsayılan beyaz).
 * @param {number} [props.glowSize]         Işık huzmesinin px cinsinden çapı.
 * @param {import("react").ElementType} [props.as]  Kök etiket (varsayılan `div`).
 */

/**
 * Işık renkleri [ton açısı, doygunluk].
 *
 * Varsayılan BEYAZ (doygunluk 0): tasarım dilinde vurgu bir renk değil,
 * parlaklık. Renkli tonlar yalnızca anlam taşıdıkları yerde kullanılır —
 * kur yükseldi/düştü gibi.
 */
const GLOW_COLORS = {
  /**
   * Beyaz tamamen doygunluksuz DEĞİL: %18 doygunlukla soğuk bir beyaz.
   * Saf gri (0%) ışıması siyah zeminde "ışık" gibi değil "açık gri kenarlık"
   * gibi okunuyordu; gerçek beyaz ışık kaynakları da nötr değil, hafif mavi
   * tarafa düşer. Renk olarak algılanmayacak kadar az, ışık olarak algılanmaya
   * yetecek kadar çok.
   */
  white: [210, "18%"],
  green: [145, "85%"],
  red: [2, "85%"],
  amber: [40, "90%"],
};

export function GlowCard({
  children,
  className = "",
  glowColor = "white",
  glowSize = 260,
  as: Tag = "div",
  style,
  onPointerMove,
  ...rest
}) {
  const cardRef = useRef(null);
  const frameRef = useRef(0);
  const pointerRef = useRef(null);

  /**
   * Koordinat yazımı kareye bir kez düşürülüyor. Ölçüm okuması
   * (getBoundingClientRect) de bu callback'in içinde: pointermove saniyede
   * 120+ kez tetiklenebiliyor ve her tetikte layout okumak, sonra hemen stil
   * yazmak düzen hesabını tekrar tekrar geçersiz kılar.
   */
  const flush = useCallback(() => {
    frameRef.current = 0;
    const el = cardRef.current;
    const pointer = pointerRef.current;
    if (!el || !pointer) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--glow-x", `${(pointer.x - rect.left).toFixed(1)}px`);
    el.style.setProperty("--glow-y", `${(pointer.y - rect.top).toFixed(1)}px`);
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  const handlePointerMove = useCallback(
    (event) => {
      onPointerMove?.(event);
      // Dokunmatikte ışıma zaten kapalı (@media hover); boşuna iş yapmayalım.
      if (event.pointerType === "touch") return;
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (!frameRef.current) frameRef.current = requestAnimationFrame(flush);
    },
    [flush, onPointerMove]
  );

  const [hue, saturation] = GLOW_COLORS[glowColor] ?? GLOW_COLORS.white;

  return (
    <Tag
      ref={cardRef}
      className={`glow-card ${className}`}
      style={{
        "--glow-hue": hue,
        "--glow-sat": saturation,
        "--glow-size": `${glowSize}px`,
        ...style,
      }}
      onPointerMove={handlePointerMove}
      {...rest}
    >
      {/*
        Işık katmanları içerikten ÖNCE yazılıyor ama konumlandırıldıkları için
        akıştaki içeriğin üzerine boyanırlar (CSS boyama sırası). Halka kartın
        1.5 px kenarında, iç aydınlanma %10 opaklıkta olduğu için okumayı
        etkilemiyor; kenara değen bir içerik olursa `relative z-raised` alır.
      */}
      <span className="glow-card__aura" aria-hidden="true">
        <span />
      </span>
      <span className="glow-card__ring" aria-hidden="true" />
      <span className="glow-card__sheen" aria-hidden="true" />
      {children}
    </Tag>
  );
}
