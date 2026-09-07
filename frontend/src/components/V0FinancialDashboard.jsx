import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Clock, LogOut, SlidersHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { V0BankCard } from "./V0BankCard";
import { Sheet } from "./Sheet";
import { BusinessLoginModal } from "./BusinessLoginModal";
import { BuySellToggle } from "./BuySellToggle";
import { GooeyPillField, GooeySearchBar, GooeyToggle } from "./ui/animated-search-bar";
import { SlidingTabs } from "./ui/sliding-tabs";
/*
  ⚠️ OPTİMİZASYON (O-01b): "Piyasa Özeti" grafiği + recharts/d3 (~113 kB gzip)
  artık ilk açılış paketinde değil. Kart kendi dosyasında ve talep üzerine
  yükleniyor; kur kartları çizildikten sonra (aşağıdaki idle-preload ile
  genellikle kullanıcı kaydırmadan önce) geliyor.
*/
const MarketSummaryCard = lazy(() =>
  import("./MarketSummaryCard").then((m) => ({ default: m.MarketSummaryCard }))
);
import { HeaderActions } from "./HeaderActions";
import { HeaderClock } from "./HeaderClock";
import { BrandLogo } from "./BrandLogo";
import { SiteNav } from "./SiteNav";
import { cityOptionsFromBranches } from "../lib/cities";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useRegisterOfficeSearch } from "../context/officeSearchStore";
import { trackBusinessClick, reportSearchMiss } from "../lib/analytics";
import { apiUrl, fetchRatesWithRetry, ratesStreamUrl } from "../lib/api";
import { buildBranchSlug, buildBusinessSlug, exchangeOfficePath } from "../lib/slug";
import { shouldPlayRateIntro } from "../lib/rateIntro";

/** P-04: bilgilendirici log yalnızca geliştirmede. */
const devLog = (...args) => {
  if (import.meta.env.DEV) console.log(...args);
};

/**
 * ⚠️ PERF (ilk yükleme): Backend Render'ın ücretsiz katmanında; 15 dk boştan
 * sonra uyandırması 30–60 sn sürüyor ve o sırada `/api/kurlar` HTTP 503
 * dönüyor. Eski kod 503'te doğrudan `banks: []` yazıyor, kullanıcı boş ekran
 * görüyordu.
 *
 * Çözüm iki parçalı:
 *  1) Son başarılı kur yanıtını localStorage'a yaz; tekrar gelen ziyaretçi
 *     kurları ANINDA görür (stale-while-revalidate).
 *  2) 503 / ağ hatasında üstel bekleyişle yeniden dene (soğuk başlatmayı bekle).
 */
/*
  İyileştirme: eşlenmiş banka şekli değişince (ölü mevduat/kredi alanları
  kaldırıldı) sürüm anahtarı yükseltilir — eski şekilli önbellek render edilmez.
*/
const RATES_CACHE_KEY = "adadoviz:rates-cache:v2";
/** M1: kimliği kararlı boş dizi — şubesiz kartların memo'su kırılmasın. */
const EMPTY_BRANCHES = [];
/** Bayat kur gösterimi için üst sınır — bundan eskisini hiç gösterme. */
const RATES_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readRatesCache() {
  try {
    const raw = localStorage.getItem(RATES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.banks) || parsed.banks.length === 0) return null;
    if (!Number.isFinite(parsed.ts) || Date.now() - parsed.ts > RATES_CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRatesCache(payload) {
  try {
    localStorage.setItem(
      RATES_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), ...payload })
    );
  } catch {
    /* kota dolu / özel mod — sorun değil */
  }
}


const SEO_SITE_URL = "https://adadoviz.tunahangul.com";

function buildCurrencyConversionJsonLd({ lang, banksCount }) {
  const isEn = lang === "en";
  return {
    "@context": "https://schema.org",
    "@type": "CurrencyConversionService",
    name: isEn ? "AdaDöviz KKTC Live Exchange Rates & Converter" : "AdaDöviz KKTC Canlı Döviz Kurları ve Çevirici",
    description: isEn
      ? "Compare live USD, EUR and GBP exchange rates across Northern Cyprus (KKTC) exchange offices and convert currencies instantly."
      : "Kuzey Kıbrıs (KKTC) döviz bürolarının güncel USD, EUR ve GBP kurlarını karşılaştırın; anında döviz çevirisi yapın.",
    url: `${SEO_SITE_URL}/`,
    provider: {
      "@type": "Organization",
      name: "AdaDöviz",
      url: `${SEO_SITE_URL}/`,
      logo: `${SEO_SITE_URL}/adadoviz-mark.svg`,
    },
    areaServed: {
      "@type": "Place",
      name: isEn ? "Northern Cyprus (KKTC)" : "Kuzey Kıbrıs (KKTC)",
    },
    serviceType: "Currency exchange rate comparison",
    availableChannel: {
      "@type": "ServiceChannel",
      serviceUrl: `${SEO_SITE_URL}/`,
      availableLanguage: ["tr", "en"],
    },
    ...(Number.isFinite(banksCount) && banksCount > 0
      ? { offerCount: banksCount }
      : {}),
  };
}

function buildFinancialProductJsonLd(lang) {
  const isEn = lang === "en";
  return {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: isEn ? "KKTC Exchange Rate Comparison" : "KKTC Döviz Kuru Karşılaştırma",
    description: isEn
      ? "Live FX rates for USD/TRY, EUR/TRY and GBP/TRY based on Central Bank of Northern Cyprus reference rates."
      : "KKTC Merkez Bankası referans kurlarına dayalı canlı USD/TRY, EUR/TRY ve GBP/TRY döviz kurları.",
    url: `${SEO_SITE_URL}/`,
    category: "ExchangeRate",
    brand: {
      "@type": "Brand",
      name: "AdaDöviz",
    },
    areaServed: {
      "@type": "AdministrativeArea",
      name: isEn ? "Northern Cyprus" : "Kuzey Kıbrıs Türk Cumhuriyeti",
    },
  };
}

/** Backend listesiyle uyumlu Türkiye banka haritası. */
const LOCAL_BANKS = [
  { id: "ziraat", name: "Ziraat Bankası", websiteUrl: "https://www.ziraatbank.com.tr" },
  { id: "garanti", name: "Garanti BBVA", websiteUrl: "https://www.garantibbva.com.tr" },
  { id: "akbank", name: "Akbank", websiteUrl: "https://www.akbank.com" },
  { id: "isbank", name: "Türkiye İş Bankası", websiteUrl: "https://www.isbank.com.tr" },
  { id: "yapikredi", name: "Yapı Kredi", websiteUrl: "https://www.yapikredi.com.tr" },
  { id: "halkbank", name: "Halkbank", websiteUrl: "https://www.halkbank.com.tr" },
  { id: "vakifbank", name: "VakıfBank", websiteUrl: "https://www.vakifbank.com.tr" },
  { id: "qnb", name: "QNB Finansbank", websiteUrl: "https://www.qnb.com.tr" },
  { id: "denizbank", name: "DenizBank", websiteUrl: "https://www.denizbank.com" },
  { id: "kuveytturk", name: "Kuveyt Türk", websiteUrl: "https://www.kuveytturk.com.tr" },
  { id: "teb", name: "TEB", websiteUrl: "https://www.teb.com.tr" },
  { id: "ing", name: "ING Bank", websiteUrl: "https://www.ing.com.tr" },
  { id: "odeabank", name: "Odeabank", websiteUrl: "https://www.odeabank.com.tr" },
  { id: "fibabanka", name: "Fibabanka", websiteUrl: "https://www.fibabanka.com.tr" },
  { id: "albaraka", name: "Albaraka Türk", websiteUrl: "https://www.albarakaturk.com.tr" },
  { id: "sun_doviz", name: "Sun Döviz", websiteUrl: "https://www.sundoviz.com.tr" },
];

/**
 * ⚠️ UX DÜZELTMESİ (denetim bulgusu U-04): Altı sıralama seçeneğinin ALTISI DA
 * alış tarafındaydı. Oysa turist "elimde TL var, dolar alacağım" derken SATIŞ
 * kuruna bakar — o sıralama hiç yoktu. Sıralama mantığı zaten
 * sortBy.split("-") ile [para, tip, yön] okuduğu için algoritma değişmedi;
 * yalnızca eksik seçenekler eklendi.
 *
 * Müşteri için "iyi": alışta EN YÜKSEK, satışta EN DÜŞÜK.
 */
const EXCHANGE_SORT_OPTIONS = [
  { value: "nearest", labelKey: "sortNearest" },
  { value: "none", labelKey: "sortNone" },
  { value: "usd-buy-high", labelKey: "sortUsdBuyHigh" },
  { value: "usd-sell-low", labelKey: "sortUsdSellLow" },
  { value: "eur-buy-high", labelKey: "sortEurBuyHigh" },
  { value: "eur-sell-low", labelKey: "sortEurSellLow" },
  { value: "gbp-buy-high", labelKey: "sortGbpBuyHigh" },
  { value: "gbp-sell-low", labelKey: "sortGbpSellLow" },
  { value: "usd-buy-low", labelKey: "sortUsdBuyLow" },
  { value: "usd-sell-high", labelKey: "sortUsdSellHigh" },
  { value: "eur-buy-low", labelKey: "sortEurBuyLow" },
  { value: "eur-sell-high", labelKey: "sortEurSellHigh" },
  { value: "gbp-buy-low", labelKey: "sortGbpBuyLow" },
  { value: "gbp-sell-high", labelKey: "sortGbpSellHigh" },
];

/** Çalışma saati — string ("09:00 - 17:30") veya haftalık obje */
function isOpenNow(workingHours) {
  if (!workingHours) return false;
  try {
    if (typeof workingHours === "object" && !Array.isArray(workingHours)) {
      const dayKeys = [
        "pazar",
        "pazartesi",
        "sali",
        "carsamba",
        "persembe",
        "cuma",
        "cumartesi",
      ];
      const key = dayKeys[new Date().getDay()];
      const slot = workingHours[key];
      if (!Array.isArray(slot) || slot[0] == null || slot[1] == null) return false;
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      return currentTime >= Number(slot[0]) && currentTime <= Number(slot[1]);
    }

    const [start, end] = String(workingHours)
      .split("-")
      .map((t) => t.trim());
    if (!start || !end) return false;
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);
    if (![startH, startM, endH, endM].every(Number.isFinite)) return false;

    const startTime = startH * 60 + startM;
    const endTime = endH * 60 + endM;

    return currentTime >= startTime && currentTime <= endTime;
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** En yakın şube + mesafe (km). Şube/koordinat yoksa null. */
function getNearestBranchInfo(bank, userLat, userLng, branchesByInstitution) {
  if (userLat == null || userLng == null) return null;
  const id = bank.institutionId;
  const nameKey = normalizeText(bank.name || "");
  const list =
    (id && branchesByInstitution[id]) ||
    branchesByInstitution[nameKey] ||
    [];
  if (!list.length) return null;
  let best = null;
  let min = Number.POSITIVE_INFINITY;
  for (const branch of list) {
    const lat = Number(branch.lat);
    const lng = Number(branch.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const d = haversineKm(userLat, userLng, lat, lng);
    if (d < min) {
      min = d;
      best = branch;
    }
  }
  if (!best || !Number.isFinite(min)) return null;
  return {
    id: best.id,
    name: best.name || "",
    distanceKm: min,
    lat: Number(best.lat),
    lng: Number(best.lng),
  };
}

// ✅ DEAD CODE REMOVED: INTEREST_SORT_OPTIONS ve CREDIT_SORT_OPTIONS kaldırıldı
// Sadece döviz kurları (exchange) mode kullanılıyor
/** Serbest metin veya sayıdan kur sayısı; ondalığı bozmadan çözümleme (örn. "44.38" veya TR formatı). */
function parseRateNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const trimmed = String(value).trim().replace(/\s/g, "");
  if (!trimmed) return null;
  const lastDot = trimmed.lastIndexOf(".");
  const lastComma = trimmed.lastIndexOf(",");
  let normalized = trimmed.replace(/[^\d.,-]/g, "");
  if (!normalized) return null;
  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(/,/g, "");
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}


function mapApiBankToExchangeRows(apiBank) {
  const fromArray = Array.isArray(apiBank?.exchangeRates) ? apiBank.exchangeRates : [];
  const fromObj = apiBank?.rates ?? {};
  const byCodeFromArray = Object.fromEntries(
    fromArray.map((row) => [row.currency, { buy: row.buy, sell: row.sell }])
  );

  const pick = (code) => {
    const rowPair = byCodeFromArray[code];
    const objPair = fromObj[code];
    const buyRaw = rowPair?.buy ?? objPair?.buy;
    const sellRaw = rowPair?.sell ?? objPair?.sell;
    const buy = parseRateNumber(buyRaw);
    const sell = parseRateNumber(sellRaw);
    return { currency: code, buy, sell };
  };

  return [pick("EUR"), pick("USD"), pick("GBP")];
}

function toNumberForCompare(value) {
  return parseRateNumber(value) ?? 0;
}


function getRate(bank, currency, type) {
  const rate = bank.exchangeRates.find((r) => r.currency === currency);
  return rate ? toNumberForCompare(rate[type]) : 0;
}

export function V0FinancialDashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, isSuperAdmin, logout } = useAuth();
  const { t, lang } = useLanguage();
  const localeCode = lang === 'en' ? 'en-US' : 'tr-TR';

  /*
    Grafik chunk'ını ilk boyama BİTTİKTEN sonra, tarayıcı boştayken önceden
    indir — kullanıcı "Piyasa Özeti"ne kaydırdığında genelde hazır olur ama
    kritik yola (kur kartları) yük bindirmez.
  */
  useEffect(() => {
    const preload = () => import("./MarketSummaryCard");
    const ric = typeof window !== "undefined" && window.requestIdleCallback;
    const id = ric ? ric(preload, { timeout: 4000 }) : setTimeout(preload, 2500);
    return () => {
      if (ric && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(id);
      } else {
        clearTimeout(id);
      }
    };
  }, []);

  const logoutTimerRef = useRef(null);

  /*
    M3: Eskiden `localStorage.clear()` + `window.location.href = "/"` vardı —
    çerez onayı, SWR kur önbelleği, intro bayrağı hepsi siliniyor ve tam sayfa
    yeniden yükleniyordu (soğuk-başlangıç yolu tekrar). Artık yalnızca auth
    anahtarları temizlenir (logout() → clearAuth()) ve SPA içinde gezinilir.
  */
  const handleLogout = () => {
    setShowLogoutPopup(true);
    logout();
    navigate("/");
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    logoutTimerRef.current = setTimeout(() => setShowLogoutPopup(false), 600);
  };

  useEffect(() => {
    return () => {
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    };
  }, []);

  /** M1: kararlı referans — her kart yeniden render olmasın. */
  const handleBankSelect = useCallback(
    (biz) => {
      const name = String(biz?.name || "")
        .replace(/\s*\([Tt]est\)\s*/g, "")
        .trim();
      trackBusinessClick(name || biz?.name, biz?.institutionId);
      const nearest = biz?.nearestBranch;
      const slug = nearest?.id
        ? buildBranchSlug(nearest, name || biz?.name)
        : biz?.slug ||
          buildBusinessSlug({
            institutionId: biz?.institutionId,
            name: name || biz?.name,
          });
      navigate(exchangeOfficePath(slug), { state: { openDetail: true } });
    },
    [navigate]
  );
  /*
    Kur kartlarındaki roller sayaç YALNIZCA kullanıcı kurları ilk kez
    gördüğünde oynar (bu tarayıcıda bir kez). Karar mount'ta bir kez alınır;
    o oturumdaki tüm kartlar aynı bayrağı paylaşır.
  */
  const [introRates] = useState(shouldPlayRateIntro);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("none");
  const [openNowOnly, setOpenNowOnly] = useState(false);
  /** Şehir filtresi: "" = tüm şehirler. Şube adresinden türetilen slug. */
  const [cityFilter, setCityFilter] = useState("");
  const [userLocation, setUserLocation] = useState(null);
  const [branchesByInstitution, setBranchesByInstitution] = useState({});
  const [geoToast, setGeoToast] = useState("");
  const [showLocationConsent, setShowLocationConsent] = useState(false);
  /*
    İlk render'da localStorage'daki son kur anlık görüntüsüyle başla — tekrar
    gelen ziyaretçi backend soğukken bile kurları anında görür, arkada taze
    veri gelince sessizce güncellenir.
  */
  const [banks, setBanks] = useState(() => readRatesCache()?.banks || []);
  /*
    A-C2: kur listesi durumu ekran okuyucuya ve göze açıkça bildirilsin.
    "loading" ilk çekiliş · "waking" 503 (soğuk backend uyanıyor) · "error"
    tüm denemeler tükendi · "ready" veri geldi.
  */
  const [ratesState, setRatesState] = useState(() =>
    readRatesCache()?.banks?.length ? "ready" : "loading"
  );
  const [lastUpdated, setLastUpdated] = useState(
    () => readRatesCache()?.serverChangedAt || null
  );
  const lastUpdatedRef = useRef(lastUpdated);
  const ratesFingerprintRef = useRef("");
  /** SSE sinyali geldiğinde kurları yeniden çekmek için (K-02). */
  const refetchBanksRef = useRef(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [, setRawCentralBankRates] = useState(null); // ✅ SAF XML kurları
  const [calculatorBank, setCalculatorBank] = useState("");
  const [isBusinessLoginOpen, setIsBusinessLoginOpen] = useState(false);
  const [showLogoutPopup, setShowLogoutPopup] = useState(false);  // ✅ YENİ: Çıkış Modal
  const [chartPeriod, setChartPeriod] = useState('Günlük');  // ✅ YENİ: Market Summary filtresi
  const [liveRates, setLiveRates] = useState(null); // ✅ TEK merkezi SSE mesajı - tüm banka kartları bunu paylaşır

  // ✅ FIX: Her V0BankCard kendi SSE bağlantısını açtığında (16+ kart), tarayıcının
  // host başına bağlantı limiti (~6) tükeniyor ve Market Summary'nin fetch istekleri
  // sonsuza kadar kuyrukta kalıyordu ("Yükleniyor..." hiç bitmiyordu).
  // Çözüm: TEK bir SSE bağlantısı burada (Dashboard seviyesinde) açılır,
  // gelen mesaj state'e yazılır, tüm banka kartlarına prop olarak aşağı geçirilir.
  useEffect(() => {
    let eventSource = null;
    let reconnectTimer = null;
    let isMounted = true;
    let reconnectAttempt = 0;

    const connect = () => {
      eventSource = new EventSource(ratesStreamUrl());

      eventSource.onopen = () => {
        reconnectAttempt = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "rate_update" && data.rates) {
            setLiveRates(data.rates);
            const at = data.ratesChangedAt || data.timestamp || new Date().toISOString();
            if (at !== lastUpdatedRef.current) {
              lastUpdatedRef.current = at;
              setLastUpdated(at);
            }
          } else if (data.type === "data_changed" && data.ratesChangedAt) {
            if (data.ratesChangedAt !== lastUpdatedRef.current) {
              lastUpdatedRef.current = data.ratesChangedAt;
              setLastUpdated(data.ratesChangedAt);
            }
          }
        } catch {
          // Sessizce yut - tekil mesaj parse hatası kritik değil
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        if (isMounted) {
          // Exponential backoff (1s, 2s, 4s, … max 30s) — reconnect storm önlenir
          const delayMs = Math.min(30000, 1000 * Math.pow(2, reconnectAttempt));
          reconnectAttempt += 1;
          reconnectTimer = setTimeout(connect, delayMs);
        }
      };
    };

    connect();

    return () => {
      isMounted = false;
      if (eventSource) eventSource.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  /**
   * SSE ile Merkez Bankası değişimi geldiğinde kartları tazele.
   *
   * ⚠️ K-02 sonrası: Burada marjlar tarayıcıda tutulup nihai kur yeniden
   * HESAPLANIYORDU. Marj artık istemciye hiç inmediği için (ve inmemesi
   * gerektiği için) SSE bir "yeniden çek" sinyaline dönüştü — nihai kuru
   * her zaman backend hesaplar.
   */
  useEffect(() => {
    if (!liveRates) return;
    setRawCentralBankRates(liveRates);
    refetchBanksRef.current?.();
  }, [liveRates]);

  const [exchangeCurrency, setExchangeCurrency] = useState("");
  // Alış: döviz tutarı → TL; Satış: TL tutarı → döviz
  const [exchangeAmount, setExchangeAmount] = useState("0");
  const [exchangeOperation, setExchangeOperation] = useState("buy");

  useEffect(() => {
    let mounted = true;

    const fetchBanks = async () => {
      try {
        /**
         * ⚠️ GÜVENLİK + MİMARİ DÜZELTMESİ (denetim bulgusu K-02): Burada
         * /api/kurlar ile birlikte /api/margins de çekiliyor ve nihai kur
         * TARAYICIDA yeniden hesaplanıyordu. İki sorunu vardı:
         *   1) /api/margins public'ti ve 20 işletmenin kâr marjını herkese
         *      açıyordu (rakip istihbaratı). Uç artık superadmin'e kapalı.
         *   2) Aynı sayı iki yerde hesaplanıyordu — backend'de ve frontend'de.
         * Nihai kurun tek kaynağı artık backend'dir.
         */
        /*
          Soğuk backend toleransı (F-H3): retry döngüsü lib/api.js'e taşındı,
          ComparePage ile paylaşılıyor.
        */
        const data = await fetchRatesWithRetry({
          isCancelled: () => !mounted,
          onRetry: ({ attempt, delayMs }) => {
            if (mounted) setRatesState((s) => (s === "ready" ? s : "waking"));
            devLog(`[DASHBOARD] Kurlar hazır değil, ${delayMs}ms sonra tekrar (deneme ${attempt})`);
          },
        });
        if (!data) return;

        const incomingBanks = Array.isArray(data?.banks) ? data.banks : [];
        const websiteByName = new Map(
          LOCAL_BANKS.map((bank) => [normalizeText(bank.name), bank.websiteUrl])
        );

        // ✅ DINAMIK HESAPLAMA: Raw XML kurlar + DB marjları
        const mappedBanks = incomingBanks.map((apiBank, index) => {
          const apiName = apiBank?.bankName || apiBank?.bank || `Banka ${index + 1}`;
          const normalizedName = normalizeText(apiName);
          const websiteUrl = apiBank?.sourceUrl || websiteByName.get(normalizedName) || "#";
          
          // ✅ KILIT: Backend'ten gelen institutionId kullan (örn: 'akbank', 'ziraat', 'garanti')
          const institutionId = apiBank?.institutionId;
          
          // Nihai kur backend'den gelir (K-02): tek gerçeklik kaynağı.
          const exchangeRates = mapApiBankToExchangeRows(apiBank);

          return {
            id: `api-bank-${index + 1}`,
            name: apiName,
            websiteUrl,
            institutionId,
            slug:
              apiBank?.slug ||
              buildBusinessSlug({
                institutionId,
                name: apiName,
              }),
            exchangeRates,
            workingHours:
              apiBank?.workingHours ||
              apiBank?.working_hours ||
              null,
            subscription_type: apiBank?.subscription_type || null,
            subscription_end_date: apiBank?.subscription_end_date || null,
            days_remaining:
              apiBank?.days_remaining != null ? Number(apiBank.days_remaining) : null,
            logo_url: apiBank?.logo_url || null,
            is_active:
              apiBank?.is_active === true ||
              apiBank?.is_active === 1 ||
              apiBank?.is_active === "1" ||
              (apiBank?.is_active !== false &&
                apiBank?.is_active !== 0 &&
                apiBank?.is_active !== "0"),
          };
        }).filter((bank) => {
          const isActive =
            bank.is_active === true || bank.is_active === 1 || bank.is_active === "1";
          if (!isActive) return false;
          if (bank.subscription_end_date) {
            const end = new Date(bank.subscription_end_date).getTime();
            if (Number.isFinite(end) && end <= Date.now()) return false;
          }
          return true;
        });

        // ✅ SAF XML kurlarını kaydet (Dinamik hesaplama için)
        if (data?.rawCentralBankRates) {
          setRawCentralBankRates(data.rawCentralBankRates);
          devLog("[DASHBOARD] SAF XML kurları kaydedildi:", data.rawCentralBankRates);
        }

        const serverChangedAtForCache =
          data?.ratesChangedAt || data?.updatedAt || null;
        if (mappedBanks.length > 0) {
          writeRatesCache({
            banks: mappedBanks,
            rawCentralBankRates: data?.rawCentralBankRates || null,
            serverChangedAt: serverChangedAtForCache,
          });
        }

        if (mounted) {
          setBanks(mappedBanks);
          setRatesState(mappedBanks.length > 0 ? "ready" : "error");

          // Son güncelleme: yalnızca kur/marj içeriği veya sunucu damgası değişince
          const fingerprint = JSON.stringify(
            mappedBanks.map((b) => ({
              id: b.institutionId || b.id,
              rates: b.exchangeRates,
            }))
          );
          const serverChangedAt =
            data?.ratesChangedAt || data?.updatedAt || null;
          const contentChanged = fingerprint !== ratesFingerprintRef.current;
          if (contentChanged) {
            ratesFingerprintRef.current = fingerprint;
          }
          const nextStamp =
            contentChanged
              ? serverChangedAt || new Date().toISOString()
              : serverChangedAt && serverChangedAt !== lastUpdatedRef.current
                ? serverChangedAt
                : null;

          if (nextStamp && nextStamp !== lastUpdatedRef.current) {
            lastUpdatedRef.current = nextStamp;
            setLastUpdated(nextStamp);
          } else if (!lastUpdatedRef.current && serverChangedAt) {
            lastUpdatedRef.current = serverChangedAt;
            setLastUpdated(serverChangedAt);
          }

          devLog(`[DASHBOARD] ${mappedBanks.length} banka yüklendi, FirstBank: ${mappedBanks[0]?.name || "N/A"}`);
        }
      } catch (error) {
        console.error("[DASHBOARD] Kur verisi alınamadı:", error);
        if (mounted) setRatesState((s) => (s === "ready" ? s : "error"));
        /*
          State'e DOKUNMA. Elde önbellekten gelen kurlar varsa dolu ekran
          korunur (hata yüzünden boşaltmak "yavaş"ı "bozuk"a çeviriyordu);
          hiç veri yoksa zaten `banks === []` ve "yükleniyor" kartı görünür.
          Bir sonraki interval / SSE denemesi tazelemeyi sürdürür.
        */
      }
    };

    refetchBanksRef.current = fetchBanks;
    fetchBanks();
    /*
      M8: SSE zaten canlı güncelleme veriyor. Bu interval yalnızca SSE fallback'i —
      15 dk'ya uzatıldı ve yalnızca sekme görünürken çalışır (arka planda uyuyan
      soğuk-başlangıç backend'ine gereksiz istek atmasın).
    */
    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") fetchBanks();
    }, 900000); // 15 dakika

    devLog("[DASHBOARD] SSE fallback yenilemesi başlatıldı - 15 dakika aralığıyla (yalnızca görünürken)");

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

  // ✅ DEAD CODE REMOVED: Interest ve Credit mode'ları kaldırıldı
  // ✅ Sadece exchange mode kullanılıyor
  const currentSortOptions = useMemo(() => {
    return EXCHANGE_SORT_OPTIONS.map((opt) => ({
      value: opt.value,
      label: t(opt.labelKey),
    }));
  }, [t]);

  // Şube koordinatları — En Yakın Konum sıralaması
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/branches"));
        if (!res.ok) return;
        const data = await res.json();
        const rows = Array.isArray(data.branches) ? data.branches : [];
        const map = {};
        for (const branch of rows) {
          const key = branch.institution_id || normalizeText(branch.institution_name || "");
          if (!key) continue;
          if (!map[key]) map[key] = [];
          map[key].push(branch);
          const nameKey = normalizeText(branch.institution_name || "");
          if (nameKey && nameKey !== key) {
            if (!map[nameKey]) map[nameKey] = [];
            map[nameKey].push(branch);
          }
        }
        if (!cancelled) setBranchesByInstitution(map);
      } catch (err) {
        console.warn("[DASHBOARD] Şubeler (konum) alınamadı:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!geoToast) return undefined;
    const timer = setTimeout(() => setGeoToast(""), 4500);
    return () => clearTimeout(timer);
  }, [geoToast]);

  const requestNearestSort = () => {
    if (!navigator.geolocation) {
      setGeoToast(t("locationUnsupported"));
      setSortBy("none");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setSortBy("nearest");
        setGeoToast("");
      },
      () => {
        setGeoToast(t("locationPermissionRequired"));
        setUserLocation(null);
        setSortBy("none");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };

  const handleSortChange = (value) => {
    if (value === "nearest") {
      if (userLocation) {
        setSortBy("nearest");
        return;
      }
      setShowLocationConsent(true);
      return;
    }
    setSortBy(value);
  };

  useEffect(() => {
    const allowedValues = new Set(currentSortOptions.map((o) => o.value));
    if (!allowedValues.has(sortBy)) {
      setSortBy(currentSortOptions[0]?.value ?? "none");
    }
  }, [currentSortOptions, sortBy]);

  const filteredAndSortedBanks = useMemo(() => {
    // Aktif + süresi dolmamış
    let result = banks.filter((b) => {
      const isActive =
        b.is_active === true || b.is_active === 1 || b.is_active === "1";
      if (!isActive) return false;
      if (b.subscription_end_date) {
        const end = new Date(b.subscription_end_date).getTime();
        if (Number.isFinite(end) && end <= Date.now()) return false;
      }
      return true;
    });

    const byIdOrInstitution = Array.from(
      new Map(
        result.map((business) => [
          business.institutionId || business.id,
          business,
        ])
      ).values()
    );
    result = Array.from(
      new Map(
        byIdOrInstitution.map((business) => [
          normalizeText(business.name || business.bankName || "") ||
            business.institutionId ||
            business.id,
          business,
        ])
      ).values()
    );

    if (searchQuery) {
      result = result.filter((bank) =>
        bank.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Şehir filtresi: işletmenin O ŞEHİRDE en az bir şubesi varsa listede kalır.
    if (cityFilter) {
      result = result.filter((bank) => {
        const list =
          branchesByInstitution[bank.institutionId] ||
          branchesByInstitution[normalizeText(bank.name)] ||
          [];
        return list.some((branch) => branch?.city === cityFilter);
      });
    }

    if (openNowOnly) {
      result = result.filter((bank) => {
        const hours =
          bank.workingHours ||
          bank.working_hours ||
          "09:00 - 17:00";
        return isOpenNow(hours);
      });
    }

    const nearestActive =
      sortBy === "nearest" &&
      userLocation?.lat != null &&
      userLocation?.lng != null;

    if (nearestActive) {
      result = result.map((bank) => {
        const nearest = getNearestBranchInfo(
          bank,
          userLocation.lat,
          userLocation.lng,
          branchesByInstitution
        );
        return {
          ...bank,
          nearestBranch: nearest,
          nearestDistanceKm: nearest?.distanceKm ?? Number.POSITIVE_INFINITY,
        };
      });
      result.sort((a, b) => a.nearestDistanceKm - b.nearestDistanceKm);
    } else if (sortBy !== "none") {
      // M1: eskiden burada `{...bank}` ile yeni nesneler üretiliyordu (memo'yu
      // kırıyordu). nearestBranch yalnızca "en yakın" sıralamasında anlamlı —
      // burada sadece sırala, nesne kimliğini koru.
      result = [...result];
      result.sort((a, b) => {
        const [currency, type, direction] = sortBy.split("-");
        const currencyUpper = currency.toUpperCase();
        const rateA = getRate(a, currencyUpper, type);
        const rateB = getRate(b, currencyUpper, type);
        // Kuru olmayan işletmeler sıralamanın sonuna düşsün (NaN sıralamayı bozmasın).
        const okA = Number.isFinite(rateA);
        const okB = Number.isFinite(rateB);
        if (!okA && !okB) return 0;
        if (!okA) return 1;
        if (!okB) return -1;
        return direction === "high" ? rateB - rateA : rateA - rateB;
      });
    } else {
      result = [...result];
      result.sort((a, b) => a.name.localeCompare(b.name, "tr"));
    }

    return result;
  }, [banks, searchQuery, sortBy, openNowOnly, cityFilter, userLocation, branchesByInstitution]);

  /**
   * ⚠️ UX DÜZELTMESİ (denetim bulgusu U-10): Panoda beş büronun da kuru
   * kuruşuna kadar aynı görünüyordu ve en iyi kuru gösteren hiçbir işaret
   * yoktu — yani "büroları karşılaştır" vaadi ekranda hiç görünmüyordu.
   *
   * Müşteri açısından en iyi ALIŞ = en yüksek (dövizini daha pahalıya
   * bozdurur), en iyi SATIŞ = en düşük (dövizi daha ucuza alır).
   * Sonuç V0BankCard'a `bestRates` olarak geçer ve ilgili hücre işaretlenir.
   */
  const bestRates = useMemo(() => {
    if (filteredAndSortedBanks.length < 2) return null;
    const result = {};
    for (const currency of ["EUR", "USD", "GBP"]) {
      let bestBuy = null;
      let bestSell = null;
      for (const bank of filteredAndSortedBanks) {
        const row = bank.exchangeRates?.find((r) => r.currency === currency);
        const buy = Number(row?.buy);
        const sell = Number(row?.sell);
        if (Number.isFinite(buy) && (bestBuy == null || buy > bestBuy)) bestBuy = buy;
        if (Number.isFinite(sell) && (bestSell == null || sell < bestSell)) bestSell = sell;
      }
      // Herkes aynı kuru veriyorsa "en iyi" işareti bilgi taşımaz — işaretleme.
      let worstBuy = null;
      let worstSell = null;
      for (const bank of filteredAndSortedBanks) {
        const row = bank.exchangeRates?.find((r) => r.currency === currency);
        const buy = Number(row?.buy);
        const sell = Number(row?.sell);
        if (Number.isFinite(buy) && (worstBuy == null || buy < worstBuy)) worstBuy = buy;
        if (Number.isFinite(sell) && (worstSell == null || sell > worstSell)) worstSell = sell;
      }
      const buySpread = bestBuy != null && worstBuy != null && bestBuy - worstBuy > 1e-9;
      const sellSpread = bestSell != null && worstSell != null && worstSell - bestSell > 1e-9;
      if (buySpread || sellSpread) {
        result[currency] = {
          buy: buySpread ? bestBuy : null,
          sell: sellSpread ? bestSell : null,
        };
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }, [filteredAndSortedBanks]);

  const selectedCalculatorBank = banks.find((b) => b.name === calculatorBank) ?? null;
  const selectedExchangePair =
    selectedCalculatorBank?.exchangeRates?.find((r) => r.currency === exchangeCurrency) ?? null;
  const selectedExchangeSellRate = selectedExchangePair?.sell ?? null;
  const selectedExchangeBuyRate = selectedExchangePair?.buy ?? null;
  const exchangeAmountNum = Number.parseFloat(exchangeAmount);
  // Alış = büronun alış kuru (müşteri döviz satar → TL alır)
  // Satış = büronun satış kuru (müşteri TL verir → döviz alır)
  const exchangeResult =
    Number.isFinite(exchangeAmountNum) &&
    exchangeAmountNum > 0 &&
    (exchangeOperation === "buy"
      ? Number.isFinite(selectedExchangeBuyRate)
      : Number.isFinite(selectedExchangeSellRate))
      ? exchangeOperation === "buy"
        ? exchangeAmountNum * selectedExchangeBuyRate
        : exchangeAmountNum / selectedExchangeSellRate
      : null;

  // A-06: üst bar çipleri 26px yükseklikteydi; parmakla isabet ettirilemiyordu.
  // Transition burada YOK: tek kullanıcısı (İşletme Girişi) kendi
  // `transition-colors`'ını taşıyor — ikisi aynı satırda olsa çakışırdı.
  const headerBtnClass =
    "inline-flex items-center justify-center min-h-[2.75rem] rounded-full border px-3.5 text-xs font-semibold";

  const sortItems = useMemo(
    () => currentSortOptions.map((opt) => ({ id: opt.value, label: opt.label })),
    [currentSortOptions]
  );

  const cityItems = useMemo(
    () => [
      { id: "__all__", label: t("cityFilterAll") },
      ...cityOptionsFromBranches(branchesByInstitution, lang).map((city) => ({
        id: city.slug,
        label: city.label,
      })),
    ],
    [branchesByInstitution, lang, t]
  );

  /** Sıralama ve "Şu An Açık" kontrolleri hem satır içi hem Sheet'te kullanılır. */
  const sortControl = (
    <GooeySearchBar
      mode="select"
      fill
      items={sortItems}
      selectedId={sortBy}
      neutralSelectedId="none"
      onSelect={(item) => handleSortChange(item.id)}
      collapsedLabel={t("sortLabel")}
      placeholder={t("sortLabel")}
      emptyLabel={t("noResults")}
      maxResults={16}
      scrollMax={4}
      resultIcon={null}
      aria-label={t("sortLabel")}
    />
  );

  const openNowControl = (
    <GooeyToggle
      className="office-filters__toggle"
      label={t("openNow")}
      checked={openNowOnly}
      onChange={setOpenNowOnly}
      icon={Clock}
    />
  );

  const cityControl =
    cityItems.length > 1 ? (
      <GooeySearchBar
        mode="select"
        fill
        items={cityItems}
        selectedId={cityFilter || "__all__"}
        neutralSelectedId="__all__"
        onSelect={(item) => setCityFilter(item.id === "__all__" ? "" : item.id)}
        collapsedLabel={t("cityFilterLabel")}
        placeholder={t("cityFilterLabel")}
        emptyLabel={t("noResults")}
        maxResults={12}
        scrollMax={4}
        resultIcon={null}
        aria-label={t("cityFilterLabel")}
      />
    ) : null;

  const officeSearchItems = useMemo(
    () =>
      banks.map((bank) => ({
        id: String(bank.institutionId || bank.id || bank.name),
        label: bank.name,
      })),
    [banks]
  );

  const onOfficeQuery = useCallback((next) => {
    setSearchQuery(next);
  }, []);

  const onOfficePick = useCallback((item) => {
    setSearchQuery(item.label);
    document.getElementById("office-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useRegisterOfficeSearch(officeSearchItems, searchQuery, onOfficeQuery, onOfficePick);

  /*
   * P3.4 (S6) — arama sonuç bulamadığında "eşleşmeyen arama" logla. Katalog
   * yüklüyken, sorgu ≥ 2 karakterken ve filtrelenmiş sonuç boşken; 1.2 sn
   * debounce + oturum içi aynı (sorgu+şehir) tekrar gönderilmez.
   */
  const reportedMissesRef = useRef(new Set());
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || banks.length === 0 || filteredAndSortedBanks.length > 0) return undefined;
    const key = `${q.toLowerCase()}|${cityFilter || ""}`;
    if (reportedMissesRef.current.has(key)) return undefined;
    const timer = setTimeout(() => {
      reportedMissesRef.current.add(key);
      reportSearchMiss(q, cityFilter || undefined);
    }, 1200);
    return () => clearTimeout(timer);
  }, [searchQuery, cityFilter, banks.length, filteredAndSortedBanks.length]);

  const officeSearchBar = (
    <GooeySearchBar
      fill
      hideOrb
      items={officeSearchItems}
      value={searchQuery}
      onChange={onOfficeQuery}
      onSelect={onOfficePick}
      collapsedLabel={t("searchBanks")}
      placeholder={t("searchBanks")}
      emptyLabel={t("noResults")}
      aria-label={t("searchBanks")}
    />
  );

  const activeFilterCount =
    (sortBy !== "none" ? 1 : 0) + (openNowOnly ? 1 : 0) + (cityFilter ? 1 : 0);

  const currencyConversionLd = useMemo(
    () => JSON.stringify(buildCurrencyConversionJsonLd({ lang, banksCount: banks.length })),
    [lang, banks.length]
  );
  const financialProductLd = useMemo(() => JSON.stringify(buildFinancialProductJsonLd(lang)), [lang]);

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900 relative dark:bg-ink-950 dark:text-white">
      {/*
        ⚠️ SEO DÜZELTMESİ (denetim bulgusu U-09): Bu sayfada DÖRT rakip <Helmet>
        vardı — SeoHead (veritabanından), ana başlık, piyasa özeti bloğu ve
        çevirici bloğu. Üçü prioritizeSeoTags taşıyordu; hangisinin son
        güncellendiğine göre sayfa başlığı değişiyordu (ölçüm: arka arkaya iki
        okuma iki farklı <title> döndürdü) ve çeviricide para birimi seçmek
        sayfanın kimliğini değiştiriyordu.

        Artık title/description/canonical/og'un TEK sahibi App.jsx'teki
        <SeoHead /> — yani süper admin'in SEO paneli gerçekten çalışıyor.
        Burada yalnızca yapısal veri (JSON-LD) kalıyor.
      */}
      <Helmet>
        <script type="application/ld+json">{currencyConversionLd}</script>
        <script type="application/ld+json">{financialProductLd}</script>
      </Helmet>
      <header className="sticky top-0 z-sticky w-full border-b border-ink-200/80 bg-white/80 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80 sm:px-6 sm:py-4 md:py-5">
        <div className="mx-auto flex w-full max-w-[1600px] min-w-0 items-center justify-between gap-2 sm:gap-4">
        <BrandLogo className="min-w-0 shrink" />
        {/* Ana gezinme: Kurlar / Kıyasla / İşletme (md ve üzeri). */}
        <SiteNav className="mr-auto ml-2" />
        <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-3">
          {/* Business Login'in solunda canlı saat — kendi state'inde tik atar. */}
          <HeaderClock />
          <button
            type="button"
            onClick={() =>
              isAuthenticated
                ? navigate(isSuperAdmin ? "/super-admin" : "/admin")
                : setIsBusinessLoginOpen(true)
            }
            /*
              ⚠️ HATA DÜZELTMESİ: `brand-400`/`brand-600` — palette bu emekli
              vurgu skalasını terk edeli beri bu buton unutulmuş, tek kalan
              kullanımıydı. Hex'leri nötr gri (#9d9da8/#55555f), yani hover
              zaten görünse de sitenin geri kalanından kopuk "grimsi" bir leke
              gibi duruyordu. SlidingTabs'ın hover'ıyla değiştirildi: kenarlık
              SABİT kalıyor, yalnızca metin soluktan tam kontrasta geçiyor.

              `data-no-press`: sitedeki her buton için otomatik bir
              `transition: transform ...` kuralı var (M-04), `:not()` zinciri
              yüzünden tek class'lı `transition-colors`'ı eziyordu — renk
              geçişsiz atlıyordu. O kuraldan çıkıp basma tepkisini
              `active:scale` ile aynı class listesinde (`color,transform`)
              yeniden tanımlıyoruz — tıklama geri bildirimi kaybolmuyor.
            */
            data-no-press
            className={`${headerBtnClass} max-w-[9.5rem] truncate border-ink-300 bg-white text-ink-700 transition-[color,transform] duration-base ease-out active:scale-[0.97] hover:text-ink-950 dark:border-white/10 dark:bg-ink-950/60 dark:text-ink-200 dark:hover:text-white sm:max-w-none`}
          >
            {isAuthenticated
              ? isSuperAdmin
                ? t("adminPanel")
                : t("businessPanel")
              : t("businessLogin")}
          </button>

          {isAuthenticated && (
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-1 text-xs font-semibold text-danger-700 transition-all duration-300 hover:border-danger-500/60 hover:bg-danger-500/20 dark:text-danger-200 dark:text-danger-400"
              title={t("logout")}
            >
              <LogOut className="size-4" />
              <span className="hidden md:inline">{t("logout")}</span>
            </button>
          )}

          <HeaderActions />
        </div>
        </div>
      </header>
      <BusinessLoginModal isOpen={isBusinessLoginOpen} onClose={() => setIsBusinessLoginOpen(false)} />
      {/*
        ⚠️ TASARIM DÜZELTMESİ (mat siyah): Bu iki küre %20 opaklıkla duruyordu
        ve ekranın iki yanını renkli bir yıkamayla kaplıyordu — "mat siyah"
        zemin böyle olmuyor, renkli bir alacakaranlık oluyor.

        Küreler artık renksiz: karanlık temada mat siyahın üzerine düşen soluk
        beyaz ışık, aydınlık temada gri bir gölgelenme. Renkli bir yıkama
        (önce teal, sonra magenta) "mat siyah" olmuyordu.
      */}
      <div className="pointer-events-none fixed -left-60 -top-40 z-0 h-[40rem] w-[40rem] rounded-full bg-ink-950/[0.04] blur-[140px] dark:bg-white/[0.05]"></div>
      <div className="pointer-events-none fixed -right-40 top-10 z-0 h-[45rem] w-[45rem] rounded-full bg-ink-950/[0.04] blur-[140px] dark:bg-white/[0.04]"></div>
      <div
        className="pointer-events-none fixed inset-0 z-0 text-ink-900 opacity-[0.05] dark:text-white dark:opacity-[0.09]"
        /*
          ⚠️ TASARIM DÜZELTMESİ (D-16): Arka plan ızgarası paletin dışındaydı —
          yatay çizgiler sky-400 (#38bdf8), dikey çizgiler indigo-500 (#6366f1)
          idi. Denetimde 10 renk ailesi 5 semantik role indirilmişti ama bu iki
          renk geride kalmıştı; ayrıca 0.22 opaklık 38 px aralıkta defter
          kâğıdı gibi baskın çıkıp üstündeki rakamlarla yarışıyordu.

          Artık tek marka tonu, üçte bir opaklık ve iki katı aralık: doku hâlâ
          var ama okunacak şey rakamlar.
        */
        /*
          (mat siyah) D-16 ızgarayı paletin içine almıştı ama değer hâlâ SABİT
          bir cyan hex'iydi (#06b6d4). Palet magentaya geçince ekranda tek
          başına kalan cyan buydu. Doku artık renksiz.

          Çizgi rengi `currentColor`: aynı elemanla iki temaya çalışıyor —
          karanlıkta beyaz, aydınlıkta mürekkep. Sabit beyaz yazılsaydı doku
          aydınlık temada tamamen kaybolurdu.
        */
        style={{
          backgroundImage:
            "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />
      <div className="relative z-raised mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 pb-10 pt-6 sm:px-4 md:gap-8 md:px-8 md:pb-12 md:pt-8">
      <div className="flex w-full flex-col gap-1">
        <h1>{t("homeH1")}</h1>
        <p className="text-sm text-ink-600 dark:text-ink-400">{t("homeLead")}</p>
      </div>

      {/*
        ⚠️ TASARIM DÜZELTMESİ (D-13): Kart yüzeyi sistem dışıydı — `rounded-2xl`
        + `shadow-xl` kullanılıyordu, oysa tasarım sisteminde `rounded-card`
        (0.875rem) ve `shadow-card` tanımlı ve `.surface-card` bunları tek
        yerden veriyor. Ayrıca `transition-all hover:border-brand-500/30`:
        sayfanın en büyük statik kabının üstüne gelince kenarlığı renk
        değiştiriyordu. Tıklanabilir değil, bir eylem de değil — amacı olmayan
        animasyon kaldırıldı.
      */}
      <section className="surface-card p-4 md:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {/*
              ⚠️ TASARIM DÜZELTMESİ (D-14): Aynı düzeydeki üç bölüm başlığı üç
              ayrı dille yazılmıştı — piyasa özeti camgöbeği+büyük harf,
              çevirici gri+büyük harf, ofisler siyah+normal ve daha büyük punto.
              Hiyerarşi bozuluyordu: küçük camgöbeği etiket, altındaki dev
              rakamlardan daha çok dikkat çekiyordu.

              Artık tek dil: aynı punto, aynı ağırlık, aynı renk. `uppercase` da
              kaldırıldı — projenin kendi kuralı (index.css `.field-label`)
              lang="tr" altında tarayıcının "i" harfini "İ" yapması yüzünden
              büyük harf kullanmamayı söylüyordu.
            */}
            <h2 className="text-base font-semibold tracking-tight text-ink-900 dark:text-white">
              {t("marketSummary")}
            </h2>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
              {t("marketSummaryNote")}
            </p>
          </div>

          {/*
            ⚠️ TASARIM DÜZELTMESİ (D-15): Zaman aralığı seçicisi bozuktu. Aktif
            sekme `sm:scale-105` ile fiziksel olarak BÜYÜYOR, gradyan dolgu ve
            `shadow-lg` gölge alıyordu; beş sekme `flex-wrap` ile alt satıra
            taşıp "Yıllık"ı tek başına bırakıyordu. Ölçüm: 741 px genişlikte
            sekme grubu iki satıra kırılıyordu.

            Yeni hâli tek satırda kalır (dar ekranda yatay kayar) ve aktif sekme
            büyümez — yalnızca yüzey rengiyle ayrışır.

            Dolgu artık her sekmede yeniden boyanmıyor: tek bir gösterge katmanı
            sekmeler arasında kayıyor (SlidingTabs), tema anahtarındaki kayan
            topuzla aynı hareket dili.
          */}
          <SlidingTabs
            ariaLabel={t("marketSummary")}
            className="flex shrink-0 gap-0.5 overflow-x-auto rounded-control border border-ink-200 bg-ink-100/70 p-1 [scrollbar-width:none] dark:border-white/10 dark:bg-ink-950/60 sm:overflow-visible [&::-webkit-scrollbar]:hidden"
            items={[
              { key: "Saatlik", label: t("periodHourly") },
              { key: "Günlük", label: t("periodDaily") },
              { key: "Haftalık", label: t("periodWeekly") },
              { key: "Aylık", label: t("periodMonthly") },
              { key: "Yıllık", label: t("periodYearly") },
            ]}
            value={chartPeriod}
            onChange={setChartPeriod}
          />
        </div>
        
        {/* ✅ SADELEŞTIRILMIŞ: Sadece USD, EUR, GBP - GERÇEK VERİ */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {['USD', 'EUR', 'GBP'].map((currency) => (
            /*
              Fallback dolu kartla AYNI 294 px — grafik chunk'ı yüklenirken
              sayfa zıplamasın (CLS koruması).
            */
            <Suspense
              key={currency}
              fallback={
                <div className="h-[294px] rounded-xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900" />
              }
            >
              <MarketSummaryCard currency={currency} period={chartPeriod} />
            </Suspense>
          ))}
        </div>
      </section>

      {/* D-13 / D-14: piyasa özeti kartıyla aynı yüzey ve aynı başlık dili. */}
      <section className="surface-card overflow-visible p-4 sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-ink-900 dark:text-white">
            {t("currencyConverter")}
          </h2>
        </div>

        <div className="currency-converter-row grid grid-cols-1 items-center gap-3 sm:grid-cols-2 xl:grid-cols-12">
            <div className="min-w-0 xl:col-span-2">
              <GooeySearchBar
                mode="select"
                fill
                items={[
                  { id: "USD", label: "USD" },
                  { id: "EUR", label: "EUR" },
                  { id: "GBP", label: "GBP" },
                ]}
                selectedId={exchangeCurrency}
                onSelect={(item) => setExchangeCurrency(item.id)}
                collapsedLabel={t("currencyUnit")}
                placeholder={t("selectCurrency")}
                emptyLabel={t("noResults")}
                maxResults={3}
                resultIcon={null}
                aria-label={t("currencyUnit")}
              />
            </div>

            <div className="min-w-0 xl:col-span-2">
              <BuySellToggle value={exchangeOperation} onChange={setExchangeOperation} />
            </div>

            <div className="min-w-0 sm:col-span-2 xl:col-span-3">
              {/*
                Uyarı artık ETİKET değil. Para birimi seçilmeden önce düğmenin
                üstünde "Lütfen önce Döviz Birimi seçin" yazıyordu; kontrolün
                ne olduğu (döviz bürosu seçici) hiç okunmuyordu ve uzun metin
                hapı komşu alanlardan farklı gösteriyordu. Etiket artık her
                hâlde "Döviz Bürosu"; sebep `title` ile imleçte veriliyor.

                `maxResults` 8 değil 16: 16 büro var, 8'de kesmek kaydırsan da
                geri kalanını ulaşılmaz kılıyordu. Görünen baloncuk sayısı yine
                4 (`scrollMax`), gerisi kaydırmayla geliyor.
              */}
              <GooeySearchBar
                mode="select"
                fill
                disabled={!exchangeCurrency}
                items={
                  exchangeCurrency
                    ? [...banks]
                        .sort((a, b) => a.name.localeCompare(b.name, localeCode))
                        .map((bank) => {
                          const rate = bank.exchangeRates?.find((r) => r.currency === exchangeCurrency);
                          const price = exchangeOperation === "buy"
                            ? (Number.isFinite(rate?.buy) ? rate.buy.toFixed(2) : "—")
                            : (Number.isFinite(rate?.sell) ? rate.sell.toFixed(2) : "—");
                          const operationType = exchangeOperation === "buy" ? t("buy") : t("sell");
                          return {
                            id: bank.name,
                            label: `${bank.name} | ${operationType}: ${price}`,
                          };
                        })
                    : []
                }
                selectedId={calculatorBank}
                onSelect={(item) => {
                  setCalculatorBank(item.id);
                  setExchangeAmount("0");
                }}
                collapsedLabel={t("selectBank")}
                placeholder={t("selectExchangeOffice")}
                title={!exchangeCurrency ? t("selectCurrencyFirst") : undefined}
                emptyLabel={t("noResults")}
                maxResults={16}
                scrollMax={4}
                aria-label={t("selectBank")}
              />
            </div>

            <div className="min-w-0 xl:col-span-2">
              <GooeyPillField
                tone="dark"
                label={
                  exchangeOperation === "buy"
                    ? exchangeCurrency
                      ? `${t("amountCurrency")} (${exchangeCurrency})`
                      : t("amountCurrency")
                    : t("amountTl")
                }
                type="number"
                min="0"
                disabled={!calculatorBank}
                value={!calculatorBank ? "" : exchangeAmount === "0" ? "" : exchangeAmount}
                onChange={(next) => setExchangeAmount(next === "" ? "0" : next)}
                placeholder={calculatorBank ? t("enterAmount") : ""}
                title={!calculatorBank ? t("selectOfficeFirst") : undefined}
              />
            </div>

            {(() => {
              const hasResult =
                Number.isFinite(exchangeResult) && calculatorBank && Number(exchangeAmount) > 0;
              return (
                <GooeyPillField
                  className="min-w-0 sm:col-span-2 xl:col-span-3"
                  tone="dark"
                  label={
                    exchangeOperation === "buy"
                      ? t("resultSell")
                      : `${t("resultBuy")} ${exchangeCurrency || ""}`.trim()
                  }
                  readOnly
                  muted={!hasResult}
                  placeholder={calculatorBank && !hasResult ? t("enterAmountPrompt") : ""}
                  title={!calculatorBank ? t("selectOfficeFirst") : undefined}
                  value={
                    hasResult
                      ? `${exchangeResult.toLocaleString(localeCode, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} ${exchangeOperation === "buy" ? "TL" : exchangeCurrency}`
                      : ""
                  }
                />
              );
            })()}
          </div>
      </section>

      {/* D-14: üçüncü bölüm de artık aynı başlık dilini kullanıyor. */}
      <h2 className="text-base font-semibold tracking-tight text-ink-900 dark:text-white">
        {t("homeH2Offices")}
      </h2>

      {/*
        A-06 / mobil UX: Arama + sıralama + "Şu An Açık" üç kontrolü 375px'te
        dar alana sıkışıyordu. Mobilde arama görünür kalır, sıralama ve filtre
        alttan açılan Sheet'e taşınır; sm+ ekranlarda hepsi eskisi gibi satır içi.
      */}
      <div className={cityControl ? "office-filters" : "office-filters office-filters--three"}>
        <div className="office-filters__cell hidden sm:block">{officeSearchBar}</div>

        <button
          type="button"
          onClick={() => setFilterSheetOpen(true)}
          className="btn-ghost w-full justify-between sm:hidden"
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
            {t("sortLabel")}
          </span>
          {activeFilterCount > 0 ? (
            <span className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-brand-600 px-1.5 py-0.5 text-xs font-bold text-white">
              {activeFilterCount}
            </span>
          ) : null}
        </button>

        <div className="office-filters__cell hidden sm:block">{sortControl}</div>
        {cityControl ? (
          <div className="office-filters__cell hidden sm:block">{cityControl}</div>
        ) : null}
        <div className="office-filters__cell hidden sm:block">{openNowControl}</div>
      </div>

      <Sheet
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        title={t("sortLabel")}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setSortBy("none");
                setOpenNowOnly(false);
                setCityFilter("");
              }}
            >
              {t("clearFilters")}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setFilterSheetOpen(false)}
            >
              {t("showResults")} ({filteredAndSortedBanks.length})
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pt-1">
          {sortControl}
          {cityControl}
          {openNowControl}
        </div>
      </Sheet>

      {geoToast ? (
        <div className="rounded-lg border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-sm text-warning-800 dark:text-warning-200">
          {geoToast}
        </div>
      ) : null}

      {showLocationConsent ? (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-ink-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-5 shadow-2xl dark:border-ink-700 dark:bg-ink-900">
            <h3 className="text-base font-bold text-ink-900 dark:text-white">
              {t("locationShareTitle")}
            </h3>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
              {t("locationShareConfirm")}
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  setShowLocationConsent(false);
                  setSortBy("none");
                  setGeoToast(t("locationPermissionRequired"));
                }}
                className="btn-ghost flex-1"
              >
                {t("locationShareDeny")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLocationConsent(false);
                  requestNearestSort();
                }}
                className="btn-primary flex-1"
              >
                {t("locationShareAllow")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {banks.length === 0 ? (
        <div
          role="status"
          aria-live="polite"
          aria-busy={ratesState === "loading" || ratesState === "waking"}
          className="rounded-2xl border border-ink-200 bg-white/80 p-6 py-10 text-center text-ink-600 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-ink-900/60 dark:text-ink-300"
        >
          {ratesState === "error" ? (
            <>
              <p className="font-medium text-ink-900 dark:text-white">{t("banksErrorTitle")}</p>
              <p className="mt-1 text-sm">{t("banksErrorBody")}</p>
              <button
                type="button"
                onClick={() => {
                  setRatesState("loading");
                  refetchBanksRef.current?.();
                }}
                className="btn-primary mt-4"
              >
                {t("retry")}
              </button>
            </>
          ) : ratesState === "waking" ? (
            <>
              <p className="font-medium text-ink-900 dark:text-white">{t("banksWakingTitle")}</p>
              <p className="mt-1 text-sm">{t("banksWakingBody")}</p>
            </>
          ) : (
            t("banksLoading")
          )}
        </div>
      ) : filteredAndSortedBanks.length > 0 ? (
        <div id="office-grid" className="grid scroll-mt-28 grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8 lg:grid-cols-3 md:gap-10">
          {filteredAndSortedBanks.map((bank) => (
            <V0BankCard
              key={bank.institutionId || bank.id}
              bank={bank}
              bestRates={bestRates}
              introRates={introRates}
              branches={
                branchesByInstitution[bank.institutionId] ||
                branchesByInstitution[normalizeText(bank.name)] ||
                EMPTY_BRANCHES
              }
              showNearestBranch={sortBy === "nearest" && Boolean(userLocation)}
              onSelect={handleBankSelect}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-ink-200 bg-white/80 p-6 py-10 text-center text-ink-600 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-ink-900/60 dark:text-ink-300">
          {t("noBanksMatch")}
        </div>
      )}

      {lastUpdated ? (
        <div className="mt-10 flex justify-center px-2">
          {/*
            Metin her iki temada da `text-ink-500` idi; koyu zeminde neredeyse
            okunmuyordu. Artık sitedeki ikincil metin dili: açıkta ink-600,
            koyuda ink-300. Kenarlık da diğer yüzeylerle aynı (`white/10`).
          */}
          <div className="rounded-lg border border-ink-200 bg-white/80 px-4 py-2.5 text-center text-xs tracking-wide text-ink-600 shadow-sm dark:border-white/10 dark:bg-ink-900/60 dark:text-ink-300">
            {/* U-05: bu değer sunucunun son kontrol anı, bültenin tarihi değil. */}
            {`${t("lastChecked")}: ${new Date(lastUpdated).toLocaleDateString(localeCode)} - ${new Date(lastUpdated).toLocaleTimeString(localeCode)}`}
          </div>
        </div>
      ) : null}

        {/* ✅ FIXED MODAL - ÇIKIS */}
        {showLogoutPopup && (
          <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
            <div className="surface-card flex w-full max-w-sm flex-col items-center p-6 shadow-2xl transition-all sm:p-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-danger-500/20 animate-spin">
                <svg className="h-8 w-8 text-danger-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <h3 className="text-center text-lg font-bold text-ink-900 dark:text-white sm:text-xl">{t("logoutInProgress")}</h3>
              <p className="mt-2 text-center text-sm text-ink-600 dark:text-ink-300">{t("logoutRedirecting")}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
