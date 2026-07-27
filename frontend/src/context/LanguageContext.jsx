import { createContext, useCallback, useContext, useMemo, useState } from "react";

const LanguageContext = createContext(null);

const STORAGE_KEY = "finsight-lang";

export const dictionaries = {
  tr: {
    liveMarket: "Canlı Piyasa",
    businessLogin: "İşletme Girişi",
    businessPanel: "İşletme Paneli",
    adminPanel: "Admin Paneli",
    logout: "Çıkış Yap",
    partnership: "Partnerlik",
    marketSummary: "Piyasa Özeti",
    marketSummaryNote: "KKTC Merkez Bankası kurları baz alınarak yapılmıştır.",
    searchBanks: "Banka ara...",
    openNow: "Şu An Açık",
    currencyConverter: "Döviz Çevirici",
    depositCalculator: "Mevduat Getiri Hesaplayıcı",
    loanCalculator: "Kredi Taksit Hesaplayıcı",
    currencyUnit: "Döviz Birimi",
    selectCurrency: "Döviz Seçiniz",
    operationType: "İşlem Türü",
    buy: "Alış",
    sell: "Satış",
    selectBank: "Banka Seçin",
    selectBankPlaceholder: "Banka Seçiniz",
    amountTl: "Tutar (TL)",
    amountCurrency: "Tutar",
    resultBuy: "Alınacak",
    resultSell: "Elde Edilecek TL",
    resultWaiting: "Sonuç bekleniyor",
    sortLabel: "Sıralama",
    banksLoading: "Kur listesi yukleniyor veya baglanti hatası...",
    noBanksMatch: "Filtrelere uyan işletme bulunamadı.",
    themeLight: "Açık tema",
    themeDark: "Koyu tema",
    langTr: "TR",
    langEn: "EN",
    sortNearest: "En Yakın",
    sortNone: "Sıralama Yok",
    sortGbpBuyHigh: "En Yüksek Alış (GBP)",
    sortGbpBuyLow: "En Düşük Alış (GBP)",
    sortUsdBuyHigh: "En Yüksek Alış (USD)",
    sortUsdBuyLow: "En Düşük Alış (USD)",
    sortEurBuyHigh: "En Yüksek Alış (EUR)",
    sortEurBuyLow: "En Düşük Alış (EUR)",
    periodHourly: "Saatlik",
    periodDaily: "Günlük",
    periodWeekly: "Haftalık",
    periodMonthly: "Aylık",
    periodYearly: "Yıllık",
    backToDashboard: "Dashboard",
    managementPanel: "Yönetim Paneli",
    lastUpdate: "Son Güncelleme",
    subscriptionStatus: "Abonelik Durumu",
    remainingSubscription: "Kalan Abonelik Süresi",
    subscriptionExpired: "Süresi Bitti",
    daysUnit: "Gün",
    centralBankRates: "Merkez Bankası Kurları (Salt Okunur)",
    centralBankRatesNote: "Aşağıdaki kurlar KKTC Merkez Bankası XML kaynağından gelmektedir.",
    subscriptionExpiredNotice:
      "Abonelik süreniz dolmuştur. Kâr marjı ayarları yalnızca görüntülenebilir; güncelleme yapılamaz.",
    buyRates: "ALIŞ KURLAR",
    sellRates: "SATIŞ KURLAR",
    centralBankRate: "Merkez Bankası KUR",
    effectiveRate: "Efektif",
    profitType: "Kâr Tipi",
    profitMargin: "Kâr Marjı",
    profitValue: "Kâr Değeri",
    fixedPrice: "Baz Fiyat (TL)",
    percentPrice: "Yüzdesel (%)",
    finalRate: "Final Kur",
    profitTl: "TL Kâr",
    saveMargins: "Kâr Marjlarını Kaydet",
    saving: "Kaydediliyor...",
    logoutShort: "Çıkış",
    changePassword: "Şifre Değiştir",
    changePasswordTitle: "Şifre Değiştir",
    oldPassword: "Eski Şifre",
    newPassword: "Yeni Şifre",
    confirmPassword: "Yeni Şifre (Tekrar)",
    confirmPasswordAction: "Onayla",
    cancel: "Vazgeç",
    passwordMismatch: "Yeni şifreler eşleşmiyor.",
    passwordChangedSuccess: "Şifre başarıyla değiştirildi.",
  },
  en: {
    liveMarket: "Live Market",
    businessLogin: "Business Login",
    businessPanel: "Business Panel",
    adminPanel: "Admin Panel",
    logout: "Log Out",
    partnership: "Partnership",
    marketSummary: "Market Summary",
    marketSummaryNote: "Based on Central Bank of Northern Cyprus rates.",
    searchBanks: "Search banks...",
    openNow: "Open Now",
    currencyConverter: "Currency Converter",
    depositCalculator: "Deposit Return Calculator",
    loanCalculator: "Loan Installment Calculator",
    currencyUnit: "Currency",
    selectCurrency: "Select Currency",
    operationType: "Operation",
    buy: "Buy",
    sell: "Sell",
    selectBank: "Select Bank",
    selectBankPlaceholder: "Select a bank",
    amountTl: "Amount (TRY)",
    amountCurrency: "Amount",
    resultBuy: "You get",
    resultSell: "You get TRY",
    resultWaiting: "Waiting for result",
    sortLabel: "Sort",
    banksLoading: "Loading rates or connection error...",
    noBanksMatch: "No businesses match the filters.",
    themeLight: "Light theme",
    themeDark: "Dark theme",
    langTr: "TR",
    langEn: "EN",
    sortNearest: "Nearest",
    sortNone: "No Sorting",
    sortGbpBuyHigh: "Highest Buy (GBP)",
    sortGbpBuyLow: "Lowest Buy (GBP)",
    sortUsdBuyHigh: "Highest Buy (USD)",
    sortUsdBuyLow: "Lowest Buy (USD)",
    sortEurBuyHigh: "Highest Buy (EUR)",
    sortEurBuyLow: "Lowest Buy (EUR)",
    periodHourly: "Hourly",
    periodDaily: "Daily",
    periodWeekly: "Weekly",
    periodMonthly: "Monthly",
    periodYearly: "Yearly",
    backToDashboard: "Dashboard",
    managementPanel: "Management Panel",
    lastUpdate: "Last Update",
    subscriptionStatus: "Subscription Status",
    remainingSubscription: "Remaining Subscription",
    subscriptionExpired: "Expired",
    daysUnit: "Days",
    centralBankRates: "Central Bank Rates (Read-only)",
    centralBankRatesNote: "The rates below are sourced from the TRNC Central Bank XML feed.",
    subscriptionExpiredNotice:
      "Your subscription has expired. Margin settings are view-only and cannot be updated.",
    buyRates: "BUY RATES",
    sellRates: "SELL RATES",
    centralBankRate: "Central Bank Rate",
    effectiveRate: "Effective",
    profitType: "Profit Type",
    profitMargin: "Profit Margin",
    profitValue: "Profit Value",
    fixedPrice: "Fixed (TRY)",
    percentPrice: "Percent (%)",
    finalRate: "Final Rate",
    profitTl: "TRY Profit",
    saveMargins: "Save Profit Margins",
    saving: "Saving...",
    logoutShort: "Log Out",
    changePassword: "Change Password",
    changePasswordTitle: "Change Password",
    oldPassword: "Current Password",
    newPassword: "New Password",
    confirmPassword: "Confirm New Password",
    confirmPasswordAction: "Confirm",
    cancel: "Cancel",
    passwordMismatch: "New passwords do not match.",
    passwordChangedSuccess: "Password changed successfully.",
  },
};

function getInitialLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "tr" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  return "tr";
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(getInitialLang);

  const setLang = useCallback((next) => {
    const value = next === "en" ? "en" : "tr";
    setLangState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = value;
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next = prev === "tr" ? "en" : "tr";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      document.documentElement.lang = next;
      return next;
    });
  }, []);

  const t = useCallback(
    (key) => {
      const dict = dictionaries[lang] || dictionaries.tr;
      return dict[key] ?? dictionaries.tr[key] ?? key;
    },
    [lang]
  );

  const value = useMemo(
    () => ({
      lang,
      setLang,
      toggleLang,
      t,
      dict: dictionaries[lang] || dictionaries.tr,
    }),
    [lang, setLang, toggleLang, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
