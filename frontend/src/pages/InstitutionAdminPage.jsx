import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Key, LogOut, Save, X, Camera, Edit2, Clock, Phone } from "lucide-react";
import Cropper from "react-easy-crop";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fetchAdminRates, saveAdminRates, changeBusinessPassword, fetchBusinessProfile, updateBusinessProfile } from "../lib/auth";
import { fetchKktcRates } from "../lib/kktcRates";
import { HeaderActions } from "../components/HeaderActions";
import { DualRangeSlider } from "../components/DualRangeSlider";

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
  
  // ✅ Logo Yönetimi Modal
  const [showLogoModal, setShowLogoModal] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null); // Object URL
  const [logoCropStep, setLogoCropStep] = useState(false); // false: select, true: crop
  const [logoCrop, setLogoCrop] = useState({ x: 0, y: 0 });
  const [logoZoom, setLogoZoom] = useState(1);
  const [logoCroppedArea, setLogoCroppedArea] = useState(null);
  const [logoLoading, setLogoLoading] = useState(false);
  const logoObjectUrlRef = useRef(null);
  
  // ✅ İşletme Bilgileri Modal
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [currentBusinessPhone, setCurrentBusinessPhone] = useState("—");
  const [profileLogoUrl, setProfileLogoUrl] = useState(null);
  const [infoStep, setInfoStep] = useState(0); // 0: kapalı, 1: telefon, 2: onay, 3: kod
  const [rawPhone, setRawPhone] = useState(""); // Sadece rakamlar: "5051234567"
  const [verificationCode, setVerificationCode] = useState("");
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState("");
  const [infoSuccess, setInfoSuccess] = useState("");
  
  // Çalışma Saatleri: Her gün için [başlangıç (dakika), bitiş (dakika)]
  const [businessHours, setBusinessHours] = useState({
    pazartesi: [480, 1020], // 08:00 - 17:00
    sali: [480, 1020],
    carsamba: [480, 1020],
    persembe: [480, 1020],
    cuma: [480, 1020],
    cumartesi: [540, 900], // 09:00 - 15:00
    pazar: [null, null], // Kapalı
  });
  
  const dayLabels = ["pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi", "pazar"];
  const dayDisplayNames = {
    pazartesi: "Pazartesi",
    sali: "Salı",
    carsamba: "Çarşamba",
    persembe: "Perşembe",
    cuma: "Cuma",
    cumartesi: "Cumartesi",
    pazar: "Pazar",
  };

  // ✅ Logo Object URL Cleanup
  useEffect(() => {
    return () => {
      if (logoObjectUrlRef.current) {
        URL.revokeObjectURL(logoObjectUrlRef.current);
      }
    };
  }, []);

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
        const profile = await fetchBusinessProfile(auth.token);
        if (!mounted || !profile) return;
        if (profile.phone) setCurrentBusinessPhone(profile.phone);
        if (profile.logo_url) setProfileLogoUrl(profile.logo_url);
        if (profile.working_hours && typeof profile.working_hours === "object") {
          setBusinessHours((prev) => ({ ...prev, ...profile.working_hours }));
        }
      } catch (err) {
        console.warn("[PROFILE] Yüklenemedi:", err.message);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [bootstrapping, auth?.token]);

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

  // ✅ Logo Handler — File Select
  const handleLogoFileSelect = (file) => {
    if (file && file.type.startsWith("image/")) {
      setLogoFile(file);
      // Cleanup eski URL
      if (logoObjectUrlRef.current) {
        URL.revokeObjectURL(logoObjectUrlRef.current);
      }
      // Yeni object URL oluştur
      const objectUrl = URL.createObjectURL(file);
      logoObjectUrlRef.current = objectUrl;
      setLogoPreviewUrl(objectUrl);
      setLogoCropStep(true); // Crop adımına geç
    }
  };

  // ✅ Kırpılmış görseli canvas'tan blob'a çevir
  const getCroppedImage = async (imageSrc, crop) => {
    const image = new Image();
    image.src = imageSrc;
    
    return new Promise((resolve) => {
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const scaleX = image.naturalWidth / image.width;
        const scaleY = image.naturalHeight / image.height;
        
        canvas.width = crop.width;
        canvas.height = crop.height;
        
        const ctx = canvas.getContext("2d");
        ctx.drawImage(
          image,
          crop.x * scaleX,
          crop.y * scaleY,
          crop.width * scaleX,
          crop.height * scaleY,
          0,
          0,
          crop.width,
          crop.height
        );
        
        canvas.toBlob((blob) => {
          resolve(blob);
        }, "image/png");
      };
    });
  };

  // ✅ onCropComplete callback
  const handleCropComplete = (croppedArea, croppedAreaPixels) => {
    setLogoCroppedArea(croppedAreaPixels);
  };

  // ✅ Kırpılmış logoyu kaydet → SQLite + Supabase
  const handleSaveCroppedLogo = async () => {
    if (!logoPreviewUrl || !logoCroppedArea || !auth?.token) return;
    setLogoLoading(true);
    try {
      const blob = await getCroppedImage(logoPreviewUrl, logoCroppedArea);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      await updateBusinessProfile(auth.token, { logo_url: dataUrl });
      setProfileLogoUrl(dataUrl);
      setShowLogoModal(false);
      setLogoFile(null);
      setLogoPreviewUrl(null);
      setLogoCropStep(false);
      setLogoCroppedArea(null);
    } catch (err) {
      console.error("[LOGO] Yükleme hatası:", err);
      alert(err.message || "Logo kaydedilemedi.");
    } finally {
      setLogoLoading(false);
    }
  };

  // ✅ Telefon Formatı Yardımcı (Kusursuz Masking Algoritması)
  const formatPhoneDisplay = (rawDigits) => {
    // rawDigits: "5051234567" gibi sadece rakamlar
    // Template: "(XXX) XXX XXXX"
    // Output: Her X'i sırasıyla rakamla değiştir
    let template = "(XXX) XXX XXXX";
    let digitIndex = 0;
    
    let result = "";
    for (let i = 0; i < template.length; i++) {
      if (template[i] === "X") {
        if (digitIndex < rawDigits.length) {
          result += rawDigits[digitIndex];
          digitIndex++;
        } else {
          result += "X";
        }
      } else {
        result += template[i];
      }
    }
    
    return result;
  };

  // ✅ Saat formatı yardımcı
  const minutesToTime = (minutes) => {
    if (minutes === null || minutes === undefined) return "Kapalı";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  };

  // ✅ Telefon Input Change Handler
  const handlePhoneInputChange = (e) => {
    const inputValue = e.target.value;
    // Sadece rakamları ayıkla ve max 10 hane olacak şekilde sınırla
    const digitsOnly = inputValue.replace(/\D/g, "").slice(0, 10);
    setRawPhone(digitsOnly);
  };

  // ✅ Telefon step 1: Yeni numara girilip onaya hazırlanma
  const handlePhoneSubmit = async () => {
    if (rawPhone.length !== 10) {
      setInfoError("Lütfen geçerli bir telefon numarası girin (10 rakam).");
      return;
    }
    setInfoError("");
    setInfoLoading(true);
    try {
      // Mock: OTP gönderme API çağrısı
      await new Promise((resolve) => setTimeout(resolve, 800));
      setInfoStep(3); // Doğrudan kod giriş aşamasına git (mock olarak)
      setVerificationCode("");
    } catch (err) {
      setInfoError("OTP gönderilemedi.");
    } finally {
      setInfoLoading(false);
    }
  };

  // ✅ Kod doğrulama ve telefon + çalışma saatleri kaydı
  const handleVerifyCode = async () => {
    if (verificationCode.length !== 6 || !/^\d+$/.test(verificationCode)) {
      setInfoError("Lütfen 6 haneli doğrulama kodunu girin.");
      return;
    }
    if (!auth?.token) return;
    setInfoError("");
    setInfoLoading(true);
    try {
      // OTP şu an mock; doğrulama sonrası kalıcı kayıt
      const formattedPhone = `+90 ${formatPhoneDisplay(rawPhone)}`;
      await updateBusinessProfile(auth.token, {
        phone: formattedPhone,
        working_hours: businessHours,
      });
      setCurrentBusinessPhone(formattedPhone);
      setInfoSuccess("Telefon ve çalışma saatleri kaydedildi!");
      setTimeout(() => {
        closeInfoModal();
        setInfoSuccess("");
      }, 1500);
    } catch (err) {
      setInfoError(err.message || "Kaydedilemedi.");
    } finally {
      setInfoLoading(false);
    }
  };

  /** Sadece çalışma saatlerini kaydet (telefon değiştirmeden) */
  const handleSaveWorkingHours = async () => {
    if (!auth?.token) return;
    setInfoLoading(true);
    setInfoError("");
    try {
      await updateBusinessProfile(auth.token, { working_hours: businessHours });
      setInfoSuccess("Çalışma saatleri kaydedildi!");
      setTimeout(() => setInfoSuccess(""), 2000);
    } catch (err) {
      setInfoError(err.message || "Çalışma saatleri kaydedilemedi.");
    } finally {
      setInfoLoading(false);
    }
  };

  // ✅ İşletme Bilgileri Modal Kapatma
  const closeInfoModal = () => {
    setShowInfoModal(false);
    setInfoStep(0);
    setRawPhone("");
    setVerificationCode("");
    setInfoError("");
    setInfoSuccess("");
  };

  // ✅ Range Slider Handler
  const handleHourChange = (day, index, value) => {
    const newValue = Math.min(Math.max(parseInt(value) || 0, 0), 1440);
    const current = [...businessHours[day]];
    current[index] = newValue;
    
    // Mantık: başlangıç > bitiş ise swap et
    if (index === 0 && newValue > current[1]) {
      current[1] = newValue;
    } else if (index === 1 && newValue < current[0]) {
      current[0] = newValue;
    }
    
    setBusinessHours((prev) => ({
      ...prev,
      [day]: current,
    }));
  };

  // ✅ Günü Kapalı/Açık yap
  const toggleDayOpen = (day) => {
    setBusinessHours((prev) => {
      const current = prev[day];
      if (current[0] === null && current[1] === null) {
        return { ...prev, [day]: [480, 1020] };
      } else {
        return { ...prev, [day]: [null, null] };
      }
    });
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
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-all duration-300 hover:border-cyan-400 hover:text-cyan-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-cyan-400 dark:hover:text-cyan-400"
            >
              <ArrowLeft className="size-4" />
              {t("backToDashboard")}
            </button>

            {/* İşletme Logosu — Interactive */}
            <button
              type="button"
              onClick={() => setShowLogoModal(true)}
              className="group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white transition-all duration-300 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] cursor-pointer dark:border-white/10 dark:bg-slate-950/60 dark:hover:border-cyan-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
            >
              {profileLogoUrl ? (
                <img
                  src={profileLogoUrl}
                  alt={auth?.institution_name || "Logo"}
                  className="h-full w-full object-cover group-hover:opacity-70 transition-opacity"
                />
              ) : auth?.institution_id ? (
                <img
                  src={`/logos/${auth.institution_id}.png`}
                  alt={auth.institution_name}
                  className="h-full w-full object-contain p-1 group-hover:opacity-70 transition-opacity"
                  onError={(e) => {
                    e.target.style.display = "none";
                  }}
                />
              ) : (
                <Building2 className="size-8 text-slate-400" />
              )}
              <Camera className="absolute size-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
            </button>

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
              className="inline-flex items-center gap-2 rounded-lg border border-red-500 bg-transparent px-3 py-2 text-sm text-red-600 transition-all duration-300 hover:bg-red-500/10 hover:shadow-[0_0_15px_rgba(239,68,68,0.5)] dark:text-red-400 dark:hover:border-red-500 dark:hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]"
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

        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => {
              resetPasswordForm();
              setShowPasswordModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-all duration-300 hover:border-cyan-400 hover:text-cyan-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-400 dark:hover:text-cyan-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
          >
            <Key className="size-4" />
            {t("changePassword")}
          </button>
          
          <button
            type="button"
            onClick={() => {
              setInfoError("");
              setInfoSuccess("");
              setInfoStep(0);
              setRawPhone("");
              setShowInfoModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-all duration-300 hover:border-cyan-400 hover:text-cyan-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-400 dark:hover:text-cyan-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
          >
            <Edit2 className="size-4" />
            İşletme Bilgilerini Güncelle
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
                      className="h-10 w-full rounded-lg border border-cyan-500/40 bg-white px-2 text-xs text-cyan-800 outline-none transition-all focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950 dark:text-cyan-200"
                    />
                  </div>

                  {/* Final Kur & Kâr */}
                  <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-2 text-center">
                    <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                      {t("finalRate")}: <span className="font-bold text-cyan-800 dark:text-cyan-200">{formatNum(final)}</span>
                      {(() => {
                        const kar = final && kur ? final - kur : 0;
                        return kar > 0 ? ` / +${formatNum(kar)} ${t("profitTl")}` : '';
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
            <h3 className="mb-3 text-sm font-semibold text-red-600 dark:text-red-400">{t("sellRates")}</h3>
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
                        className="h-10 w-full rounded-lg border border-cyan-500/40 bg-white px-2 text-xs text-cyan-800 outline-none transition-all focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950 dark:text-cyan-200"
                      />
                    </div>

                    {/* Final Kur & Kâr */}
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-2 text-center">
                      <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                        {t("finalRate")}: <span className="font-bold text-red-800 dark:text-red-200">{formatNum(final)}</span>
                        {(() => {
                          const kar = final && kur ? final - kur : 0;
                          return kar > 0 ? ` / +${formatNum(kar)} ${t("profitTl")}` : '';
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

        {/* ✅ Logo Modal — File Select ve Crop */}
        {showLogoModal && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => !logoLoading && !logoCropStep && setShowLogoModal(false)}
          >
            <div
              className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <X
                size={24}
                onClick={() => !logoLoading && setShowLogoModal(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors z-10"
                aria-label="Kapat"
              />

              {/* STEP 1: Dosya Seçimi */}
              {!logoCropStep ? (
                <div className="p-6">
                  <div className="mb-5 flex items-center gap-3 pr-8">
                    <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-600 dark:text-cyan-400">
                      <Camera className="size-5" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                      Logo Yönet
                    </h3>
                  </div>

                  <div className="space-y-4">
                    {/* Logo Önizlemesi */}
                    <div className="flex justify-center">
                      <div className="flex h-32 w-32 items-center justify-center rounded-full border-2 border-slate-300 bg-slate-50 overflow-hidden dark:border-slate-700 dark:bg-slate-950">
                        {auth?.institution_id ? (
                          <img
                            src={`/logos/${auth.institution_id}.png`}
                            alt={auth.institution_name}
                            className="h-full w-full object-cover"
                            onError={(e) => (e.target.style.display = "none")}
                          />
                        ) : (
                          <Building2 className="size-12 text-slate-300 dark:text-slate-600" />
                        )}
                      </div>
                    </div>

                    {/* Drag & Drop Dosya Yükleme */}
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (e.dataTransfer.files[0]) {
                          handleLogoFileSelect(e.dataTransfer.files[0]);
                        }
                      }}
                      className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center transition hover:border-cyan-400 hover:bg-cyan-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-cyan-500 dark:hover:bg-cyan-950/20"
                    >
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => e.target.files[0] && handleLogoFileSelect(e.target.files[0])}
                        disabled={logoLoading}
                        className="hidden"
                        id="logo-input"
                      />
                      <label htmlFor="logo-input" className="cursor-pointer">
                        <Camera className="mx-auto size-6 text-slate-400 mb-2" />
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Dosya sürükleyin veya seçin
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          PNG, JPG, GIF, WEBP
                        </p>
                      </label>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowLogoModal(false)}
                        disabled={logoLoading}
                        className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* STEP 2: Kırpma */
                <div className="p-6">
                  <div className="mb-5 flex items-center gap-3 pr-8">
                    <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-600 dark:text-cyan-400">
                      <Camera className="size-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                        Logoyu Kırp
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Zoom ve konumu ayarla</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Cropper Container */}
                    <div className="relative bg-slate-900 rounded-lg overflow-hidden" style={{ height: "300px" }}>
                      {logoPreviewUrl && (
                        <Cropper
                          image={logoPreviewUrl}
                          crop={logoCrop}
                          zoom={logoZoom}
                          aspect={1 / 1}
                          cropShape="round"
                          showGrid={false}
                          onCropChange={setLogoCrop}
                          onCropComplete={handleCropComplete}
                          onZoomChange={setLogoZoom}
                          restrictPosition={true}
                        />
                      )}
                    </div>

                    {/* Zoom Slider */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                        Zoom
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.1"
                        value={logoZoom}
                        onChange={(e) => setLogoZoom(parseFloat(e.target.value))}
                        disabled={logoLoading}
                        className="w-full h-2 bg-slate-300 rounded-lg cursor-pointer dark:bg-slate-700 accent-cyan-500"
                      />
                      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>1x</span>
                        <span className="font-semibold">{logoZoom.toFixed(1)}x</span>
                        <span>3x</span>
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setLogoCropStep(false);
                          setLogoPreviewUrl(null);
                          setLogoFile(null);
                        }}
                        disabled={logoLoading}
                        className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white"
                      >
                        Geri
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveCroppedLogo}
                        disabled={logoLoading}
                        className="flex-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition dark:bg-cyan-600 dark:hover:bg-cyan-500"
                      >
                        {logoLoading ? "Kaydediliyor..." : "Logoyu Kaydet"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ✅ İşletme Bilgileri Modal — Yeni Versiyon */}
        {showInfoModal && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => !infoLoading && closeInfoModal()}
          >
            <div
              className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <X
                size={24}
                onClick={() => !infoLoading && closeInfoModal()}
                className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors z-10"
                aria-label="Kapat"
              />

              <div className="mb-6 flex items-center gap-3 pr-8">
                <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-600 dark:text-cyan-400">
                  <Edit2 className="size-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                    İşletme Bilgilerini Güncelle
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Telefon ve çalışma saatleri
                  </p>
                </div>
              </div>

              {/* ADIM 1: Telefon Girişi */}
              {infoStep === 0 && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-4 space-y-2">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      Mevcut Telefon Numarası:
                    </p>
                    <p className="text-lg font-bold text-cyan-600 dark:text-cyan-400">
                      {currentBusinessPhone}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <Phone className="size-4" />
                      Yeni Telefon Numarası
                    </label>
                    <div className="relative h-11 flex items-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-500/20 transition">
                      {/* Sabit +90 Prefix */}
                      <span className="absolute left-3 text-sm font-mono font-bold text-slate-600 dark:text-slate-400 pointer-events-none">
                        +90
                      </span>
                      
                      {/* Input: Maskeleme ile otomatik format */}
                      <input
                        type="tel"
                        inputMode="numeric"
                        value={formatPhoneDisplay(rawPhone)}
                        onChange={handlePhoneInputChange}
                        disabled={infoLoading}
                        placeholder="+90 (XXX) XXX XXXX"
                        maxLength="17"
                        className="h-full w-full rounded-lg bg-transparent px-3 pl-14 text-sm font-mono text-slate-800 outline-none disabled:opacity-50 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  {/* Çalışma Saatleri — Haftanın 7 Günü */}
                  <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                      <Clock className="size-4" />
                      Çalışma Saatleri
                    </h4>

                    <div className="space-y-4">
                      {dayLabels.map((day) => {
                        const [start, end] = businessHours[day];
                        const isClosed = start === null || end === null;
                        const displayStart = minutesToTime(start);
                        const displayEnd = minutesToTime(end);
                        return (
                          <div key={day} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/50">
                            <div className="flex items-center justify-between mb-3">
                              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                {dayDisplayNames[day]}
                              </label>
                              <button
                                type="button"
                                onClick={() => toggleDayOpen(day)}
                                className={`text-xs px-2.5 py-1.5 rounded font-medium transition ${
                                  isClosed
                                    ? "bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-200"
                                    : "bg-cyan-500/20 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300"
                                }`}
                              >
                                {isClosed ? "Kapalı" : "Açık"}
                              </button>
                            </div>

                            {!isClosed ? (
                              <div className="space-y-3">
                                <DualRangeSlider
                                  min={0}
                                  max={1440}
                                  step={30}
                                  minValue={start}
                                  maxValue={end}
                                  disabled={infoLoading}
                                  onRangeChange={(newStart, newEnd) => {
                                    setBusinessHours((prev) => ({
                                      ...prev,
                                      [day]: [newStart, newEnd],
                                    }));
                                  }}
                                />
                                
                                <p className="text-sm font-semibold text-center text-cyan-600 dark:text-cyan-400 pt-1">
                                  {displayStart} — {displayEnd}
                                </p>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-3 font-medium">
                                Bu gün kapalıdır.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {infoError ? (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
                      {infoError}
                    </div>
                  ) : null}

                  {infoSuccess ? (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                      {infoSuccess}
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={closeInfoModal}
                      disabled={infoLoading}
                      className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveWorkingHours}
                      disabled={infoLoading}
                      className="flex-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-700 transition hover:border-cyan-400 disabled:opacity-50 dark:text-cyan-300"
                    >
                      {infoLoading ? "Kaydediliyor..." : "Saatleri Kaydet"}
                    </button>
                    <button
                      type="button"
                      onClick={handlePhoneSubmit}
                      disabled={infoLoading || rawPhone.length !== 10}
                      className="flex-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition dark:bg-cyan-600 dark:hover:bg-cyan-500"
                    >
                      {infoLoading ? "Gönderiliyor..." : "Telefon Güncelle"}
                    </button>
                  </div>
                </div>
              )}

              {/* ADIM 3: Kod Girişi (Onay aşaması atlanıp doğrudan koda geçildi) */}
              {infoStep === 3 && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-4">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2">
                      Yeni Numaranız:
                    </p>
                    <p className="text-lg font-bold text-cyan-600 dark:text-cyan-400">
                      +90 {formatPhoneDisplay(rawPhone)}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Doğrulama Kodu
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="000000"
                      maxLength="6"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      disabled={infoLoading}
                      className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-center text-lg font-mono font-bold text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 tracking-[0.5em]"
                    />
                  </div>

                  {infoError ? (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
                      {infoError}
                    </div>
                  ) : null}

                  {infoSuccess ? (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                      {infoSuccess}
                    </div>
                  ) : null}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setInfoStep(0)}
                      disabled={infoLoading}
                      className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      onClick={handleVerifyCode}
                      disabled={infoLoading || verificationCode.length !== 6}
                      className="flex-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition dark:bg-cyan-600 dark:hover:bg-cyan-500"
                    >
                      {infoLoading ? "Doğrulanıyor..." : "Kodu Doğrula"}
                    </button>
                  </div>
                </div>
              )}
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
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition-all duration-300 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400 dark:focus:ring-cyan-500/20"
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
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition-all duration-300 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400 dark:focus:ring-cyan-500/20"
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
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition-all duration-300 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400 dark:focus:ring-cyan-500/20"
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
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 transition-all duration-300 hover:border-red-500 hover:text-red-500 hover:shadow-[0_0_15px_rgba(239,68,68,0.5)] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-red-500 dark:hover:text-red-500 dark:hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={passwordLoading}
                    className="flex-1 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition-all duration-300 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] hover:brightness-110 disabled:opacity-50 dark:from-cyan-500 dark:to-blue-600"
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
