import { useEffect } from "react";

/**
 * Açık olan her `[role="dialog"][aria-modal="true"]` panele klavye davranışını
 * uygular: odak tuzağı, Esc ile kapatma ve eksikse erişilebilir ad.
 *
 * ⚠️ ERİŞİLEBİLİRLİK DÜZELTMESİ (denetim bulgusu A-03): Uygulamada 19 modal
 * paneli vardı ve hiçbiri dialog değildi (ölçüm: süper admin düzenleme modalı
 * açıkken sayfada role="dialog" sayısı = 0). Modal açıkken arkadaki tablonun
 * butonları hâlâ sekme sırasındaydı, Esc çalışmıyordu, odak açılışta modala
 * girmiyor ve kapanışta geri dönmüyordu.
 *
 * Bu bekçi tek yerde çalışır; her modalın kendi işaretlemesini değiştirmeye
 * gerek kalmadan davranışı garanti eder. Modal kendi Esc/kapatma mantığını
 * zaten uyguluyorsa çakışmaz — Esc yalnızca panelin kapatma düğmesine tıklar.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * A-L3: `offsetParent` `position: fixed` elemanlar için her zaman null döner —
 * bu tür focusable'lar tuzaktan düşüyordu. Görünürlüğü ölçü kutusuyla da doğrula.
 */
function isVisible(el) {
  if (el === document.activeElement) return true;
  if (el.offsetParent !== null) return true;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function visibleItems(panel) {
  return Array.from(panel.querySelectorAll(FOCUSABLE)).filter(isVisible);
}

/** Panelin en üstteki (son açılan) hâli. */
function topDialog() {
  // vaul (Sheet / mobil BusinessDetailModal) odak tuzağını, Esc'i ve scroll
  // kilidini kendi yönetir — burada tekrar uygulamak çift işleme yaratırdı.
  const list = document.querySelectorAll(
    '[role="dialog"][aria-modal="true"]:not([data-vaul-drawer])'
  );
  return list.length ? list[list.length - 1] : null;
}

export function ModalA11yGuard() {
  useEffect(() => {
    let lastPanel = null;
    let restoreTo = null;

    /** Panel açıldığında: ad ver, odağı içeri al, önceki odağı sakla. */
    const onOpen = (panel) => {
      restoreTo = document.activeElement;

      if (!panel.getAttribute("aria-label") && !panel.getAttribute("aria-labelledby")) {
        const heading = panel.querySelector("h1,h2,h3");
        const name = heading?.textContent?.trim();
        if (name) panel.setAttribute("aria-label", name);
      }
      if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");

      const first = visibleItems(panel)[0];
      (first || panel).focus?.({ preventScroll: true });
    };

    const onClose = () => {
      restoreTo?.focus?.({ preventScroll: true });
      restoreTo = null;
    };

    // Açılış/kapanışı DOM değişimlerinden yakala.
    // İyileştirme: gözlemci geneldi ve her DOM eklemesinde (Recharts tooltip'leri,
    // dropdown portalları, animasyonlar) senkron çalışıyordu — rAF ile birleştir.
    let rafId = 0;
    const check = () => {
      rafId = 0;
      const panel = topDialog();
      if (panel && panel !== lastPanel) {
        lastPanel = panel;
        onOpen(panel);
      } else if (!panel && lastPanel) {
        lastPanel = null;
        onClose();
      }
    };
    const observer = new MutationObserver(() => {
      if (!rafId) rafId = requestAnimationFrame(check);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const onKeyDown = (event) => {
      const panel = topDialog();
      if (!panel) return;

      if (event.key === "Escape") {
        // Panelin kendi kapatma düğmesini kullan — kapatma mantığı orada.
        const closeBtn =
          panel.querySelector('[aria-label="Kapat"],[aria-label="Close"]') ||
          Array.from(panel.querySelectorAll("button")).find((b) =>
            /^(kapat|close|vazgeç|cancel|iptal)$/i.test(b.textContent.trim())
          );
        if (closeBtn) {
          event.preventDefault();
          closeBtn.click();
        }
        return;
      }

      if (event.key !== "Tab") return;
      const items = visibleItems(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Odak modalın dışına kaçtıysa geri çek.
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return null;
}

export default ModalA11yGuard;
