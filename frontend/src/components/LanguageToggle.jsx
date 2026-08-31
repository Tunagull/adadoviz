import { useLanguage } from "../context/LanguageContext";

/**
 * TR / EN dil anahtarı — ThemeToggle ile birebir aynı kayan pill yapısı.
 *
 * Aynı ölçüler bilinçli olarak paylaşılıyor (pill h-8 w-16, knob size-6;
 * compact h-7 w-14 / size-5) ki iki kontrol yan yana dururken tek bir
 * kontrol ailesi gibi okunsun.
 *
 * Erişilebilirlik notu: ThemeToggle `role="switch" aria-checked` kullanıyor
 * çünkü koyu tema açık/kapalı bir durumdur. Dil ise açık/kapalı değil, iki
 * eşdeğer seçenek arasında bir tercihtir — "checked" burada anlamsız kalırdı.
 * Bu yüzden düz bir <button> ve mevcut durumu + yapılacak eylemi birlikte
 * söyleyen bir aria-label kullanılıyor.
 */
export function LanguageToggle({ className = "", compact = false }) {
  const { lang, toggleLang, t } = useLanguage();

  const isEn = lang === "en";
  const label = isEn
    ? "Language: English. Switch to Turkish."
    : "Dil: Türkçe. İngilizce'ye geç.";

  const pill = compact ? "h-7 w-14" : "h-8 w-16";
  const knob = compact ? "size-5" : "size-6";
  const text = compact ? "text-[9px]" : "text-[10px]";
  const shift = compact ? "translate-x-7" : "translate-x-8";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleLang();
      }}
      className={`inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-1 ${className}`}
    >
      <span
        className={`relative flex items-center rounded-full border transition-colors duration-300 ${pill} ${
          isEn ? "border-ink-700 bg-ink-950" : "border-ink-200 bg-white"
        }`}
      >
        {/* Kayan topuz — aktif dilin altında durur */}
        <span
          aria-hidden="true"
          className={`absolute left-1 rounded-full bg-brand-500 transition-transform duration-300 ease-out ${knob} ${
            isEn ? shift : "translate-x-0"
          }`}
        />

        {/* Etiketler topuzun ÜSTÜNDE: aktif olan beyaz, diğeri sönük */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-1 flex items-center justify-center font-bold tracking-wide transition-colors duration-300 ${knob} ${text} ${
            isEn ? "text-ink-500" : "text-white"
          }`}
        >
          {t("langTr")}
        </span>
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-1 flex items-center justify-center font-bold tracking-wide transition-colors duration-300 ${knob} ${text} ${shift} ${
            isEn ? "text-white" : "text-ink-400"
          }`}
        >
          {t("langEn")}
        </span>
      </span>
    </button>
  );
}

export default LanguageToggle;
