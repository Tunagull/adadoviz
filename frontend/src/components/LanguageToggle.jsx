import { useLanguage } from "../context/LanguageContext";
import { useTheme } from "../context/ThemeContext";

/**
 * TR / EN dil anahtarı — ThemeToggle ile birebir aynı kayan pill yapısı.
 *
 * Aynı ölçüler bilinçli olarak paylaşılıyor (pill h-8 w-16, knob size-6;
 * compact h-7 w-14 / size-5) ki iki kontrol yan yana dururken tek bir
 * kontrol ailesi gibi okunsun.
 *
 * Pill zemini TEMAYA bağlıdır, seçili dile değil. (Önceden `isEn` ile
 * sürülüyordu: TR seçiliyken koyu temada beyaz bir pill kalıyordu.)
 *
 * Erişilebilirlik notu: ThemeToggle `role="switch" aria-checked` kullanıyor
 * çünkü koyu tema açık/kapalı bir durumdur. Dil ise açık/kapalı değil, iki
 * eşdeğer seçenek arasında bir tercihtir — "checked" burada anlamsız kalırdı.
 * Bu yüzden düz bir <button> ve mevcut durumu + yapılacak eylemi birlikte
 * söyleyen bir aria-label kullanılıyor.
 */
export function LanguageToggle({ className = "", compact = false }) {
  const { lang, toggleLang, t } = useLanguage();
  const { theme } = useTheme();

  const isEn = lang === "en";
  const isDark = theme === "dark";
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
      /*
        ⚠️ DÜZELTME: Önceki sürüm dış butona hover'da kenarlık+arka plan
        ekliyordu — Saatlik/Günlük/Haftalık'ın (SlidingTabs) hover'ı bu değil,
        yalnızca metin soluktan tam kontrasta geçiyor. Pasif dil etiketi
        (aşağıda `group-hover`) o karşılığı görüyor.

        Basma geri bildirimi ayrıca YAZILMIYOR (bkz. ThemeToggle'daki aynı
        not) — sitedeki her buton için zaten otomatik uygulanıyor (M-04).
      */
      className={`group inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-1 ${className}`}
    >
      <span
        className={`relative flex items-center rounded-full border transition-colors duration-300 ${pill} ${
          isDark ? "border-ink-700 bg-ink-950" : "border-ink-200 bg-white"
        }`}
      >
        {/*
          Kayan topuz — aktif dilin altında durur.

          (beyaz neon) Topuz `bg-brand-500` idi, yani paletin vurgu rengi.
          Vurgu artık renk değil parlaklık: karanlık temada beyaz ve ışıyan,
          aydınlık temada mat siyah bir topuz. `surface-neon` bu kararı tek
          yerden veriyor.
        */}
        <span
          aria-hidden="true"
          className={`surface-neon absolute left-1 rounded-full transition-transform duration-300 ease-out ${knob} ${
            isEn ? shift : "translate-x-0"
          }`}
        />

        {/*
          Etiketler topuzun ÜSTÜNDE. Aktif etiket topuzun rengine göre ters
          olmak zorunda: aydınlık temada siyah topuz üstünde beyaz, karanlık
          temada beyaz topuz üstünde siyah.
        */}
        {/*
          Pasif etiket hover'da SlidingTabs'ın pasif sekmesiyle AYNI davranışı
          gösteriyor: soluk renk tam kontrasta geçiyor (`group-hover`), zemin/
          kenarlık değişmiyor. Aktif etiket zaten tam kontrastta, dokunmuyor.
        */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-1 flex items-center justify-center font-bold tracking-wide transition-colors duration-base ease-out ${knob} ${text} ${
            isEn
              ? isDark
                ? "text-ink-500 group-hover:text-white"
                : "text-ink-400 group-hover:text-ink-950"
              : "text-white dark:text-ink-950"
          }`}
        >
          {t("langTr")}
        </span>
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-1 flex items-center justify-center font-bold tracking-wide transition-colors duration-base ease-out ${knob} ${text} ${shift} ${
            isEn
              ? "text-white dark:text-ink-950"
              : isDark
                ? "text-ink-500 group-hover:text-white"
                : "text-ink-400 group-hover:text-ink-950"
          }`}
        >
          {t("langEn")}
        </span>
      </span>
    </button>
  );
}

export default LanguageToggle;
