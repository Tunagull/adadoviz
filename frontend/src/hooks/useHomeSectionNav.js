import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

function partnershipHash() {
  return typeof window !== "undefined" && window.location.hash === "#partnership";
}

/**
 * Anasayfada Kurlar / İşletme vurgusu.
 *
 * İşletme ayrı rota değil; partnerlik bölümüne gidince (veya oraya tıklanınca)
 * yanar. Yukarı kayınca tekrar Kurlar yanar. Tıklama anında vurgu hemen
 * değişir; kaydırma animasyonu bitene kadar ölçüm onu geri almaz.
 */
export function useHomeSectionNav() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const isCompare = location.pathname.startsWith("/kiyasla");
  const isPricing = location.pathname.startsWith("/paketler");
  const [partnershipActive, setPartnershipActive] = useState(partnershipHash);
  const lockRef = useRef(null);

  useEffect(() => {
    if (!isHome) {
      lockRef.current = null;
      setPartnershipActive(false);
      return undefined;
    }

    if (location.hash === "#partnership" || partnershipHash()) {
      setPartnershipActive(true);
    }

    let raf = 0;
    const ENTER = 0.32;
    const LEAVE = 0.48;

    const measure = () => {
      raf = 0;
      const el = document.getElementById("partnership");
      if (!el) return;
      const ratio = el.getBoundingClientRect().top / (window.innerHeight || 1);
      const inZone = ratio <= ENTER;
      const leftZone = ratio > LEAVE;

      if (lockRef.current === "business") {
        if (inZone) lockRef.current = null;
        return;
      }
      if (lockRef.current === "rates") {
        if (leftZone) lockRef.current = null;
        return;
      }

      setPartnershipActive((prev) => {
        if (!prev && inZone) return true;
        if (prev && leftZone) return false;
        return prev;
      });
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isHome, location.hash]);

  const activateBusiness = () => {
    lockRef.current = "business";
    setPartnershipActive(true);
  };

  const activateRates = () => {
    lockRef.current = "rates";
    setPartnershipActive(false);
  };

  return {
    isHome,
    isRatesActive: isHome && !partnershipActive,
    isBusinessActive: isHome && partnershipActive,
    isCompareActive: isCompare,
    isPricingActive: isPricing,
    activateBusiness,
    activateRates,
  };
}

export function scrollToPartnership() {
  document.getElementById("partnership")?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.history.replaceState(null, "", `${window.location.pathname}#partnership`);
}

export function scrollToRates() {
  window.history.replaceState(null, "", window.location.pathname || "/");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
