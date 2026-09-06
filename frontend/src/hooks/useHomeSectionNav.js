import { useLocation } from "react-router-dom";

/**
 * Üst gezinme vurgusu — her sekme kendi rotasında.
 */
export function useHomeSectionNav() {
  const { pathname } = useLocation();

  return {
    isRatesActive: pathname === "/" || pathname === "/kurlar",
    isBestRateActive: pathname.startsWith("/en-iyi-kur"),
    isCompareActive: pathname.startsWith("/kiyasla"),
    isPricingActive: pathname.startsWith("/paketler"),
    // Partnerlik formu iletişim çarkından açılıyor; sekme vurgusu orada kalsın.
    isContactActive: pathname.startsWith("/iletisim") || pathname.startsWith("/partnerlik"),
  };
}

export function scrollToRates() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
