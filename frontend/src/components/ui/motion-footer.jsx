import { useCallback, useEffect, useRef } from "react";
import { ArrowUp, BarChart3, Building2, LineChart, Mail, MessageCircle, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { contactLinks } from "../../lib/contact";
import { InstagramIcon } from "./brand-icons";

/**
 * Sinematik alt bölüm — "perde açılışı" (curtain reveal) footer.
 *
 * Kaynak bileşen Next.js + TypeScript + shadcn + GSAP/ScrollTrigger için
 * yazılmıştı. Uyarlamada dört karar var:
 *
 * 1. GSAP KURULMADI. ScrollTrigger + gsap core ≈ 55 KB gzip ve bu footer
 *    kabuğun içinde, yani HER sayfa yüklemesinde inecekti. Kod tabanı bundan
 *    kaçınmak için admin panellerini ayrı parçalara bölmüştü (P-01). Üç efektin
 *    üçü de kütüphanesiz karşılanıyor: kaydırma ilerlemesi rAF + Intersection-
 *    Observer, manyetik hover rAF + transform, nefes/kayan yazı/nabız ise CSS
 *    keyframe. Tek görsel fark: `elastic.out` dönüşü yerine tek yaylanmalı
 *    `back-out` eğrisi.
 * 2. shadcn token'ları (--foreground, --primary, --destructive) yok; stil tek
 *    bir kanal değişkenine (`--footer-ink`) indirildi (bkz. index.css).
 * 3. Statik CSS `<style dangerouslySetInnerHTML>` ile her render'da basılmıyor,
 *    `index.css` içindeki katmanda duruyor.
 * 4. Metinler `useLanguage` sözlüğünden geliyor; site iki dilli.
 *
 * Google Fonts'tan Plus Jakarta Sans çekilmiyor: tasarım sisteminin yazı tipi
 * Inter ve zaten `index.html`'de ön bağlantısı var. İkinci bir aile hem ağ
 * maliyeti hem de tipografi tutarsızlığı demekti.
 */

/** Hareket azaltma tercihi açıksa manyetik etki ve kaydırma takibi çalışmaz. */
function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * İmleci "çeken" düğme. Dönüşüm JS'ten yazılıyor ama SÜRESİ CSS'te
 * (`.footer-glass-pill`): inline `transition` yazmak kenarlık/gölge
 * geçişlerini de ezerdi. Bırakma anındaki farklı eğri `data-magnet`
 * özniteliğiyle seçiliyor.
 *
 * @param {object} props
 * @param {import("react").ElementType} [props.as]  Kök etiket (`button`, `a`, …)
 * @param {number} [props.strength]                 Çekim şiddeti (0–1)
 */
export function MagneticButton({
  as: Tag = "button",
  className = "",
  strength = 0.35,
  children,
  onPointerMove,
  onPointerLeave,
  ...rest
}) {
  const ref = useRef(null);
  const frameRef = useRef(0);
  const pointerRef = useRef(null);
  /** İmleç girdiğinde, transform sıfırken alınan referans kutu. */
  const baseRectRef = useRef(null);

  const flush = useCallback(() => {
    frameRef.current = 0;
    const el = ref.current;
    const pointer = pointerRef.current;
    if (!el || !pointer) return;

    /*
      ⚠️ HATA DÜZELTMESİ: Ölçüm `el.getBoundingClientRect()` ile yapılıyordu ve
      o kutu MEVCUT transform'u içeriyor. Yani düğme her karede kendi kaydığı
      yerden yeniden ölçülüyor, sapma birikiyor ve düğme imleci kovalayarak
      yerinden sürükleniyordu. Nişan alırken düğme altından kaçtığı için
      tıklamalar yanına düşüyordu — "footer butonları çalışmıyor".

      Referans artık imleç girdiği anda BİR KEZ, transform sıfırken alınan
      temel kutu; sapma birikmiyor, düğme öngörülebilir bir yay kadar oynuyor.
    */
    const rect = baseRectRef.current || el.getBoundingClientRect();
    const dx = pointer.x - (rect.left + rect.width / 2);
    const dy = pointer.y - (rect.top + rect.height / 2);

    el.style.transform =
      `perspective(700px) translate3d(${(dx * strength).toFixed(2)}px, ${(dy * strength).toFixed(2)}px, 0)` +
      ` rotateX(${(-dy * 0.12).toFixed(2)}deg) rotateY(${(dx * 0.12).toFixed(2)}deg) scale(1.04)`;
  }, [strength]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  const handlePointerMove = useCallback(
    (event) => {
      onPointerMove?.(event);
      if (event.pointerType === "touch" || prefersReducedMotion()) return;
      const el = ref.current;
      if (!el) return;
      // İlk harekette, düğme henüz yerinden oynamamışken ölç.
      if (!baseRectRef.current) baseRectRef.current = el.getBoundingClientRect();
      el.dataset.magnet = "track";
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (!frameRef.current) frameRef.current = requestAnimationFrame(flush);
    },
    [flush, onPointerMove]
  );

  const handlePointerLeave = useCallback(
    (event) => {
      onPointerLeave?.(event);
      const el = ref.current;
      if (!el) return;
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      el.dataset.magnet = "release";
      el.style.transform = "";
      // Bir sonraki girişte yeniden ölçülsün: sayfa kaymış/yeniden
      // boyutlanmış olabilir.
      baseRectRef.current = null;
    },
    [onPointerLeave]
  );

  return (
    <Tag
      ref={ref}
      className={`footer-glass-pill ${className}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Perdenin ne kadar açıldığını ölçer ve iki özel değişken yazar:
 *   --footer-progress  0→1  dev arka plan yazısının yükselişi
 *   --footer-reveal    0→1  başlık ve bağlantıların yükselişi (daha geç başlar)
 *
 * Kaydırma dinleyicisi yalnızca footer görüş alanına yaklaştığında bağlı
 * duruyor; sayfanın geri kalanında hiç iş yapmıyor.
 */
function useCurtainProgress(wrapperRef, footerRef) {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const footer = footerRef.current;
    if (!wrapper || !footer || prefersReducedMotion()) return;

    let frame = 0;
    let listening = false;

    const update = () => {
      frame = 0;
      const rect = wrapper.getBoundingClientRect();
      if (rect.height === 0) return;

      // Perde üst kenarı ekranın altına değdiğinde 0, tepeye ulaştığında 1.
      const raw = (window.innerHeight - rect.top) / rect.height;
      const progress = Math.min(1, Math.max(0, raw));
      // İçerik kasıtlı olarak gecikiyor: perde yarılanmadan yazı gelmiyor.
      const reveal = Math.min(1, Math.max(0, (progress - 0.35) / 0.4));

      footer.style.setProperty("--footer-progress", progress.toFixed(3));
      footer.style.setProperty("--footer-reveal", reveal.toFixed(3));
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !listening) {
          window.addEventListener("scroll", onScroll, { passive: true });
          listening = true;
          onScroll();
        } else if (!entry.isIntersecting && listening) {
          window.removeEventListener("scroll", onScroll);
          listening = false;
        }
      },
      { rootMargin: "200px 0px" }
    );

    observer.observe(wrapper);
    update();

    return () => {
      observer.disconnect();
      if (listening) window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [wrapperRef, footerRef]);
}

function MarqueeRun({ items }) {
  return (
    <div className="flex shrink-0 items-center">
      {items.map((item) => (
        <span key={item} className="flex items-center">
          <span className="px-6">{item}</span>
          <span aria-hidden="true" className="opacity-40">
            ✦
          </span>
        </span>
      ))}
    </div>
  );
}

export function CinematicFooter() {
  const { t } = useLanguage();
  const wrapperRef = useRef(null);
  const footerRef = useRef(null);

  useCurtainProgress(wrapperRef, footerRef);

  const marqueeItems = [
    t("footerMarquee1"),
    t("footerMarquee2"),
    t("footerMarquee3"),
    t("footerMarquee4"),
    t("footerMarquee5"),
  ];

  const pillLink =
    "inline-flex min-h-[2.75rem] items-center gap-2 rounded-full px-5 py-3 text-xs font-semibold " +
    "text-ink-700 hover:text-ink-950 dark:text-ink-300 dark:hover:text-white md:text-sm";

  return (
    /*
      Perde: bu sarmalayıcı normal akışta bir ekran yüksekliğinde yer tutar,
      `clip-path` ise içindeki sabit konumlu footer'ı yalnızca bu kutunun
      içinde görünür kılar. Sayfa kaydıkça kutu yukarı çıkar ve footer
      altından açılmış gibi ortaya çıkar.
    */
    <div
      ref={wrapperRef}
      /* M2 (uiux): perde bir tam ekran (100dvh) yer tutuyordu — footer
         linklerine ulaşmak için bir ekran fazladan kaydırma. ~62vh yeterli. */
      className="relative h-[62vh] w-full shrink-0"
      style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)" }}
    >
      <footer
        ref={footerRef}
        /*
          Karanlık temada footer zemini sayfadan (ink-950) bir tık DAHA koyu:
          saf siyah. Perde altından açılan bir katmanın daha derin olması
          gerekiyor; iki yüzey birebir aynı renk olduğunda açılma hissi
          kayboluyor ve sayfa sadece uzuyormuş gibi duruyordu.
        */
        className="cinematic-footer fixed bottom-0 left-0 flex h-[62vh] max-h-[100dvh] min-h-[26rem] w-full flex-col justify-between overflow-hidden bg-white text-ink-900 dark:bg-black dark:text-ink-100"
      >
        <div
          aria-hidden="true"
          className="footer-aurora footer-breathe pointer-events-none absolute left-1/2 top-1/2 z-base h-[60vh] w-[80vw] rounded-[50%] blur-[80px]"
        />
        <div aria-hidden="true" className="footer-grid pointer-events-none absolute inset-0 z-base" />

        <div
          aria-hidden="true"
          className="footer-giant-text pointer-events-none absolute -bottom-[4vh] left-1/2 z-base select-none whitespace-nowrap"
        >
          ADADÖVİZ
        </div>

        {/* Eğik kayan şerit — ürünün ne yaptığını tek satırda tekrar eder. */}
        <div
          aria-hidden="true"
          className="absolute left-0 top-10 z-raised w-full -rotate-2 scale-110 overflow-hidden border-y border-ink-200/70 bg-ink-50/60 py-3 backdrop-blur-md dark:border-white/10 dark:bg-ink-950/60"
        >
          <div className="footer-marquee-track flex w-max text-[10px] font-bold uppercase tracking-[0.3em] text-ink-500 dark:text-ink-400 md:text-xs">
            <MarqueeRun items={marqueeItems} />
            <MarqueeRun items={marqueeItems} />
          </div>
        </div>

        <div className="relative z-raised mx-auto mt-20 flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6">
          <h2 className="footer-reveal footer-text-glow mb-10 text-center text-4xl font-black tracking-tighter md:text-7xl">
            {t("footerCtaHeading")}
          </h2>

          <div className="footer-reveal flex w-full flex-col items-center gap-5">
            <div className="flex w-full flex-wrap justify-center gap-4">
              <MagneticButton
                as={Link}
                to="/kiyasla"
                className="flex min-h-[3rem] cursor-pointer items-center gap-3 rounded-full px-8 py-4 text-sm font-bold text-ink-900 dark:text-white md:text-base"
              >
                <BarChart3 className="size-5" aria-hidden="true" />
                {t("footerCtaCompare")}
              </MagneticButton>

              <MagneticButton
                as={Link}
                to="/partnerlik"
                className="flex min-h-[3rem] cursor-pointer items-center gap-3 rounded-full px-8 py-4 text-sm font-bold text-ink-900 dark:text-white md:text-base"
              >
                <Building2 className="size-5" aria-hidden="true" />
                {t("footerCtaPartner")}
              </MagneticButton>
            </div>

            <div className="mt-1 flex w-full flex-wrap justify-center gap-3 md:gap-4">
              <MagneticButton
                as={Link}
                to="/"
                strength={0.25}
                className={`cursor-pointer ${pillLink}`}
              >
                <LineChart className="size-4" aria-hidden="true" />
                {t("navRates")}
              </MagneticButton>

              {/*
                Footer sitenin ESKİ yapısını gösteriyordu: gezinme yalnızca
                Kurlar + WhatsApp + Instagram'dı. Üst gezinme çoktan dört
                sekmeye çıkmıştı (Kurlar / Kıyasla / Paketler / İletişim);
                eksik ikisi buraya eklendi.
              */}
              <MagneticButton
                as={Link}
                to="/paketler"
                strength={0.25}
                className={`cursor-pointer ${pillLink}`}
              >
                <Tag className="size-4" aria-hidden="true" />
                {t("navPricing")}
              </MagneticButton>

              <MagneticButton
                as={Link}
                to="/iletisim"
                strength={0.25}
                className={`cursor-pointer ${pillLink}`}
              >
                <Mail className="size-4" aria-hidden="true" />
                {t("navContact")}
              </MagneticButton>

              <MagneticButton
                as="a"
                href={contactLinks.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp ile iletişim kurun"
                strength={0.25}
                className={pillLink}
              >
                <MessageCircle className="size-4" aria-hidden="true" />
                WhatsApp
              </MagneticButton>

              <MagneticButton
                as="a"
                href={contactLinks.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram'da bizi takip edin"
                strength={0.25}
                className={pillLink}
              >
                <InstagramIcon className="size-4" />
                Instagram
              </MagneticButton>
            </div>
          </div>
        </div>

        <div className="relative z-raised flex w-full flex-col items-center justify-between gap-5 px-6 pb-8 md:flex-row md:px-12">
          <div className="order-2 text-[11px] font-semibold tracking-wide text-ink-500 dark:text-ink-400 md:order-1 md:text-xs">
            © {new Date().getFullYear()} AdaDöviz — {t("footerTagline")}
          </div>

          <MagneticButton
            as="button"
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label={t("footerBackTop")}
            title={t("footerBackTop")}
            strength={0.3}
            className="group order-3 flex size-12 cursor-pointer items-center justify-center rounded-full text-ink-600 hover:text-ink-950 dark:text-ink-300 dark:hover:text-white"
          >
            <ArrowUp
              className="size-5 transition-transform duration-base ease-out-strong group-hover:-translate-y-1"
              aria-hidden="true"
            />
          </MagneticButton>
        </div>
      </footer>
    </div>
  );
}

export default CinematicFooter;
