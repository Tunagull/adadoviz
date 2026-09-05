import { useEffect } from "react";

/**
 * Ref sayaçlı gövde-scroll kilidi (M5).
 *
 * Eskiden her modal doğrudan `document.body.style.overflow = 'hidden'` yazıp
 * kapanırken `'unset'`e döndürüyordu. Aynı anda birden çok overlay varsa
 * (üç MarketSummaryCard + Sheet + konum-onayı) biri kapanınca ötekiler hâlâ
 * açıkken sayfa kaydırılır hâle geliyordu. Bu hook bir sayaç tutar; kilidi
 * yalnızca son kilit bırakılınca kaldırır ve ÖNCEKİ değeri geri yükler.
 *
 * @param {boolean} locked
 */
let lockCount = 0;
let previousOverflow = "";

export function useScrollLock(locked) {
  useEffect(() => {
    if (!locked) return undefined;

    if (lockCount === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount <= 0) {
        lockCount = 0;
        document.body.style.overflow = previousOverflow;
      }
    };
  }, [locked]);
}
