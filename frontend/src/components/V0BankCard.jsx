import { useState, useEffect, useRef, memo } from "react";
import { Award, MapPin, Phone } from "lucide-react";
import { mediaUrl } from "../lib/api";
import { useLanguage } from "../context/LanguageContext";
import { GlowCard } from "./ui/spotlight-card";
import { AnimatedRate } from "./ui/animated-counter";

function getCurrencyDisplay(currency) {
  return currency;
}

const bankDomains = {
  "ziraat bankası": "ziraatbank.com.tr",
  "garanti bbva": "garantibbva.com.tr",
  akbank: "akbank.com",
  "türkiye iş bankası": "isbank.com.tr",
  "yapı kredi": "yapikredi.com.tr",
  halkbank: "halkbank.com.tr",
  vakıfbank: "vakifbank.com.tr",
  "qnb finansbank": "qnbfinansbank.com",
  denizbank: "denizbank.com",
  "kuveyt türk": "kuveytturk.com.tr",
  teb: "teb.com.tr",
  "ing bank": "ing.com.tr",
  odeabank: "odeabank.com.tr",
  fibabanka: "fibabanka.com.tr",
  "albaraka türk": "albaraka.com.tr",
  "sun döviz": "sundoviz.com.tr",
};

/**
 * @param {object} props
 * @param {{EUR?:{buy:number,sell:number},USD?:{buy:number,sell:number},GBP?:{buy:number,sell:number}}} [props.bestRates]
 *   U-10: Panodaki en iyi alış / en iyi satış değerleri. Bu kart o değeri
 *   tutturuyorsa ilgili hücre işaretlenir — ürünün tek satış argümanı
 *   "büroları karşılaştır" olduğu halde ekranda hiçbir karşılaştırma
 *   işareti yoktu.
 */
function V0BankCardComponent({ bank, mode, onSelect, showNearestBranch = false, bestRates = null, branches = [], introRates = false }) {
  const { t } = useLanguage();
  // ✅ ADIM 2: Flash effect durumları
  const [flashColor, setFlashColor] = useState(null); // 'green' | 'red' | null
  const prevRatesRef = useRef({});

  const interestRates = Array.isArray(bank.interestRates) ? bank.interestRates : [];
  const loans = bank?.loans ?? {};
  const baseDepositRateRaw =
    typeof bank?.depositRate === "number"
      ? bank.depositRate
      : Number.parseFloat(String(interestRates?.[0]?.rate ?? "").replace(",", "."));
  const baseDepositRate = Number.isFinite(baseDepositRateRaw) ? baseDepositRateRaw : null;
  const simulatedDepositRows =
    Number.isFinite(baseDepositRate)
      ? [
          { label: "Günlük (1-7 Gün)", rate: Math.max(baseDepositRate - 3.5, 0) },
          { label: "Aylık (32-92 Gün)", rate: baseDepositRate },
          { label: "Yıllık (365 Gün)", rate: Math.max(baseDepositRate - 1.5, 0) },
        ]
      : [];
  const ratesByPriority = ["EUR", "USD", "GBP"];
  const exchangeRates = ratesByPriority.map((code) => {
    const found = (bank.exchangeRates || []).find((rate) => rate.currency === code);
    return {
      currency: code,
      buy: found?.buy ?? null,
      sell: found?.sell ?? null,
    };
  });

  // SSE → Dashboard banks güncellemesi → bu prop değişir; flash buradan tetiklenir.
  // liveRates ayrı prop olarak verilmez: memo ile gereksiz tüm-kart re-render önlenir.
  useEffect(() => {
    if (mode !== "exchange" || !bank.institutionId) return;

    if (Object.keys(prevRatesRef.current).length === 0) {
      for (const rate of exchangeRates) {
        if (rate.buy) {
          prevRatesRef.current[rate.currency] = rate.buy;
        }
      }
      return;
    }

    let hasChanged = false;
    let isPositive = true;

    for (const rate of exchangeRates) {
      if (rate.buy && prevRatesRef.current[rate.currency]) {
        const oldRate = prevRatesRef.current[rate.currency];
        const newRate = rate.buy;

        if (newRate !== oldRate) {
          hasChanged = true;
          isPositive = newRate > oldRate;
          prevRatesRef.current[rate.currency] = newRate;
          break;
        }
      }
    }

    if (hasChanged) {
      setFlashColor(isPositive ? "green" : "red");
      const timer = setTimeout(() => setFlashColor(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [mode, bank.institutionId, bank.exchangeRates]);

  /**
   * ✅ ADIM 3: Tailwind Flash Effect - Dinamik sınıflar + Smooth Fade
   *
   * ⚠️ TASARIM DÜZELTMESİ (mat siyah + neon): Kartın hover vurgusu
   * `hover:border-brand-400` idi — kenarlığın TAMAMI tek renge atlıyordu.
   * Statik bir vurgu, imleci nereye getirdiğinizi bilmez; kart "seçildi"
   * demez, sadece renk değiştirir. Yerine `GlowCard`: ışık kaynağı imlecin
   * kendisi, kenarlığın yalnızca imlece yakın parçası yanıyor.
   *
   * `overflow-hidden` de kaldırıldı: ışımanın kartın dışına taşması gerekiyor,
   * aksi halde saçılma tam kenarda kesiliyor ve neon değil şerit gibi duruyor.
   */
  const getCardClasses = () => {
    const baseClasses = "group rounded-2xl backdrop-blur-lg transition-all duration-300 cursor-pointer";

    if (flashColor === "green") {
      return `${baseClasses} border-success-500/80 bg-success-500/20 shadow-lg shadow-success-500/30 border`;
    } else if (flashColor === "red") {
      return `${baseClasses} border-danger-500/80 bg-danger-500/20 shadow-lg shadow-danger-500/30 border`;
    } else {
      return `${baseClasses} border border-ink-200 bg-white/90 shadow-xl dark:border-white/10 dark:bg-ink-900/60 dark:shadow-card-dark`;
    }
  };

  const rawName = bank.name || "";
  /**
   * ⚠️ UX DÜZELTMESİ (denetim bulgusu U-13): Burada müşteri panosunda gerçek
   * işletmelerin kartına "TEST" rozeti basılıyordu (ölçüm: Albaraka Türk ve
   * Dablöz). Abonelik durumu yöneticinin bilmesi gereken bir şeydir, müşterinin
   * değil — rozet süper admin listesinde kaldı, panodan kaldırıldı.
   */
  const displayName = rawName.replace(/\s*\([Tt]est\)\s*/g, "").trim();
  /** M-01: karttan doğrudan arama / yol tarifi için en uygun şube. */
  const contactBranch = bank.nearestBranch || branches?.[0] || null;
  const contactPhone = contactBranch?.phone || contactBranch?.whatsapp || bank.phone || null;
  const hasCoords =
    contactBranch &&
    Number.isFinite(Number(contactBranch.lat)) &&
    Number.isFinite(Number(contactBranch.lng));
  const nearest = showNearestBranch ? bank.nearestBranch : null;
  const nearestLabel =
    nearest?.name && Number.isFinite(nearest.distanceKm)
      ? `(${nearest.name} - ${
          nearest.distanceKm < 10
            ? `${nearest.distanceKm.toFixed(1)}km`
            : `${Math.round(nearest.distanceKm)}km`
        })`
      : null;

  const handleCardClick = () => {
    if (typeof onSelect === "function") onSelect(bank);
  };

  const handleCardKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleCardClick();
    }
  };

  return (
    <GlowCard
      className={getCardClasses() + " p-4 sm:p-6"}
      /* Kur değişimi yanıp sönerken ışıma da yönü anlatır: yeşil yükseldi, kırmızı düştü. */
      glowColor={flashColor === "green" ? "green" : flashColor === "red" ? "red" : "white"}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${displayName || bank.name} analizini aç`}
    >
      <div className="flex items-center gap-3 px-1 pb-4">
        <img
          src={
            mediaUrl(bank.logo_url) ||
            `https://www.google.com/s2/favicons?domain=${bankDomains[String(bank.name || "").toLowerCase()] || "bank.com"}&sz=128`
          }
          alt={displayName || bank.name}
          className="h-8 w-8 shrink-0 rounded-full bg-white p-0.5 object-cover shadow-sm"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h3
            className={`glow-card-title min-w-0 text-base font-semibold leading-tight transition-all duration-300 ${
              flashColor === "green"
                ? "text-success-700 dark:text-success-200"
                : flashColor === "red"
                  ? "text-danger-700 dark:text-danger-200"
                  : "text-ink-800 dark:text-ink-100 group-hover:text-brand-700 dark:group-hover:text-white"
            }`}
          >
            <span className="block truncate">{displayName || bank.name}</span>
            {nearestLabel ? (
              <span className="mt-0.5 block truncate text-xs font-medium text-brand-600 dark:text-brand-300">
                {nearestLabel}
              </span>
            ) : null}
          </h3>
        </div>
      </div>

      {mode === "exchange" ? (
        <div className="px-1 pb-1">
          {/*
            ⚠️ TASARIM DÜZELTMESİ (D-18): "Alış" ve "Satış" etiketleri HER kur
            satırında tekrar ediyordu — üç para birimi × iki etiket = kart
            başına 6 kez, altı büroluk bir listede 36 kez. Tablo başlığı bir kez
            yazılır; tekrar eden etiket bilgi taşımaz, yalnızca rakamların
            etrafını doldurur ve asıl okunacak şeyin kontrastını düşürür.

            Sütunlar sabit genişlikte (w-[4.75rem]) olduğu için başlık ile
            değerler dikeyde hizalanır; sabit genişlik ayrıca kur değişince
            rakamların yatayda oynamasını engeller.
          */}
          <div className="flex items-center justify-end gap-5 px-1 pb-1.5">
            <span className="w-[4.75rem] text-right text-[11px] font-medium tracking-wide text-ink-500 dark:text-ink-400">
              {t("buyShort")}
            </span>
            <span className="w-[4.75rem] text-right text-[11px] font-medium tracking-wide text-ink-500 dark:text-ink-400">
              {t("sellShort")}
            </span>
          </div>
          <div className="divide-y divide-ink-200 dark:divide-ink-700/60">
            {exchangeRates.map((rate) => {
              /**
               * ⚠️ UX DÜZELTMESİ (denetim bulgusu U-10): Ürünün tek satış
               * argümanı "büroları karşılaştır" olduğu halde ekranda en iyi
               * kuru gösteren hiçbir işaret yoktu. Müşteri için en iyi alış =
               * en YÜKSEK (dövizini daha pahalıya bozdurur), en iyi satış =
               * en DÜŞÜK (dövizi daha ucuza alır).
               */
              const best = bestRates?.[rate.currency];
              const isBestBuy =
                best?.buy != null && rate.buy != null && Math.abs(best.buy - rate.buy) < 1e-9;
              const isBestSell =
                best?.sell != null && rate.sell != null && Math.abs(best.sell - rate.sell) < 1e-9;

              return (
                <div key={rate.currency} className="flex items-center justify-between gap-3 py-3">
                  <span
                    className={`inline-flex items-center justify-center rounded-control px-3 py-1.5 text-xs font-semibold transition-colors ease-out-strong ${flashColor ? "duration-instant" : "duration-[700ms]"} ${
                      flashColor === "green"
                        ? "bg-success-500/25 text-success-700 dark:text-success-400"
                        : flashColor === "red"
                          ? "bg-danger-500/25 text-danger-700 dark:text-danger-400"
                          : "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200"
                    }`}
                  >
                    {getCurrencyDisplay(rate.currency)}
                  </span>

                  <div className="flex items-center gap-5">
                    {/*
                      ⚠️ TASARIM DÜZELTMESİ (denetim bulgusu D-08): Alış sürekli
                      yeşil, satış sürekli kırmızıydı. Finansal arayüzlerde
                      yeşil/kırmızı "yükseldi/düştü" demektir; burada "alış/satış"
                      için kullanılıyordu ve aynı kartta yanıp sönen değişim
                      rengiyle karışıyordu. Ayrım artık ETİKET ve HİZALAMA ile
                      yapılıyor; renk yalnızca değişim yönünü anlatıyor.
                    */}
                    {/* D-18: etiket sütun başlığına taşındı; ödül işareti rakamın yanında kaldı. */}
                    <div className="flex w-[4.75rem] items-center justify-end gap-1">
                      {isBestBuy ? (
                        <Award
                          size={12}
                          className="shrink-0 text-brand-600 dark:text-brand-400"
                          aria-label={t("bestBuy")}
                        />
                      ) : null}
                      <span
                        className={`font-mono text-xl font-bold tabular-nums transition-colors ease-out-strong ${flashColor ? "duration-instant" : "duration-[700ms]"} ${
                          flashColor === "green"
                            ? "text-success-700 dark:text-success-400"
                            : flashColor === "red"
                              ? "text-danger-700 dark:text-danger-400"
                              : isBestBuy
                                ? "text-brand-700 dark:text-brand-300"
                                : "text-ink-900 dark:text-white"
                        }`}
                      >
                        <AnimatedRate value={rate.buy} play={introRates} />
                      </span>
                    </div>

                    {/* D-18: aynı düzeltme satış sütunu için. */}
                    <div className="flex w-[4.75rem] items-center justify-end gap-1">
                      {isBestSell ? (
                        <Award
                          size={12}
                          className="shrink-0 text-brand-600 dark:text-brand-400"
                          aria-label={t("bestSell")}
                        />
                      ) : null}
                      <span
                        className={`font-mono text-xl font-bold tabular-nums transition-colors ease-out-strong ${flashColor ? "duration-instant" : "duration-[700ms]"} ${
                          flashColor === "green"
                            ? "text-success-700 dark:text-success-400"
                            : flashColor === "red"
                              ? "text-danger-700 dark:text-danger-400"
                              : isBestSell
                                ? "text-brand-700 dark:text-brand-300"
                                : "text-ink-900 dark:text-white"
                        }`}
                      >
                        <AnimatedRate value={rate.sell} play={introRates} />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/*
            ⚠️ ÜRÜN HARİTASI M-01: Panoda tek bir tel: bağlantısı veya harita linki
            yoktu; müşteri önce detay panelini açmak zorundaydı. Oysa bir döviz
            bürosu ararken asıl eylem "ara" ve "yol tarifi al".
          */}
          {contactPhone || hasCoords ? (
            <div className="flex gap-2 border-t border-ink-200 px-1 pt-3 dark:border-ink-700/60">
              {contactPhone ? (
                <a
                  href={`tel:${String(contactPhone).replace(/[^\d+]/g, "")}`}
                  onClick={(e) => e.stopPropagation()}
                  className="btn-subtle btn-sm min-h-[2.5rem] flex-1"
                >
                  <Phone size={14} aria-hidden="true" />
                  {t("callBtn")}
                </a>
              ) : null}
              {hasCoords ? (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${contactBranch.lat},${contactBranch.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="btn-ghost btn-sm min-h-[2.5rem] flex-1"
                >
                  <MapPin size={14} aria-hidden="true" />
                  {t("directionsBtn")}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : mode === "interest" ? (
        <div className="px-1 pb-1">
          {simulatedDepositRows.length > 0 ? (
            <div className="divide-y divide-ink-700/60">
              {simulatedDepositRows.map((item) => (
                <div key={item.label} className="flex items-center justify-between py-3">
                  <span className="text-sm text-ink-600 dark:text-ink-400">{item.label}</span>
                  <span className="font-mono text-xl font-bold text-success-300">%{item.rate.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center px-4 py-8 text-center text-sm text-ink-600 dark:text-ink-400">
              Bu kaynakta faiz verisi yayınlanmıyor; yalnızca döviz özeti kullanılıyor.
            </div>
          )}
        </div>
      ) : (
        <div className="px-1 pb-1">
          <div className="divide-y divide-ink-700/60">
            {[
              { key: "tasit", label: "Taşıt Kredisi" },
              { key: "konut", label: "Konut Kredisi" },
              { key: "ihtiyac", label: "İhtiyaç Kredisi" },
            ].map((item) => {
              const raw = loans?.[item.key];
              const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? "").replace(",", "."));
              return (
                <div key={item.key} className="flex items-center justify-between py-3">
                  <span className="text-sm text-ink-300">{item.label}</span>
                  <span className="font-mono text-2xl font-bold text-warning-300">
                    {Number.isFinite(value) ? `%${value.toFixed(2)}` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </GlowCard>
  );
}

export const V0BankCard = memo(V0BankCardComponent);
