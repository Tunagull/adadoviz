import { Fragment, useEffect, useRef, useState } from "react";
import {
  LazyMotion,
  m,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { markRateIntroSeen } from "../../lib/rateIntro";

/*
  Kur kartlarındaki "ilk görüşte" roller sayaç.

  Kaynak: motion-primitives tarzı SlidingNumber / animated-counter. Uyarlamalar:
  - `motion/react` yerine `framer-motion`; `m` + tembel `domAnimation` (başlık
    paketini şişirmez — GooeySearchBar zaten aynı yığını yüklüyor).
  - Her sütun SABİT: değer daima NN.NN biçiminde, animasyon boyunca rakam
    sayısı değişip layout kaymıyor.
  - "Sıfırdan say" ama SINIRLI: her rakam `spins` tam tur + hedefe iner
    (0.01 basamağının 4085 kez dönmesi gibi bir şey yok). Soldan sağa kademeli.
  - `prefers-reduced-motion` veya geçersiz değer → düz `toFixed`, animasyon yok.
  - İlk turdan sonra canlı kur güncellemesi kaymadan oturur (`spring.jump`).
*/

const loadDomAnimation = () =>
  import("framer-motion").then((mod) => mod.domAnimation);

// M1 (uiux): kur bir yardımcının tek işi — kullanıcı sayının oturmasını
// ~1 sn izliyordu. Daha sert yay + tek tur + kısa stagger → toplam < 500 ms.
const ROLL_SPRING = { stiffness: 200, damping: 26, mass: 1 };

function toNumber(raw) {
  if (typeof raw === "number") return raw;
  if (raw == null || raw === "") return NaN;
  return Number.parseFloat(String(raw).replace(",", "."));
}

/** 0-9 arası tek bir rakam; `spring` sürekli değeri, `number` bu span'in kimliği. */
function RollNumber({ spring, number }) {
  // `translateY(%)` span'in KENDİ yüksekliğine göre — span `absolute inset-0`
  // olduğu için tam bir sütun (1em) yüksekliği demek. `em` string yerine `%`:
  // framer-motion tarafından güvenle yorumlanır.
  const y = useTransform(spring, (v) => {
    let p = (((number - v) % 10) + 10) % 10; // [0,10)
    if (p > 5) p -= 10; // en kısa yol: [-5,5)
    return `${p * 100}%`;
  });
  return (
    <m.span
      style={{ y }}
      className="absolute inset-0 flex items-center justify-center"
    >
      {number}
    </m.span>
  );
}

function DigitColumn({ digit, roll, spins, delayMs }) {
  // `roll` yalnızca mount'ta yakalanır; sonradan prop değişse de umursamayız.
  const [willRoll] = useState(roll);
  const spring = useSpring(willRoll ? -spins * 10 : digit, ROLL_SPRING);
  const introDoneRef = useRef(false);

  useEffect(() => {
    if (willRoll && !introDoneRef.current) {
      introDoneRef.current = true;
      const id = window.setTimeout(() => spring.set(digit), delayMs);
      return () => window.clearTimeout(id);
    }
    // İlk tur bitti (ya da hiç yoktu): canlı kur güncellemesinde kaymadan otur.
    spring.jump(digit);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digit]);

  return (
    <span
      className="relative inline-block w-[1ch] overflow-hidden"
      style={{ height: "1em" }}
    >
      <span className="invisible">0</span>
      {Array.from({ length: 10 }, (_, n) => (
        <RollNumber key={n} spring={spring} number={n} />
      ))}
    </span>
  );
}

/**
 * @param {object} props
 * @param {number|string|null} props.value  Kur değeri (ör. 40.85)
 * @param {boolean} [props.play]   true ise ilk görüşte roller animasyonu oynar
 * @param {number} [props.decimals]
 * @param {string} [props.className]
 */
export function AnimatedRate({ value, play = false, decimals = 2, className = "" }) {
  const reduceMotion = useReducedMotion();
  const num = toNumber(value);
  const valid = Number.isFinite(num);
  const shouldRoll = valid && play && !reduceMotion;

  useEffect(() => {
    if (shouldRoll) markRateIntroSeen();
  }, [shouldRoll]);

  if (!valid) {
    return <span className={className}>—</span>;
  }

  const fixed = num.toFixed(decimals);

  // İyileştirme: roller oynamayacaksa (dönüş ziyaretçisi / reduced-motion /
  // geçersiz) framer yığınını hiç kurma — düz metin. Ana rotadaki motion-value
  // sayısını ~%90 düşürür.
  if (!shouldRoll) {
    return <span className={`tabular-nums ${className}`}>{fixed}</span>;
  }

  const [intStr, decStr = ""] = fixed.replace("-", "").split(".");
  const intDigits = intStr.split("").map(Number);
  const decDigits = decStr.split("").map(Number);
  const columns = [...intDigits, ...decDigits];
  const dotAt = intDigits.length;

  return (
    <LazyMotion features={loadDomAnimation} strict>
      <span
        className={`inline-flex items-baseline leading-none tabular-nums ${className}`}
        aria-hidden="true"
      >
        {num < 0 ? <span>-</span> : null}
        {columns.map((d, i) => (
          <Fragment key={i}>
            {i === dotAt ? <span>.</span> : null}
            <DigitColumn
              digit={d}
              roll={shouldRoll}
              spins={1}
              delayMs={Math.min(i, 5) * 40}
            />
          </Fragment>
        ))}
      </span>
      <span className="sr-only">{fixed}</span>
    </LazyMotion>
  );
}
