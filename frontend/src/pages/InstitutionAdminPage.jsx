import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Key, LogOut, Save, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fetchAdminRates, saveAdminRates, changeBusinessPassword } from "../lib/auth";
import { fetchKktcRates } from "../lib/kktcRates";
import { HeaderActions } from "../components/HeaderActions";

// Granüler 6-kalem yapısı
const MARGIN_ITEMS = [
  { currency: "EUR", type: "buy", labelKey: "EUR_BUY" },
  { currency: "EUR", type: "sell", labelKey: "EUR_SELL" },
  { currency: "USD", type: "buy", labelKey: "USD_BUY" },
  { currency: "USD", type: "sell", labelKey: "USD_SELL" },
  { currency: "GBP", type: "buy", labelKey: "GBP_BUY" },
  { currency: "GBP", type: "sell", labelKey: "GBP_SELL" },
];

const MARGIN_LABELS = {
  tr: {
    EUR_BUY: "EUR ALIŞ",
    EUR_SELL: "EUR SATIŞ",
    USD_BUY: "USD ALIŞ",
    USD_SELL: "USD SATIŞ",
    GBP_BUY: "GBP ALIŞ",
    GBP_SELL: "GBP SATIŞ",
  },
  en: {
    EUR_BUY: "EUR BUY",
    EUR_SELL: "EUR SELL",
    USD_BUY: "USD BUY",
    USD_SELL: "USD SELL",
    GBP_BUY: "GBP BUY",
    GBP_SELL: "GBP SELL",
  },
};

function formatNum(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
}

function formatDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function applyGranularMargin(kur, marginType, marginValue) {
  const base = Number(kur);
  const m = Math.max(0, Number(marginValue) || 0);
  if (!Number.isFinite(base) || !Number.isFinite(m)) return null;
  if (marginType === "percent") return base + (base * m) / 100;
  return base + m;
}

function sanitizeNonNegative(value) {
  if (value === "" || value === null || value === undefined) return "";
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) return "0";
  if (num < 0) return "0";
  return String(value);
}

export function InstitutionAdminPage() {
  const navigate = useNavigate();
  const { auth, isAuthenticated, bootstrapping, logout } = useAuth();
  const { lang, t } = useLanguage();
  const marginLabels = MARGIN_LABELS[lang] || MARGIN_LABELS.tr;
  // Granüler state
  const [marginConfig, setMarginConfig] = useState({
    EUR: { buy: { type: "fixed", value: "0" }, sell: { type: "fixed", value: "0" } },
    USD: { buy: { type: "fixed", value: "0" }, sell: { type: "fixed", value: "0" } },
    GBP: { buy: { type: "fixed", value: "0" }, sell: { type: "fixed", value: "0" } },
  });

  const [centralBankRates, setCentralBankRates] = useState({
    EUR: { buy: null, sell: null },
    USD: { buy: null, sell: null },
    GBP: { buy: null, sell: null },
  });

  const [kktcTarih, setKktcTarih] = useState(null);
  const [centralBankUpdatedAt, setCentralBankUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSaving, setIsSaving] = useState(false);  // ✅ YENİ: Yükleniyor durumu
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPopup, setShowPopup] = useState(false);  // ✅ Kaydetme başarısı
  const [showSuccessModal, setShowSuccessModal] = useState(false);  // ✅ YENİ: Başarı modal
  const [showLogoutPopup, setShowLogoutPopup] = useState(false);  // ✅ Çıkış modal
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [institutionName, setInstitutionName] = useState(auth?.institution_name || "");

  useEffect(() => {
    if (bootstrapping) return;
    if (!isAuthenticated) {
      navigate("/", { replace: true });
      return;
    }
    if (auth?.role === "superadmin") {
      navigate("/super-admin", { replace: true });
    }
  }, [bootstrapping, isAuthenticated, auth?.role, navigate]);

  useEffect(() => {
    if (bootstrapping || !auth?.token) return;

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const data = await fetchAdminRates(auth.token);
        if (!mounted) return;
        
        setInstitutionName(data.institution_name || auth.institution_name);
        setCentralBankUpdatedAt(data.centralBankUpdatedAt || data.updatedAt || null);

        // Granüler API: currencies dizisinden kur ve margin config'i oku
        const newMarginConfig = {
          EUR: { buy: { type: "fixed", value: "0" }, sell: { type: "fixed", value: "0" } },
          USD: { buy: { type: "fixed", value: "0" }, sell: { type: "fixed", value: "0" } },
          GBP: { buy: { type: "fixed", value: "0" }, sell: { type: "fixed", value: "0" } },
        };
        const cbRates = {};

        if (Array.isArray(data.currencies)) {
          for (const item of data.currencies) {
            const curr = item.currency;
            cbRates[curr] = {
              buy: item.buy?.kur ?? null,
              sell: item.sell?.kur ?? null,
              buy_efektif: item.buy?.efektif_kur ?? null,
              sell_efektif: item.sell?.efektif_kur ?? null,
            };
            newMarginConfig[curr] = {
              buy: {
                type: item.buy?.margin_type || "fixed",
                value: String(item.buy?.margin_value ?? 0),
              },
              sell: {
                type: item.sell?.margin_type || "fixed",
                value: String(item.sell?.margin_value ?? 0),
              },
            };
            console.log(`[ADMIN-LOAD] ${curr}: buy_margin=${item.buy?.margin_value} (${item.buy?.margin_type}), sell_margin=${item.sell?.margin_value} (${item.sell?.margin_type})`);
          }
        }
        setCentralBankRates(cbRates);
        setMarginConfig(newMarginConfig);
        console.log("[ADMIN-LOAD] Marjlar başarıyla yüklendi:", newMarginConfig);

        // KKTC Merkez Bankası kurlarını çek
        try {
          const kktcData = await fetchKktcRates();
          if (!mounted) return;
          setKktcTarih(kktcData.tarih);
          setCentralBankUpdatedAt(kktcData.tarih || new Date().toLocaleString("tr-TR"));
          
          // KKTC verilerini centralBankRates'e yerleştir
          const updatedCbRates = { ...cbRates };
          for (const kur of kktcData.kurlar) {
            if (kur.sembol && kur.alis && kur.satis) {
              updatedCbRates[kur.sembol] = {
                buy: kur.alis,
                sell: kur.satis,
                buy_efektif: kur.efektif_alis ?? null,
                sell_efektif: kur.efektif_satis ?? null,
              };
              console.log(`[ADMIN-PAGE] ${kur.sembol} KKTC: buy=${kur.alis}, sell=${kur.satis}, buy_efektif=${kur.efektif_alis}, sell_efektif=${kur.efektif_satis}`);
            }
          }
          setCentralBankRates(updatedCbRates);
          console.log("[ADMIN-PAGE] KKTC Kurları başarıyla yüklendi:", updatedCbRates);
        } catch (kktcError) {
          console.warn("[ADMIN] KKTC Merkez Bankası kurları alınamadı:", kktcError.message);
        }
      } catch (err) {
        if (!mounted) return;
        setError(err.message || "Veri yüklenemedi.");
        if (String(err.message || "").toLowerCase().includes("oturum")) {
          logout();
          navigate("/", { replace: true });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [auth, bootstrapping, logout, navigate]);

  const handleMarginChange = (currency, type, field, value) => {
    setSuccess("");
    const sanitized = field === "value" ? sanitizeNonNegative(value) : value;
    setMarginConfig((prev) => ({
      ...prev,
      [currency]: {
        ...prev[currency],
        [type]: {
          ...prev[currency][type],
          [field]: sanitized,
        },
      },
    }));
  };

  const kalanAbonelikSuresi = useMemo(() => {
    const end = auth?.subscription_end_date
      ? new Date(auth.subscription_end_date).getTime()
      : null;
    if (!end || !Number.isFinite(end)) return null;
    return Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
  }, [auth?.subscription_end_date]);

  const isExpired = kalanAbonelikSuresi != null && kalanAbonelikSuresi <= 0;

  const handleSave = async (event) => {
    event.preventDefault();
    if (!auth?.token) return;
    if (isExpired) {
      setError("Abonelik süreniz dolmuş. Kâr marjları güncellenemez.");
      return;
    }

    try {
      // ✅ AŞAMA 1: Yükleniyor göster
      setIsSaving(true);
      setSaving(true);
      setError("");
      setSuccess("");

      // Granüler yapıyı backend'in beklediği formata çevir
      const payload = [];
      for (const curr of ["EUR", "USD", "GBP"]) {
        const buyValue = marginConfig?.[curr]?.buy?.value || "0";
        const sellValue = marginConfig?.[curr]?.sell?.value || "0";
        const buyType = marginConfig?.[curr]?.buy?.type || "fixed";
        const sellType = marginConfig?.[curr]?.sell?.type || "fixed";
        
        payload.push({
          currency: curr,
          buy: {
            margin_type: buyType,
            margin_value: Number.parseFloat(buyValue),
          },
          sell: {
            margin_type: sellType,
            margin_value: Number.parseFloat(sellValue),
          },
        });
      }

      if (!auth?.token) throw new Error("Token bulunamadı");
      const response = await saveAdminRates(auth.token, payload);
      console.log("[ADMIN] Kaydetme başarılı:", response);
      
      // API'den dönen güncellenmiş veriyi state'e kaydet
      if (Array.isArray(response.currencies)) {
        const newCBRates = {};
        for (const item of response.currencies) {
          const curr = item.currency;
          newCBRates[curr] = {
            buy: item.buy?.kur ?? null,
            sell: item.sell?.kur ?? null,
            buy_efektif: item.buy?.efektif_kur ?? null,
            sell_efektif: item.sell?.efektif_kur ?? null,
          };
        }
        setCentralBankRates(newCBRates);
      }
      
      // ✅ AŞAMA 2: 1 Saniye sonra başarı modal'ını göster
      setTimeout(() => {
        setIsSaving(false);
        setShowSuccessModal(true);  // ✅ Başarı modal'ı aç (kapatılabilir)
      }, 1000);
    } catch (err) {
      console.error("[ADMIN] Kaydetme hatası:", err);
      setError(`❌ ${err.message || "Kayıt başarısız."}`);
      setSuccess("");
      setIsSaving(false);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    // ✅ FIXED MODAL POPUP GÖSTER
    setShowLogoutPopup(true);
    
    // ✅ 1 SANIYE SONRA LOGOUT VE TAM YENILEME
    setTimeout(() => {
      const themePref = localStorage.getItem("finsight-theme");
      const langPref = localStorage.getItem("finsight-lang");
      logout();
      localStorage.clear();
      if (themePref) localStorage.setItem("finsight-theme", themePref);
      if (langPref) localStorage.setItem("finsight-lang", langPref);
      setShowLogoutPopup(false);
      window.location.href = "/";  // ✅ React Router'dan önce tam yenileme
    }, 1000);  // ✅ 1000ms = 1 saniye (Dashboard ile eşitlendi)
  };

  const resetPasswordForm = () => {
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    setPasswordSuccess("");
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    resetPasswordForm();
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (newPassword !== confirmPassword) {
      setPasswordError(t("passwordMismatch"));
      return;
    }

    if (!auth?.token) return;

    setPasswordLoading(true);
    try {
      await changeBusinessPassword(auth.token, {
        oldPassword,
        newPassword,
      });
      setPasswordSuccess(t("passwordChangedSuccess"));
      setTimeout(() => {
        closePasswordModal();
      }, 1200);
    } catch (err) {
      setPasswordError(err.message || "Şifre değiştirilemedi.");
    } finally {
      setPasswordLoading(false);
    }
  };

  if (bootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500 dark:bg-[#020617] dark:text-slate-400">
        Oturum kontrol ediliyor...
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if (loading || !auth?.institution_id || !marginConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500 dark:bg-[#020617] dark:text-slate-400">
        Veriler yükleniyor...
      </div>
    );
  }

  console.log("[ADMIN-PAGE] Central Bank Rates:", centralBankRates);
  console.log("[ADMIN-PAGE] KKTC Tarih:", kktcTarih);
  console.log("[ADMIN-PAGE] Margin Config:", marginConfig);

  try {
    const days = kalanAbonelikSuresi;
    const expired = isExpired;
    const nearExpiry = days != null && days <= 30;

    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 dark:bg-[#020617] dark:text-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        {/* Header: Logo + İşletme Bilgisi */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-teal-500/40 hover:text-slate-900 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:text-white"
            >
              <ArrowLeft className="size-4" />
              {t("backToDashboard")}
            </button>

            {/* İşletme Logosu */}
            <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/60">
              {auth?.institution_id ? (
                <img
                  src={`/logos/${auth.institution_id}.png`}
                  alt={auth.institution_name}
                  className="h-full w-full object-contain p-1"
                  onError={(e) => {
                    e.target.style.display = "none";
                  }}
                />
              ) : (
                <Building2 className="size-8 text-slate-400" />
              )}
            </div>

            {/* İşletme Bilgisi */}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                  {institutionName} {t("managementPanel")}
                </h1>
                {auth?.subscription_type === "Test" && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold tracking-wider text-rose-500 bg-rose-500/10 border border-rose-500/30 shadow-[0_0_12px_rgba(244,63,94,0.5)]">
                    TEST
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("lastUpdate")}: {kktcTarih || formatDateTime(centralBankUpdatedAt) || "—"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-4">
            <HeaderActions />
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-200"
            >
              <LogOut className="size-4" />
              {t("logoutShort")}
            </button>
            <div
              className={`rounded-xl border px-3 py-2 text-sm ${
                expired || nearExpiry
                  ? "border-rose-500/40 bg-rose-500/10"
                  : "border-teal-500/30 bg-teal-500/10"
              }`}
            >
              <p className="text-[10px] uppercase tracking-wide opacity-80 text-slate-600 dark:text-slate-300">
                {t("subscriptionStatus")}
              </p>
              <p
                className={
                  days == null
                    ? "font-semibold text-slate-600 dark:text-slate-300"
                    : nearExpiry
                      ? "text-rose-600 font-bold dark:text-rose-500"
                      : "text-teal-700 font-semibold dark:text-teal-400"
                }
              >
                {days == null
                  ? `${t("remainingSubscription")}: —`
                  : expired
                    ? `${t("remainingSubscription")}: ${t("subscriptionExpired")}`
                    : `${t("remainingSubscription")}: ${days} ${t("daysUnit")}`}
              </p>
            </div>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => {
              resetPasswordForm();
              setShowPasswordModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-teal-500/40 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-teal-500/40 dark:hover:text-teal-300"
          >
            <Key className="size-4" />
            {t("changePassword")}
          </button>
        </div>

        {/* Merkez Bankası Bilgisi */}
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
            {t("centralBankRates")}
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {t("centralBankRatesNote")}
          </p>
        </div>

        {isExpired ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            {t("subscriptionExpiredNotice")}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        {/* Granüler 6-Kalem Tablo */}
        <form onSubmit={handleSave} className="space-y-6">
          {/* ALIŞ KURLAR */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-cyan-700 dark:text-cyan-400">{t("buyRates")}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {Array.isArray(MARGIN_ITEMS) ? MARGIN_ITEMS.filter(i => i.type === 'buy').map((item) => {
              const cfg = marginConfig?.[item?.currency]?.[item?.type] || { type: "fixed", value: "0" };
              const kur = centralBankRates?.[item?.currency]?.[item?.type] || null;
              const final = applyGranularMargin(kur, cfg?.type, cfg?.value);
              const itemLabel = marginLabels[item.labelKey] || item.labelKey;

              return (
                <div
                  key={`${item.currency}-${item.type}`}
                  className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 dark:border-white/10 dark:bg-slate-900/60 dark:hover:border-white/20"
                >
                  <h4 className="mb-3 text-sm font-bold text-cyan-700 dark:text-cyan-300">{itemLabel}</h4>

                  {/* Merkez Bankası KUR */}
                  <div className="mb-3">
                    <p className="text-xs text-slate-500">{t("centralBankRate")}</p>
                    <input
                      readOnly
                      value={formatNum(kur)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 font-mono text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-300"
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                      {t("effectiveRate")}: {formatNum(centralBankRates?.[item?.currency]?.[item?.type === 'buy' ? 'buy_efektif' : 'sell_efektif'] || '0')}
                    </p>
                  </div>

                  {/* Kâr Tipi Selectbox */}
                  <div className="mb-3">
                    <label className="text-xs text-slate-500 dark:text-slate-400">{t("profitType")}</label>
                    <select
                      value={cfg.type}
                      disabled={isExpired}
                      onChange={(e) =>
                        handleMarginChange(item.currency, item.type, "type", e.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-teal-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="fixed">{t("fixedPrice")}</option>
                      <option value="percent">{t("percentPrice")}</option>
                    </select>
                  </div>

                  {/* Kâr Marjı */}
                  <div className="mb-3">
                    <label className="text-xs text-slate-500 dark:text-slate-400">
                      {t("profitMargin")} {cfg.type === "percent" ? "(%)" : "(TL)"}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cfg.value}
                      disabled={isExpired}
                      onChange={(e) =>
                        handleMarginChange(item.currency, item.type, "value", e.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-teal-500/40 bg-white px-2 text-xs text-teal-800 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950 dark:text-teal-200"
                    />
                  </div>

                  {/* Final Kur & Kâr */}
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-center">
                    <p className="text-xs text-emerald-800 dark:text-emerald-200">
                      <span className="font-semibold">{t("finalRate")}:</span> {formatNum(final)}
                      {(() => {
                        const kar = final && kur ? final - kur : 0;
                        return kar > 0 ? ` / ${formatNum(kar)} ${t("profitTl")}` : '';
                      })()}
                    </p>
                  </div>
                </div>
              );
              }) : null}
            </div>
          </div>

          {/* SATIŞ KURLAR */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-rose-600 dark:text-rose-400">{t("sellRates")}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {Array.isArray(MARGIN_ITEMS) ? MARGIN_ITEMS.filter(i => i.type === 'sell').map((item) => {
                const cfg = marginConfig?.[item?.currency]?.[item?.type] || { type: "fixed", value: "0" };
                const kur = centralBankRates?.[item?.currency]?.[item?.type] || null;
                const final = applyGranularMargin(kur, cfg?.type, cfg?.value);
                const itemLabel = marginLabels[item.labelKey] || item.labelKey;

                return (
                  <div
                    key={`${item.currency}-${item.type}`}
                    className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 dark:border-white/10 dark:bg-slate-900/60 dark:hover:border-white/20"
                  >
                    <h4 className="mb-3 text-sm font-bold text-rose-600 dark:text-rose-300">{itemLabel}</h4>

                    {/* Merkez Bankası KUR */}
                    <div className="mb-3">
                      <p className="text-xs text-slate-500">{t("centralBankRate")}</p>
                      <input
                        readOnly
                        value={formatNum(kur)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 font-mono text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-300"
                      />
                      <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                        {t("effectiveRate")}: {formatNum(centralBankRates?.[item?.currency]?.[item?.type === 'buy' ? 'buy_efektif' : 'sell_efektif'] || '0')}
                      </p>
                    </div>

                    {/* Kâr Tipi Selectbox */}
                    <div className="mb-3">
                      <label className="text-xs text-slate-500 dark:text-slate-400">{t("profitType")}</label>
                      <select
                        value={cfg.type}
                        disabled={isExpired}
                        onChange={(e) =>
                          handleMarginChange(item.currency, item.type, "type", e.target.value)
                        }
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-teal-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="fixed">{t("fixedPrice")}</option>
                        <option value="percent">{t("percentPrice")}</option>
                      </select>
                    </div>

                    {/* Kâr Değeri */}
                    <div className="mb-3">
                      <label className="text-xs text-slate-500 dark:text-slate-400">
                        {t("profitValue")} {cfg.type === "percent" ? "(%)" : "(TL)"}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={cfg.value}
                        disabled={isExpired}
                        onChange={(e) =>
                          handleMarginChange(item.currency, item.type, "value", e.target.value)
                        }
                        className="h-10 w-full rounded-lg border border-teal-500/40 bg-white px-2 text-xs text-teal-800 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950 dark:text-teal-200"
                      />
                    </div>

                    {/* Final Kur & Kâr */}
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-2 text-center">
                      <p className="text-xs text-rose-800 dark:text-rose-200">
                        <span className="font-semibold">{t("finalRate")}:</span> {formatNum(final)}
                        {(() => {
                          const kar = final && kur ? final - kur : 0;
                          return kar > 0 ? ` / ${formatNum(kar)} ${t("profitTl")}` : '';
                        })()}
                      </p>
                    </div>
                  </div>
                );
              }) : null}
            </div>
          </div>

          {/* Kaydet Butonu */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || loading || isExpired}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-400 to-indigo-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="size-4" />
              {saving ? t("saving") : t("saveMargins")}
            </button>
          </div>
        </form>

        {/* ✅ FIXED MODAL - BAŞARILI KAYDETME (KAPATILABILIR) */}
        {showSuccessModal && (
          <div 
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md"
            onClick={() => setShowSuccessModal(false)}  // ✅ Dışarı tıklanınca kapat
          >
            <div 
              className="relative bg-[#1a1f2e] border border-gray-700 p-8 rounded-2xl shadow-2xl flex flex-col items-center transform transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <X
                size={24}
                onClick={() => setShowSuccessModal(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors z-10"
                aria-label="Kapat"
              />

              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4">
                <span className="text-emerald-500 text-3xl">✓</span>
              </div>
              <h3 className="text-white text-xl font-bold">Kurlar başarıyla kaydedildi!</h3>
            </div>
          </div>
        )}

        {/* ✅ YÜKLENIYOR MODAL (Spinner) */}
        {isSaving && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md">
            <div className="bg-[#1a1f2e] border border-gray-700 p-8 rounded-2xl shadow-2xl flex flex-col items-center transform transition-all">
              <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-4 animate-spin">
                <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <h3 className="text-white text-xl font-bold">Kâr ayarları kaydediliyor...</h3>
              <p className="text-slate-300 text-sm mt-2">Lütfen bekleyin</p>
            </div>
          </div>
        )}

        {/* ✅ FIXED MODAL - ÇIKIS (ADMIN PANELINDEN) */}
        {showLogoutPopup && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md">
            <div className="bg-[#1a1f2e] border border-gray-700 p-8 rounded-2xl shadow-2xl flex flex-col items-center transform transition-all">
              <div className="w-16 h-16 bg-rose-500/20 rounded-full flex items-center justify-center mb-4 animate-spin">
                <svg className="w-8 h-8 text-rose-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <h3 className="text-white text-xl font-bold">Çıkış Yapılıyor...</h3>
              <p className="text-slate-300 text-sm mt-2">Dashboard'a dönüyorsunuz</p>
            </div>
          </div>
        )}

        {showPasswordModal && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={closePasswordModal}
          >
            <div
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
              onClick={(e) => e.stopPropagation()}
            >
              <X
                size={24}
                onClick={closePasswordModal}
                className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors z-10"
                aria-label="Kapat"
              />

              <div className="mb-5 flex items-center gap-3 pr-8">
                <div className="rounded-lg bg-teal-500/10 p-2 text-teal-600 dark:text-teal-400">
                  <Key className="size-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  {t("changePasswordTitle")}
                </h3>
              </div>

              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="old-password"
                    className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    {t("oldPassword")}
                  </label>
                  <input
                    id="old-password"
                    type="password"
                    autoComplete="current-password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    required
                    disabled={passwordLoading}
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-teal-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="new-password"
                    className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    {t("newPassword")}
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={4}
                    disabled={passwordLoading}
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-teal-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="confirm-password"
                    className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    {t("confirmPassword")}
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={4}
                    disabled={passwordLoading}
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-teal-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                {passwordError ? (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
                    {passwordError}
                  </div>
                ) : null}

                {passwordSuccess ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                    {passwordSuccess}
                  </div>
                ) : null}

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={closePasswordModal}
                    disabled={passwordLoading}
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={passwordLoading}
                    className="flex-1 rounded-lg bg-gradient-to-r from-teal-400 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 transition hover:brightness-110 disabled:opacity-50"
                  >
                    {passwordLoading ? t("saving") : t("confirmPasswordAction")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
    );
  } catch (err) {
    console.error("[ADMIN-PAGE] Render Error:", err);
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#020617] text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-rose-400 mb-2">Hata Oluştu</h1>
          <p className="text-sm text-slate-400 mb-4">{err?.message || "Bilinmeyen hata"}</p>
          <button
            onClick={() => window.location.href = "/"}
            className="inline-flex items-center gap-2 rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-2 text-sm text-teal-200 transition hover:bg-teal-500/20"
          >
            Dashboard'a Dön
          </button>
        </div>
      </div>
    );
  }
}
