import { useEffect, useMemo, useState, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Key, LogOut, Save, X, Camera, Edit2, Clock, Phone, MapPin, ChevronDown, Plus, Bell, LifeBuoy } from "lucide-react";
import Cropper from "react-easy-crop";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { ActivityLogPanel } from "../components/ActivityLogPanel";
import {
  fetchAdminRates,
  saveAdminRates,
  changeBusinessPassword,
  fetchBusinessProfile,
  updateBusinessProfile,
  fetchBusinessBranches,
  updateBusinessBranch,
  createBusinessBranch,
  createBusinessBranchRequest,
  fetchBusinessSubscription,
  fetchBusinessNotifications,
  markBusinessNotificationsRead,
  submitSupportTicket,
  fetchSupportTickets,
} from "../lib/auth";
import { fetchKktcRates } from "../lib/kktcRates";
import { HeaderActions } from "../components/HeaderActions";
import { Sheet } from "../components/Sheet";
import { DualRangeSlider } from "../components/DualRangeSlider";
import { SearchableSelect } from "../components/SearchableSelect";
import { FloatingInput, FloatingTextarea } from "../components/ui/floating-label";
import { shouldShowTestBadge } from "../lib/subscriptionBadge";
import { mediaUrl } from "../lib/api";
import { getCroppedImg } from "../components/LogoCropModal";
import "leaflet/dist/leaflet.css";

/** P-04: bilgilendirici log yalnızca geliştirmede. */
const devLog = (...args) => {
  if (import.meta.env.DEV) console.log(...args);
};


delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const KKTC_MAP_CENTER = [35.2281, 33.5136];

function BranchMapClickHandler({ onPick, disabled }) {
  useMapEvents({
    click(event) {
      if (disabled) return;
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

async function reverseGeocodeAddress(lat, lng) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
    { headers: { Accept: "application/json" } }
  );
  if (!response.ok) throw new Error("Adres servisi yanıt vermedi.");
  const data = await response.json();
  if (!data?.address) {
    return data?.display_name || "";
  }
  const { road, suburb, neighbourhood, city, town, village } = data.address;
  const formatted = [road || "", suburb || neighbourhood || "", city || town || village || ""]
    .filter(Boolean)
    .join(", ");
  return formatted || data.display_name || "";
}

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

function formatDateShort(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function branchRemainingDays(branch) {
  if (!branch || branch.subscription_type === "Test") return null;
  if (branch.days_remaining != null && Number.isFinite(Number(branch.days_remaining))) {
    return Number(branch.days_remaining);
  }
  if (!branch.subscription_end_date) return null;
  const end = new Date(branch.subscription_end_date).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
}

function formatBranchRemainingLabel(branch, t) {
  if (!branch) return "—";
  if (branch.subscription_type === "Test") return t("unlimitedSubscription");
  const days = branchRemainingDays(branch);
  if (days == null) return "—";
  if (days <= 0) return t("subscriptionExpired");
  return `${days} ${t("daysUnit")}`;
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
  const isAccountInactive =
    auth?.is_active === false || auth?.is_active === 0 || auth?.is_active === "0";
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
  const [, setSuccess] = useState("");
  // ✅ Kaydetme başarısı
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
  const [, setLogoFile] = useState(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null); // Object URL
  const [logoCropStep, setLogoCropStep] = useState(false); // false: select, true: crop
  const [logoCrop, setLogoCrop] = useState({ x: 0, y: 0 });
  const [logoZoom, setLogoZoom] = useState(1);
  const [logoCroppedArea, setLogoCroppedArea] = useState(null);
  const [logoLoading, setLogoLoading] = useState(false);
  const logoObjectUrlRef = useRef(null);
  
  // ✅ İşletme Bilgileri Modal
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [profileLogoUrl, setProfileLogoUrl] = useState(null);
  const [businessBranches, setBusinessBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [rawBranchPhone, setRawBranchPhone] = useState("5");
  const [rawWhatsappPhone, setRawWhatsappPhone] = useState("5");
  const branchPhoneFormattedRef = useRef("0(5");
  const whatsappPhoneFormattedRef = useRef("0(5");
  const branchPhoneInputRef = useRef(null);
  const whatsappPhoneInputRef = useRef(null);
  const [branchAddress, setBranchAddress] = useState("");
  const [branchLat, setBranchLat] = useState(null);
  const [branchLng, setBranchLng] = useState(null);
  const [branchName, setBranchName] = useState("");
  const [locationGeocoding, setLocationGeocoding] = useState(false);
  const [showSubscriptionPanel, setShowSubscriptionPanel] = useState(false);
  /** İ-01 / İ-02 / İ-03: kendi aboneliği, ödeme geçmişi ve performansı. */
  const [subInfo, setSubInfo] = useState(null);
  const [subscriptionBranches, setSubscriptionBranches] = useState([]);
  const [subscriptionPanelLoading, setSubscriptionPanelLoading] = useState(false);
  const subscriptionPanelRef = useRef(null);
  const [showBranchRequestModal, setShowBranchRequestModal] = useState(false);
  const [showBranchRequestConfirm, setShowBranchRequestConfirm] = useState(false);
  const [branchRequestLoading, setBranchRequestLoading] = useState(false);
  const [branchRequestError, setBranchRequestError] = useState("");
  const [branchRequestSuccess, setBranchRequestSuccess] = useState("");
  const [branchRequestGeocoding, setBranchRequestGeocoding] = useState(false);
  const [branchRequestForm, setBranchRequestForm] = useState({
    name: "",
    phone: "",
    address: "",
    lat: null,
    lng: null,
  });
  const [branchLimit, setBranchLimit] = useState(1);
  const [branchCount, setBranchCount] = useState(0);
  const canAddBranchDirectly = !isAccountInactive && branchCount < branchLimit;
  const [renewRequestLoadingId, setRenewRequestLoadingId] = useState(null);
  const [renewRequestError, setRenewRequestError] = useState("");
  const [renewRequestSuccess, setRenewRequestSuccess] = useState("");
  const [renewConfirmBranch, setRenewConfirmBranch] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const notifPanelRef = useRef(null);
  // P1.7 — panel-içi destek / sorun bildirimi
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportFeedback, setSupportFeedback] = useState(null); // {type:'ok'|'err', msg}
  const [supportTickets, setSupportTickets] = useState([]);
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
    if (isAccountInactive) setShowSubscriptionPanel(true);
  }, [isAccountInactive]);

  useEffect(() => {
    if (bootstrapping || !auth?.token) return;

    let mounted = true;
    (async () => {
      try {
        const profile = await fetchBusinessProfile(auth.token);
        if (!mounted || !profile) return;
        if (profile.logo_url) setProfileLogoUrl(profile.logo_url);
        if (profile.branch_limit != null) setBranchLimit(Number(profile.branch_limit) || 1);
        if (profile.branch_count != null) setBranchCount(Number(profile.branch_count) || 0);
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
            devLog(`[ADMIN-LOAD] ${curr}: buy_margin=${item.buy?.margin_value} (${item.buy?.margin_type}), sell_margin=${item.sell?.margin_value} (${item.sell?.margin_type})`);
          }
        }
        setCentralBankRates(cbRates);
        setMarginConfig(newMarginConfig);
        devLog("[ADMIN-LOAD] Marjlar başarıyla yüklendi:", newMarginConfig);

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
              devLog(`[ADMIN-PAGE] ${kur.sembol} KKTC: buy=${kur.alis}, sell=${kur.satis}, buy_efektif=${kur.efektif_alis}, sell_efektif=${kur.efektif_satis}`);
            }
          }
          setCentralBankRates(updatedCbRates);
          devLog("[ADMIN-PAGE] KKTC Kurları başarıyla yüklendi:", updatedCbRates);
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
    if (auth?.subscription_type === "Test") return null;
    const end = auth?.subscription_end_date
      ? new Date(auth.subscription_end_date).getTime()
      : null;
    if (!end || !Number.isFinite(end)) return null;
    return Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
  }, [auth?.subscription_end_date, auth?.subscription_type]);

  const isExpired =
    auth?.subscription_type !== "Test" &&
    kalanAbonelikSuresi != null &&
    kalanAbonelikSuresi <= 0;
  const ratesLocked = isExpired || isAccountInactive;

  const subscriptionWarningDays = useMemo(() => {
    let min = Infinity;
    for (const branch of subscriptionBranches) {
      const days = branchRemainingDays(branch);
      if (days == null) continue;
      if (days < 14) min = Math.min(min, days);
    }
    if (min === Infinity) return null;
    return Math.max(0, min);
  }, [subscriptionBranches]);

  const showTestBadge = useMemo(() => {
    const institutionLooksTest = shouldShowTestBadge({
      subscription_type: auth?.subscription_type,
      subscription_end_date: auth?.subscription_end_date,
      days_remaining: auth?.days_remaining,
    });
    if (!institutionLooksTest) return false;

    // Şube bazlı süreli abonelik varsa kurum TEST rozetini gizle
    const hasTimedBranch = (subscriptionBranches || []).some((branch) => {
      if (!branch || branch.subscription_type === "Test") return false;
      const days = branchRemainingDays(branch);
      return days == null || days > 0;
    });
    return !hasTimedBranch;
  }, [
    auth?.subscription_type,
    auth?.subscription_end_date,
    auth?.days_remaining,
    subscriptionBranches,
  ]);

  useEffect(() => {
    if (bootstrapping || !auth?.token) return;
    let mounted = true;
    (async () => {
      try {
        const rows = await fetchBusinessBranches(auth.token);
        if (mounted) setSubscriptionBranches(rows);
      } catch (err) {
        console.warn("[BRANCH-SUB] Şubeler yüklenemedi:", err.message);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [bootstrapping, auth?.token]);

  const loadNotifications = async () => {
    if (!auth?.token) return;
    setNotifLoading(true);
    try {
      const data = await fetchBusinessNotifications(auth.token);
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setNotifUnread(Number(data.unread) || 0);
    } catch (err) {
      console.warn("[NOTIF] Bildirimler yüklenemedi:", err.message);
    } finally {
      setNotifLoading(false);
    }
  };

  useEffect(() => {
    if (bootstrapping || !auth?.token) return undefined;
    loadNotifications();
    const timer = setInterval(loadNotifications, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapping, auth?.token]);

  useEffect(() => {
    if (!showNotifPanel) return undefined;
    const onDown = (e) => {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target)) {
        setShowNotifPanel(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showNotifPanel]);

  const openNotifications = async () => {
    const next = !showNotifPanel;
    setShowNotifPanel(next);
    if (next) {
      await loadNotifications();
    }
  };

  const loadSupportTickets = async () => {
    if (!auth?.token) return;
    try {
      const rows = await fetchSupportTickets(auth.token);
      setSupportTickets(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.warn("[SUPPORT] Talepler yüklenemedi:", err.message);
    }
  };

  const openSupportModal = () => {
    setSupportFeedback(null);
    setSupportSubject("");
    setSupportMessage("");
    setShowSupportModal(true);
    loadSupportTickets();
  };

  const handleSupportSubmit = async () => {
    if (!auth?.token) return;
    const subject = supportSubject.trim();
    const message = supportMessage.trim();
    if (!subject || !message) {
      setSupportFeedback({ type: "err", msg: t("supportError") });
      return;
    }
    setSupportSubmitting(true);
    setSupportFeedback(null);
    try {
      await submitSupportTicket(auth.token, { subject, message });
      setSupportFeedback({ type: "ok", msg: t("supportSent") });
      setSupportSubject("");
      setSupportMessage("");
      await loadSupportTickets();
    } catch (err) {
      setSupportFeedback({ type: "err", msg: err.message || t("supportError") });
    } finally {
      setSupportSubmitting(false);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    if (!auth?.token) return;
    try {
      const data = await markBusinessNotificationsRead(auth.token);
      setNotifUnread(Number(data.unread) || 0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.warn("[NOTIF] Okundu işaretlenemedi:", err.message);
    }
  };

  const formatNotifDate = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    const locale = lang === "en" ? "en-GB" : "tr-TR";
    return d.toLocaleString(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const toggleSubscriptionPanel = async () => {
    const next = !showSubscriptionPanel;
    setShowSubscriptionPanel(next);
    if (!next || !auth?.token) return;
    setSubscriptionPanelLoading(true);
    try {
      const rows = await fetchBusinessBranches(auth.token);
      setSubscriptionBranches(rows);
    } catch (err) {
      console.warn("[SUBSCRIPTION-PANEL] Şubeler yüklenemedi:", err.message);
      setSubscriptionBranches([]);
    } finally {
      setSubscriptionPanelLoading(false);
    }
  };

  useEffect(() => {
    if (!showSubscriptionPanel) return undefined;
    if (auth?.token) {
      fetchBusinessSubscription(auth.token)
        .then(setSubInfo)
        .catch(() => setSubInfo(null));
    }
    const onDocClick = (event) => {
      if (!subscriptionPanelRef.current) return;
      if (!subscriptionPanelRef.current.contains(event.target)) {
        setShowSubscriptionPanel(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
    /*
      `auth?.token` bağımlılığa eklendi: panel AÇIKKEN oturum yenilenirse
      abonelik bilgisi eski token'la çekilmiş hâlde kalıyordu. Dar bir pencere
      ama düzeltmesi bedelsiz.
    */
  }, [showSubscriptionPanel, auth?.token]);

  const resetBranchRequestForm = () => {
    setBranchRequestForm({ name: "", phone: "", address: "", lat: null, lng: null });
    setBranchRequestError("");
    setBranchRequestSuccess("");
    setBranchRequestGeocoding(false);
    setShowBranchRequestConfirm(false);
  };

  const openBranchRequestModal = () => {
    resetBranchRequestForm();
    setShowSubscriptionPanel(false);
    setShowBranchRequestModal(true);
    if (auth?.token) {
      fetchBusinessProfile(auth.token)
        .then((profile) => {
          if (!profile) return;
          if (profile.branch_limit != null) setBranchLimit(Number(profile.branch_limit) || 1);
          if (profile.branch_count != null) setBranchCount(Number(profile.branch_count) || 0);
        })
        .catch(() => {});
    }
  };

  const closeBranchRequestModal = () => {
    if (branchRequestLoading) return;
    setShowBranchRequestModal(false);
    resetBranchRequestForm();
  };

  const handleBranchRequestMapPick = async (lat, lng) => {
    if (branchRequestLoading) return;
    setBranchRequestForm((prev) => ({ ...prev, lat, lng }));
    setBranchRequestGeocoding(true);
    try {
      const address = await reverseGeocodeAddress(lat, lng);
      setBranchRequestForm((prev) => ({ ...prev, address, lat, lng }));
    } catch {
      // manuel adres
    } finally {
      setBranchRequestGeocoding(false);
    }
  };

  const handleBranchRequestSubmitClick = () => {
    setBranchRequestError("");
    const name = String(branchRequestForm.name || "").trim();
    const phone = String(branchRequestForm.phone || "").trim();
    const address = String(branchRequestForm.address || "").trim();
    if (!name) {
      setBranchRequestError("Şube adı zorunludur.");
      return;
    }
    if (!phone) {
      setBranchRequestError("Telefon numarası zorunludur.");
      return;
    }
    if (!address) {
      setBranchRequestError("Adres zorunludur.");
      return;
    }
    if (
      branchRequestForm.lat == null ||
      branchRequestForm.lng == null ||
      !Number.isFinite(Number(branchRequestForm.lat)) ||
      !Number.isFinite(Number(branchRequestForm.lng))
    ) {
      setBranchRequestError("Haritadan konum seçilmesi zorunludur.");
      return;
    }
    setShowBranchRequestConfirm(true);
  };

  const handleBranchRequestConfirm = async () => {
    if (!auth?.token) return;
    setBranchRequestLoading(true);
    setBranchRequestError("");
    const payload = {
      branch_name: String(branchRequestForm.name || "").trim(),
      phone: String(branchRequestForm.phone || "").trim(),
      address: String(branchRequestForm.address || "").trim(),
      lat: branchRequestForm.lat,
      lng: branchRequestForm.lng,
    };
    try {
      /**
       * ⚠️ UX DÜZELTMESİ (denetim bulgusu U-02): Limit altındayken buton
       * "Şube Ekle" diyor, modal başlığı "Yeni Şube Ekle" diyordu — ama kod her
       * durumda ONAY TALEBİ açıyor ve toast "Admin onayı bekleniyor." diyordu.
       * Buton bir şey vaat ediyor, sonuç başkasını söylüyordu.
       *
       * Ayrıca POST /api/business/branches ucu ve onu çağıran
       * createBusinessBranch tamamen ÖLÜ KODDU — hiçbir yerden import
       * edilmiyordu, oysa tüm doğrulamaları (ad/telefon/adres/konum) hazırdı.
       *
       * Karar: işletme zaten satın aldığı şube kotasının altındaysa şube
       * DOĞRUDAN eklenir; yalnızca kota dolduğunda onay talebi açılır.
       */
      if (canAddBranchDirectly) {
        await createBusinessBranch(auth.token, payload);
        setBranchRequestSuccess(t("addBranchDirectSuccess"));
        try {
          const rows = await fetchBusinessBranches(auth.token);
          setSubscriptionBranches(rows);
        } catch {
          /* liste tazelenemezse sonraki yüklemede gelir */
        }
      } else {
        await createBusinessBranchRequest(auth.token, {
          ...payload,
          request_type: "new",
        });
        setBranchRequestSuccess(t("newBranchRequestSuccess"));
      }
      setShowBranchRequestConfirm(false);
      setTimeout(() => {
        setShowBranchRequestModal(false);
        resetBranchRequestForm();
      }, 1200);
    } catch (err) {
      setShowBranchRequestConfirm(false);
      setBranchRequestError(err.message || "Talep oluşturulamadı.");
    } finally {
      setBranchRequestLoading(false);
    }
  };

  const isBranchInactive = (branch) => {
    if (!branch) return false;
    if (branch.is_active === false || branch.is_active === 0 || branch.is_active === "0") {
      return true;
    }
    const days = branchRemainingDays(branch);
    return days != null && days <= 0;
  };

  const handleRenewBranchRequest = async () => {
    if (!auth?.token || !renewConfirmBranch) return;
    const branch = renewConfirmBranch;
    setRenewRequestLoadingId(branch.id);
    setRenewRequestError("");
    try {
      await createBusinessBranchRequest(auth.token, {
        request_type: "reactivate",
        branch_id: branch.id,
        branch_name: branch.name,
        phone: branch.phone || branch.whatsapp || "05000000000",
        address: branch.address || "Konum güncellenecek",
        lat: branch.lat,
        lng: branch.lng,
      });
      setRenewConfirmBranch(null);
      setRenewRequestError("");
      setRenewRequestSuccess(t("renewBranchRequestSuccess"));
      try {
        const rows = await fetchBusinessBranches(auth.token);
        setSubscriptionBranches(rows);
      } catch {
        /* ignore */
      }
      setTimeout(() => setRenewRequestSuccess(""), 2500);
    } catch (err) {
      setRenewRequestError(err.message || "Yenileme talebi gönderilemedi.");
    } finally {
      setRenewRequestLoadingId(null);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!auth?.token) return;
    if (ratesLocked) {
      setError(
        isAccountInactive
          ? t("accountInactiveNotice")
          : "Abonelik süreniz dolmuş. Kâr marjları güncellenemez."
      );
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
      devLog("[ADMIN] Kaydetme başarılı:", response);
      
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
      try {
        sessionStorage.removeItem("finsight_business_auth");
        sessionStorage.removeItem("finsight_auth_remember");
      } catch {
        /* ignore */
      }
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

  // ✅ Kırpılmış görseli 256px JPEG data URL olarak üret (Supabase sync dostu)
  const getCroppedImage = async (imageSrc, crop) => getCroppedImg(imageSrc, crop, 256);

  // ✅ onCropComplete callback
  const handleCropComplete = (croppedArea, croppedAreaPixels) => {
    setLogoCroppedArea(croppedAreaPixels);
  };

  // ✅ Kırpılmış logoyu kaydet → SQLite + Supabase
  const handleSaveCroppedLogo = async () => {
    if (isAccountInactive) return;
    if (!logoPreviewUrl || !logoCroppedArea || !auth?.token) return;
    setLogoLoading(true);
    try {
      const dataUrl = await getCroppedImage(logoPreviewUrl, logoCroppedArea);
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

  // Tam maske (placeholder ghost) — input değeri X içermez, altta gri olarak kalır
  const PHONE_MASK_TEMPLATE = "0(5XX) XXX XXXX";

  // ✅ Telefon Formatı: +90 0(5XX) XXX XXXX — ilk hane her zaman 5, minimum görünen "0(5"
  const formatPhoneDisplay = (rawDigits) => {
    let d = String(rawDigits || "").replace(/\D/g, "").slice(0, 10);
    if (!d.startsWith("5")) d = `5${d.replace(/^5*/, "")}`.slice(0, 10);
    if (!d) d = "5";
    let out = "0(";
    out += d.slice(0, Math.min(3, d.length));
    if (d.length >= 3) out += ")";
    if (d.length > 3) out += ` ${d.slice(3, Math.min(6, d.length))}`;
    if (d.length > 6) out += ` ${d.slice(6, Math.min(10, d.length))}`;
    return out;
  };

  const buildPhoneMaskGhost = (rawDigits) => {
    const typed = formatPhoneDisplay(rawDigits);
    return PHONE_MASK_TEMPLATE.split("")
      .map((ch, i) => (i < typed.length ? "\u00A0" : ch))
      .join("");
  };

  const parseStoredPhoneToRaw = (stored) => {
    let digits = String(stored || "").replace(/\D/g, "");
    if (digits.startsWith("90") && digits.length >= 12) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    digits = digits.slice(0, 10);
    if (!digits.startsWith("5")) digits = `5${digits.replace(/^5*/, "")}`.slice(0, 10);
    return digits || "5";
  };

  // ✅ Saat formatı yardımcı
  const minutesToTime = (minutes) => {
    if (minutes === null || minutes === undefined) return "Kapalı";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  };

  // Input'tan ham 10 haneyi çıkar; ilk hane her zaman 5 kalır
  const extractRawPhoneDigits = (value) => {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("0")) digits = digits.slice(1);
    digits = digits.slice(0, 10);
    if (!digits.startsWith("5")) {
      digits = `5${digits.replace(/^5*/, "")}`.slice(0, 10);
    }
    return digits || "5";
  };

  const getPhoneFieldState = (field) => {
    if (field === "whatsapp") {
      return {
        raw: rawWhatsappPhone,
        setRaw: setRawWhatsappPhone,
        formattedRef: whatsappPhoneFormattedRef,
      };
    }
    return {
      raw: rawBranchPhone,
      setRaw: setRawBranchPhone,
      formattedRef: branchPhoneFormattedRef,
    };
  };

  const syncPhoneField = (field, digits) => {
    const next = extractRawPhoneDigits(digits);
    const { setRaw, formattedRef } = getPhoneFieldState(field);
    setRaw(next);
    formattedRef.current = formatPhoneDisplay(next);
    return next;
  };

  const handlePhoneFieldChange = (field) => (e) => {
    const { raw, formattedRef } = getPhoneFieldState(field);
    const inputValue = e.target.value;
    const prevFormatted = formattedRef.current;
    let digits = extractRawPhoneDigits(inputValue);

    if (
      inputValue.length < prevFormatted.length &&
      digits.length >= raw.length &&
      raw.length > 1
    ) {
      digits = raw.slice(0, -1);
    }

    syncPhoneField(field, digits);
  };

  const handlePhoneFieldKeyDown = (field) => (e) => {
    const { raw } = getPhoneFieldState(field);
    const input = e.target;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const lockedUntil = 3;

    if (
      (e.key === "Backspace" || e.key === "Delete" || e.key === "ArrowLeft" || e.key === "Home") &&
      start <= lockedUntil &&
      start === end
    ) {
      if (e.key === "Backspace" || e.key === "Delete" || e.key === "Home") {
        e.preventDefault();
        requestAnimationFrame(() => input.setSelectionRange(lockedUntil, lockedUntil));
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        input.setSelectionRange(lockedUntil, lockedUntil);
        return;
      }
    }

    if (e.key !== "Backspace" || start !== end) return;
    if (raw.length <= 1) {
      e.preventDefault();
      return;
    }
    const before = input.value[start - 1];
    if (before && /\D/.test(before)) {
      e.preventDefault();
      syncPhoneField(field, raw.slice(0, -1));
    }
  };

  const handlePhoneFieldFocus = (e) => {
    const lockedUntil = 3;
    const input = e.target;
    requestAnimationFrame(() => {
      const pos = Math.max(input.selectionStart ?? lockedUntil, lockedUntil);
      input.setSelectionRange(pos, pos);
    });
  };

  const handlePhoneFieldClick = (e) => {
    const lockedUntil = 3;
    const input = e.target;
    if ((input.selectionStart ?? 0) < lockedUntil) {
      input.setSelectionRange(lockedUntil, lockedUntil);
    }
  };

  const resetPhoneFields = () => {
    setRawBranchPhone("5");
    setRawWhatsappPhone("5");
    branchPhoneFormattedRef.current = "0(5";
    whatsappPhoneFormattedRef.current = "0(5";
  };

  const resetLocationFields = () => {
    setBranchAddress("");
    setBranchLat(null);
    setBranchLng(null);
    setBranchName("");
    setLocationGeocoding(false);
  };

  const applyBranchPhones = (branch) => {
    const branchRaw = parseStoredPhoneToRaw(branch?.phone);
    const whatsappRaw = parseStoredPhoneToRaw(branch?.whatsapp);
    setRawBranchPhone(branchRaw);
    setRawWhatsappPhone(whatsappRaw);
    branchPhoneFormattedRef.current = formatPhoneDisplay(branchRaw);
    whatsappPhoneFormattedRef.current = formatPhoneDisplay(whatsappRaw);
  };

  const applyBranchLocation = (branch) => {
    setBranchAddress(branch?.address || "");
    setBranchLat(branch?.lat == null ? null : Number(branch.lat));
    setBranchLng(branch?.lng == null ? null : Number(branch.lng));
    setBranchName(branch?.name || "");
  };

  const loadBusinessBranches = async () => {
    if (!auth?.token) return;
    try {
      const rows = await fetchBusinessBranches(auth.token);
      setBusinessBranches(rows);
      setSelectedBranchId("");
      resetPhoneFields();
      resetLocationFields();
    } catch (err) {
      console.warn("[BRANCHES] Yüklenemedi:", err.message);
      setBusinessBranches([]);
      setSelectedBranchId("");
      resetPhoneFields();
      resetLocationFields();
    }
  };

  // Modal açılınca şubeleri yükle
  useEffect(() => {
    if (!showInfoModal) return;
    loadBusinessBranches();
  }, [showInfoModal]);

  // ✅ Telefon kaydı (seçili şube)
  const handlePhoneSubmit = async () => {
    if (isAccountInactive) {
      setInfoError(t("accountInactiveNotice"));
      return;
    }
    if (!selectedBranchId) {
      setInfoError("Lütfen önce bir şube seçin.");
      return;
    }
    const trimmedName = String(branchName || "").trim();
    if (!trimmedName) {
      setInfoError("Şube adı zorunludur.");
      return;
    }
    if (rawBranchPhone.length !== 10 || rawWhatsappPhone.length !== 10) {
      setInfoError("Lütfen şube ve WhatsApp numaralarını 10 haneli olarak girin.");
      return;
    }
    if (!auth?.token) return;
    setInfoError("");
    setInfoLoading(true);
    try {
      const phone = `+90 ${formatPhoneDisplay(rawBranchPhone)}`;
      const whatsapp = `+90 ${formatPhoneDisplay(rawWhatsappPhone)}`;
      const branch = await updateBusinessBranch(auth.token, selectedBranchId, {
        name: trimmedName,
        phone,
        whatsapp,
      });
      setBusinessBranches((prev) =>
        prev.map((b) =>
          String(b.id) === String(selectedBranchId)
            ? { ...b, ...(branch || {}), name: trimmedName, phone, whatsapp }
            : b
        )
      );
      setBranchName(trimmedName);
      setInfoSuccess("Şube telefon bilgileri kaydedildi!");
      setTimeout(() => setInfoSuccess(""), 2000);
    } catch (err) {
      setInfoError(err.message || "Telefon bilgileri kaydedilemedi.");
    } finally {
      setInfoLoading(false);
    }
  };

  const handleSaveBranchLocation = async () => {
    if (isAccountInactive) {
      setInfoError(t("accountInactiveNotice"));
      return;
    }
    if (!selectedBranchId) {
      setInfoError("Lütfen önce bir şube seçin.");
      return;
    }
    const trimmedName = String(branchName || "").trim();
    if (!trimmedName) {
      setInfoError("Şube adı zorunludur.");
      return;
    }
    if (!auth?.token) return;
    setInfoError("");
    setInfoLoading(true);
    try {
      const lat =
        branchLat == null || branchLat === "" || !Number.isFinite(Number(branchLat))
          ? null
          : Number(branchLat);
      const lng =
        branchLng == null || branchLng === "" || !Number.isFinite(Number(branchLng))
          ? null
          : Number(branchLng);
      const address = String(branchAddress || "").trim();
      const branch = await updateBusinessBranch(auth.token, selectedBranchId, {
        name: trimmedName,
        address,
        lat,
        lng,
      });
      setBusinessBranches((prev) =>
        prev.map((b) =>
          String(b.id) === String(selectedBranchId)
            ? { ...b, ...branch, name: trimmedName }
            : b
        )
      );
      applyBranchLocation(branch || { name: trimmedName, address, lat, lng });
      setInfoSuccess("Şube konumu kaydedildi!");
      setTimeout(() => setInfoSuccess(""), 2000);
    } catch (err) {
      setInfoError(err.message || "Konum kaydedilemedi.");
    } finally {
      setInfoLoading(false);
    }
  };

  const handleSaveBranchName = async () => {
    if (isAccountInactive) {
      setInfoError(t("accountInactiveNotice"));
      return;
    }
    if (!selectedBranchId) {
      setInfoError("Lütfen önce bir şube seçin.");
      return;
    }
    const trimmedName = String(branchName || "").trim();
    if (!trimmedName) {
      setInfoError("Şube adı zorunludur.");
      return;
    }
    if (!auth?.token) return;
    setInfoError("");
    setInfoLoading(true);
    try {
      const branch = await updateBusinessBranch(auth.token, selectedBranchId, {
        name: trimmedName,
      });
      setBusinessBranches((prev) =>
        prev.map((b) =>
          String(b.id) === String(selectedBranchId)
            ? { ...b, ...(branch || {}), name: trimmedName }
            : b
        )
      );
      setBranchName(trimmedName);
      setInfoSuccess("Şube adı güncellendi!");
      setTimeout(() => setInfoSuccess(""), 2000);
    } catch (err) {
      setInfoError(err.message || "Şube adı kaydedilemedi.");
    } finally {
      setInfoLoading(false);
    }
  };

  const handleBranchMapPick = async (lat, lng) => {
    if (!selectedBranchId || infoLoading) return;
    setBranchLat(lat);
    setBranchLng(lng);
    setLocationGeocoding(true);
    try {
      const address = await reverseGeocodeAddress(lat, lng);
      setBranchAddress(address);
    } catch {
      // Manuel adres girişi mümkün kalsın
    } finally {
      setLocationGeocoding(false);
    }
  };

  /** Sadece çalışma saatlerini kaydet (telefon değiştirmeden) */
  const handleSaveWorkingHours = async () => {
    if (isAccountInactive) {
      setInfoError(t("accountInactiveNotice"));
      return;
    }
    if (!selectedBranchId) {
      setInfoError("Lütfen önce bir şube seçin.");
      return;
    }
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
    resetPhoneFields();
    resetLocationFields();
    setSelectedBranchId("");
    setInfoError("");
    setInfoSuccess("");
  };

  const branchSelectOptions = useMemo(
    () => businessBranches.map((b) => ({ value: String(b.id), label: b.name })),
    [businessBranches]
  );

  const branchFieldsLocked = !selectedBranchId || infoLoading || isAccountInactive;

  const hasBranchMarker =
    branchLat != null &&
    branchLng != null &&
    Number.isFinite(Number(branchLat)) &&
    Number.isFinite(Number(branchLng));

  const handleBranchSelect = (value) => {
    setSelectedBranchId(value);
    const branch = businessBranches.find((b) => String(b.id) === String(value));
    if (branch) {
      applyBranchPhones(branch);
      applyBranchLocation(branch);
    } else {
      resetPhoneFields();
      resetLocationFields();
    }
    setInfoError("");
  };

  /*
    Etiket hep yukarıda (`float="always"`): alanın içinde her zaman görünen bir
    +90 öneki ve maske hayaleti var, etiket ortada dursaydı üstlerine binerdi.
  */
  const renderMaskedPhoneInput = (field, inputRef, label) => {
    const raw = field === "whatsapp" ? rawWhatsappPhone : rawBranchPhone;
    const disabled = infoLoading || !selectedBranchId;
    return (
      <FloatingInput
        ref={inputRef}
        label={label}
        float="always"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={formatPhoneDisplay(raw)}
        onChange={handlePhoneFieldChange(field)}
        onKeyDown={handlePhoneFieldKeyDown(field)}
        onFocus={handlePhoneFieldFocus}
        onClick={handlePhoneFieldClick}
        disabled={disabled}
        controlClassName="!pl-14 font-mono caret-brand-500"
        adornment={
          <>
            <span className="pointer-events-none absolute left-3 top-1/2 z-raised -translate-y-1/2 font-mono text-sm font-bold text-ink-800 dark:text-white">
              +90
            </span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-base flex select-none items-center pl-14 pr-3 font-mono text-sm text-ink-600 dark:text-ink-400"
            >
              {buildPhoneMaskGhost(raw)}
            </span>
          </>
        }
      />
    );
  };

  // ✅ Range Slider Handler

  // ✅ Günü Kapalı/Açık yap
  const toggleDayOpen = (day) => {
    if (branchFieldsLocked) return;
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
      <div className="flex min-h-screen items-center justify-center bg-ink-50 text-ink-500 dark:bg-ink-950 dark:text-ink-400">
        Oturum kontrol ediliyor...
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if (loading || !auth?.institution_id || !marginConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 text-ink-500 dark:bg-ink-950 dark:text-ink-400">
        Veriler yükleniyor...
      </div>
    );
  }

  devLog("[ADMIN-PAGE] Central Bank Rates:", centralBankRates);
  devLog("[ADMIN-PAGE] KKTC Tarih:", kktcTarih);
  devLog("[ADMIN-PAGE] Margin Config:", marginConfig);

  /**
   * ⚠️ KOD SAĞLIĞI DÜZELTMESİ (denetim bulgusu P-03): Buradan aşağısı, 1.400
   * satırlık JSX'i saran bir `try { return (…) } catch` bloğuydu. React JSX'i
   * o anda render etmediği için o catch render hatalarını HİÇBİR ZAMAN
   * yakalamıyordu — ESLint'in 275 `react-hooks/error-boundaries` hatası tam
   * olarak bunu söylüyordu (338 sorunun 289'u bu tek dosyadaydı).
   *
   * Fallback ekranı ayrıca sabit Türkçe metin kullanıyor, temayı yok sayıyor,
   * `window.location.href` ile tam sayfa yeniliyor ve ham hata mesajını
   * işletme sahibine gösteriyordu.
   *
   * Gerçek hata yakalama artık App.jsx'teki <ErrorBoundary> ile yapılıyor.
   */
  const days = kalanAbonelikSuresi;
  const expired = isExpired;
  const nearExpiry = days != null && days <= 30;

  return (
    <div className="min-h-screen bg-ink-50 text-ink-800 dark:bg-ink-950 dark:text-white">
      {/* U-08: yönetim sayfaları kendi sekme başlığını verir; robots.txt zaten bu yolları dışlıyor, noindex ile pekiştiriliyor. */}
      <Helmet>
        <title>İşletme Paneli | AdaDöviz</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-3 py-6 sm:px-6 sm:py-8">
      {/* Header: Logo + İşletme Bilgisi */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:bg-ink-950/70 dark:text-ink-300 dark:hover:border-brand-400 dark:hover:text-brand-400"
          >
            <ArrowLeft className="size-4 shrink-0" />
            <span className="truncate">{t("backToDashboard")}</span>
          </button>

          {/* İşletme Logosu — Interactive */}
          <button
            type="button"
            onClick={() => {
              if (isAccountInactive) return;
              setShowLogoModal(true);
            }}
            className="group relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink-200 bg-white transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:border-brand-400 cursor-pointer dark:border-white/10 dark:bg-ink-950/60 dark:hover:border-brand-400 sm:h-20 sm:w-20"
          >
            {profileLogoUrl ? (
              <img
                src={mediaUrl(profileLogoUrl)}
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
              <Building2 className="size-8 text-ink-600 dark:text-ink-400" />
            )}
            <Camera className="absolute size-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
          </button>

          {/* İşletme Bilgisi */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold text-ink-900 dark:text-white sm:text-lg">
                {institutionName} {t("managementPanel")}
              </h1>
              {showTestBadge && (
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold tracking-wider text-danger-500 bg-danger-500/10 border border-danger-500/30 shadow-[0_0_12px_rgba(244,63,94,0.5)]">
                  TEST
                </span>
              )}
            </div>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {/* U-05: bu değer bültenin tarihi, "son güncelleme" değil. */}
              {t("bulletinDate")}: {kktcTarih || formatDateTime(centralBankUpdatedAt) || "—"}
            </p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end sm:gap-3 md:gap-4">
          {subscriptionWarningDays != null ? (
            <p className="max-w-full text-xs font-semibold text-warning-600 dark:text-warning-400 sm:text-sm">
              {t("subscriptionExpiringSoon")} : {subscriptionWarningDays} {t("daysUnit")}
            </p>
          ) : null}
          <div className="relative" ref={notifPanelRef}>
            <button
              type="button"
              onClick={openNotifications}
              className="relative inline-flex size-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300 dark:hover:border-brand-400 dark:hover:text-brand-300"
              aria-label={t("notificationsTitle")}
              title={t("notificationsTitle")}
            >
              <Bell className="size-4" />
              {notifUnread > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white">
                  {notifUnread > 99 ? "99+" : notifUnread}
                </span>
              ) : null}
            </button>
            {showNotifPanel ? (
              <div className="absolute right-0 z-dropdown mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900">
                <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-3 py-2.5 dark:border-ink-800">
                  <p className="text-sm font-semibold text-ink-900 dark:text-white">
                    {t("notificationsTitle")}
                  </p>
                  {notifUnread > 0 ? (
                    <button
                      type="button"
                      onClick={handleMarkAllNotificationsRead}
                      className="text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-300"
                    >
                      {t("notificationsMarkAllRead")}
                    </button>
                  ) : null}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifLoading && notifications.length === 0 ? (
                    <p className="p-4 text-sm text-ink-500 dark:text-ink-400">{t("loadingShort")}</p>
                  ) : notifications.length === 0 ? (
                    <p className="p-4 text-sm text-ink-500 dark:text-ink-400">
                      {t("notificationsEmpty")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                      {notifications.map((n) => (
                        <li
                          key={n.id}
                          className={`px-3 py-3 ${
                            n.is_read ? "" : "bg-brand-500/5 dark:bg-brand-500/10"
                          }`}
                        >
                          <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">
                            {n.title || t("notificationsTitle")}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-600 dark:text-ink-300">
                            {n.message}
                          </p>
                          <p className="mt-1 text-[10px] text-ink-600 dark:text-ink-400">
                            {formatNotifDate(n.created_at)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <HeaderActions />
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-lg border transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong bg-transparent px-3 py-2 text-sm hover:bg-danger-500/5 border-danger-600 text-danger-700 dark:border-danger-500 dark:text-danger-400"
          >
            <LogOut className="size-4" />
            {t("logoutShort")}
          </button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-start">
        <button
          type="button"
          onClick={() => {
            resetPasswordForm();
            setShowPasswordModal(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-200 dark:hover:border-brand-400 dark:hover:text-brand-400"
        >
          <Key className="size-4" />
          {t("changePassword")}
        </button>
        
        <button
          type="button"
          onClick={() => {
            setInfoError("");
            setInfoSuccess("");
            resetPhoneFields();
            resetLocationFields();
            setSelectedBranchId("");
            setShowInfoModal(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-200 dark:hover:border-brand-400 dark:hover:text-brand-400"
        >
          <Edit2 className="size-4" />
          İşletme Bilgilerini Güncelle
        </button>

        <button
          type="button"
          onClick={openSupportModal}
          className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-200 dark:hover:border-brand-400 dark:hover:text-brand-400"
        >
          <LifeBuoy className="size-4" />
          {t("supportButton")}
        </button>

        <div className="relative" ref={subscriptionPanelRef}>
          <button
            type="button"
            onClick={toggleSubscriptionPanel}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong ${
              expired || nearExpiry
                ? "border-danger-600/50 bg-danger-500/5 text-danger-700 hover:border-danger-500 dark:border-danger-500/50 dark:text-danger-400"
                : "border-brand-600/40 bg-brand-500/5 text-brand-800 hover:border-brand-400 dark:border-brand-400/40 dark:text-brand-200 dark:hover:border-brand-400"
            }`}
          >
            {t("subscriptionStatus")}
            <ChevronDown
              className={`size-4 transition ${showSubscriptionPanel ? "rotate-180" : ""}`}
            />
          </button>

          {showSubscriptionPanel ? (
            <div className="absolute left-0 top-full z-overlay mt-2 w-[min(100vw-2rem,28rem)] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900">
              {/*
                ⚠️ ÜRÜN HARİTASI İ-01/İ-02/İ-03: Bu ekranın adı "Abonelik Durumu"
                ama içinde YALNIZCA şube tablosu vardı — işletme kendi paketini,
                bitişini, kalan gününü, ne ödediğini ve görünürlük karşılığını
                hiçbir yerde göremiyordu. Aşağıdaki üç blok bunu kapatıyor.
              */}
              {subInfo?.subscription ? (
                <div className="border-b border-ink-200 px-4 py-3 dark:border-ink-700">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-ink-900 dark:text-white">
                      {subInfo.subscription.plan?.ad || subInfo.subscription.subscription_type}
                    </span>
                    {subInfo.subscription.plan?.fiyat > 0 ? (
                      <span className="font-mono text-sm font-semibold text-ink-900 tabular-nums dark:text-white">
                        {Number(subInfo.subscription.plan.fiyat).toLocaleString("tr-TR")} ₺
                        <span className="ml-1 text-xs font-normal text-ink-600 dark:text-ink-400">
                          / {subInfo.subscription.plan.sure_gun} gün
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="block text-ink-600 dark:text-ink-400">Bitiş</span>
                      <span className="font-medium text-ink-900 dark:text-ink-100">
                        {subInfo.subscription.subscription_end_date
                          ? new Date(subInfo.subscription.subscription_end_date).toLocaleDateString("tr-TR")
                          : "Süresiz"}
                      </span>
                    </div>
                    <div>
                      <span className="block text-ink-600 dark:text-ink-400">Kalan</span>
                      <span
                        className={`font-semibold ${
                          subInfo.subscription.days_remaining == null
                            ? "text-ink-700 dark:text-ink-200"
                            : subInfo.subscription.days_remaining <= 7
                              ? "text-warning-700 dark:text-warning-400"
                              : "text-ink-900 dark:text-ink-100"
                        }`}
                      >
                        {subInfo.subscription.days_remaining == null
                          ? "—"
                          : `${subInfo.subscription.days_remaining} gün`}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

              {subInfo?.performance ? (
                <div className="border-b border-ink-200 bg-brand-500/5 px-4 py-3 dark:border-ink-700">
                  <p className="text-[10px] font-semibold text-brand-700 dark:text-brand-300">
                    Bu dönem görünürlüğünüz
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-4 text-sm">
                    <span className="font-mono text-lg font-bold text-ink-900 tabular-nums dark:text-white">
                      {subInfo.performance.tiklama}
                      <span className="ml-1 text-xs font-normal text-ink-600 dark:text-ink-400">tıklama</span>
                    </span>
                    {subInfo.performance.siralama ? (
                      <span className="text-xs text-ink-600 dark:text-ink-400">
                        {subInfo.performance.toplamIsletme} işletme içinde{" "}
                        <b className="text-ink-900 dark:text-ink-100">
                          {subInfo.performance.siralama}. sırada
                        </b>
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {subInfo?.payments?.length ? (
                <div className="border-b border-ink-200 px-4 py-3 dark:border-ink-700">
                  <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-ink-600 dark:text-ink-400">
                    Ödemelerim
                  </p>
                  <ul className="space-y-1">
                    {subInfo.payments.slice(0, 5).map((pay) => (
                      <li key={pay.id} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-ink-700 dark:text-ink-300">
                          {new Date(pay.odeme_tarihi).toLocaleDateString("tr-TR")} ·{" "}
                          {pay.plan_adi || pay.plan_code}
                        </span>
                        <span className="font-mono font-semibold text-ink-900 tabular-nums dark:text-ink-100">
                          {(Number(pay.tutar) + Number(pay.kdv || 0)).toLocaleString("tr-TR")} ₺
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid grid-cols-3 gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2 text-[10px] font-semibold tracking-wide text-ink-600 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-400">
                <span>{t("branchNameLabel")}</span>
                <span>{t("subscriptionStartDate")}</span>
                <span>{t("remainingSubscription")}</span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {subscriptionPanelLoading ? (
                  <p className="px-3 py-4 text-sm text-ink-500 dark:text-ink-400">
                    {t("loadingShort")}
                  </p>
                ) : subscriptionBranches.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-ink-500 dark:text-ink-400">
                    {t("subscriptionListEmpty")}
                  </p>
                ) : (
                  subscriptionBranches.map((branch) => {
                    const inactive = isBranchInactive(branch);
                    return (
                    <div
                      key={branch.id}
                      className="grid grid-cols-3 gap-2 border-b border-ink-100 px-3 py-2.5 text-sm last:border-b-0 dark:border-ink-800"
                    >
                      <div className="min-w-0">
                        <span className="block truncate font-medium text-ink-800 dark:text-ink-100">
                          {branch.name || "—"}
                        </span>
                        {inactive ? (
                          <button
                            type="button"
                            disabled={renewRequestLoadingId === branch.id}
                            onClick={() => {
                              setRenewRequestError("");
                              setRenewConfirmBranch(branch);
                            }}
                            className="mt-1 text-[10px] font-semibold text-warning-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-warning-300"
                          >
                            {renewRequestLoadingId === branch.id
                              ? t("sending")
                              : t("renewBranchRequestBtn")}
                          </button>
                        ) : null}
                      </div>
                      <span className="text-ink-600 dark:text-ink-300">
                        {formatDateShort(
                          branch.subscription_start_date || branch.created_at
                        )}
                      </span>
                      <span
                        className={`font-semibold ${
                          inactive
                            ? "text-danger-700 dark:text-danger-400"
                            : branch.subscription_type === "Test" ||
                                (branchRemainingDays(branch) != null &&
                                  branchRemainingDays(branch) > 30)
                              ? "text-brand-700 dark:text-brand-300"
                              : branchRemainingDays(branch) == null
                                ? "text-ink-700 dark:text-ink-200"
                                : "text-danger-700 dark:text-danger-400"
                        }`}
                      >
                        {inactive
                          ? t("branchInactiveLabel")
                          : formatBranchRemainingLabel(branch, t)}
                      </span>
                    </div>
                  );
                  })
                )}
              </div>
              {renewRequestError ? (
                <p className="border-t border-danger-500/20 bg-danger-500/10 px-3 py-2 text-xs text-danger-700 dark:text-danger-300">
                  {renewRequestError}
                </p>
              ) : null}
              {renewRequestSuccess ? (
                <p className="border-t border-success-500/20 bg-success-500/10 px-3 py-2 text-xs text-success-700 dark:text-success-300">
                  {renewRequestSuccess}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={openBranchRequestModal}
          className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-200 dark:hover:border-brand-400 dark:hover:text-brand-400"
        >
          <Plus className="size-4" />
          {canAddBranchDirectly ? t("addBranchDirectBtn") : t("newBranchRequestBtn")}
        </button>
      </div>

      {/* Merkez Bankası Bilgisi */}
      <div className="rounded-card border border-brand-500/20 bg-brand-500/10 px-4 py-4">
        <p className="text-xs font-semibold text-brand-700 dark:text-brand-300">
          {t("centralBankRates")}
        </p>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
          {t("centralBankRatesNote")}
        </p>
      </div>

      {isAccountInactive ? (
        <div className="flex flex-col gap-3 rounded-xl border border-warning-500/40 bg-warning-500/10 px-4 py-3 text-sm text-warning-800 dark:text-warning-200 sm:flex-row sm:items-center sm:justify-between">
          <p>{t("accountInactiveNotice")}</p>
          <button
            type="button"
            onClick={() => setShowSubscriptionPanel(true)}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-warning-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-warning-600"
          >
            {t("extendSubscriptionBtn")}
          </button>
        </div>
      ) : isExpired ? (
        <div className="rounded-xl border border-danger-500/40 bg-danger-500/10 px-4 py-3 text-sm text-danger-700 dark:text-danger-200">
          {t("subscriptionExpiredNotice")}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-700 dark:text-danger-200">
          {error}
        </div>
      ) : null}

      {/* Granüler 6-Kalem Tablo */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* ALIŞ KURLAR */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-brand-700 dark:text-brand-300">{t("buyRates")}</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Array.isArray(MARGIN_ITEMS) ? MARGIN_ITEMS.filter(i => i.type === 'buy').map((item) => {
            const cfg = marginConfig?.[item?.currency]?.[item?.type] || { type: "fixed", value: "0" };
            const kur = centralBankRates?.[item?.currency]?.[item?.type] || null;
            const final = applyGranularMargin(kur, cfg?.type, cfg?.value);
            const itemLabel = marginLabels[item.labelKey] || item.labelKey;

            return (
              <div
                key={`${item.currency}-${item.type}`}
                className="rounded-xl border border-ink-200 bg-white p-4 transition hover:border-ink-300 dark:border-white/10 dark:bg-ink-900/60 dark:hover:border-white/20"
              >
                <h4 className="mb-3 text-sm font-bold text-brand-700 dark:text-brand-300">{itemLabel}</h4>

                {/* Merkez Bankası KUR */}
                <div className="mb-3">
                  <FloatingInput
                    label={t("centralBankRate")}
                    float="always"
                    readOnly
                    value={formatNum(kur)}
                    controlClassName="font-mono"
                    fieldClassName="!bg-ink-50 dark:!bg-ink-950/80"
                    hint={`${t("effectiveRate")}: ${formatNum(centralBankRates?.[item?.currency]?.[item?.type === 'buy' ? 'buy_efektif' : 'sell_efektif'] || '0')}`}
                  />
                </div>

                {/* Kâr Tipi Selectbox */}
                <div className="mb-3">
                  <SearchableSelect
                    label={t("profitType")}
                    value={cfg.type}
                    onChange={(val) =>
                      handleMarginChange(item.currency, item.type, "type", val)
                    }
                    disabled={ratesLocked}
                    options={[
                      { value: "fixed", label: t("fixedPrice") },
                      { value: "percent", label: t("percentPrice") },
                    ]}
                    placeholder={t("profitType")}
                  />
                </div>

                {/* Kâr Marjı */}
                <div className="mb-3">
                  <FloatingInput
                    label={`${t("profitMargin")} ${cfg.type === "percent" ? "(%)" : "(TL)"}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={cfg.value}
                    disabled={ratesLocked}
                    onChange={(e) =>
                      handleMarginChange(item.currency, item.type, "value", e.target.value)
                    }
                  />
                </div>

                {/* Final Kur & Kâr */}
                <div className="rounded-lg border-2 border-brand-600 bg-brand-50 px-3 py-2.5 text-center dark:border-brand-400/80 dark:bg-ink-950/50">
                  <p className="text-sm font-bold">
                    <span className="text-brand-900 dark:text-white">{t("finalRate")}:</span> <span className="font-mono text-brand-700 dark:text-brand-300 text-base">{formatNum(final)}</span>
                    {(() => {
                      const kar = final && kur ? final - kur : 0;
                      return kar > 0 ? <span className="ml-2 text-xs font-semibold text-success-400">/ +{formatNum(kar)} {t("profitTl")}</span> : '';
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
          <h3 className="mb-3 text-sm font-semibold text-danger-700 dark:text-danger-400">{t("sellRates")}</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Array.isArray(MARGIN_ITEMS) ? MARGIN_ITEMS.filter(i => i.type === 'sell').map((item) => {
              const cfg = marginConfig?.[item?.currency]?.[item?.type] || { type: "fixed", value: "0" };
              const kur = centralBankRates?.[item?.currency]?.[item?.type] || null;
              const final = applyGranularMargin(kur, cfg?.type, cfg?.value);
              const itemLabel = marginLabels[item.labelKey] || item.labelKey;

              return (
                <div
                  key={`${item.currency}-${item.type}`}
                  className="rounded-xl border border-ink-200 bg-white p-4 transition hover:border-ink-300 dark:border-white/10 dark:bg-ink-900/60 dark:hover:border-white/20"
                >
                  <h4 className="mb-3 text-sm font-bold text-danger-700 dark:text-danger-400">{itemLabel}</h4>

                  {/* Merkez Bankası KUR */}
                  <div className="mb-3">
                    <FloatingInput
                      label={t("centralBankRate")}
                      float="always"
                      readOnly
                      value={formatNum(kur)}
                      controlClassName="font-mono"
                      fieldClassName="!bg-ink-50 dark:!bg-ink-950/80"
                      hint={`${t("effectiveRate")}: ${formatNum(centralBankRates?.[item?.currency]?.[item?.type === 'buy' ? 'buy_efektif' : 'sell_efektif'] || '0')}`}
                    />
                  </div>

                  {/* Kâr Tipi Selectbox */}
                  <div className="mb-3">
                    <SearchableSelect
                      label={t("profitType")}
                      value={cfg.type}
                      onChange={(val) =>
                        handleMarginChange(item.currency, item.type, "type", val)
                      }
                      disabled={ratesLocked}
                      options={[
                        { value: "fixed", label: t("fixedPrice") },
                        { value: "percent", label: t("percentPrice") },
                      ]}
                      placeholder={t("profitType")}
                    />
                  </div>

                  {/* Kâr Değeri */}
                  <div className="mb-3">
                    <FloatingInput
                      label={`${t("profitValue")} ${cfg.type === "percent" ? "(%)" : "(TL)"}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={cfg.value}
                      disabled={ratesLocked}
                      onChange={(e) =>
                        handleMarginChange(item.currency, item.type, "value", e.target.value)
                      }
                    />
                  </div>

                  {/* Final Kur & Kâr */}
                  <div className="rounded-lg border-2 border-danger-600 bg-danger-50 px-3 py-2.5 text-center dark:border-danger-500/80 dark:bg-ink-950/50">
                    <p className="text-sm font-bold">
                      <span className="text-danger-900 dark:text-white">{t("finalRate")}:</span> <span className="font-mono text-danger-700 dark:text-danger-400 text-base">{formatNum(final)}</span>
                      {(() => {
                        const kar = final && kur ? final - kur : 0;
                        return kar > 0 ? <span className="ml-2 text-xs font-semibold text-success-400">/ +{formatNum(kar)} {t("profitTl")}</span> : '';
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
            disabled={saving || loading || ratesLocked}
            className="btn-primary"
          >
            <Save className="size-4" />
            {saving ? t("saving") : t("saveMargins")}
          </button>
        </div>
      </form>

      {/*
        İşlem geçmişi: işletmenin kendi profilinde, kurlarında ve şubelerinde
        yapılan değişikliklerin kaydı. Aynı kayıtlar süper admin panelinde de
        (tüm işletmeler için) görünür.
      */}
      <div className="mt-8">
        <ActivityLogPanel token={auth?.token} mode="business" />
      </div>

      {/* ✅ FIXED MODAL - BAŞARILI KAYDETME (KAPATILABILIR) */}
      {showSuccessModal && (
        <div 
          className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 backdrop-blur-md"
          onClick={() => setShowSuccessModal(false)}  // ✅ Dışarı tıklanınca kapat
        >
          <div role="dialog" aria-modal="true" 
            className="relative bg-white border border-ink-200 p-8 rounded-card shadow-2xl flex flex-col items-center transform transition-[background-color,border-color,color,box-shadow,transform] dark:bg-ink-900 dark:border-ink-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-raised flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => setShowSuccessModal(false)}
                className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>

            <div className="w-16 h-16 bg-success-500/20 rounded-full flex items-center justify-center mb-4">
              <span className="text-success-500 text-3xl">✓</span>
            </div>
            <h3 className="text-ink-900 text-xl font-bold dark:text-white">Kurlar başarıyla kaydedildi!</h3>
          </div>
        </div>
      )}

      {/* ✅ YÜKLENIYOR MODAL (Spinner) */}
      {isSaving && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 backdrop-blur-md">
          <div role="dialog" aria-modal="true" className="bg-ink-900 border border-ink-700 p-8 rounded-card shadow-2xl flex flex-col items-center transform transition-[background-color,border-color,color,box-shadow,transform]">
            <div className="w-16 h-16 bg-brand-500/20 rounded-full flex items-center justify-center mb-4 animate-spin">
              <svg className="w-8 h-8 text-brand-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <h3 className="text-white text-xl font-bold">Kâr ayarları kaydediliyor...</h3>
            <p className="text-ink-300 text-sm mt-2">Lütfen bekleyin</p>
          </div>
        </div>
      )}

      {/* ✅ FIXED MODAL - ÇIKIS (ADMIN PANELINDEN) */}
      {showLogoutPopup && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 backdrop-blur-md">
          <div role="dialog" aria-modal="true" className="bg-ink-900 border border-ink-700 p-8 rounded-card shadow-2xl flex flex-col items-center transform transition-[background-color,border-color,color,box-shadow,transform]">
            <div className="w-16 h-16 bg-danger-500/20 rounded-full flex items-center justify-center mb-4 animate-spin">
              <svg className="w-8 h-8 text-danger-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <h3 className="text-white text-xl font-bold">Çıkış Yapılıyor...</h3>
            <p className="text-ink-300 text-sm mt-2">Dashboard'a dönüyorsunuz</p>
          </div>
        </div>
      )}

      {/* ✅ Logo Modal — File Select ve Crop */}
      {showLogoModal && (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (
              e.target === e.currentTarget &&
              e.currentTarget.dataset.backdropDown === "1" &&
              !logoLoading &&
              !logoCropStep
            ) {
              setShowLogoModal(false);
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative w-full max-w-lg overflow-hidden rounded-card border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900 max-h-[min(92dvh,90vh)] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-raised flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => !logoLoading && setShowLogoModal(false)}
                className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>

            {/* STEP 1: Dosya Seçimi */}
            {!logoCropStep ? (
              <div className="p-6">
                <div className="mb-5 flex items-center gap-3 pt-10 sm:pt-0 sm:pr-[7.5rem]">
                  <div className="rounded-lg bg-brand-500/10 p-2 text-brand-600 dark:text-brand-400">
                    <Camera className="size-5" />
                  </div>
                  <h3 className="text-lg font-bold text-ink-800 dark:text-ink-100">
                    Logo Yönet
                  </h3>
                </div>

                <div className="space-y-4">
                  {/* Logo Önizlemesi */}
                  <div className="flex justify-center">
                    <div className="flex h-32 w-32 items-center justify-center rounded-full border-2 border-ink-300 bg-ink-50 overflow-hidden dark:border-ink-700 dark:bg-ink-950">
                      {auth?.institution_id ? (
                        <img
                          src={`/logos/${auth.institution_id}.png`}
                          alt={auth.institution_name}
                          className="h-full w-full object-cover"
                          onError={(e) => (e.target.style.display = "none")}
                        />
                      ) : (
                        <Building2 className="size-12 text-ink-300 dark:text-ink-600" />
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
                    className="rounded-lg border-2 border-dashed border-ink-300 bg-ink-50 p-6 text-center transition hover:border-brand-400 hover:bg-brand-50 dark:border-ink-700 dark:bg-ink-950 dark:hover:border-brand-500 dark:hover:bg-brand-900/20"
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
                      <Camera className="mx-auto size-6 text-ink-600 dark:text-ink-400 mb-2" />
                      <p className="text-sm font-medium text-ink-700 dark:text-ink-300">
                        Dosya sürükleyin veya seçin
                      </p>
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
                        PNG, JPG, GIF, WEBP
                      </p>
                    </label>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowLogoModal(false)}
                      disabled={logoLoading}
                      className="flex-1 rounded-lg border border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-medium text-ink-600 transition hover:border-ink-300 hover:text-ink-900 disabled:opacity-50 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300 dark:hover:text-white"
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* STEP 2: Kırpma */
              <div className="p-6">
                <div className="mb-5 flex items-center gap-3 pt-10 sm:pt-0 sm:pr-[7.5rem]">
                  <div className="rounded-lg bg-brand-500/10 p-2 text-brand-600 dark:text-brand-400">
                    <Camera className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-ink-800 dark:text-ink-100">
                      Logoyu Kırp
                    </h3>
                    <p className="text-xs text-ink-500 dark:text-ink-400">Zoom ve konumu ayarla</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Cropper Container */}
                  <div className="relative bg-ink-900 rounded-lg overflow-hidden" style={{ height: "300px" }}>
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
                    <label className="text-xs font-semibold tracking-wide text-ink-600 dark:text-ink-400">
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
                      className="w-full h-2 bg-ink-300 rounded-lg cursor-pointer dark:bg-ink-700 accent-brand-500"
                    />
                    <div className="flex justify-between text-xs text-ink-500 dark:text-ink-400">
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
                      className="flex-1 rounded-lg border border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-medium text-ink-600 transition hover:border-ink-300 hover:text-ink-900 disabled:opacity-50 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300 dark:hover:text-white"
                    >
                      Geri
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveCroppedLogo}
                      disabled={logoLoading}
                      className="flex-1 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition dark:bg-brand-600 dark:hover:bg-brand-500"
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
          className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (
              e.target === e.currentTarget &&
              e.currentTarget.dataset.backdropDown === "1" &&
              !infoLoading
            ) {
              closeInfoModal();
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative w-full max-w-lg overflow-hidden rounded-card border border-ink-200 bg-white p-6 shadow-2xl dark:border-ink-700 dark:bg-ink-900 max-h-[min(92dvh,90vh)] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-raised flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => !infoLoading && closeInfoModal()}
                className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>

            <div className="mb-6 flex items-start justify-between gap-3 pt-10 sm:pt-0 sm:pr-[7.5rem]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="rounded-lg bg-brand-500/10 p-2 text-brand-600 dark:text-brand-400">
                  <Edit2 className="size-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-ink-800 dark:text-ink-100">
                    İşletme Bilgilerini Güncelle
                  </h3>
                  <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                    Şube telefonları ve çalışma saatleri
                  </p>
                </div>
              </div>
              <div className="w-44 shrink-0 sm:w-52">
              <SearchableSelect
                label={t("selectBranchPlaceholder")}
                value={selectedBranchId}
                onChange={handleBranchSelect}
                options={branchSelectOptions}
                placeholder={t("selectBranchPlaceholder")}
                disabled={infoLoading || businessBranches.length === 0}
              />
              </div>
            </div>

            {/* Form: şube seç + telefonlar + çalışma saatleri */}
            <div className="space-y-4">
                <div
                  className={`space-y-1.5 ${
                    !selectedBranchId ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  <div className="flex gap-2">
                    <FloatingInput
                      className="flex-1"
                      label={t("updateBranchNameHint")}
                      icon={Building2}
                      type="text"
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      disabled={branchFieldsLocked}
                      placeholder={t("branchNamePlaceholder")}
                    />
                    <button
                      type="button"
                      onClick={handleSaveBranchName}
                      disabled={branchFieldsLocked || !String(branchName || "").trim()}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 text-sm font-semibold text-brand-700 transition hover:border-brand-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand-300"
                    >
                      <Save className="size-4" />
                      {infoLoading ? "..." : t("saveBranchNameBtn")}
                    </button>
                  </div>
                </div>

                {renderMaskedPhoneInput("branch", branchPhoneInputRef, t("branchPhoneLabel"))}
                {renderMaskedPhoneInput(
                  "whatsapp",
                  whatsappPhoneInputRef,
                  t("whatsappPhoneLabel")
                )}

                {!selectedBranchId ? (
                  <p className="text-xs text-warning-600 dark:text-warning-300">
                    {t("selectBranchToEditPhones")}
                  </p>
                ) : null}

                {/* Çalışma Saatleri — Haftanın 7 Günü */}
                <div
                  className={`mt-6 pt-6 border-t border-ink-200 dark:border-ink-700 ${
                    !selectedBranchId ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  <h4 className="text-sm font-semibold text-ink-800 dark:text-ink-100 mb-4 flex items-center gap-2">
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
                        <div key={day} className="rounded-lg border border-ink-200 bg-ink-50 p-4 dark:border-ink-700 dark:bg-ink-950/50">
                          <div className="flex items-center justify-between mb-3">
                            <label className="text-sm font-semibold text-ink-700 dark:text-ink-300">
                              {dayDisplayNames[day]}
                            </label>
                            <button
                              type="button"
                              onClick={() => toggleDayOpen(day)}
                              disabled={branchFieldsLocked}
                              className={`text-xs px-2.5 py-1.5 rounded font-medium transition disabled:cursor-not-allowed ${
                                isClosed
                                  ? "bg-ink-300 text-ink-700 dark:bg-ink-600 dark:text-ink-200"
                                  : "bg-brand-500/20 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
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
                                step={15}
                                minValue={start}
                                maxValue={end}
                                disabled={branchFieldsLocked}
                                onRangeChange={(newStart, newEnd) => {
                                  if (branchFieldsLocked) return;
                                  setBusinessHours((prev) => ({
                                    ...prev,
                                    [day]: [newStart, newEnd],
                                  }));
                                }}
                              />
                              
                              <p className="text-sm font-semibold text-center text-brand-600 dark:text-brand-400 pt-1">
                                {displayStart} — {displayEnd}
                              </p>
                            </div>
                          ) : (
                            <p className="text-xs text-ink-500 dark:text-ink-400 text-center py-3 font-medium">
                              Bu gün kapalıdır.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Şube Konumu */}
                <div
                  className={`mt-6 pt-6 border-t border-ink-200 dark:border-ink-700 ${
                    !selectedBranchId ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  <h4 className="text-sm font-semibold text-ink-800 dark:text-ink-100 mb-4 flex items-center gap-2">
                    <MapPin className="size-4" />
                    {t("branchLocationTitle")}
                  </h4>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <FloatingTextarea
                        label={t("branchAddressLabel")}
                        value={branchAddress}
                        onChange={(e) => setBranchAddress(e.target.value)}
                        disabled={branchFieldsLocked}
                        rows={3}
                        placeholder={t("branchAddressPlaceholder")}
                      />
                      <p className="text-[11px] text-ink-500 dark:text-ink-400">
                        {t("branchMapHint")}
                        {locationGeocoding ? " ..." : ""}
                      </p>
                      {hasBranchMarker ? (
                        <p className="font-mono text-[11px] text-ink-500 dark:text-ink-400">
                          {Number(branchLat).toFixed(5)}, {Number(branchLng).toFixed(5)}
                        </p>
                      ) : null}
                    </div>

                    {showInfoModal ? (
                      <div className="relative h-56 overflow-hidden rounded-lg border border-ink-200 dark:border-ink-700">
                        <MapContainer
                          key={`branch-map-${selectedBranchId || "none"}-${showInfoModal}`}
                          center={hasBranchMarker ? [branchLat, branchLng] : KKTC_MAP_CENTER}
                          zoom={hasBranchMarker ? 14 : 9}
                          scrollWheelZoom={!branchFieldsLocked}
                          dragging={!branchFieldsLocked}
                          className="h-full w-full"
                        >
                          <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          />
                          <BranchMapClickHandler
                            disabled={branchFieldsLocked}
                            onPick={handleBranchMapPick}
                          />
                          {hasBranchMarker ? (
                            <Marker position={[branchLat, branchLng]} />
                          ) : null}
                        </MapContainer>
                      </div>
                    ) : null}
                  </div>
                </div>

                {infoError ? (
                  <div className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-700 dark:text-danger-200">
                    {infoError}
                  </div>
                ) : null}

                {infoSuccess ? (
                  <div className="rounded-lg border border-success-500/30 bg-success-500/10 px-3 py-2 text-xs text-success-700 dark:text-success-200">
                    {infoSuccess}
                  </div>
                ) : null}

                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={closeInfoModal}
                    disabled={infoLoading}
                    className="w-full min-w-0 flex-1 rounded-lg border border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-medium text-ink-600 transition hover:border-ink-300 hover:text-ink-900 disabled:opacity-50 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300 dark:hover:text-white sm:min-w-[8rem]"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveWorkingHours}
                    disabled={branchFieldsLocked}
                    className="flex-1 min-w-[8rem] rounded-lg border border-brand-500/40 bg-brand-500/10 px-4 py-2.5 text-sm font-semibold text-brand-700 transition hover:border-brand-400 disabled:opacity-50 disabled:cursor-not-allowed dark:text-brand-300"
                  >
                    {infoLoading ? "Kaydediliyor..." : t("saveWorkingHoursBtn")}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveBranchLocation}
                    disabled={branchFieldsLocked}
                    className="flex-1 min-w-[8rem] rounded-lg border border-brand-500/40 bg-brand-500/10 px-4 py-2.5 text-sm font-semibold text-brand-700 transition hover:border-brand-400 disabled:opacity-50 disabled:cursor-not-allowed dark:text-brand-300"
                  >
                    {infoLoading ? "Kaydediliyor..." : t("saveBranchLocationBtn")}
                  </button>
                  <button
                    type="button"
                    onClick={handlePhoneSubmit}
                    disabled={
                      branchFieldsLocked ||
                      rawBranchPhone.length !== 10 ||
                      rawWhatsappPhone.length !== 10
                    }
                    className="flex-1 min-w-[8rem] rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition dark:bg-brand-600 dark:hover:bg-brand-500"
                  >
                    {infoLoading ? "Kaydediliyor..." : t("saveBranchPhonesBtn")}
                  </button>
                </div>
              </div>
          </div>
        </div>
      )}

      {showBranchRequestModal && (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && e.currentTarget.dataset.backdropDown === "1") {
              closeBranchRequestModal();
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative w-full max-w-lg overflow-hidden rounded-card border border-ink-200 bg-white p-6 shadow-2xl dark:border-ink-700 dark:bg-ink-900 max-h-[min(92dvh,90vh)] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-raised flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={closeBranchRequestModal}
                className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>

            <div className="mb-5 flex items-center gap-3 pt-10 sm:pt-0 sm:pr-[7.5rem]">
              <div className="rounded-lg bg-brand-500/10 p-2 text-brand-600 dark:text-brand-400">
                <Plus className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-ink-800 dark:text-ink-100">
                {canAddBranchDirectly ? t("addBranchDirectTitle") : t("newBranchRequestTitle")}
              </h3>
            </div>

            <div className="space-y-4">
              <FloatingInput
                label={t("branchNameLabel")}
                type="text"
                value={branchRequestForm.name}
                onChange={(e) =>
                  setBranchRequestForm((p) => ({ ...p, name: e.target.value }))
                }
                disabled={branchRequestLoading}
                placeholder={t("branchNamePlaceholder")}
              />

              <FloatingInput
                label={t("phoneLabel")}
                icon={Phone}
                type="tel"
                value={branchRequestForm.phone}
                onChange={(e) =>
                  setBranchRequestForm((p) => ({ ...p, phone: e.target.value }))
                }
                disabled={branchRequestLoading}
                placeholder={t("phonePlaceholder")}
              />

              <div className="space-y-1.5">
                <FloatingTextarea
                  label={t("branchAddressLabel")}
                  value={branchRequestForm.address}
                  onChange={(e) =>
                    setBranchRequestForm((p) => ({ ...p, address: e.target.value }))
                  }
                  disabled={branchRequestLoading}
                  rows={3}
                  placeholder={t("branchAddressPlaceholder")}
                />
                <p className="text-[11px] text-ink-500 dark:text-ink-400">
                  {t("branchMapHint")}
                  {branchRequestGeocoding ? " ..." : ""}
                </p>
                {branchRequestForm.lat != null && branchRequestForm.lng != null ? (
                  <p className="font-mono text-[11px] text-ink-500 dark:text-ink-400">
                    {Number(branchRequestForm.lat).toFixed(5)},{" "}
                    {Number(branchRequestForm.lng).toFixed(5)}
                  </p>
                ) : null}
              </div>

              <div className="relative h-52 overflow-hidden rounded-lg border border-ink-200 dark:border-ink-700">
                <MapContainer
                  key={`branch-request-map-${showBranchRequestModal}`}
                  center={
                    branchRequestForm.lat != null && branchRequestForm.lng != null
                      ? [branchRequestForm.lat, branchRequestForm.lng]
                      : KKTC_MAP_CENTER
                  }
                  zoom={branchRequestForm.lat != null ? 14 : 9}
                  scrollWheelZoom
                  className="h-full w-full"
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <BranchMapClickHandler
                    disabled={branchRequestLoading}
                    onPick={handleBranchRequestMapPick}
                  />
                  {branchRequestForm.lat != null && branchRequestForm.lng != null ? (
                    <Marker position={[branchRequestForm.lat, branchRequestForm.lng]} />
                  ) : null}
                </MapContainer>
              </div>

              {branchRequestError ? (
                <div className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-700 dark:text-danger-200">
                  {branchRequestError}
                </div>
              ) : null}
              {branchRequestSuccess ? (
                <div className="rounded-lg border border-success-500/30 bg-success-500/10 px-3 py-2 text-xs text-success-700 dark:text-success-200">
                  {branchRequestSuccess}
                </div>
              ) : null}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeBranchRequestModal}
                  disabled={branchRequestLoading}
                  className="flex-1 rounded-lg border border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-medium text-ink-600 transition hover:border-ink-300 disabled:opacity-50 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleBranchRequestSubmitClick}
                  disabled={branchRequestLoading}
                  className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
                >
                  {t("send")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*
        Onay adımları alttan açılan Sheet'e taşındı: mobilde başparmakla
        erişilebilir mesafede duruyor ve yükseklik içeriğe göre uyarlanıyor.
        Odak tuzağı/Esc/scroll kilidi vaul tarafından yönetiliyor.
      */}
      <Sheet
        open={showBranchRequestConfirm}
        onOpenChange={(next) => { if (!next) setShowBranchRequestConfirm(false); }}
        title={canAddBranchDirectly ? t("addBranchDirectTitle") : t("newBranchRequestTitle")}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowBranchRequestConfirm(false)}
              disabled={branchRequestLoading}
              className="btn-ghost flex-1"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleBranchRequestConfirm}
              disabled={branchRequestLoading}
              className="btn-primary flex-1"
            >
              {branchRequestLoading
                ? t("sending")
                : canAddBranchDirectly
                  ? t("confirmAddBranchBtn")
                  : t("confirmRequestBtn")}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-600 dark:text-ink-300">
          {canAddBranchDirectly ? t("addBranchDirectConfirm") : t("newBranchRequestConfirm")}
        </p>
      </Sheet>

      <Sheet
        open={Boolean(renewConfirmBranch)}
        onOpenChange={(next) => {
          if (!next) {
            setRenewConfirmBranch(null);
            setRenewRequestError("");
          }
        }}
        title={t("renewBranchRequestBtn")}
        description={renewConfirmBranch?.name}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setRenewConfirmBranch(null);
                setRenewRequestError("");
              }}
              disabled={renewRequestLoadingId != null}
              className="btn-ghost flex-1"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleRenewBranchRequest}
              disabled={renewRequestLoadingId != null}
              className="btn btn-md flex-1 bg-warning-600 text-white hover:bg-warning-700"
            >
              {renewRequestLoadingId != null ? t("sending") : t("confirmRequestBtn")}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-600 dark:text-ink-300">
          {t("renewBranchRequestConfirm")}
        </p>
        {renewRequestError ? (
          <p className="mt-3 text-xs text-danger-700 dark:text-danger-300">{renewRequestError}</p>
        ) : null}
      </Sheet>

      <Sheet
        open={showSupportModal}
        onOpenChange={(next) => { if (!next) setShowSupportModal(false); }}
        title={t("supportTitle")}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowSupportModal(false)}
              className="btn-ghost flex-1"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleSupportSubmit}
              disabled={supportSubmitting}
              className="btn-primary flex-1"
            >
              {supportSubmitting ? t("supportSubmitting") : t("supportSubmit")}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <FloatingInput
            label={t("supportSubjectLabel")}
            value={supportSubject}
            onChange={(e) => setSupportSubject(e.target.value)}
            maxLength={200}
            placeholder={t("supportSubjectPlaceholder")}
          />
          <FloatingTextarea
            label={t("supportMessageLabel")}
            value={supportMessage}
            onChange={(e) => setSupportMessage(e.target.value)}
            rows={5}
            maxLength={5000}
            placeholder={t("supportMessagePlaceholder")}
          />
          {supportFeedback ? (
            <p
              className={`text-xs ${
                supportFeedback.type === "ok"
                  ? "text-success-700 dark:text-success-300"
                  : "text-danger-700 dark:text-danger-300"
              }`}
            >
              {supportFeedback.msg}
            </p>
          ) : null}
        </div>

        {supportTickets.length > 0 ? (
          <div className="mt-5 border-t border-ink-200 pt-4 dark:border-ink-800">
            <p className="mb-2 text-xs font-semibold text-ink-700 dark:text-ink-300">
              {t("supportMyTickets")}
            </p>
            <ul className="space-y-2">
              {supportTickets.map((tk) => (
                <li
                  key={tk.id}
                  className="rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink-900 dark:text-ink-100">{tk.subject}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        tk.status === "closed"
                          ? "bg-ink-500/10 text-ink-600 dark:text-ink-300"
                          : tk.status === "answered"
                            ? "bg-success-500/10 text-success-700 dark:text-success-300"
                            : "bg-warning-500/10 text-warning-700 dark:text-warning-300"
                      }`}
                    >
                      {tk.status === "closed"
                        ? t("supportStatusClosed")
                        : tk.status === "answered"
                          ? t("supportStatusAnswered")
                          : t("supportStatusOpen")}
                    </span>
                  </div>
                  {tk.admin_reply ? (
                    <p className="mt-1 text-ink-600 dark:text-ink-300">
                      <span className="font-semibold">{t("supportAdminReplyLabel")}: </span>
                      {tk.admin_reply}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Sheet>

      {showPasswordModal && (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && e.currentTarget.dataset.backdropDown === "1") {
              closePasswordModal();
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative w-full max-w-md overflow-hidden rounded-card border border-ink-200 bg-white p-6 shadow-2xl dark:border-ink-700 dark:bg-ink-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-raised flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={closePasswordModal}
                className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>

            <div className="mb-5 flex items-center gap-3 pt-10 sm:pt-0 sm:pr-[7.5rem]">
              <div className="rounded-lg bg-brand-500/10 p-2 text-brand-600 dark:text-brand-400">
                <Key className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-ink-800 dark:text-ink-100">
                {t("changePasswordTitle")}
              </h3>
            </div>

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <FloatingInput
                id="old-password"
                label={t("oldPassword")}
                icon={Key}
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
                disabled={passwordLoading}
              />

              <FloatingInput
                id="new-password"
                label={t("newPassword")}
                icon={Key}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={4}
                disabled={passwordLoading}
              />

              <FloatingInput
                id="confirm-password"
                label={t("confirmPassword")}
                icon={Key}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={4}
                disabled={passwordLoading}
              />

              {passwordError ? (
                <div className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-700 dark:text-danger-200">
                  {passwordError}
                </div>
              ) : null}

              {passwordSuccess ? (
                <div className="rounded-lg border border-success-500/30 bg-success-500/10 px-3 py-2 text-xs text-success-700 dark:text-success-200">
                  {passwordSuccess}
                </div>
              ) : null}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closePasswordModal}
                  disabled={passwordLoading}
                  className="flex-1 rounded-lg border border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-medium text-ink-600 transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:border-danger-500 hover:text-danger-500 disabled:opacity-50 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300 dark:hover:border-danger-500 dark:hover:text-danger-500"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="flex-1 rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:brightness-110 disabled:opacity-50 dark:from-brand-500 dark:to-brand-600"
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
}
