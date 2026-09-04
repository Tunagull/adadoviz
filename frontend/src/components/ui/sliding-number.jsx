import { useEffect } from "react";
import {
  LazyMotion,
  m,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import useMeasure from "react-use-measure";

/**
 * Rakamları makara gibi kaydıran sayı göstergesi.
 *
 * Her basamak 0–9 arası on kopyayı üst üste tutuyor; aktif rakam bir yay
 * (spring) ile hedefe kayıyor, en kısa yol seçiliyor (9→0 yukarı değil aşağı).
 * Kayma yüksekliği ÖLÇÜMDEN geliyor (react-use-measure) — sabit bir piksel
 * değeri font/zoom değişince şaşardı.
 *
 * `motion` yerine `m` + tembel `domAnimation`: başlık paketine framer-motion'ın
 * tam sürümünü sokmuyoruz (O-01 satıcı ayrımıyla aynı mantık).
 */

const TRANSITION = {
  type: "spring",
  stiffness: 280,
  damping: 18,
  mass: 0.3,
};

/** domAnimation ~15 kB; layout animasyonu kullanmadığımız için yeterli. */
const loadFeatures = () =>
  import("framer-motion").then((mod) => mod.domAnimation);

function Digit({ value, place }) {
  const valueRoundedToPlace = Math.floor(value / place) % 10;
  const initial = useMotionValue(valueRoundedToPlace);
  const animatedValue = useSpring(initial, TRANSITION);

  useEffect(() => {
    animatedValue.set(valueRoundedToPlace);
  }, [animatedValue, valueRoundedToPlace]);

  return (
    <div className="relative inline-block w-[1ch] overflow-x-visible overflow-y-clip leading-none tabular-nums">
      <div className="invisible">0</div>
      {Array.from({ length: 10 }, (_, i) => (
        <Num key={i} mv={animatedValue} number={i} />
      ))}
    </div>
  );
}

function Num({ mv, number }) {
  const [ref, bounds] = useMeasure();

  const y = useTransform(mv, (latest) => {
    if (!bounds.height) return 0;
    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;
    let memo = offset * bounds.height;

    if (offset > 5) {
      memo -= 10 * bounds.height;
    }

    return memo;
  });

  // Yükseklik ölçülene kadar animasyonlu rakamı çizme.
  if (!bounds.height) {
    return (
      <span ref={ref} className="invisible absolute">
        {number}
      </span>
    );
  }

  return (
    <m.span
      style={{ y }}
      className="absolute inset-0 flex items-center justify-center"
      ref={ref}
    >
      {number}
    </m.span>
  );
}

export function SlidingNumber({
  value,
  padStart = false,
  decimalSeparator = ".",
}) {
  const reduceMotion = useReducedMotion();

  const absValue = Math.abs(value);
  const [integerPart, decimalPart] = absValue.toString().split(".");
  const integerValue = parseInt(integerPart, 10);
  const paddedInteger =
    padStart && integerValue < 10 ? `0${integerPart}` : integerPart;
  const integerDigits = paddedInteger.split("");
  const integerPlaces = integerDigits.map((_, i) =>
    Math.pow(10, integerDigits.length - i - 1)
  );

  // Hareketi azaltmayı seçen kullanıcıda kayma yok — düz sayı.
  if (reduceMotion) {
    const formatted =
      (value < 0 ? "-" : "") +
      paddedInteger +
      (decimalPart ? decimalSeparator + decimalPart : "");
    return <span className="tabular-nums">{formatted}</span>;
  }

  return (
    <LazyMotion features={loadFeatures} strict>
      <div className="flex items-center">
        {value < 0 && "-"}
        {integerDigits.map((_, index) => (
          <Digit
            key={`pos-${integerPlaces[index]}`}
            value={integerValue}
            place={integerPlaces[index]}
          />
        ))}
        {decimalPart && (
          <>
            <span>{decimalSeparator}</span>
            {decimalPart.split("").map((_, index) => (
              <Digit
                key={`decimal-${index}`}
                value={parseInt(decimalPart, 10)}
                place={Math.pow(10, decimalPart.length - index - 1)}
              />
            ))}
          </>
        )}
      </div>
    </LazyMotion>
  );
}
