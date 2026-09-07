import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  AlertTriangle,
  Bell,
  HeartPulse,
  Building2,
  Check,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  LogOut,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { ActivityLogPanel } from "../components/ActivityLogPanel";
import { MarketHealthPanel } from "../components/MarketHealthPanel";
import { RateAlertPanel } from "../components/RateAlertPanel";
import {
  createAdminBusiness,
  fetchAdminBusinesses,
  updateAdminBusiness,
  updateAdminBusinessStatus,
  resetAdminBusinessSubscription,
  deleteAdminBusiness,
  fetchAdminAnalytics,
  fetchAdminSeo,
  updateAdminSeo,
  fetchAdminBranchRequests,
  fetchAdminBranchRequestsUnread,
  markAdminBranchRequestsRead,
  updateAdminBranchRequest,
  fetchAdminBranches,
  updateAdminBranch,
  fetchAdminSystemHealth,
  fetchAdminPayments,
  createAdminPayment,
  backfillAdminPayments,
  fetchAdminDiscountCodes,
  createAdminDiscountCode,
  toggleAdminDiscountCode,
  deleteAdminDiscountCode,
  fetchAdminLeads,
  updateAdminLead,
  fetchAdminDemand,
  fetchAdminPaymentProofs,
  fetchAdminPaymentProof,
  approveAdminPaymentProof,
  rejectAdminPaymentProof,
  fetchAdminPlans,
  fetchAdminExpiring,
  fetchAdminPartnershipApplications,
  fetchAdminNotifications,
  markAdminNotificationsRead,
  fetchAdminSupportTickets,
  updateAdminSupportTicket,
  fetchAdminOpsOverview,
  fetchAdminSignupRequests,
  approveSignupRequest,
  rejectSignupRequest,
} from "../lib/auth";
import { BusinessBranchesPanel } from "../components/DealerManagement";
import { BusinessLogoField } from "../components/BusinessLogoField";
import { FloatingInput, FloatingTextarea } from "../components/ui/floating-label";
import { HeaderActions } from "../components/HeaderActions";
import { SearchableSelect } from "../components/SearchableSelect";


/** Aylık 500 ₺ · Yıllık 5000 ₺ · Test ücretsiz · Manuel elle girilir */
const STATUS_TONE_PROOF = {
  pending: "text-warning-700 dark:text-warning-400",
  approved: "text-success-700 dark:text-success-400",
  rejected: "text-danger-700 dark:text-danger-400",
};

function defaultSubscriptionPrice(subscriptionType) {
  if (subscriptionType === "Aylık") return 500;
  if (subscriptionType === "Yıllık") return 5000;
  if (subscriptionType === "Test") return 0;
  return 0;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatLedgerDateTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return { date: "—", time: "—", label: "—" };
  const date = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return { date, time, label: `${time} ${date}` };
}

function formatMoneyTry(amount, lang = "tr") {
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString(lang === "en" ? "en-US" : "tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return n > 0 ? `₺${formatted}` : "—";
}

function inDateRange(iso, from, to) {
  if (!from && !to) return true;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return true;
  if (from) {
    const fromTs = new Date(`${from}T00:00:00`).getTime();
    if (Number.isFinite(fromTs) && t < fromTs) return false;
  }
  if (to) {
    const toTs = new Date(`${to}T23:59:59`).getTime();
    if (Number.isFinite(toTs) && t > toTs) return false;
  }
  return true;
}

const emptyCreateForm = {
  institution_name: "",
  contact_person: "",
  username: "",
  email: "",
  password: "",
  branchLimit: "1",
  logo_url: null,
};

const emptyEditForm = {
  id: null,
  institution_name: "",
  contact_person: "",
  username: "",
  email: "",
  password: "",
  subscriptionType: "Test",
  manualDays: "0",
  price: "0",
  branchLimit: "1",
  currentRemainingDays: null,
  logo_url: null,
};

function parseSubscriptionType(biz) {
  const t = String(biz?.subscription_type || biz?.subscription || "Test");
  if (t === "Aylık" || t === "Yıllık" || t === "Manuel" || t === "Test") return t;
  if (t === "Abonelik" || /yıllık/i.test(String(biz?.subscription || ""))) return "Yıllık";
  if (/aylık/i.test(String(biz?.subscription || ""))) return "Aylık";
  return "Test";
}

function calculateNewDays(subscriptionType, currentRemainingDays, manualDays) {
  // Test = sınırsız abonelik
  if (subscriptionType === "Test") return null;
  const current = Math.max(0, Number(currentRemainingDays) || 0);
  if (subscriptionType === "Aylık") return current + 30;
  if (subscriptionType === "Yıllık") return current + 365;
  if (subscriptionType === "Manuel") {
    const customDays = parseInt(manualDays, 10) || 0;
    return Math.max(0, current + customDays);
  }
  return current;
}

function formatRemaining(days, t, subscriptionType) {
  if (subscriptionType === "Test") return t("unlimitedSubscription");
  if (days == null) return "—";
  if (days <= 0) return t("subscriptionExpired");
  return `${days} ${t("daysUnit")} ${t("daysRemainingSuffix")}`;
}

/** Şube doluluk: eksik sarı, tam yeşil, fazla kırmızı */
/**
 * A-03: Kalan abonelik günü. 7 günün altı uyarı, biten kırmızı — yönetici
 * tabloya bakınca kimin yenilemesi gerektiğini anında görsün.
 */
function RemainingBadge({ days }) {
  if (days == null) {
    return <span className="text-ink-500 dark:text-ink-400">süresiz</span>;
  }
  const n = Number(days);
  if (!Number.isFinite(n)) return <span className="text-ink-500">—</span>;
  if (n <= 0) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-danger-700 dark:text-danger-400">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        doldu
      </span>
    );
  }
  if (n <= 7) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-warning-700 dark:text-warning-400">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        {n} gün
      </span>
    );
  }
  return <span className="text-ink-700 dark:text-ink-200">{n} gün</span>;
}

function BranchQuotaBadge({ used, limit }) {
  const u = Number(used) || 0;
  const lim = Math.max(1, Number(limit) || 1);
  const label = `${u}/${lim}`;
  if (u > lim) {
    // U-12: limit sonradan düşürülünce mevcut şubeler kalıyor; sadece "2/1"
    // yazmak yerine durumun ne anlama geldiğini açıkça söyle.
    const msg = `Şube limiti aşıldı: ${u} şube var, limit ${lim}`;
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger-700 dark:text-danger-400"
        title={msg}
        aria-label={msg}
      >
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (u < lim) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning-600 dark:text-warning-400"
        title="Eksik şube"
      >
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-700 dark:text-success-400"
      title="Şube limiti dolu"
    >
      <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

function parseDateLoose(iso) {
  if (!iso) return null;
  const raw = String(iso).trim();
  if (!raw) return null;
  // YYYY-MM-DD or YYYY-MM-DD HH:MM:SS → UTC olarak oku
  if (/^\d{4}-\d{2}-\d{2}( |T)/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw.replace(" ", "T") + "Z");
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** P1.5 — operatör bildirim çanı (InstitutionAdminPage çanının eşdeğeri). */
function AdminNotificationBell({ token }) {
  const { t, lang } = useLanguage();
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await fetchAdminNotifications(token);
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnread(Number(data.unread) || 0);
    } catch (err) {
      console.warn("[NOTIF] Operatör bildirimleri yüklenemedi:", err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await load();
  };

  const markAll = async () => {
    try {
      const data = await markAdminNotificationsRead(token);
      setUnread(Number(data.unread) || 0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.warn("[NOTIF] Okundu işaretlenemedi:", err.message);
    }
  };

  const fmtDate = (iso) => {
    const d = parseDateLoose(iso);
    if (!d) return "—";
    return d.toLocaleString(lang === "en" ? "en-GB" : "tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={toggle}
        className="relative inline-flex size-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300 dark:hover:border-brand-400 dark:hover:text-brand-300"
        aria-label={t("notificationsTitle")}
        title={t("notificationsTitle")}
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-dropdown mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900">
          <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-3 py-2.5 dark:border-ink-800">
            <p className="text-sm font-semibold text-ink-900 dark:text-white">
              {t("notificationsTitle")}
            </p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAll}
                className="text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                {t("notificationsMarkAllRead")}
              </button>
            ) : null}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loading && notifications.length === 0 ? (
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
                    <p className="mt-0.5 text-xs text-ink-600 dark:text-ink-300">{n.message}</p>
                    <p className="mt-1 text-[10px] text-ink-600 dark:text-ink-400">
                      {fmtDate(n.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SubscriptionFields({ form, setForm }) {
  const { t } = useLanguage();
  const subscriptionOptions = [
    { value: "Test", label: t("subTypeTest") },
    { value: "Aylık", label: t("subTypeMonthly") },
    { value: "Yıllık", label: t("subTypeYearly") },
    { value: "Manuel", label: t("subTypeManual") },
  ];
  return (
    <>
      <div className="flex flex-col gap-2">
        <SearchableSelect
          label={t("subscriptionTypeLabel")}
          value={form.subscriptionType}
          onChange={(subscriptionType) =>
            setForm((prev) => ({
              ...prev,
              subscriptionType,
              price:
                subscriptionType === "Manuel"
                  ? prev.price
                  : String(defaultSubscriptionPrice(subscriptionType)),
            }))
          }
          options={subscriptionOptions}
          placeholder={t("subscriptionTypeLabel")}
        />
      </div>

      {form.subscriptionType === "Manuel" && (
        <>
          <FloatingInput
            className="mt-1"
            label={t("customDaysLabel")}
            type="number"
            value={form.manualDays}
            onChange={(e) => setForm((prev) => ({ ...prev, manualDays: e.target.value }))}
            placeholder={t("customDaysPlaceholder")}
          />
          <FloatingInput
            className="mt-1"
            label={t("customPriceLabel")}
            type="number"
            min="0"
            value={form.price}
            onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
            placeholder={t("customPricePlaceholder")}
          />
        </>
      )}
    </>
  );
}

function SubscriptionPreview({ currentDays, newDays, price, lang, t }) {
  const currentLabel =
    currentDays == null ? t("unlimitedSubscription") : `${currentDays} ${t("daysUnit")}`;
  const afterLabel =
    newDays == null ? t("unlimitedSubscription") : `${newDays} ${t("daysUnit")}`;
  return (
    <div className="mt-2 flex w-fit flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3 dark:border-ink-800 dark:bg-ink-900/50">
      <div className="flex flex-col items-center">
        <span className="mb-1 text-[10px] text-ink-500 dark:text-ink-400">{t("currentRemainingLabel")}</span>
        <span className="text-sm font-semibold text-ink-700 dark:text-ink-300">{currentLabel}</span>
      </div>
      <ArrowRight className="text-ink-600 dark:text-ink-400" size={16} />
      <div className="flex flex-col items-center">
        <span className="mb-1 text-[10px] text-success-700 dark:text-success-400/80 dark:text-success-500/70">{t("afterUpdateLabel")}</span>
        <span className="text-sm font-bold text-success-700 dark:text-success-400">{afterLabel}</span>
      </div>
      <div className="ml-1 flex flex-col items-center border-l border-ink-200 pl-3 dark:border-ink-700">
        <span className="mb-1 text-[10px] text-brand-600/80 dark:text-brand-400/70">{t("subscriptionPriceLabel")}</span>
        <span className="text-sm font-bold tabular-nums text-brand-700 dark:text-brand-300">
          {formatMoneyTry(price, lang)}
        </span>
      </div>
    </div>
  );
}

function SubscriptionLedgerButton({ active, onClick }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong sm:text-sm ${
        active
          ? "border-brand-500/40 bg-brand-500/20 text-brand-700 shadow-[0_0_12px_rgba(47,123,149,0.35)] dark:text-brand-300"
          : "border-ink-200 bg-white text-ink-600 hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-brand-400 dark:hover:text-brand-400"
      }`}
      title={t("subscriptionLedgerTitle")}
    >
      <CreditCard size={16} />
      <span className="hidden sm:inline">{t("subscriptionLedgerShort")}</span>
    </button>
  );
}

function DateRangeFilter({ from, to, onFromChange, onToChange, t }) {
  return (
    <div className="flex items-center gap-1.5" title={t("dateRangeLabel")}>
      <FloatingInput
        label={t("dateFromLabel")}
        size="sm"
        className="min-w-0 flex-1"
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => onFromChange(e.target.value)}
      />
      <span className="text-ink-500">–</span>
      <FloatingInput
        label={t("dateToLabel")}
        size="sm"
        className="min-w-0 flex-1"
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => onToChange(e.target.value)}
      />
    </div>
  );
}

function subscriptionTypeLabel(value, t) {
  if (value === "Aylık") return t("subTypeMonthly");
  if (value === "Yıllık") return t("subTypeYearly");
  if (value === "Manuel") return t("subTypeManual");
  if (value === "Test") return t("subTypeTest");
  return value || t("subTypeTest");
}

export function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { token, isAuthenticated, isSuperAdmin, bootstrapping, logout, auth } = useAuth();
  const { lang, t } = useLanguage();
  const [tab, setTab] = useState("list");
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successModalMessage, setSuccessModalMessage] = useState(
    "Değişiklikler başarıyla uygulandı."
  );
  const [businessToDelete, setBusinessToDelete] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editPanelTab, setEditPanelTab] = useState("edit"); // "edit" | "business" | "subscription"
  const [showLogModal, setShowLogModal] = useState(false);
  const [showSeoModal, setShowSeoModal] = useState(false);
  const [seoForm, setSeoForm] = useState(null);
  const [seoLoading, setSeoLoading] = useState(false);
  const [seoSaving, setSeoSaving] = useState(false);
  const [seoError, setSeoError] = useState("");
  const [seoSuccess, setSeoSuccess] = useState("");
  const [ledgerView, setLedgerView] = useState(null); // null | "subscription"
  const [ledgerScopeBusiness, setLedgerScopeBusiness] = useState(null); // null = tümü, string = işletme adı
  const [analyticsData, setAnalyticsData] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [healthData, setHealthData] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [filterBusiness, setFilterBusiness] = useState("");
  const [filterCurrency, setFilterCurrency] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [logsView, setLogsView] = useState("customer"); // "customer" | "business"
  const [logDateFrom, setLogDateFrom] = useState("");
  const [logDateTo, setLogDateTo] = useState("");
  const [bizLogBusiness, setBizLogBusiness] = useState("");
  const [bizLogActionType, setBizLogActionType] = useState("");
  const [branchRequests, setBranchRequests] = useState([]);
  const [branchRequestsLoading, setBranchRequestsLoading] = useState(false);
  const [branchRequestsError, setBranchRequestsError] = useState("");
  /* Faz 1: gelir görünürlüğü */
  const [payments, setPayments] = useState([]);
  const [revenue, setRevenue] = useState(null);
  const [revAnalytics, setRevAnalytics] = useState(null);
  const [discountCodes, setDiscountCodes] = useState([]);
  const [discountForm, setDiscountForm] = useState({
    code: "",
    tur: "percent",
    deger: "",
    max_kullanim: "",
    gecerlilik_bitis: "",
  });
  const [discountBusy, setDiscountBusy] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [plans, setPlans] = useState([]);
  const [partnershipApps, setPartnershipApps] = useState([]);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState("");
  /* R-01: tahsilat kaydı formu — handleCreatePayment tanımlıydı ama onu
     çağıran hiçbir arayüz yoktu, yani ödeme girme yolu kapalıydı. */
  const [payForm, setPayForm] = useState({
    institution_id: "",
    plan_code: "",
    tutar: "",
    kdv: "",
    yontem: "",
    discount_code: "",
  });
  const [paySaving, setPaySaving] = useState(false);
  const [paySaved, setPaySaved] = useState(false);
  const [branchRequestUnread, setBranchRequestUnread] = useState(0);
  const [branchRequestActingId, setBranchRequestActingId] = useState(null);
  const [showBranchSubModal, setShowBranchSubModal] = useState(false);
  const [branchSubBusiness, setBranchSubBusiness] = useState(null);
  const [branchSubList, setBranchSubList] = useState([]);
  const [branchSubLoading, setBranchSubLoading] = useState(false);
  const [branchSubError, setBranchSubError] = useState("");
  const [branchSubSelectedId, setBranchSubSelectedId] = useState("");
  const [branchSubForm, setBranchSubForm] = useState({
    subscriptionType: "Aylık",
    manualDays: "0",
    price: "500",
    currentRemainingDays: 0,
  });
  const [branchSubSaving, setBranchSubSaving] = useState(false);
  // P1.7 — destek talepleri
  const [supportTickets, setSupportTickets] = useState([]);
  const [supportOpen, setSupportOpen] = useState(0);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportActingId, setSupportActingId] = useState(null);
  const [supportReplyDraft, setSupportReplyDraft] = useState({});

  const TABS = useMemo(
    () => [
      { id: "list", label: t("tabList") },
      { id: "create", label: t("tabCreate") },
      { id: "requests", label: t("tabRequests") },
      { id: "signups", label: t("tabSignups") },
      { id: "leads", label: t("tabLeads") },
      { id: "proofs", label: t("tabProofs") },
      /*
        ⚠️ HATA DÜZELTMESİ (R-01): `revenue`, `expiring`, `plans` ve
        `partnershipApps` her panel açılışında `loadRevenue` ile çekiliyor ama
        HİÇBİRİ ekrana çizilmiyordu — dört istekten üçü tamamen boşa gidiyor,
        dört özellik de arayüzden düşmüş durumdaydı. En ağırı ortaklık
        başvuruları: ana sayfadaki form hâlâ /api/partnership-apply'a
        gönderiyor, yani başvurular veritabanına düşüp görünmez oluyordu.
      */
      { id: "revenue", label: t("tabRevenue") },
      { id: "support", label: t("supportAdminTab") },
      { id: "health", label: t("tabHealth") },
      { id: "logs", label: t("logsTitle") },
    ],
    [t]
  );

  useEffect(() => {
    if (tab === "edit") setTab("list");
  }, [tab]);

  useEffect(() => {
    if (bootstrapping) return;
    if (!isAuthenticated) {
      navigate("/", { replace: true });
      return;
    }
    if (!isSuperAdmin) {
      navigate("/admin", { replace: true });
    }
  }, [bootstrapping, isAuthenticated, isSuperAdmin, navigate]);

  useEffect(() => {
    if (!showLogModal || !token) return;
    let cancelled = false;
    setFilterBusiness("");
    setFilterCurrency("");
    setFilterAction("");
    setLogsView("customer");
    setLogDateFrom("");
    setLogDateTo("");
    setBizLogBusiness("");
    setBizLogActionType("");
    (async () => {
      setStatsLoading(true);
      setStatsError("");
      try {
        const data = await fetchAdminAnalytics(token, 50);
        if (!cancelled) setAnalyticsData(data);
      } catch (err) {
        if (!cancelled) {
          setStatsError(err.message || t("statsLoadFailedMsg"));
          setAnalyticsData(null);
        }
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showLogModal, token]);

  const [opsData, setOpsData] = useState(null);

  const loadSystemHealth = useCallback(async () => {
    if (!token) return;
    setHealthLoading(true);
    setHealthError("");
    fetchAdminOpsOverview(token)
      .then(setOpsData)
      .catch(() => setOpsData(null));
    try {
      const data = await fetchAdminSystemHealth(token);
      setHealthData(data);
      setAuditLogs(Array.isArray(data?.audit) ? data.audit : []);
    } catch (err) {
      setHealthError(err.message || t("healthDriftUnavailable"));
      setHealthData(null);
    } finally {
      setHealthLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    if (tab !== "health" || !token) return undefined;
    loadSystemHealth();
    return undefined;
  }, [tab, token, loadSystemHealth]);

  const loadSupportTickets = useCallback(async () => {
    if (!token) return;
    setSupportLoading(true);
    try {
      const { tickets, open } = await fetchAdminSupportTickets(token);
      setSupportTickets(Array.isArray(tickets) ? tickets : []);
      setSupportOpen(Number(open) || 0);
    } catch (err) {
      console.warn("[SUPPORT] Talepler yüklenemedi:", err.message);
    } finally {
      setSupportLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (tab !== "support" || !token) return undefined;
    loadSupportTickets();
    return undefined;
  }, [tab, token, loadSupportTickets]);

  const handleSupportUpdate = async (id, payload) => {
    if (!token) return;
    setSupportActingId(id);
    try {
      await updateAdminSupportTicket(token, id, payload);
      setSupportReplyDraft((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await loadSupportTickets();
    } catch (err) {
      setError(err.message || "Talep güncellenemedi.");
    } finally {
      setSupportActingId(null);
    }
  };

  const loadBranchRequestUnread = useCallback(async () => {
    if (!token) return;
    try {
      const unread = await fetchAdminBranchRequestsUnread(token);
      setBranchRequestUnread(unread);
    } catch {
      // sessiz
    }
  }, [token]);

  /** Faz 1: tahsilat, gelir özeti, vade takvimi, paketler, başvurular. */
  const loadRevenue = useCallback(async () => {
    if (!token) return;
    setPayLoading(true);
    setPayError("");
    try {
      const [pay, exp, pl, apps, disc] = await Promise.all([
        fetchAdminPayments(token),
        fetchAdminExpiring(token, 30),
        fetchAdminPlans(token),
        fetchAdminPartnershipApplications(token),
        fetchAdminDiscountCodes(token).catch(() => ({ codes: [] })),
      ]);
      setPayments(pay.payments || []);
      setRevenue(pay.summary || null);
      setRevAnalytics(pay.analytics || null);
      setExpiring(exp.expiring || []);
      setPlans(pl.plans || []);
      setPartnershipApps(apps.applications || []);
      setDiscountCodes(disc.codes || []);
    } catch (err) {
      setPayError(err.message || "Tahsilat verisi alınamadı.");
    } finally {
      setPayLoading(false);
    }
  }, [token]);

  const handleBackfillPayments = useCallback(async () => {
    if (!token) return;
    try {
      await backfillAdminPayments(token);
      await loadRevenue();
    } catch (err) {
      setPayError(err.message || "Geriye dönük üretim başarısız.");
    }
  }, [token, loadRevenue]);

  const handleCreatePayment = useCallback(
    async (payload) => {
      if (!token) return;
      await createAdminPayment(token, payload);
      await loadRevenue();
    },
    [token, loadRevenue]
  );

  /** P3.3 — indirim kodu oluştur. */
  const handleCreateDiscount = useCallback(
    async (e) => {
      e.preventDefault();
      if (!token || !discountForm.code || !discountForm.deger) return;
      setDiscountBusy(true);
      setPayError("");
      try {
        await createAdminDiscountCode(token, {
          code: discountForm.code,
          tur: discountForm.tur,
          deger: Number(discountForm.deger),
          max_kullanim: discountForm.max_kullanim === "" ? 0 : Number(discountForm.max_kullanim),
          gecerlilik_bitis: discountForm.gecerlilik_bitis || undefined,
        });
        setDiscountForm({ code: "", tur: "percent", deger: "", max_kullanim: "", gecerlilik_bitis: "" });
        await loadRevenue();
      } catch (err) {
        setPayError(err.message || "İndirim kodu oluşturulamadı.");
      } finally {
        setDiscountBusy(false);
      }
    },
    [token, discountForm, loadRevenue]
  );

  const handleToggleDiscount = useCallback(
    async (code, aktif) => {
      if (!token) return;
      try {
        await toggleAdminDiscountCode(token, code, aktif);
        await loadRevenue();
      } catch (err) {
        setPayError(err.message || "İndirim kodu güncellenemedi.");
      }
    },
    [token, loadRevenue]
  );

  const handleDeleteDiscount = useCallback(
    async (code) => {
      if (!token) return;
      try {
        await deleteAdminDiscountCode(token, code);
        await loadRevenue();
      } catch (err) {
        setPayError(err.message || "İndirim kodu silinemedi.");
      }
    },
    [token, loadRevenue]
  );

  /** P3.3 — muhasebe CSV (istemci tarafı; payments zaten yüklü). */
  const handleExportPaymentsCsv = useCallback(() => {
    const cols = [
      "odeme_tarihi",
      "institution_name",
      "institution_id",
      "plan_adi",
      "plan_code",
      "tutar",
      "kdv",
      "toplam",
      "para_birimi",
      "yontem",
      "durum",
      "donem_baslangic",
      "donem_bitis",
      "fatura_no",
      "indirim_kodu",
      "indirim_tutari",
      "aciklama",
    ];
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = payments.map((p) =>
      cols
        .map((c) => {
          if (c === "toplam") return esc((Number(p.tutar) || 0) + (Number(p.kdv) || 0));
          if (c === "odeme_tarihi") return esc(String(p.odeme_tarihi || "").slice(0, 10));
          return esc(p[c]);
        })
        .join(";")
    );
    const csv = "﻿" + [cols.join(";"), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adadoviz-tahsilat-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [payments]);

  /** P3.3 — tek tahsilat için yazdırılabilir makbuz (yeni sekmede). */
  const openReceipt = useCallback(
    (p) => {
      const fmt = (n) => `${Number(n || 0).toLocaleString("tr-TR")} ₺`;
      const gross = (Number(p.tutar) || 0) + (Number(p.indirim_tutari) || 0);
      const rows = [
        [t("revBusiness"), p.institution_name || p.institution_id],
        [t("revPlan"), p.plan_adi || p.plan_code],
        [t("revMethod"), p.yontem || "—"],
        ["Dönem", `${p.donem_baslangic} → ${p.donem_bitis}`],
        [t("revAmount"), fmt(gross)],
      ];
      if (Number(p.indirim_tutari) > 0) {
        rows.push([`${t("revDiscountApplied")} (${p.indirim_kodu})`, `- ${fmt(p.indirim_tutari)}`]);
      }
      rows.push([t("revVat"), fmt(p.kdv)]);
      rows.push([t("revNet"), fmt((Number(p.tutar) || 0) + (Number(p.kdv) || 0))]);
      const body = rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 12px;color:#55555f">${k}</td><td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums">${v}</td></tr>`
        )
        .join("");
      const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Makbuz #${p.id}</title>
<style>body{font:14px/1.5 system-ui,-apple-system,sans-serif;color:#08080a;margin:0;padding:32px;background:#fff}
.wrap{max-width:520px;margin:0 auto;border:1px solid #e5e5ea;border-radius:12px;overflow:hidden}
.hd{background:#08080a;color:#fff;padding:20px 24px;font-weight:700;font-size:16px}
table{width:100%;border-collapse:collapse}
tr:not(:last-child) td{border-bottom:1px solid #f0f0f2}
.meta{padding:12px 24px;color:#8a8a94;font-size:12px}
.pr{margin:24px auto 0;display:block;padding:10px 16px;border:0;border-radius:8px;background:#55555f;color:#fff;font-size:14px;cursor:pointer}
@media print{.pr{display:none}.wrap{border:0}}</style></head>
<body><div class="wrap"><div class="hd">AdaDöviz — Tahsilat Makbuzu #${p.id}</div>
<div class="meta">${String(p.odeme_tarihi || "").slice(0, 10)}${p.fatura_no ? ` · Fatura: ${p.fatura_no}` : ""}</div>
<table><tbody>${body}</tbody></table></div>
<button class="pr" onclick="window.print()">Yazdır / PDF kaydet</button></body></html>`;
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    },
    [t]
  );

  // P3.1 — self-signup başvuru kuyruğu
  const [signupRequests, setSignupRequests] = useState([]);
  const [signupPending, setSignupPending] = useState(0);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [signupActingId, setSignupActingId] = useState(null);
  const [signupForm, setSignupForm] = useState({});

  const loadSignupRequests = useCallback(async () => {
    if (!token) return;
    setSignupLoading(true);
    setSignupError("");
    try {
      const data = await fetchAdminSignupRequests(token);
      setSignupRequests(data.requests || []);
      setSignupPending(Number(data.pending) || 0);
    } catch (err) {
      setSignupError(err.message || t("statsLoadFailedMsg"));
    } finally {
      setSignupLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    if (tab !== "signups" || !token) return undefined;
    let alive = true;
    (async () => {
      try {
        const data = await fetchAdminSignupRequests(token);
        if (!alive) return;
        setSignupRequests(data.requests || []);
        setSignupPending(Number(data.pending) || 0);
        setSignupError("");
      } catch (err) {
        if (alive) setSignupError(err.message || t("statsLoadFailedMsg"));
      } finally {
        if (alive) setSignupLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, token, t]);

  const handleSignupApprove = async (id) => {
    if (!token) return;
    setSignupActingId(id);
    setError("");
    try {
      const cfg = signupForm[id] || {};
      await approveSignupRequest(token, id, {
        subscription_type: cfg.subscription_type || "Test",
        branch_limit: cfg.branch_limit ? Number(cfg.branch_limit) : undefined,
      });
      setSuccess(t("signupAdminApproved"));
      await loadSignupRequests();
    } catch (err) {
      setError(err.message || t("signupAdminActionFailed"));
    } finally {
      setSignupActingId(null);
    }
  };

  const handleSignupReject = async (id) => {
    if (!token) return;
    const reason = window.prompt(t("signupAdminRejectPrompt")) ?? null;
    if (reason === null) return;
    setSignupActingId(id);
    setError("");
    try {
      await rejectSignupRequest(token, id, reason);
      setSuccess(t("signupAdminRejected"));
      await loadSignupRequests();
    } catch (err) {
      setError(err.message || t("signupAdminActionFailed"));
    } finally {
      setSignupActingId(null);
    }
  };

  // P3.4 — Lead CRM + talep analitiği
  const [leads, setLeads] = useState([]);
  const [leadStats, setLeadStats] = useState(null);
  const [demand, setDemand] = useState(null);
  const [leadFilter, setLeadFilter] = useState("");
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadError, setLeadError] = useState("");
  const [leadActing, setLeadActing] = useState("");
  const [leadDrafts, setLeadDrafts] = useState({});

  const loadLeads = useCallback(async () => {
    if (!token) return;
    setLeadLoading(true);
    setLeadError("");
    try {
      const [ld, dm] = await Promise.all([
        fetchAdminLeads(token, leadFilter || undefined),
        fetchAdminDemand(token, 30),
      ]);
      setLeads(ld.leads || []);
      setLeadStats(ld.stats || null);
      setDemand(dm || null);
    } catch (err) {
      setLeadError(err.message || t("statsLoadFailedMsg"));
    } finally {
      setLeadLoading(false);
    }
  }, [token, leadFilter, t]);

  useEffect(() => {
    if (tab !== "leads" || !token) return;
    loadLeads();
  }, [tab, token, loadLeads]);

  const handleUpdateLead = useCallback(
    async (lead, patch) => {
      if (!token) return;
      setLeadActing(lead.lead_key);
      setLeadError("");
      try {
        await updateAdminLead(token, lead.source, lead.source_id, patch);
        await loadLeads();
      } catch (err) {
        setLeadError(err.message || t("signupAdminActionFailed"));
      } finally {
        setLeadActing("");
      }
    },
    [token, loadLeads, t]
  );

  // P3.6 — ödeme dekontları
  const [proofs, setProofs] = useState([]);
  const [proofsPending, setProofsPending] = useState(0);
  const [proofFilter, setProofFilter] = useState("pending");
  const [proofLoading, setProofLoading] = useState(false);
  const [proofError, setProofError] = useState("");
  const [proofActing, setProofActing] = useState(null);
  const [proofImage, setProofImage] = useState(null); // { id, proof_image, institution_name }

  const loadProofs = useCallback(async () => {
    if (!token) return;
    setProofLoading(true);
    setProofError("");
    try {
      const data = await fetchAdminPaymentProofs(token, proofFilter || undefined);
      setProofs(data.proofs || []);
      setProofsPending(Number(data.pending) || 0);
    } catch (err) {
      setProofError(err.message || t("statsLoadFailedMsg"));
    } finally {
      setProofLoading(false);
    }
  }, [token, proofFilter, t]);

  useEffect(() => {
    if (tab !== "proofs" || !token) return;
    loadProofs();
  }, [tab, token, loadProofs]);

  const handleViewProof = useCallback(
    async (id) => {
      if (!token) return;
      try {
        const data = await fetchAdminPaymentProof(token, id);
        setProofImage(data.proof || null);
      } catch (err) {
        setProofError(err.message || t("statsLoadFailedMsg"));
      }
    },
    [token, t]
  );

  const handleApproveProof = useCallback(
    async (id) => {
      if (!token) return;
      setProofActing(id);
      setProofError("");
      try {
        await approveAdminPaymentProof(token, id);
        setProofImage(null);
        await loadProofs();
      } catch (err) {
        setProofError(err.message || t("signupAdminActionFailed"));
      } finally {
        setProofActing(null);
      }
    },
    [token, loadProofs, t]
  );

  const handleRejectProof = useCallback(
    async (id) => {
      if (!token) return;
      const reason = window.prompt(t("proofRejectPrompt")) ?? null;
      if (reason === null) return;
      setProofActing(id);
      setProofError("");
      try {
        await rejectAdminPaymentProof(token, id, reason);
        setProofImage(null);
        await loadProofs();
      } catch (err) {
        setProofError(err.message || t("signupAdminActionFailed"));
      } finally {
        setProofActing(null);
      }
    },
    [token, loadProofs, t]
  );

  const loadBranchRequests = useCallback(async () => {
    if (!token) return;
    setBranchRequestsLoading(true);
    setBranchRequestsError("");
    try {
      const data = await fetchAdminBranchRequests(token);
      setBranchRequests(data.requests || []);
      setBranchRequestUnread(Number(data.unread) || 0);
    } catch (err) {
      setBranchRequestsError(err.message || t("statsLoadFailedMsg"));
    } finally {
      setBranchRequestsLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    if (bootstrapping || !token || !isSuperAdmin) return;
    loadBranchRequestUnread();
    const timer = setInterval(loadBranchRequestUnread, 30000);
    return () => clearInterval(timer);
  }, [bootstrapping, token, isSuperAdmin, loadBranchRequestUnread]);

  useEffect(() => {
    if (tab !== "requests" || !token) return;
    (async () => {
      await loadBranchRequests();
      try {
        const result = await markAdminBranchRequestsRead(token);
        setBranchRequestUnread(Number(result?.unread) || 0);
      } catch {
        // ignore
      }
    })();
  }, [tab, token, loadBranchRequests]);

  const handleBranchRequestAction = async (id, status) => {
    if (!token) return;
    setBranchRequestActingId(id);
    setError("");
    try {
      await updateAdminBranchRequest(token, id, { status });
      setSuccess(
        status === "approved"
          ? t("requestStatusApproved")
          : t("requestStatusRejected")
      );
      await loadBranchRequests();
      await loadBranchRequestUnread();
    } catch (err) {
      setError(err.message || "Talep güncellenemedi.");
    } finally {
      setBranchRequestActingId(null);
    }
  };

  function formatRelativeTime(iso) {
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return "—";
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return t("justNow");
    if (mins < 60) return `${mins} ${t("minutesAgoSuffix")}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ${t("hoursAgoSuffix")}`;
    const days = Math.floor(hours / 24);
    return `${days} ${t("daysAgoSuffix")}`;
  }

  function formatRegistrationDate(iso) {
    const d = parseDateLoose(iso);
    if (!d) {
      const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return "—";
      return `${m[3]}.${m[2]}.${m[1]}`;
    }
    const locale = lang === "en" ? "en-GB" : "tr-TR";
    return d.toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function formatRequestDateTime(iso) {
    if (!iso) return "—";
    const raw = String(iso).trim();
    const d = new Date(
      raw.includes("T") || raw.includes("Z") ? raw : raw.replace(" ", "T") + "Z"
    );
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
  }

  /*
    ⚠️ OPTİMİZASYON (O-03): aynı sorun — `analyticsData?.sessions || []` her
    render'da yeni dizi üretiyor ve buna bağlı ÜÇ `useMemo` (satır 806, 816,
    837) hiç memoize etmiyordu.
  */
  const logData = useMemo(() => analyticsData?.sessions || [], [analyticsData]);

  /**
   * ⚠️ ÜRÜN HARİTASI A-02: Bu iki dizi SABİT BOŞ idi — "Abonelik Dökümü" ve
   * "Loglar" ekranları eksiksiz yazılmış (filtre, tarih aralığı, para
   * biçimlendirme) ama kalıcı olarak "Bu dökümde henüz kayıt yok." diyordu.
   * Artık gerçek tahsilat kayıtlarından besleniyorlar.
   */
  const businessLedger = useMemo(
    () =>
      auditLogs.map((a) => ({
        timestamp: a.created_at,
        businessName: a.institution_name || a.institution_id || "—",
        actionType: a.action,
        detail: a.detail,
        actor: a.actor,
      })),
    [auditLogs]
  );

  const subscriptionLedger = useMemo(
    () =>
      payments.map((p) => ({
        id: p.id,
        timestamp: p.odeme_tarihi,
        businessName: p.institution_name || p.institution_id,
        planName: p.plan_adi || p.plan_code,
        amount: Number(p.tutar) + Number(p.kdv || 0),
        method: p.yontem,
        status: p.durum,
        periodStart: p.donem_baslangic,
        periodEnd: p.donem_bitis,
        note: p.aciklama,
      })),
    [payments]
  );

  const ledgerBusinessOptions = useMemo(() => {
    const fromList = businesses.map((b) => b.institution_name).filter(Boolean);
    const fromLedger = subscriptionLedger.map((r) => r.businessName).filter(Boolean);
    return Array.from(new Set([...fromList, ...fromLedger])).sort((a, b) =>
      a.localeCompare(b, "tr")
    );
  }, [businesses, subscriptionLedger]);

  const visibleSubscriptionLedger = useMemo(() => {
    if (!ledgerScopeBusiness) return subscriptionLedger;
    return subscriptionLedger.filter((row) => row.businessName === ledgerScopeBusiness);
  }, [subscriptionLedger, ledgerScopeBusiness]);

  const editBusinessLedger = useMemo(() => {
    const name = editForm.institution_name;
    if (!name) return [];
    return businessLedger.filter((row) => row.businessName === name);
  }, [businessLedger, editForm.institution_name]);


  const openSubscriptionLedger = (scopeBusiness = null) => {
    if (ledgerView === "subscription" && !scopeBusiness && !ledgerScopeBusiness) {
      setLedgerView(null);
      setLedgerScopeBusiness(null);
      return;
    }
    setLedgerScopeBusiness(scopeBusiness);
    setLedgerView("subscription");
  };

  const closeSubscriptionLedger = () => {
    setLedgerView(null);
    setLedgerScopeBusiness(null);
  };

  const bizLogBusinessOptions = useMemo(() => {
    const fromList = businesses.map((b) => b.institution_name).filter(Boolean);
    const fromLedger = businessLedger.map((r) => r.businessName).filter(Boolean);
    return Array.from(new Set([...fromList, ...fromLedger])).sort((a, b) =>
      a.localeCompare(b, "tr")
    );
  }, [businesses, businessLedger]);

  const filteredBusinessLogs = useMemo(() => {
    return businessLedger.filter((log) => {
      if (bizLogBusiness && log.businessName !== bizLogBusiness) return false;
      if (bizLogActionType && log.actionType !== bizLogActionType) return false;
      if (!inDateRange(log.timestamp, logDateFrom, logDateTo)) return false;
      return true;
    });
  }, [businessLedger, bizLogBusiness, bizLogActionType, logDateFrom, logDateTo]);

  const actionTypeBadgeClass = {
    profile: "border-brand-500/30 bg-brand-500/10 text-brand-300",
    margin: "border-success-500/30 bg-success-500/10 text-success-300",
    branch: "border-warning-500/30 bg-warning-500/10 text-warning-300",
  };

  function actionTypeLabel(type) {
    if (type === "margin") return t("actionTypeMargin");
    if (type === "branch") return t("actionTypeBranch");
    return t("actionTypeProfile");
  }

  const businessFilterOptions = useMemo(() => {
    const set = new Set();
    for (const session of logData) {
      for (const name of session.clicked_businesses || []) {
        if (name) set.add(String(name));
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [logData]);

  const currencyFilterOptions = useMemo(() => {
    const set = new Set(["USD", "EUR", "GBP"]);
    for (const session of logData) {
      for (const cur of session.viewed_currencies || []) {
        if (cur) set.add(String(cur).toUpperCase());
      }
    }
    return Array.from(set).sort();
  }, [logData]);

  const filteredLogData = useMemo(() => {
    return logData.filter((session) => {
      const businesses = session.clicked_businesses || [];
      const currencies = (session.viewed_currencies || []).map((c) =>
        String(c).toUpperCase()
      );
      const loc = String(session.location || "").trim();
      const hasLocation = Boolean(loc) && loc !== "Bilinmiyor";

      if (filterBusiness && !businesses.includes(filterBusiness)) return false;
      if (filterCurrency && !currencies.includes(filterCurrency.toUpperCase())) {
        return false;
      }
      if (filterAction === "location" && !hasLocation) return false;
      if (filterAction === "currency" && currencies.length === 0) return false;
      if (filterAction === "business" && businesses.length === 0) return false;
      if (!inDateRange(session.created_at, logDateFrom, logDateTo)) return false;
      return true;
    });
  }, [logData, filterBusiness, filterCurrency, filterAction, logDateFrom, logDateTo]);

  const loadBusinesses = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const rows = await fetchAdminBusinesses(token);
      setBusinesses(rows);
    } catch (err) {
      setError(err.message || t("businessesLoadFailedMsg"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    if (!bootstrapping && isSuperAdmin && token) {
      loadBusinesses();
    }
  }, [bootstrapping, isSuperAdmin, token, loadBusinesses]);

  useEffect(() => {
    if (!bootstrapping && isSuperAdmin && token) {
      loadRevenue();
    }
  }, [bootstrapping, isSuperAdmin, token, loadRevenue]);

  useEffect(() => {
    if (!showEditModal || editPanelTab !== "subscription" || !editForm.id || !token) return;
    let cancelled = false;
    (async () => {
      setBranchSubLoading(true);
      setBranchSubError("");
      try {
        const rows = await fetchAdminBranches(token, editForm.id);
        if (!cancelled) {
          setBranchSubList(rows);
          setBranchSubBusiness({
            id: editForm.id,
            institution_name: editForm.institution_name,
            username: editForm.username,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setBranchSubList([]);
          setBranchSubError(err.message || t("statsLoadFailedMsg"));
        }
      } finally {
        if (!cancelled) setBranchSubLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showEditModal, editPanelTab, editForm.id, editForm.institution_name, editForm.username, token, t]);

  useEffect(() => {
    if (!showEditModal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showEditModal]);

  /** U-12: düzenlenen işletmenin mevcut şube sayısı (limit uyarısı için). */
  const editBranchCount = useMemo(() => {
    if (!editForm.id) return 0;
    const row = businesses.find((b) => b.id === editForm.id);
    return Number(row?.branch_count) || 0;
  }, [businesses, editForm.id]);

  const openEdit = (biz) => {
    setEditForm({
      id: biz.id,
      institution_name: biz.institution_name || "",
      contact_person: biz.contact_person || "",
      username: biz.username || "",
      email: biz.email || "",
      password: "",
      subscriptionType: parseSubscriptionType(biz),
      manualDays: "0",
      price: "0",
      branchLimit: String(Math.max(1, Number(biz.branch_limit) || 1)),
      currentRemainingDays: null,
      logo_url: biz.logo_url || null,
    });
    setSuccess("");
    setError("");
    setEditPanelTab("edit");
    setShowEditModal(true);
    setTab("list");
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditPanelTab("edit");
  };

  const openSeoModal = async () => {
    setShowSeoModal(true);
    setSeoError("");
    setSeoSuccess("");
    setSeoLoading(true);
    try {
      const seo = await fetchAdminSeo(token);
      setSeoForm({
        site_name: seo.site_name || "",
        title: seo.title || "",
        description: seo.description || "",
        keywords: seo.keywords || "",
        canonical_url: seo.canonical_url || "",
        og_image: seo.og_image || "",
        robots: seo.robots || "index, follow",
        geo_region: seo.geo_region || "",
        geo_placename: seo.geo_placename || "",
        locale: seo.locale || "tr_TR",
        focus_queries: seo.focus_queries || "",
        structured_data_enabled: seo.structured_data_enabled !== false,
      });
    } catch (err) {
      setSeoError(err.message || t("seoLoadFailed"));
      setSeoForm(null);
    } finally {
      setSeoLoading(false);
    }
  };

  const closeSeoModal = () => {
    if (seoSaving) return;
    setShowSeoModal(false);
    setSeoError("");
    setSeoSuccess("");
  };

  const handleSeoSave = async (event) => {
    event.preventDefault();
    if (!seoForm) return;
    setSeoSaving(true);
    setSeoError("");
    setSeoSuccess("");
    try {
      const saved = await updateAdminSeo(token, seoForm);
      setSeoForm((prev) => ({ ...prev, ...saved }));
      setSeoSuccess(t("seoSavedMsg"));
    } catch (err) {
      setSeoError(err.message || t("seoSaveFailed"));
    } finally {
      setSeoSaving(false);
    }
  };

  const openBranchSubscriptionModal = async (biz) => {
    setBranchSubBusiness(biz);
    setShowBranchSubModal(true);
    setBranchSubError("");
    setBranchSubSelectedId("");
    setBranchSubForm({
      subscriptionType: "Aylık",
      manualDays: "0",
      price: "500",
      currentRemainingDays: 0,
    });
    setBranchSubLoading(true);
    try {
      const rows = await fetchAdminBranches(token, biz.id);
      setBranchSubList(rows);
    } catch (err) {
      setBranchSubList([]);
      setBranchSubError(err.message || t("statsLoadFailedMsg"));
    } finally {
      setBranchSubLoading(false);
    }
  };

  const closeBranchSubscriptionModal = () => {
    if (branchSubSaving) return;
    setShowBranchSubModal(false);
    setBranchSubBusiness(null);
    setBranchSubList([]);
    setBranchSubSelectedId("");
    setBranchSubError("");
  };

  const selectBranchForSubscription = (branch) => {
    const type = branch.subscription_type || "Test";
    setBranchSubSelectedId(String(branch.id));
    setBranchSubForm({
      subscriptionType: type === "Test" || type === "Aylık" || type === "Yıllık" || type === "Manuel" ? type : "Aylık",
      manualDays: "0",
      price: String(defaultSubscriptionPrice(type === "Test" ? "Aylık" : type)),
      currentRemainingDays:
        type === "Test" ? null : Math.max(0, Number(branch.days_remaining) || 0),
    });
    setBranchSubError("");
  };

  const branchSubCalculatedDays = useMemo(
    () =>
      calculateNewDays(
        branchSubForm.subscriptionType,
        branchSubForm.currentRemainingDays,
        branchSubForm.manualDays
      ),
    [branchSubForm.subscriptionType, branchSubForm.currentRemainingDays, branchSubForm.manualDays]
  );

  const handleSaveBranchSubscription = async () => {
    if (!branchSubSelectedId || !token) return;
    const businessId = branchSubBusiness?.id || editForm.id;
    if (!businessId) return;
    setBranchSubSaving(true);
    setBranchSubError("");
    try {
      const payload = {
        subscription_type: branchSubForm.subscriptionType,
        remaining_days: branchSubCalculatedDays,
        is_active: true,
      };
      if (branchSubForm.subscriptionType === "Test") {
        payload.subscription_end_date = null;
        payload.remaining_days = null;
      }
      await updateAdminBranch(token, branchSubSelectedId, payload);
      const rows = await fetchAdminBranches(token, businessId);
      setBranchSubList(rows);
      const updated = rows.find((b) => String(b.id) === String(branchSubSelectedId));
      if (updated) selectBranchForSubscription(updated);
      setSuccess(t("branchSubscriptionSaved"));
    } catch (err) {
      setBranchSubError(err.message || t("updateFailedMsg"));
    } finally {
      setBranchSubSaving(false);
    }
  };

  const handleExtendBranchOneMonth = async () => {
    if (!branchSubSelectedId || !token) return;
    const businessId = branchSubBusiness?.id || editForm.id;
    const current = branchSubList.find((b) => String(b.id) === String(branchSubSelectedId));
    if (!businessId || !current) return;
    setBranchSubSaving(true);
    setBranchSubError("");
    try {
      const baseDays =
        current.subscription_type === "Test"
          ? 0
          : Math.max(0, Number(current.days_remaining) || 0);
      await updateAdminBranch(token, branchSubSelectedId, {
        subscription_type:
          current.subscription_type === "Test" ? "Aylık" : current.subscription_type || "Aylık",
        remaining_days: baseDays + 30,
        is_active: true,
      });
      const rows = await fetchAdminBranches(token, businessId);
      setBranchSubList(rows);
      const updated = rows.find((b) => String(b.id) === String(branchSubSelectedId));
      if (updated) selectBranchForSubscription(updated);
      setSuccess(t("branchExtendedOneMonth"));
    } catch (err) {
      setBranchSubError(err.message || t("updateFailedMsg"));
    } finally {
      setBranchSubSaving(false);
    }
  };

  const handleToggleBranchActive = async () => {
    if (!branchSubSelectedId || !token) return;
    const businessId = branchSubBusiness?.id || editForm.id;
    const current = branchSubList.find((b) => String(b.id) === String(branchSubSelectedId));
    if (!businessId || !current) return;
    setBranchSubSaving(true);
    setBranchSubError("");
    try {
      await updateAdminBranch(token, branchSubSelectedId, {
        is_active: current.is_active === false,
      });
      const rows = await fetchAdminBranches(token, businessId);
      setBranchSubList(rows);
      const updated = rows.find((b) => String(b.id) === String(branchSubSelectedId));
      if (updated) selectBranchForSubscription(updated);
      setSuccess(
        current.is_active === false ? t("branchActivatedMsg") : t("branchDeactivatedMsg")
      );
    } catch (err) {
      setBranchSubError(err.message || t("updateFailedMsg"));
    } finally {
      setBranchSubSaving(false);
    }
  };

  const handleToggleStatus = async (biz) => {
    setTogglingId(biz.id);
    setError("");
    try {
      const updated = await updateAdminBusinessStatus(token, biz.id, !biz.is_active);
      setBusinesses((prev) =>
        prev.map((row) => (row.id === biz.id ? { ...row, ...updated } : row))
      );
    } catch (err) {
      setError(err.message || t("statusUpdateFailedMsg"));
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id) => {
    setError("");
    setSuccess("");
    try {
      await deleteAdminBusiness(token, id);
      setBusinesses((prev) => prev.filter((row) => row.id !== id));
      if (editForm.id === id) {
        setEditForm(emptyEditForm);
        setShowEditModal(false);
        setTab("list");
      }
      setSuccess(t("businessDeletedMsg"));
      setSuccessModalMessage(t("businessDeletedMsg"));
      setShowSuccessModal(true);
    } catch (err) {
      setError(err.message || t("businessDeleteFailedMsg"));
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await createAdminBusiness(token, {
        institution_name: createForm.institution_name,
        contact_person: createForm.contact_person,
        username: createForm.username,
        email: createForm.email,
        password: createForm.password,
        subscription_type: "Test",
        is_active: true,
        logo_url: createForm.logo_url || null,
        branch_limit: Math.max(1, parseInt(createForm.branchLimit, 10) || 1),
      });
      setCreateForm(emptyCreateForm);
      setSuccess(t("businessCreatedMsg"));
      await loadBusinesses();
      setTab("list");
    } catch (err) {
      setError(err.message || t("creationFailedMsg"));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (event) => {
    event.preventDefault();
    if (!editForm.id) {
      setError(t("selectFromListFirstMsg"));
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        username: editForm.username,
        email: editForm.email,
        institution_name: editForm.institution_name,
        contact_person: editForm.contact_person,
        logo_url: editForm.logo_url || null,
        branch_limit: Math.max(1, parseInt(editForm.branchLimit, 10) || 1),
      };
      if (editForm.password.trim()) {
        payload.password = editForm.password.trim();
      }
      await updateAdminBusiness(token, editForm.id, payload);
      setSuccess(t("businessUpdatedMsg"));
      setEditForm((prev) => ({
        ...prev,
        password: "",
      }));
      await loadBusinesses();
      setSuccessModalMessage(t("changesAppliedMsg"));
      setShowSuccessModal(true);
    } catch (err) {
      setError(err.message || t("updateFailedMsg"));
    } finally {
      setSaving(false);
    }
  };

  const handleResetSubscription = async () => {
    if (!editForm.id) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await resetAdminBusinessSubscription(token, editForm.id);
      setSuccess(t("subscriptionResetMsg"));
      setEditForm((prev) => ({ ...prev, currentRemainingDays: 0 }));
      await loadBusinesses();
      setSuccessModalMessage(t("subscriptionResetMsg"));
      setShowSuccessModal(true);
      setTab("list");
    } catch (err) {
      setError(err.message || t("resetFailedMsg"));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/", { replace: true });
  };

  if (bootstrapping || !isSuperAdmin) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-ink-500 text-sm dark:text-ink-400">
        {t("loadingGeneric")}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-6 sm:px-6 sm:py-8 text-ink-800 dark:text-ink-100">
      {/* U-08: yönetim sayfaları kendi sekme başlığını verir; robots.txt zaten bu yolları dışlıyor, noindex ile pekiştiriliyor. */}
      <Helmet>
        <title>Super Admin Paneli | AdaDöviz</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="mb-4">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:bg-ink-950/70 dark:text-ink-300 dark:hover:border-brand-400 dark:hover:text-brand-400"
        >
          <ArrowLeft className="size-4" />
          {t("backToDashboardLink")}
        </button>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 sm:mb-8 sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-xl bg-gradient-to-tr bg-brand-gradient p-2.5 text-white shadow-lg shadow-brand-900/30">
            <Shield className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink-900 dark:text-white sm:text-2xl">{t("superAdminTitle")}</h1>
            <p className="truncate text-sm text-ink-500 dark:text-ink-400">
              {auth?.username} · {t("superAdminSubtitle")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminNotificationBell token={token} />
          <HeaderActions />
          <SubscriptionLedgerButton
            active={ledgerView === "subscription"}
            onClick={() => openSubscriptionLedger(null)}
          />
          <button
            type="button"
            onClick={openSeoModal}
            className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-brand-400 dark:hover:text-brand-400"
          >
            <Search size={18} />
            {t("seoButton")}
          </button>
          <button
            type="button"
            onClick={() => setShowLogModal(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-brand-400 dark:hover:text-brand-400"
          >
            <Activity size={18} />
            {t("logsButton")}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong hover:border-danger-500 hover:text-danger-500 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-danger-500 dark:hover:text-danger-500"
          >
            <LogOut size={16} />
            {t("logoutShort")}
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-ink-200 pb-3 dark:border-ink-800">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setError("");
              setSuccess("");
            }}
            className={`relative inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-strong ${
              tab === item.id
                ? "bg-brand-500/20 text-brand-700 border border-brand-500/40 dark:text-brand-300"
                : "text-ink-500 border border-transparent hover:border-brand-400 hover:text-brand-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:border-brand-400 dark:hover:text-brand-400 dark:hover:bg-ink-800/80"
            }`}
          >
            {item.label}
            {item.id === "requests" && branchRequestUnread > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-danger-500 px-1 py-0.5 text-[10px] font-bold leading-none text-white shadow">
                {branchRequestUnread > 99 ? "99+" : branchRequestUnread}
              </span>
            ) : null}
            {item.id === "support" && supportOpen > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-warning-500 px-1 py-0.5 text-[10px] font-bold leading-none text-white shadow">
                {supportOpen > 99 ? "99+" : supportOpen}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-700 dark:text-danger-200">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="mb-4 rounded-lg border border-success-500/30 bg-success-500/10 px-3 py-2 text-sm text-success-700 dark:text-success-200">
          {success}
        </div>
      ) : null}

      {tab === "list" && (
        <section className="rounded-card border border-ink-200 bg-white overflow-hidden dark:border-ink-800 dark:bg-ink-900/80">
          <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3 dark:border-ink-800">
            <div className="flex items-center gap-2 text-ink-800 dark:text-ink-200">
              <Building2 size={18} className="text-brand-600 dark:text-brand-400" />
              <h2 className="font-semibold">{t("tabList")}</h2>
            </div>
            <button
              type="button"
              onClick={loadBusinesses}
              className="text-xs text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
            >
              {t("refresh")}
            </button>
          </div>

          {loading ? (
            <p className="p-6 text-sm text-ink-500 dark:text-ink-400">{t("loadingList")}</p>
          ) : businesses.length === 0 ? (
            <p className="p-6 text-sm text-ink-500 dark:text-ink-400">{t("noBusinessesYet")}</p>
          ) : (
            <>
            <div className="space-y-3 p-3 md:hidden">
              {businesses.map((biz) => {
                const used = Number(biz.branch_count) || 0;
                const limit = Math.max(1, Number(biz.branch_limit) || 1);
                const isActive = biz.is_active !== false;
                const toggleDisabled = togglingId === biz.id;
                return (
                  <article
                    key={biz.id}
                    className="rounded-xl border border-ink-200 bg-ink-50 p-4 dark:border-ink-800 dark:bg-ink-950/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink-900 dark:text-white">{biz.institution_name}</p>
                        <button
                          type="button"
                          onClick={() => openEdit(biz)}
                          className="mt-0.5 font-mono text-sm text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
                        >
                          {biz.username}
                        </button>
                        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                          ID {biz.id} · {formatRegistrationDate(biz.created_at)}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                          {t("colLastLogin")}:{" "}
                          {biz.last_login_at
                            ? formatRequestDateTime(biz.last_login_at)
                            : t("neverLoggedIn")}
                        </p>
                      </div>
                      <BranchQuotaBadge used={used} limit={limit} />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isActive}
                        /* A-02: 21 durum anahtarının hiçbirinin erişilebilir adı
                           yoktu; ekran okuyucu 21 kez "anahtar, işaretli değil"
                           diyor, hangi işletme olduğu belirsiz kalıyordu. */
                        aria-label={`${biz.institution_name} — ${isActive ? t("statusActive") : t("statusInactive")}`}
                        disabled={toggleDisabled}
                        onClick={() => handleToggleStatus(biz)}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${
                          isActive
                            ? "border-success-500/50 bg-success-500/80"
                            : "border-ink-300 bg-ink-300 dark:border-ink-600 dark:bg-ink-700"
                        } ${toggleDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <span
                          className={`inline-block size-4 transform rounded-full bg-white shadow transition ${
                            isActive ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                      <span className={`text-[11px] ${isActive ? "text-success-700 dark:text-success-400" : "text-danger-700 dark:text-danger-400"}`}>
                        {isActive ? t("statusActive") : t("statusInactive")}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(biz)}
                        className="btn-ghost !px-3 !py-1.5 !text-xs"
                      >
                        <Pencil size={14} />
                        {t("editBtn")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openBranchSubscriptionModal(biz)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-700 dark:text-brand-300"
                      >
                        <CreditCard size={14} />
                        {t("addSubscriptionBtn")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setBusinessToDelete(biz)}
                        className="btn-danger !px-3 !py-1.5 !text-xs"
                      >
                        <Trash2 size={14} />
                        {t("deleteBtn")}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="bg-ink-50 text-xs tracking-wide text-ink-600 dark:bg-ink-950/80 dark:text-ink-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("colId")}</th>
                    <th className="px-4 py-3 font-medium">{t("businessName")}</th>
                    <th className="px-4 py-3 font-medium">{t("colLoginId")}</th>
                    {/* A-03: paket, bitiş ve kalan gün tabloda hiç yoktu — kimin
                        aboneliğinin bittiğini görmek için 21 pencere açmak gerekiyordu. */}
                    <th className="px-4 py-3 font-medium">Paket</th>
                    <th className="px-4 py-3 font-medium">Bitiş</th>
                    <th className="px-4 py-3 font-medium">Kalan</th>
                    <th className="px-4 py-3 font-medium">{t("colBranchCount")}</th>
                    <th className="px-4 py-3 font-medium">{t("colRegisteredAt")}</th>
                    <th className="px-4 py-3 font-medium">{t("colLastLogin")}</th>
                    <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                    <th className="px-4 py-3 font-medium text-right">{t("colAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {businesses.map((biz) => {
                    const used = Number(biz.branch_count) || 0;
                    const limit = Math.max(1, Number(biz.branch_limit) || 1);
                    const isActive = biz.is_active !== false;
                    const toggleDisabled = togglingId === biz.id;
                    return (
                      <tr key={biz.id} className="border-t border-ink-200 hover:bg-ink-50 dark:border-ink-800/80 dark:hover:bg-ink-800/40">
                        <td className="px-4 py-3 text-ink-500 font-mono text-xs">{biz.id}</td>
                        <td className="px-4 py-3 text-ink-800 dark:text-ink-100">{biz.institution_name}</td>
                        <td className="px-4 py-3 text-ink-800 font-mono dark:text-ink-200">
                          <button
                            type="button"
                            onClick={() => openEdit(biz)}
                            title={t("editBtn")}
                            className="font-mono text-brand-700 underline-offset-2 transition hover:text-brand-500 hover:underline dark:text-brand-300 dark:hover:text-brand-200"
                          >
                            {biz.username}
                          </button>
                          {/*
                            U-14: Public URL'i (/doviz-burosu/:slug) ve logo ucunu
                            belirleyen alan institution_id'dir ama panelde hiç
                            gösterilmiyordu — "Cappy Exchange"in slug'ı tek harflik
                            "x" olduğu halde yönetici bunu göremiyordu.
                          */}
                          {biz.institution_id && biz.institution_id !== biz.username ? (
                            <p className="mt-0.5 font-mono text-[11px] text-ink-500 dark:text-ink-400">
                              /{biz.institution_id}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          <span className="rounded-control bg-ink-100 px-2 py-0.5 font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-200">
                            {biz.subscription_type || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-600 whitespace-nowrap dark:text-ink-300">
                          {biz.subscription_end_date
                            ? formatRegistrationDate(biz.subscription_end_date)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          <RemainingBadge days={biz.days_remaining} />
                        </td>
                        <td className="px-4 py-3">
                          <BranchQuotaBadge used={used} limit={limit} />
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-600 whitespace-nowrap dark:text-ink-300">
                          {formatRegistrationDate(biz.created_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-600 whitespace-nowrap dark:text-ink-300">
                          {biz.last_login_at
                            ? formatRequestDateTime(biz.last_login_at)
                            : t("neverLoggedIn")}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isActive}
                            aria-label={`${biz.institution_name} — ${isActive ? t("statusActive") : t("statusInactive")}`}
                            disabled={toggleDisabled}
                            onClick={() => handleToggleStatus(biz)}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${
                              isActive
                                ? "border-success-500/50 bg-success-500/80"
                                : "border-ink-300 bg-ink-300 dark:border-ink-600 dark:bg-ink-700"
                            } ${toggleDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                            title={
                              isActive
                                ? t("activeToggleInactive")
                                : t("inactiveToggleActive")
                            }
                          >
                            <span
                              className={`inline-block size-4 transform rounded-full bg-white shadow transition ${
                                isActive ? "translate-x-6" : "translate-x-1"
                              }`}
                            />
                          </button>
                          <span className={`ml-2 text-[11px] ${isActive ? "text-success-700 dark:text-success-400" : "text-danger-700 dark:text-danger-400"}`}>
                            {isActive ? t("statusActive") : t("statusInactive")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {/*
                            ⚠️ TASARIM DÜZELTMESİ (D-21): İşlem sütunundaki üç
                            buton etiketleriyle birlikte yatay sığmıyordu ve
                            `flex-wrap` her birini ALT SATIRA atıyordu. Sonuç:
                            satır yüksekliği ~100 px, ekranda aynı anda yalnızca
                            2,5 işletme görünüyordu. Yönetim tablosunun işi
                            karşılaştırma yapmak; satırların çoğu ekran dışında
                            kalınca tablo işlevini kaybediyor.

                            Yoğun tablolarda standart çözüm ikon eylemleridir.
                            Etiketler `title` ve `aria-label` olarak korunuyor —
                            ekran okuyucu ve fareyle üzerine gelme için bilgi
                            kaybı yok, buna karşılık üç katı satır görünüyor.
                          */}
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(biz)}
                              title={t("editBtn")}
                              aria-label={t("editBtn")}
                              className="inline-flex size-8 items-center justify-center rounded-control border border-ink-200 bg-white text-ink-600 transition-[background-color,border-color,color] duration-fast ease-out-strong hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300 dark:hover:border-brand-400 dark:hover:text-brand-300"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openBranchSubscriptionModal(biz)}
                              title={t("addSubscriptionBtn")}
                              aria-label={t("addSubscriptionBtn")}
                              className="inline-flex size-8 items-center justify-center rounded-control border border-brand-500/40 bg-brand-500/10 text-brand-700 transition-[background-color,border-color,color] duration-fast ease-out-strong hover:border-brand-400 dark:text-brand-300"
                            >
                              <CreditCard size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setBusinessToDelete(biz)}
                              title={t("deleteBtn")}
                              aria-label={t("deleteBtn")}
                              className="inline-flex size-8 items-center justify-center rounded-control border border-danger-600/40 text-danger-700 transition-[background-color,border-color,color] duration-fast ease-out-strong hover:bg-danger-500/10 dark:border-danger-500/40 dark:text-danger-400"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </section>
      )}

      {showEditModal && editForm.id ? (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-ink-950/70 backdrop-blur-sm p-3 sm:p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && e.currentTarget.dataset.backdropDown === "1") {
              closeEditModal();
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-card border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-ink-200 px-5 pb-3 pt-5 dark:border-ink-800 md:px-6">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-white">
                    {editPanelTab === "edit"
                      ? t("editBusinessTitle")
                      : editPanelTab === "business"
                        ? t("businessLedgerTitle")
                        : t("addSubscriptionTitle")}
                  </h2>
                  <span className="mt-0.5 block truncate text-sm font-mono text-brand-600 dark:text-brand-300">
                    {editForm.username}
                    {editForm.institution_name ? ` · ${editForm.institution_name}` : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <HeaderActions compact />
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                    aria-label={t("cancel")}
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>

              <div className="inline-flex w-full max-w-full flex-wrap rounded-lg border border-ink-200 bg-ink-50 p-0.5 dark:border-ink-700 dark:bg-ink-950/60 sm:w-auto">
                {[
                  { id: "edit", icon: Pencil, label: t("editBtn") },
                  { id: "business", icon: ClipboardList, label: t("businessLedgerShort") },
                  { id: "subscription", icon: CreditCard, label: t("addSubscriptionTitle") },
                ].map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setEditPanelTab(id)}
                    className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition sm:flex-none sm:text-sm ${
                      editPanelTab === id
                        ? "bg-brand-500/15 text-brand-700 dark:text-brand-300"
                        : "text-ink-500 hover:text-brand-600 dark:text-ink-400 dark:hover:text-brand-400"
                    }`}
                  >
                    <Icon size={14} />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
              {editPanelTab === "edit" ? (
                <>
                  <form onSubmit={handleUpdate} className="grid gap-4">
                    <BusinessLogoField
                      logoUrl={editForm.logo_url}
                      name={editForm.institution_name}
                      onChange={(logo_url) => setEditForm((p) => ({ ...p, logo_url }))}
                    />
                    <FloatingInput
                      label={t("businessName")}
                      value={editForm.institution_name}
                      onChange={(e) => setEditForm((p) => ({ ...p, institution_name: e.target.value }))}
                      required
                    />
                    <FloatingInput
                      label={t("contactPerson")}
                      value={editForm.contact_person}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          contact_person: e.target.value.replace(/[0-9]/g, ""),
                        }))
                      }
                      placeholder={t("contactPersonPlaceholder")}
                      required
                    />
                    <FloatingInput
                      label={t("loginIdField")}
                      value={editForm.username}
                      onChange={(e) => setEditForm((p) => ({ ...p, username: e.target.value }))}
                      placeholder={t("loginIdPlaceholder")}
                      autoComplete="username"
                      required
                    />
                    <FloatingInput
                      label={t("businessEmailField")}
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                      placeholder={t("businessEmailPlaceholder")}
                      autoComplete="email"
                      required
                    />
                    <FloatingInput
                      label={t("newPasswordOptionalField")}
                      type="password"
                      value={editForm.password}
                      onChange={(e) => setEditForm((p) => ({ ...p, password: e.target.value }))}
                      autoComplete="new-password"
                    />

                    <div>
                      <FloatingInput
                        label={t("branchLimitLabel")}
                        type="number"
                        min="1"
                        step="1"
                        value={editForm.branchLimit}
                        onChange={(e) =>
                          setEditForm((p) => ({ ...p, branchLimit: e.target.value }))
                        }
                        required
                      />
                      {/*
                        U-12: Limit mevcut şube sayısının altına indirilirse
                        şubeler silinmez; kayıt "2/1" gibi tutarsız bir duruma
                        düşer. Eskiden hiçbir uyarı yoktu.
                      */}
                      {editBranchCount > (parseInt(editForm.branchLimit, 10) || 1) ? (
                        <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-warning-700 dark:text-warning-400">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            Bu işletmenin {editBranchCount} şubesi var. Limiti bunun altına
                            indirmek mevcut şubeleri silmez; kayıt limit aşımı durumunda kalır.
                          </span>
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-3">
                      <button type="submit" disabled={saving} className={primaryBtnClass}>
                        {saving ? t("saving") : t("saveChangesBtn")}
                      </button>
                      <button
                        type="button"
                        onClick={closeEditModal}
                        className="rounded-lg border border-ink-200 bg-ink-50 px-4 py-2.5 text-sm font-medium text-ink-600 transition hover:border-ink-300 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </form>

                  <hr className="my-8 border-ink-200 dark:border-ink-800" />

                  <BusinessBranchesPanel
                    token={token}
                    businessId={editForm.id}
                    businessName={editForm.institution_name}
                    branchLimit={Math.max(1, parseInt(editForm.branchLimit, 10) || 1)}
                  />
                </>
              ) : editPanelTab === "business" ? (
                editBusinessLedger.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-500 dark:text-ink-400">
                    {t("ledgerEmpty")}
                  </p>
                ) : (
                  <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200 dark:divide-ink-800 dark:border-ink-800">
                    {editBusinessLedger.map((row) => {
                      const when = formatLedgerDateTime(row.timestamp);
                      return (
                        <li key={row.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-3">
                          <span className="shrink-0 font-mono text-xs text-ink-500 dark:text-ink-400 sm:w-36">
                            {when.label}
                          </span>
                          <span className="text-sm text-ink-800 dark:text-ink-200">{row.description}</span>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-ink-600 dark:text-ink-300">
                    {t("addSubscriptionHint")}
                  </p>
                  {branchSubLoading ? (
                    <p className="text-sm text-ink-500 dark:text-ink-400">{t("loadingShort")}</p>
                  ) : branchSubError && branchSubList.length === 0 ? (
                    <p className="text-sm text-danger-700 dark:text-danger-300">{branchSubError}</p>
                  ) : branchSubList.length === 0 ? (
                    <p className="text-sm text-ink-500 dark:text-ink-400">
                      {t("noBranchesForSubscription")}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {branchSubList.map((branch) => {
                        const selected = String(branchSubSelectedId) === String(branch.id);
                        const rem = formatRemaining(
                          branch.days_remaining,
                          t,
                          branch.subscription_type || "Test"
                        );
                        const active = branch.is_active !== false;
                        return (
                          <li key={branch.id}>
                            <button
                              type="button"
                              onClick={() => selectBranchForSubscription(branch)}
                              className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                                selected
                                  ? "border-brand-500/50 bg-brand-500/10"
                                  : "border-ink-200 bg-ink-50 hover:border-brand-400/50 dark:border-ink-700 dark:bg-ink-950"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-ink-900 dark:text-white">
                                  {branch.name}
                                  {!active ? (
                                    <span className="ml-2 rounded bg-danger-500/15 px-1.5 py-0.5 text-[10px] font-bold text-danger-700 dark:text-danger-300">
                                      {t("statusInactive")}
                                    </span>
                                  ) : null}
                                </span>
                                <span
                                  className={`text-xs font-semibold ${
                                    !active
                                      ? "text-ink-600 dark:text-ink-400"
                                      : branch.subscription_type === "Test"
                                        ? "text-brand-600 dark:text-brand-300"
                                        : branch.days_remaining != null &&
                                            branch.days_remaining <= 30
                                          ? "text-danger-700 dark:text-danger-400"
                                          : "text-success-700 dark:text-success-400"
                                  }`}
                                >
                                  {rem}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-ink-500 dark:text-ink-400">
                                {subscriptionTypeLabel(branch.subscription_type, t)}
                                {" · "}
                                {t("subscriptionStartDate")}:{" "}
                                {formatRegistrationDate(
                                  branch.subscription_start_date || branch.created_at
                                )}
                              </p>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {branchSubSelectedId ? (
                    <div className="rounded-xl border border-ink-200 bg-ink-50 p-4 space-y-3 dark:border-ink-700 dark:bg-ink-950/60">
                      <SubscriptionFields form={branchSubForm} setForm={setBranchSubForm} />
                      <SubscriptionPreview
                        currentDays={branchSubForm.currentRemainingDays}
                        newDays={branchSubCalculatedDays}
                        price={branchSubForm.price}
                        lang={lang}
                        t={t}
                      />
                      {branchSubError ? (
                        <p className="text-xs text-danger-700 dark:text-danger-300">{branchSubError}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={branchSubSaving}
                          onClick={handleSaveBranchSubscription}
                          className={primaryBtnClass}
                        >
                          {branchSubSaving ? t("saving") : t("saveBranchSubscriptionBtn")}
                        </button>
                        <button
                          type="button"
                          disabled={branchSubSaving}
                          onClick={handleExtendBranchOneMonth}
                          className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-4 py-2.5 text-sm font-semibold text-brand-700 transition hover:border-brand-400 dark:text-brand-300"
                        >
                          {t("extendOneMonthBtn")}
                        </button>
                        <button
                          type="button"
                          disabled={branchSubSaving}
                          onClick={handleToggleBranchActive}
                          className="rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-700 transition hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
                        >
                          {branchSubList.find((b) => String(b.id) === String(branchSubSelectedId))
                            ?.is_active === false
                            ? t("activateBranchBtn")
                            : t("deactivateBranchBtn")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showBranchSubModal && branchSubBusiness ? (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-ink-950/70 backdrop-blur-sm p-3 sm:p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && e.currentTarget.dataset.backdropDown === "1") {
              closeBranchSubscriptionModal();
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-card border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-ink-200 px-5 py-4 dark:border-ink-800 md:px-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-white">
                    {t("addSubscriptionTitle")}
                  </h2>
                  <p className="mt-0.5 truncate text-sm text-brand-600 dark:text-brand-300">
                    {branchSubBusiness.institution_name || branchSubBusiness.username}
                  </p>
                  <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                    {t("addSubscriptionHint")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <HeaderActions compact />
                  <button
                    type="button"
                    onClick={closeBranchSubscriptionModal}
                    className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                    aria-label={t("cancel")}
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6 space-y-4">
              {branchSubLoading ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">{t("loadingShort")}</p>
              ) : branchSubError && branchSubList.length === 0 ? (
                <p className="text-sm text-danger-700 dark:text-danger-300">{branchSubError}</p>
              ) : branchSubList.length === 0 ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  {t("noBranchesForSubscription")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {branchSubList.map((branch) => {
                    const selected = String(branchSubSelectedId) === String(branch.id);
                    const rem = formatRemaining(
                      branch.days_remaining,
                      t,
                      branch.subscription_type || "Test"
                    );
                    return (
                      <li key={branch.id}>
                        <button
                          type="button"
                          onClick={() => selectBranchForSubscription(branch)}
                          className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                            selected
                              ? "border-brand-500/50 bg-brand-500/10"
                              : "border-ink-200 bg-ink-50 hover:border-brand-400/50 dark:border-ink-700 dark:bg-ink-950"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-ink-900 dark:text-white">
                              {branch.name}
                            </span>
                            <span
                              className={`text-xs font-semibold ${
                                branch.subscription_type === "Test"
                                  ? "text-brand-600 dark:text-brand-300"
                                  : branch.days_remaining != null && branch.days_remaining <= 30
                                    ? "text-danger-700 dark:text-danger-400"
                                    : "text-success-700 dark:text-success-400"
                              }`}
                            >
                              {rem}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-ink-500 dark:text-ink-400">
                            {subscriptionTypeLabel(branch.subscription_type, t)}
                            {" · "}
                            {t("subscriptionStartDate")}:{" "}
                            {formatRegistrationDate(
                              branch.subscription_start_date || branch.created_at
                            )}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {branchSubSelectedId ? (
                <div className="rounded-xl border border-ink-200 bg-ink-50 p-4 space-y-3 dark:border-ink-700 dark:bg-ink-950/60">
                  <SubscriptionFields form={branchSubForm} setForm={setBranchSubForm} />
                  <SubscriptionPreview
                    currentDays={branchSubForm.currentRemainingDays}
                    newDays={branchSubCalculatedDays}
                    price={branchSubForm.price}
                    lang={lang}
                    t={t}
                  />
                  {branchSubError ? (
                    <p className="text-xs text-danger-700 dark:text-danger-300">{branchSubError}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={branchSubSaving}
                      onClick={handleSaveBranchSubscription}
                      className={primaryBtnClass}
                    >
                      {branchSubSaving ? t("saving") : t("saveBranchSubscriptionBtn")}
                    </button>
                    <button
                      type="button"
                      disabled={branchSubSaving}
                      onClick={handleExtendBranchOneMonth}
                      className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-4 py-2.5 text-sm font-semibold text-brand-700 transition hover:border-brand-400 dark:text-brand-300"
                    >
                      {t("extendOneMonthBtn")}
                    </button>
                    <button
                      type="button"
                      disabled={branchSubSaving}
                      onClick={handleToggleBranchActive}
                      className="rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-700 transition hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
                    >
                      {branchSubList.find((b) => String(b.id) === String(branchSubSelectedId))
                        ?.is_active === false
                        ? t("activateBranchBtn")
                        : t("deactivateBranchBtn")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "create" && (
        <section className="rounded-card border border-ink-200 bg-white p-5 md:p-6 dark:border-ink-800 dark:bg-ink-900/80">
          <div className="mb-4 flex items-center gap-2">
            <Plus size={18} className="text-brand-600 dark:text-brand-400" />
            <h2 className="text-lg font-semibold text-ink-900 dark:text-white">{t("tabCreate")}</h2>
          </div>
          <form onSubmit={handleCreate} className="grid gap-4 max-w-xl">
            <BusinessLogoField
              logoUrl={createForm.logo_url}
              name={createForm.institution_name}
              onChange={(logo_url) => setCreateForm((p) => ({ ...p, logo_url }))}
            />
            <FloatingInput
              label={t("businessName")}
              value={createForm.institution_name}
              onChange={(e) => setCreateForm((p) => ({ ...p, institution_name: e.target.value }))}
              required
            />
            <FloatingInput
              label={t("contactPerson")}
              value={createForm.contact_person}
              onChange={(e) =>
                setCreateForm((p) => ({
                  ...p,
                  contact_person: e.target.value.replace(/[0-9]/g, ""),
                }))
              }
              placeholder={t("contactPersonPlaceholder")}
              required
            />
            <FloatingInput
              label={t("loginIdField")}
              value={createForm.username}
              onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))}
              placeholder={t("loginIdPlaceholder")}
              autoComplete="username"
              required
            />
            <FloatingInput
              label={t("businessEmailField")}
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
              placeholder={t("businessEmailPlaceholder")}
              autoComplete="email"
              required
            />
            <FloatingInput
              label={t("passwordLabel")}
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
              required
              autoComplete="new-password"
            />
            <FloatingInput
              label={t("branchLimitLabel")}
              type="number"
              min="1"
              step="1"
              value={createForm.branchLimit}
              onChange={(e) =>
                setCreateForm((p) => ({ ...p, branchLimit: e.target.value }))
              }
              required
            />
            <button type="submit" disabled={saving} className={primaryBtnClass}>
              {saving ? t("creatingBtn") : t("createBusinessBtn")}
            </button>
          </form>
        </section>
      )}

      {tab === "requests" && (
        <section className="rounded-card border border-ink-200 bg-white overflow-hidden dark:border-ink-800 dark:bg-ink-900/80">
          <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3 dark:border-ink-800">
            <div className="flex items-center gap-2 text-ink-800 dark:text-ink-200">
              <ClipboardList size={18} className="text-brand-600 dark:text-brand-400" />
              <h2 className="font-semibold">{t("tabRequests")}</h2>
              {branchRequestUnread > 0 ? (
                <span className="rounded-full bg-danger-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {branchRequestUnread}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={loadBranchRequests}
              className="text-xs text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
            >
              {t("refresh")}
            </button>
          </div>

          {branchRequestsLoading ? (
            <p className="p-6 text-sm text-ink-500 dark:text-ink-400">{t("loadingShort")}</p>
          ) : branchRequestsError ? (
            <p className="p-6 text-sm text-danger-700 dark:text-danger-300">{branchRequestsError}</p>
          ) : branchRequests.length === 0 ? (
            <p className="p-6 text-sm text-ink-500 dark:text-ink-400">{t("requestsEmpty")}</p>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {branchRequests.map((req) => {
                const statusLabel =
                  req.status === "approved"
                    ? t("requestStatusApproved")
                    : req.status === "rejected"
                      ? t("requestStatusRejected")
                      : t("requestStatusPending");
                const statusClass =
                  req.status === "approved"
                    ? "text-success-700 dark:text-success-400"
                    : req.status === "rejected"
                      ? "text-danger-700 dark:text-danger-400"
                      : "text-warning-600 dark:text-warning-400";
                return (
                  <li
                    key={req.id}
                    className={`px-4 py-4 ${
                      req.status === "pending" && !req.is_read
                        ? "bg-brand-500/5 dark:bg-brand-500/10"
                        : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold text-ink-900 dark:text-white">
                          {req.branch_name}
                          <span className="ml-2 rounded-md border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink-600 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-300">
                            {req.request_type === "reactivate"
                              ? t("requestTypeRenew")
                              : t("requestTypeNew")}
                          </span>
                        </p>
                        <p className="text-xs text-ink-500 dark:text-ink-400">
                          {t("requestBusinessLabel")}: {req.business_name || req.institution_id}
                        </p>
                        {req.phone ? (
                          <p className="text-xs text-ink-500 dark:text-ink-400">
                            {t("phoneLabel")}: {req.phone}
                          </p>
                        ) : null}
                        {req.address ? (
                          <p className="text-xs text-ink-500 dark:text-ink-400 line-clamp-2">
                            {req.address}
                          </p>
                        ) : null}
                        {req.lat != null && req.lng != null ? (
                          <p className="font-mono text-[10px] text-ink-500">
                            {Number(req.lat).toFixed(5)}, {Number(req.lng).toFixed(5)}
                          </p>
                        ) : null}
                        <p className="text-[11px] text-ink-600 dark:text-ink-400">
                          {t("requestCreatedAt")}: {formatRequestDateTime(req.created_at)}
                        </p>
                        <p className={`text-xs font-semibold ${statusClass}`}>{statusLabel}</p>
                      </div>
                      {req.status === "pending" ? (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            disabled={branchRequestActingId === req.id}
                            onClick={() => handleBranchRequestAction(req.id, "approved")}
                            className="inline-flex items-center gap-1 rounded-lg border border-success-500/40 bg-success-500/10 px-3 py-1.5 text-xs font-semibold text-success-700 transition hover:bg-success-500/20 disabled:opacity-50 dark:text-success-300"
                          >
                            <Check size={14} />
                            {t("approveRequestBtn")}
                          </button>
                          <button
                            type="button"
                            disabled={branchRequestActingId === req.id}
                            onClick={() => handleBranchRequestAction(req.id, "rejected")}
                            className="inline-flex items-center gap-1 rounded-lg border border-danger-500/40 bg-danger-500/10 px-3 py-1.5 text-xs font-semibold text-danger-700 transition hover:bg-danger-500/20 disabled:opacity-50 dark:text-danger-300"
                          >
                            <X size={14} />
                            {t("rejectRequestBtn")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* P3.1 — self-signup başvuru kuyruğu (onay → hesap oluşturur). */}
      {tab === "signups" && (
        <section className="rounded-card border border-ink-200 bg-white overflow-hidden dark:border-ink-800 dark:bg-ink-900/80">
          <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3 dark:border-ink-800">
            <div className="flex items-center gap-2 text-ink-800 dark:text-ink-200">
              <UserPlus size={18} className="text-brand-600 dark:text-brand-400" />
              <h2 className="font-semibold">{t("tabSignups")}</h2>
              {signupPending > 0 ? (
                <span className="rounded-full bg-danger-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {signupPending}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={loadSignupRequests}
              className="text-xs text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
            >
              {t("refresh")}
            </button>
          </div>

          {signupLoading ? (
            <p className="p-6 text-sm text-ink-500 dark:text-ink-400">{t("loadingShort")}</p>
          ) : signupError ? (
            <p className="p-6 text-sm text-danger-700 dark:text-danger-300">{signupError}</p>
          ) : signupRequests.length === 0 ? (
            <p className="p-6 text-sm text-ink-500 dark:text-ink-400">{t("signupAdminEmpty")}</p>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {signupRequests.map((r) => {
                const statusLabel =
                  r.status === "approved"
                    ? t("requestStatusApproved")
                    : r.status === "rejected"
                      ? t("requestStatusRejected")
                      : t("requestStatusPending");
                const statusClass =
                  r.status === "approved"
                    ? "text-success-700 dark:text-success-400"
                    : r.status === "rejected"
                      ? "text-danger-700 dark:text-danger-400"
                      : "text-warning-600 dark:text-warning-400";
                const cfg = signupForm[r.id] || {};
                return (
                  <li
                    key={r.id}
                    className={`px-4 py-4 ${r.status === "pending" ? "bg-brand-500/5 dark:bg-brand-500/10" : ""}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold text-ink-900 dark:text-white">{r.institution_name}</p>
                        <p className="text-xs text-ink-500 dark:text-ink-400">
                          {r.contact_person} · {r.email} · {r.phone}
                        </p>
                        {r.city ? (
                          <p className="text-xs text-ink-500 dark:text-ink-400">{r.city}</p>
                        ) : null}
                        {r.current_rate_info ? (
                          <p className="text-xs text-ink-500 dark:text-ink-400 line-clamp-2">
                            {r.current_rate_info}
                          </p>
                        ) : null}
                        <p className="text-[11px] text-ink-600 dark:text-ink-400">
                          {t("requestCreatedAt")}: {formatRequestDateTime(r.created_at)}
                        </p>
                        <p className={`text-xs font-semibold ${statusClass}`}>
                          {statusLabel}
                          {r.reject_reason ? ` — ${r.reject_reason}` : ""}
                        </p>
                      </div>
                      {r.status === "pending" ? (
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <div className="flex items-center gap-2">
                            <select
                              value={cfg.subscription_type || "Test"}
                              onChange={(e) =>
                                setSignupForm((prev) => ({
                                  ...prev,
                                  [r.id]: { ...prev[r.id], subscription_type: e.target.value },
                                }))
                              }
                              className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs dark:border-ink-700 dark:bg-ink-950 dark:text-ink-200"
                            >
                              {["Test", "Ücretsiz", "Aylık", "Yıllık"].map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="1"
                              placeholder={t("signupAdminBranchLimit")}
                              value={cfg.branch_limit || ""}
                              onChange={(e) =>
                                setSignupForm((prev) => ({
                                  ...prev,
                                  [r.id]: { ...prev[r.id], branch_limit: e.target.value },
                                }))
                              }
                              className="w-20 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs dark:border-ink-700 dark:bg-ink-950 dark:text-ink-200"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={signupActingId === r.id}
                              onClick={() => handleSignupApprove(r.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-success-500/40 bg-success-500/10 px-3 py-1.5 text-xs font-semibold text-success-700 transition hover:bg-success-500/20 disabled:opacity-50 dark:text-success-300"
                            >
                              <Check size={14} />
                              {t("signupAdminApprove")}
                            </button>
                            <button
                              type="button"
                              disabled={signupActingId === r.id}
                              onClick={() => handleSignupReject(r.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-danger-500/40 bg-danger-500/10 px-3 py-1.5 text-xs font-semibold text-danger-700 transition hover:bg-danger-500/20 disabled:opacity-50 dark:text-danger-300"
                            >
                              <X size={14} />
                              {t("signupAdminReject")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* P3.4 — Lead CRM + talep analitiği */}
      {tab === "leads" && (
        <section className="space-y-4">
          {leadError ? (
            <p className="rounded-control border border-danger-600/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-700 dark:text-danger-300">
              {leadError}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: t("leadTotal"), value: leadStats?.total },
              { label: t("leadNew"), value: leadStats?.byStatus?.new },
              { label: t("leadContacted"), value: leadStats?.byStatus?.contacted },
              { label: t("leadWon"), value: leadStats?.byStatus?.won },
              { label: t("leadLost"), value: leadStats?.byStatus?.lost },
              {
                label: t("leadRemindersDue"),
                value: leadStats
                  ? `${leadStats.remindersDue}${
                      leadStats.remindersUpcoming ? ` (+${leadStats.remindersUpcoming})` : ""
                    }`
                  : null,
                danger: (leadStats?.remindersDue || 0) > 0,
              },
            ].map((c) => (
              <div key={c.label} className="surface-card p-3">
                <p className="text-xs font-medium text-ink-600 dark:text-ink-400">{c.label}</p>
                <p
                  className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                    c.danger ? "text-danger-700 dark:text-danger-400" : "text-ink-900 dark:text-white"
                  }`}
                >
                  {leadLoading || leadStats == null ? "—" : c.value ?? 0}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {["", "new", "contacted", "won", "lost"].map((s) => (
              <button
                key={s || "all"}
                type="button"
                onClick={() => setLeadFilter(s)}
                className={`rounded-control px-3 py-1 text-xs font-medium transition ${
                  leadFilter === s
                    ? "bg-brand-500 text-white"
                    : "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300"
                }`}
              >
                {s ? t(`lead${s[0].toUpperCase()}${s.slice(1)}`) : t("leadAll")}
              </button>
            ))}
          </div>

          {leads.length ? (
            <ul className="space-y-3">
              {leads.map((lead) => {
                const draft = leadDrafts[lead.lead_key] || {
                  note: lead.note || "",
                  reminder_date: lead.reminder_date || "",
                  assignee: lead.assignee || "",
                };
                const setDraft = (patch) =>
                  setLeadDrafts((d) => ({
                    ...d,
                    [lead.lead_key]: { ...draft, ...patch },
                  }));
                const dirty =
                  (draft.note || "") !== (lead.note || "") ||
                  (draft.reminder_date || "") !== (lead.reminder_date || "") ||
                  (draft.assignee || "") !== (lead.assignee || "");
                return (
                  <li key={lead.lead_key} className="surface-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink-900 dark:text-white">
                          {lead.institution_name || "—"}
                        </span>
                        <span
                          className={`rounded-control px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            lead.source === "signup"
                              ? "bg-brand-500/15 text-brand-700 dark:text-brand-300"
                              : "bg-ink-200 text-ink-600 dark:bg-ink-700 dark:text-ink-300"
                          }`}
                        >
                          {lead.source === "signup" ? t("leadSrcSignup") : t("leadSrcPartner")}
                        </span>
                        {lead.source_status && lead.source_status !== "pending" ? (
                          <span className="text-[10px] text-ink-500 dark:text-ink-400">
                            {lead.source_status}
                          </span>
                        ) : null}
                      </div>
                      <span className="font-mono text-xs tabular-nums text-ink-500 dark:text-ink-400">
                        {String(lead.created_at || "").slice(0, 10)}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-xs text-ink-600 dark:text-ink-400">
                      {[lead.contact_person, lead.email, lead.phone, lead.city]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {lead.message ? (
                      <p className="mt-1 line-clamp-2 text-xs text-ink-600 dark:text-ink-400">
                        {lead.message}
                      </p>
                    ) : null}

                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <select
                        className="field"
                        value={lead.status}
                        disabled={leadActing === lead.lead_key}
                        onChange={(e) => handleUpdateLead(lead, { status: e.target.value })}
                      >
                        <option value="new">{t("leadNew")}</option>
                        <option value="contacted">{t("leadContacted")}</option>
                        <option value="won">{t("leadWon")}</option>
                        <option value="lost">{t("leadLost")}</option>
                      </select>
                      <input
                        className="field"
                        type="text"
                        placeholder={t("leadAssignee")}
                        value={draft.assignee}
                        onChange={(e) => setDraft({ assignee: e.target.value })}
                      />
                      <input
                        className="field"
                        type="date"
                        aria-label={t("leadReminder")}
                        value={draft.reminder_date}
                        onChange={(e) => setDraft({ reminder_date: e.target.value })}
                      />
                      <input
                        className="field"
                        type="text"
                        placeholder={t("leadNote")}
                        value={draft.note}
                        onChange={(e) => setDraft({ note: e.target.value })}
                      />
                    </div>
                    {dirty ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm mt-2"
                        disabled={leadActing === lead.lead_key}
                        onClick={() =>
                          handleUpdateLead(lead, {
                            note: draft.note,
                            reminder_date: draft.reminder_date || "",
                            assignee: draft.assignee,
                          })
                        }
                      >
                        {t("leadSave")}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-600 dark:text-ink-400">
              {leadLoading ? "—" : t("leadEmpty")}
            </p>
          )}

          {/* Talep analitiği */}
          <h3 className="pt-2 text-base font-semibold tracking-tight text-ink-900 dark:text-white">
            {t("demandTitle")}
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="surface-card p-4">
              <h4 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-200">
                {t("demandFunnel")}
              </h4>
              {demand?.funnel?.length ? (
                <ul className="space-y-2">
                  {demand.funnel.map((step, i) => {
                    const top = demand.funnel[0]?.value || 1;
                    const prev = i > 0 ? demand.funnel[i - 1]?.value || 0 : null;
                    const pct = Math.max(2, Math.round((step.value / top) * 100));
                    return (
                      <li key={step.key}>
                        <div className="flex items-center justify-between text-xs text-ink-600 dark:text-ink-400">
                          <span>{t(`funnel_${step.key}`)}</span>
                          <span className="font-mono tabular-nums">
                            {Number(step.value).toLocaleString("tr-TR")}
                            {prev != null && prev > 0
                              ? ` · ${Math.round((step.value / prev) * 100)}%`
                              : ""}
                          </span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-ink-100 dark:bg-ink-800">
                          <div
                            className="h-2 rounded-full bg-brand-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-ink-600 dark:text-ink-400">{t("revNoData")}</p>
              )}
            </div>

            <div className="surface-card p-4">
              <h4 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-200">
                {t("demandMisses")}
                {demand?.searchMisses?.total ? (
                  <span className="ml-2 font-mono text-xs text-ink-500 dark:text-ink-400">
                    {demand.searchMisses.total}
                  </span>
                ) : null}
              </h4>
              {demand?.searchMisses?.top?.length ? (
                <ul className="divide-y divide-ink-200 text-sm dark:divide-ink-700/60">
                  {demand.searchMisses.top.map((m) => (
                    <li
                      key={m.query_norm}
                      className="flex items-center justify-between gap-3 py-1.5"
                    >
                      <span className="min-w-0 truncate text-ink-800 dark:text-ink-200">
                        {m.ornek || m.query_norm}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-ink-500 dark:text-ink-400">
                        × {m.adet}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-600 dark:text-ink-400">{t("demandMissesEmpty")}</p>
              )}
            </div>

            <div className="surface-card p-4">
              <h4 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-200">
                {t("demandByCity")}
              </h4>
              {demand?.demand?.byCity?.length ? (
                <ul className="divide-y divide-ink-200 text-sm dark:divide-ink-700/60">
                  {demand.demand.byCity.map((r) => (
                    <li key={r.city} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="truncate text-ink-800 dark:text-ink-200">{r.city}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-ink-500 dark:text-ink-400">
                        {r.adet}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-600 dark:text-ink-400">{t("revNoData")}</p>
              )}
            </div>

            <div className="surface-card p-4">
              <h4 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-200">
                {t("demandTopBusinesses")}
              </h4>
              {demand?.demand?.byCurrency?.length ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {demand.demand.byCurrency.map((r) => (
                    <span
                      key={r.currency}
                      className="rounded-control bg-ink-100 px-2 py-0.5 font-mono text-xs text-ink-700 dark:bg-ink-800 dark:text-ink-300"
                    >
                      {r.currency} · {r.adet}
                    </span>
                  ))}
                </div>
              ) : null}
              {demand?.demand?.topBusinesses?.length ? (
                <ul className="divide-y divide-ink-200 text-sm dark:divide-ink-700/60">
                  {demand.demand.topBusinesses.map((r) => (
                    <li
                      key={r.institution_id}
                      className="flex items-center justify-between gap-3 py-1.5"
                    >
                      <span className="truncate text-ink-800 dark:text-ink-200">
                        {r.institution_name}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-ink-500 dark:text-ink-400">
                        {r.adet}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-600 dark:text-ink-400">{t("revNoData")}</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* P3.6 — ödeme dekontları onay kuyruğu */}
      {tab === "proofs" && (
        <section className="space-y-4">
          {proofError ? (
            <p className="rounded-control border border-danger-600/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-700 dark:text-danger-300">
              {proofError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {["pending", "approved", "rejected", ""].map((s) => (
              <button
                key={s || "all"}
                type="button"
                onClick={() => setProofFilter(s)}
                className={`rounded-control px-3 py-1 text-xs font-medium transition ${
                  proofFilter === s
                    ? "bg-brand-500 text-white"
                    : "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300"
                }`}
              >
                {s ? t(`renewStatus_${s}`) : t("leadAll")}
                {s === "pending" && proofsPending > 0 ? ` (${proofsPending})` : ""}
              </button>
            ))}
          </div>

          {proofs.length ? (
            <ul className="space-y-3">
              {proofs.map((p) => (
                <li key={p.id} className="surface-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink-900 dark:text-white">
                      {p.institution_name || p.institution_id}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-ink-500 dark:text-ink-400">
                      {String(p.created_at || "").slice(0, 10)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">
                    {p.plan_adi || p.plan_code}
                    {p.amount != null
                      ? ` · ${Number(p.amount).toLocaleString("tr-TR")} ₺`
                      : ""}
                    {p.method ? ` · ${p.method}` : ""}
                    {" · "}
                    <span className={STATUS_TONE_PROOF[p.status] || ""}>
                      {t(`renewStatus_${p.status}`)}
                    </span>
                  </p>
                  {p.note ? (
                    <p className="mt-1 line-clamp-2 text-xs text-ink-600 dark:text-ink-400">
                      {p.note}
                    </p>
                  ) : null}
                  {p.reject_reason ? (
                    <p className="mt-1 text-xs text-danger-700 dark:text-danger-400">
                      {p.reject_reason}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleViewProof(p.id)}
                      className="btn-ghost btn-sm"
                    >
                      {t("proofView")}
                    </button>
                    {p.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          disabled={proofActing === p.id}
                          onClick={() => handleApproveProof(p.id)}
                          className="rounded-lg border border-success-500/40 bg-success-500/10 px-3 py-1.5 text-xs font-semibold text-success-700 hover:bg-success-500/20 disabled:opacity-50 dark:text-success-300"
                        >
                          {t("proofApprove")}
                        </button>
                        <button
                          type="button"
                          disabled={proofActing === p.id}
                          onClick={() => handleRejectProof(p.id)}
                          className="rounded-lg border border-danger-500/40 bg-danger-500/10 px-3 py-1.5 text-xs font-semibold text-danger-700 hover:bg-danger-500/20 disabled:opacity-50 dark:text-danger-300"
                        >
                          {t("proofReject")}
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-600 dark:text-ink-400">
              {proofLoading ? "—" : t("proofEmpty")}
            </p>
          )}

          {proofImage ? (
            <div
              className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 p-4"
              onClick={() => setProofImage(null)}
              role="presentation"
            >
              <div
                className="max-h-[90vh] max-w-2xl overflow-auto rounded-xl bg-white p-3 dark:bg-ink-900"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={t("proofImageTitle")}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink-900 dark:text-white">
                    {proofImage.institution_name || proofImage.institution_id}
                  </span>
                  <button
                    type="button"
                    onClick={() => setProofImage(null)}
                    className="text-sm text-ink-500 hover:text-ink-900 dark:hover:text-white"
                  >
                    ✕
                  </button>
                </div>
                <img
                  src={proofImage.proof_image}
                  alt={t("proofImageTitle")}
                  className="max-h-[75vh] w-full rounded-lg object-contain"
                />
              </div>
            </div>
          ) : null}
        </section>
      )}

      {/*
        R-01: kopmuş dört özelliğin geri bağlandığı sekme. Buradaki tüm veri
        zaten `loadRevenue` tarafından çekiliyordu; tek eksik onu ekrana
        çizmekti. `handleBackfillPayments` de burada yeniden bağlandı.
      */}
      {tab === "revenue" && (
        <section className="space-y-4">
          {payError ? (
            <p className="rounded-control border border-danger-600/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-700 dark:text-danger-300">
              {payError}
            </p>
          ) : null}

          {/* Gelir özeti */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { label: t("revThisMonth"), value: revenue?.buAy },
              { label: t("revThisYear"), value: revenue?.buYil },
              { label: t("revTotal"), value: revenue?.toplam },
              { label: t("revPending"), value: revenue?.bekleyen },
              { label: t("revCount"), value: revenue?.odemeSayisi, plain: true },
            ].map((card) => (
              <div key={card.label} className="surface-card p-4">
                <p className="text-xs font-medium text-ink-600 dark:text-ink-400">{card.label}</p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums text-ink-900 dark:text-white">
                  {payLoading
                    ? "—"
                    : card.plain
                      ? Number(card.value || 0)
                      : `${Number(card.value || 0).toLocaleString("tr-TR")} ₺`}
                </p>
              </div>
            ))}
          </div>

          {/* P3.3 — türetilmiş metrikler (MRR / gecikmiş / churn / LTV) */}
          <div className="surface-card p-4">
            <h3 className="mb-3 text-base font-semibold tracking-tight text-ink-900 dark:text-white">
              {t("revMetricsTitle")}
            </h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: t("revMrr"), value: revAnalytics?.mrr, money: true },
                { label: t("revArr"), value: revAnalytics?.arr, money: true },
                { label: t("revArpa"), value: revAnalytics?.arpa, money: true },
                { label: t("revLtv"), value: revAnalytics?.ltv, money: true },
                { label: t("revActivePaying"), value: revAnalytics?.activePaying },
                {
                  label: t("revOverdue"),
                  value: revAnalytics?.overdueCount,
                  hint:
                    revAnalytics?.overdueAmount != null
                      ? `${Number(revAnalytics.overdueAmount).toLocaleString("tr-TR")} ₺`
                      : null,
                  danger: (revAnalytics?.overdueCount || 0) > 0,
                },
                { label: t("revChurn"), value: revAnalytics?.churned90d },
                {
                  label: t("revChurnRate"),
                  value: revAnalytics?.churnRate,
                  suffix: "%",
                },
              ].map((card) => (
                <div key={card.label} className="rounded-control bg-ink-50 p-3 dark:bg-ink-800/40">
                  <p className="text-xs font-medium text-ink-600 dark:text-ink-400">{card.label}</p>
                  <p
                    className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                      card.danger
                        ? "text-danger-700 dark:text-danger-400"
                        : "text-ink-900 dark:text-white"
                    }`}
                  >
                    {payLoading || revAnalytics == null
                      ? "—"
                      : card.money
                        ? `${Number(card.value || 0).toLocaleString("tr-TR")} ₺`
                        : `${Number(card.value || 0).toLocaleString("tr-TR")}${card.suffix || ""}`}
                  </p>
                  {card.hint ? (
                    <p className="mt-0.5 font-mono text-xs text-ink-500 dark:text-ink-400">
                      {card.hint}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/*
            R-01: `handleCreatePayment` tanımlıydı ama hiçbir yerden
            çağrılmıyordu — süper adminin ödeme kaydetme yolu yoktu.
            Tutar boş bırakılırsa seçilen paketin fiyatı sunucuda uygulanır.
          */}
          <form
            className="surface-card space-y-3 p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!payForm.institution_id || !payForm.plan_code) return;
              setPaySaving(true);
              setPayError("");
              setPaySaved(false);
              try {
                const today = new Date().toISOString().slice(0, 10);
                await handleCreatePayment({
                  ...payForm,
                  tutar: payForm.tutar === "" ? undefined : Number(payForm.tutar),
                  kdv: payForm.kdv === "" ? undefined : Number(payForm.kdv),
                  discount_code: payForm.discount_code || undefined,
                  odeme_tarihi: new Date().toISOString(),
                  donem_baslangic: today,
                });
                setPayForm({
                  institution_id: "",
                  plan_code: "",
                  tutar: "",
                  kdv: "",
                  yontem: "",
                  discount_code: "",
                });
                setPaySaved(true);
              } catch (err) {
                setPayError(err.message || "Tahsilat kaydedilemedi.");
              } finally {
                setPaySaving(false);
              }
            }}
          >
            <h3 className="text-base font-semibold tracking-tight text-ink-900 dark:text-white">
              {t("revNewPayment")}
            </h3>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {/*
                R-… Native <select> yerine SearchableSelect: dosyadaki diğer
                sekiz kullanımla aynı — animasyonlu açılır menü, aranabilir,
                klavye gezinmeli. `required` kaldırıldı; gönderim zaten
                `if (!payForm.institution_id || !payForm.plan_code) return`
                ile korunuyor.
              */}
              <div className="block">
                <SearchableSelect
                  label={t("revBusiness")}
                  value={payForm.institution_id}
                  onChange={(value) =>
                    setPayForm((f) => ({ ...f, institution_id: value }))
                  }
                  options={businesses.map((b) => ({
                    value: b.institution_id,
                    label: b.institution_name,
                  }))}
                  placeholder={t("revPickBusiness")}
                />
              </div>

              <div className="block">
                <SearchableSelect
                  label={t("revPlan")}
                  value={payForm.plan_code}
                  onChange={(value) => setPayForm((f) => ({ ...f, plan_code: value }))}
                  options={plans.map((p) => ({ value: p.code, label: p.ad }))}
                  placeholder={t("revPickPlan")}
                />
              </div>

              <label className="block">
                <span className="field-label">{t("revAmount")}</span>
                <input
                  className="field"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={payForm.tutar}
                  onChange={(e) => setPayForm((f) => ({ ...f, tutar: e.target.value }))}
                />
              </label>

              <label className="block">
                <span className="field-label">{t("revVat")}</span>
                <input
                  className="field"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={payForm.kdv}
                  onChange={(e) => setPayForm((f) => ({ ...f, kdv: e.target.value }))}
                />
              </label>

              <label className="block">
                <span className="field-label">{t("revMethod")}</span>
                <input
                  className="field"
                  type="text"
                  value={payForm.yontem}
                  onChange={(e) => setPayForm((f) => ({ ...f, yontem: e.target.value }))}
                />
              </label>

              <label className="block">
                <span className="field-label">{t("revDiscountOptional")}</span>
                <input
                  className="field uppercase"
                  type="text"
                  value={payForm.discount_code}
                  onChange={(e) =>
                    setPayForm((f) => ({ ...f, discount_code: e.target.value.toUpperCase() }))
                  }
                  list="discount-code-list"
                />
                <datalist id="discount-code-list">
                  {discountCodes
                    .filter((c) => c.aktif)
                    .map((c) => (
                      <option key={c.code} value={c.code} />
                    ))}
                </datalist>
              </label>
            </div>

            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary btn-sm" disabled={paySaving}>
                {t("revSave")}
              </button>
              {paySaved ? (
                <span className="text-sm text-success-700 dark:text-success-400">
                  {t("revSaved")}
                </span>
              ) : null}
            </div>
          </form>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Pakete göre dağılım */}
            <div className="surface-card p-4">
              <h3 className="mb-3 text-base font-semibold tracking-tight text-ink-900 dark:text-white">
                {t("revByPlan")}
              </h3>
              {revenue?.paketDagilimi?.length ? (
                <ul className="divide-y divide-ink-200 text-sm dark:divide-ink-700/60">
                  {revenue.paketDagilimi.map((row) => (
                    <li key={row.plan_code} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate text-ink-800 dark:text-ink-200">
                        {row.plan_adi || row.plan_code}
                        <span className="ml-2 text-xs text-ink-500 dark:text-ink-400">
                          × {row.adet}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-ink-900 dark:text-white">
                        {Number(row.toplam || 0).toLocaleString("tr-TR")} ₺
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-600 dark:text-ink-400">{t("revNoData")}</p>
              )}
              <button
                type="button"
                onClick={handleBackfillPayments}
                className="btn-ghost btn-sm mt-4"
              >
                {t("revBackfill")}
              </button>
            </div>

            {/* Süresi yaklaşanlar */}
            <div className="surface-card p-4">
              <h3 className="mb-3 text-base font-semibold tracking-tight text-ink-900 dark:text-white">
                {t("revExpiring")}
              </h3>
              {expiring.length ? (
                <ul className="divide-y divide-ink-200 text-sm dark:divide-ink-700/60">
                  {expiring.map((row) => (
                    <li
                      key={row.institution_id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0 truncate text-ink-800 dark:text-ink-200">
                        {row.institution_name}
                        <span className="ml-2 text-xs text-ink-500 dark:text-ink-400">
                          {row.subscription_type}
                        </span>
                      </span>
                      {/*
                        Backend `days_remaining <= n` filtresi uyguladığı için
                        süresi ÇOKTAN DOLMUŞ abonelikler de bu listeye giriyor
                        ve negatif değer taşıyor. "-25 gün kaldı" anlamsız bir
                        cümle; bu durumda kalan gün değil, dolmuş olduğu
                        yazılır.
                      */}
                      <span
                        className={`shrink-0 font-mono text-xs tabular-nums ${
                          Number(row.days_remaining) <= 7
                            ? "text-danger-700 dark:text-danger-400"
                            : "text-warning-700 dark:text-warning-400"
                        }`}
                      >
                        {Number(row.days_remaining) < 0
                          ? t("revExpired")
                          : `${row.days_remaining} ${t("revDaysLeft")}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-600 dark:text-ink-400">{t("revExpiringEmpty")}</p>
              )}
            </div>

            {/* Paketler */}
            <div className="surface-card p-4">
              <h3 className="mb-3 text-base font-semibold tracking-tight text-ink-900 dark:text-white">
                {t("revPlans")}
              </h3>
              {plans.length ? (
                <ul className="divide-y divide-ink-200 text-sm dark:divide-ink-700/60">
                  {plans.map((p) => (
                    <li key={p.code} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate text-ink-800 dark:text-ink-200">
                        {p.ad}
                        <span className="ml-2 text-xs text-ink-500 dark:text-ink-400">
                          {p.sure_gun > 0 ? `${p.sure_gun} gün` : "süresiz"}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-ink-900 dark:text-white">
                        {Number(p.fiyat || 0).toLocaleString("tr-TR")} ₺
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-600 dark:text-ink-400">{t("revNoData")}</p>
              )}
            </div>

            {/* Ortaklık başvuruları — form gönderiyordu ama kimse göremiyordu. */}
            <div className="surface-card p-4">
              <h3 className="mb-3 text-base font-semibold tracking-tight text-ink-900 dark:text-white">
                {t("revApplications")}
                {partnershipApps.length ? (
                  <span className="ml-2 rounded-control bg-brand-500/15 px-2 py-0.5 font-mono text-xs text-brand-700 dark:text-brand-300">
                    {partnershipApps.length}
                  </span>
                ) : null}
              </h3>
              {partnershipApps.length ? (
                <ul className="divide-y divide-ink-200 text-sm dark:divide-ink-700/60">
                  {partnershipApps.map((a) => (
                    <li key={a.id} className="py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-medium text-ink-900 dark:text-white">
                          {a.institution_name}
                        </span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-ink-500 dark:text-ink-400">
                          {String(a.created_at || "").slice(0, 10)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-600 dark:text-ink-400">
                        {a.contact_person} · {a.email} · {a.phone}
                      </p>
                      {a.message ? (
                        <p className="mt-1 line-clamp-2 text-xs text-ink-600 dark:text-ink-400">
                          {a.message}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-600 dark:text-ink-400">
                  {t("revApplicationsEmpty")}
                </p>
              )}
            </div>

            {/* P3.3 — indirim kodları */}
            <div className="surface-card p-4">
              <h3 className="mb-3 text-base font-semibold tracking-tight text-ink-900 dark:text-white">
                {t("revDiscountCodes")}
              </h3>
              <form className="mb-3 grid gap-2 sm:grid-cols-2" onSubmit={handleCreateDiscount}>
                <input
                  className="field uppercase"
                  type="text"
                  placeholder={t("revDiscountCode")}
                  value={discountForm.code}
                  onChange={(e) =>
                    setDiscountForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                  }
                />
                <select
                  className="field"
                  value={discountForm.tur}
                  onChange={(e) => setDiscountForm((f) => ({ ...f, tur: e.target.value }))}
                >
                  <option value="percent">{t("revDiscountPercent")}</option>
                  <option value="fixed">{t("revDiscountFixed")}</option>
                </select>
                <input
                  className="field"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder={t("revDiscountValue")}
                  value={discountForm.deger}
                  onChange={(e) => setDiscountForm((f) => ({ ...f, deger: e.target.value }))}
                />
                <input
                  className="field"
                  type="number"
                  min="0"
                  step="1"
                  placeholder={t("revDiscountMaxUse")}
                  value={discountForm.max_kullanim}
                  onChange={(e) =>
                    setDiscountForm((f) => ({ ...f, max_kullanim: e.target.value }))
                  }
                />
                <input
                  className="field"
                  type="date"
                  aria-label={t("revDiscountExpiry")}
                  value={discountForm.gecerlilik_bitis}
                  onChange={(e) =>
                    setDiscountForm((f) => ({ ...f, gecerlilik_bitis: e.target.value }))
                  }
                />
                <button
                  type="submit"
                  className="btn-ghost btn-sm"
                  disabled={discountBusy || !discountForm.code || !discountForm.deger}
                >
                  {t("revDiscountAdd")}
                </button>
              </form>
              {discountCodes.length ? (
                <ul className="divide-y divide-ink-200 text-sm dark:divide-ink-700/60">
                  {discountCodes.map((c) => (
                    <li key={c.code} className="flex items-center justify-between gap-2 py-2">
                      <span className="min-w-0 truncate">
                        <span className="font-mono font-semibold text-ink-900 dark:text-white">
                          {c.code}
                        </span>
                        <span className="ml-2 text-xs text-ink-500 dark:text-ink-400">
                          {c.tur === "fixed"
                            ? `${Number(c.deger).toLocaleString("tr-TR")} ₺`
                            : `%${c.deger}`}
                          {" · "}
                          {c.kullanim_sayisi}
                          {c.max_kullanim > 0 ? `/${c.max_kullanim}` : ""} {t("revDiscountUsed")}
                          {c.gecerlilik_bitis ? ` · ${c.gecerlilik_bitis}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleDiscount(c.code, !c.aktif)}
                          className={`rounded-control px-2 py-0.5 text-xs font-medium ${
                            c.aktif
                              ? "bg-success-500/15 text-success-700 dark:text-success-300"
                              : "bg-ink-200 text-ink-600 dark:bg-ink-700 dark:text-ink-300"
                          }`}
                        >
                          {c.aktif ? t("revDiscountActive") : t("revDiscountInactive")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDiscount(c.code)}
                          className="text-xs text-danger-700 hover:underline dark:text-danger-400"
                        >
                          {t("revDiscountDelete")}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-600 dark:text-ink-400">{t("revDiscountNone")}</p>
              )}
            </div>

            {/* P3.3 — son tahsilatlar + makbuz + CSV */}
            <div className="surface-card p-4 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold tracking-tight text-ink-900 dark:text-white">
                  {t("revRecentPayments")}
                </h3>
                <button
                  type="button"
                  onClick={handleExportPaymentsCsv}
                  className="btn-ghost btn-sm"
                  disabled={!payments.length}
                >
                  {t("revExportCsv")}
                </button>
              </div>
              {payments.length ? (
                <ul className="divide-y divide-ink-200 text-sm dark:divide-ink-700/60">
                  {payments.slice(0, 12).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate text-ink-800 dark:text-ink-200">
                        {p.institution_name || p.institution_id}
                        <span className="ml-2 text-xs text-ink-500 dark:text-ink-400">
                          {String(p.odeme_tarihi || "").slice(0, 10)} · {p.plan_adi || p.plan_code}
                          {Number(p.indirim_tutari) > 0 ? ` · ${p.indirim_kodu}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="font-mono tabular-nums text-ink-900 dark:text-white">
                          {(
                            (Number(p.tutar) || 0) + (Number(p.kdv) || 0)
                          ).toLocaleString("tr-TR")}{" "}
                          ₺
                        </span>
                        <button
                          type="button"
                          onClick={() => openReceipt(p)}
                          className="text-xs text-brand-700 hover:underline dark:text-brand-300"
                        >
                          {t("revReceipt")}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-600 dark:text-ink-400">{t("revNoData")}</p>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === "support" && (
        <section className="rounded-card border border-ink-200 bg-white overflow-hidden dark:border-ink-800 dark:bg-ink-900/80">
          <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3 dark:border-ink-800">
            <div className="flex items-center gap-2 text-ink-800 dark:text-ink-200">
              <h2 className="font-semibold">{t("supportAdminTab")}</h2>
              {supportOpen > 0 ? (
                <span className="inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-warning-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {supportOpen}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={loadSupportTickets}
              className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
            >
              {t("refresh")}
            </button>
          </div>

          {supportLoading && supportTickets.length === 0 ? (
            <p className="p-4 text-sm text-ink-500 dark:text-ink-400">{t("loadingShort")}</p>
          ) : supportTickets.length === 0 ? (
            <p className="p-4 text-sm text-ink-500 dark:text-ink-400">{t("supportAdminEmpty")}</p>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {supportTickets.map((tk) => {
                const draft =
                  supportReplyDraft[tk.id] !== undefined
                    ? supportReplyDraft[tk.id]
                    : tk.admin_reply || "";
                const acting = supportActingId === tk.id;
                return (
                  <li key={tk.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">
                          {tk.subject}
                        </p>
                        <p className="text-[11px] text-ink-500 dark:text-ink-400">
                          {t("supportAdminFrom")}: {tk.business_name || tk.reporter_username} ·{" "}
                          {parseDateLoose(tk.created_at)?.toLocaleString("tr-TR") || "—"}
                        </p>
                      </div>
                      <select
                        value={tk.status}
                        disabled={acting}
                        onChange={(e) => handleSupportUpdate(tk.id, { status: e.target.value })}
                        className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
                      >
                        <option value="open">{t("supportStatusOpen")}</option>
                        <option value="answered">{t("supportStatusAnswered")}</option>
                        <option value="closed">{t("supportStatusClosed")}</option>
                      </select>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-xs text-ink-600 dark:text-ink-300">
                      {tk.message}
                    </p>
                    <div className="mt-2">
                      <FloatingTextarea
                        label={t("supportAdminReplyLabel")}
                        value={draft}
                        rows={2}
                        maxLength={5000}
                        placeholder={t("supportAdminReplyPlaceholder")}
                        onChange={(e) =>
                          setSupportReplyDraft((prev) => ({ ...prev, [tk.id]: e.target.value }))
                        }
                      />
                      <div className="mt-1.5 flex justify-end">
                        <button
                          type="button"
                          disabled={acting || !draft.trim() || draft.trim() === (tk.admin_reply || "")}
                          onClick={() => handleSupportUpdate(tk.id, { admin_reply: draft.trim() })}
                          className="btn btn-sm btn-primary"
                        >
                          {acting ? t("supportSubmitting") : t("supportAdminSave")}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "health" && (
        <section className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <HeartPulse className="size-5 text-brand-600 dark:text-brand-400" />
              <h2 className="font-semibold">{t("healthMonitorTitle")}</h2>
            </div>
            <button type="button" onClick={loadSystemHealth} className="text-xs text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white">
              {t("refresh")}
            </button>
          </div>

          {opsData ? (
            (() => {
              const labelKeys = {
                rates: "opsRates",
                dualWrite: "opsDualWrite",
                drift: "opsDrift",
                supabase: "opsSupabase",
                hydrate: "opsHydrate",
                auditChain: "opsAuditChain",
                migrations: "opsMigrations",
                expiring: "opsExpiring",
              };
              const dot = {
                ok: "bg-success-500",
                warn: "bg-warning-500",
                down: "bg-danger-500",
                unknown: "bg-ink-400",
              };
              const bannerCls =
                opsData.overall === "down"
                  ? "border-danger-500/30 bg-danger-500/10 text-danger-700 dark:text-danger-200"
                  : opsData.overall === "warn"
                    ? "border-warning-500/30 bg-warning-500/10 text-warning-700 dark:text-warning-200"
                    : "border-success-500/30 bg-success-500/10 text-success-700 dark:text-success-200";
              const bannerText =
                opsData.overall === "down"
                  ? t("opsOverallDown")
                  : opsData.overall === "warn"
                    ? t("opsOverallWarn")
                    : t("opsOverallOk");
              return (
                <div className="space-y-3">
                  <div className={`rounded-card border px-3 py-2 text-sm font-semibold ${bannerCls}`}>
                    {t("opsTitle")}: {bannerText}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {(opsData.checks || []).map((c) => (
                      <div
                        key={c.key}
                        className="rounded-card border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-900/80"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`size-2 shrink-0 rounded-full ${dot[c.status] || dot.unknown}`} />
                          <span className="text-xs font-semibold text-ink-800 dark:text-ink-100">
                            {t(labelKeys[c.key] || c.key)}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-ink-500 dark:text-ink-400">{c.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()
          ) : null}

          {/* P2.6 — pazar yeri sağlığı (S2): bayat marj, kur sanity, kapsama boşluğu. */}
          <MarketHealthPanel token={token} />

          {/* P3.2 — kur alarmı değer sinyali (C3). */}
          <RateAlertPanel token={token} />

          {healthLoading ? (
            <p className="text-sm text-ink-500 dark:text-ink-400">{t("loadingShort")}</p>
          ) : healthError ? (
            <p className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-700 dark:text-danger-200">
              {healthError}
            </p>
          ) : healthData ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-card border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/80">
                  <p className="text-xs font-semibold tracking-wide text-ink-600 dark:text-ink-400">
                    {t("healthMbRates")}
                  </p>
                  <p className="mt-2 text-sm text-ink-800 dark:text-ink-100">
                    {t("healthLastFetch")}:{" "}
                    {healthData.rates?.lastOkAt
                      ? formatRequestDateTime(healthData.rates.lastOkAt)
                      : "—"}
                  </p>
                  <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                    {t("healthLastAttempt")}:{" "}
                    {healthData.rates?.lastAttemptAt
                      ? formatRequestDateTime(healthData.rates.lastAttemptAt)
                      : "—"}
                  </p>
                  <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                    XML: {healthData.rates?.centralBankXmlDate || "—"}
                    {healthData.rates?.source ? ` · ${healthData.rates.source}` : ""}
                  </p>
                  {healthData.rates?.lastError ? (
                    <p className="mt-2 text-xs text-danger-700 dark:text-danger-400">
                      {t("healthMbError")}: {healthData.rates.lastError}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-card border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/80">
                  <p className="text-xs font-semibold tracking-wide text-ink-600 dark:text-ink-400">
                    {t("healthDualWrite")}
                  </p>
                  <p className="mt-2 text-2xl font-bold text-ink-900 dark:text-white">
                    {healthData.dualWrite?.count || 0}
                  </p>
                  {(healthData.dualWrite?.recent || []).length === 0 ? (
                    <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                      {t("healthDualWriteEmpty")}
                    </p>
                  ) : (
                    <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-danger-700 dark:text-danger-300">
                      {(healthData.dualWrite.recent || []).slice(0, 5).map((err, idx) => (
                        <li key={`${err.at}-${idx}`}>
                          {err.op}: {err.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-card border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/80">
                  <p className="text-xs font-semibold tracking-wide text-ink-600 dark:text-ink-400">
                    {t("healthDriftTitle")}
                  </p>
                  {healthData.drift?.ok === false ? (
                    <p className="mt-2 text-sm text-warning-700 dark:text-warning-300">
                      {t("healthDriftUnavailable")}
                    </p>
                  ) : (healthData.drift?.drifts || []).length === 0 ? (
                    <p className="mt-2 text-sm text-success-700 dark:text-success-300">
                      {t("healthDriftOk")}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-warning-700 dark:text-warning-300">
                      {t("healthDriftWarn")} ({healthData.drift.drifts.length})
                    </p>
                  )}
                </div>
              </div>

              {(healthData.drift?.drifts || []).length > 0 ? (
                <div className="rounded-xl border border-warning-500/40 bg-warning-500/10 p-4">
                  <div className="mb-2 flex items-center gap-2 text-warning-800 dark:text-warning-200">
                    <AlertTriangle className="size-4" />
                    <p className="text-sm font-semibold">{t("healthDriftWarn")}</p>
                  </div>
                  <ul className="space-y-1 text-xs text-warning-900 dark:text-warning-100">
                    {healthData.drift.drifts.map((d, idx) => (
                      <li key={`${d.institution_id}-${d.field}-${idx}`}>
                        <span className="font-medium">{d.institution_name || d.institution_id}</span>
                        {" · "}
                        <span className="font-mono">{d.field}</span>
                        {": SQLite="}
                        {String(d.sqlite)}
                        {" / Supabase="}
                        {String(d.supabase)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="rounded-card border border-ink-200 bg-white overflow-hidden dark:border-ink-800 dark:bg-ink-900/80">
                <div className="border-b border-ink-200 px-4 py-3 dark:border-ink-800">
                  <h2 className="font-semibold">{t("auditLogTitle")}</h2>
                </div>
                {(healthData.audit || []).length === 0 ? (
                  <p className="p-4 text-sm text-ink-500 dark:text-ink-400">{t("auditLogEmpty")}</p>
                ) : (
                  <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                    {(healthData.audit || []).map((row) => {
                      const actionLabel =
                        row.action === "password_reset"
                          ? t("auditPasswordReset")
                          : row.action === "password_change"
                            ? t("auditPasswordChange")
                            : row.action === "password_reset_requested"
                              ? t("auditPasswordResetRequested")
                              : row.action === "business_delete"
                                ? t("auditBusinessDelete")
                                : row.action;
                      return (
                        <li key={row.id || `${row.action}-${row.created_at}`} className="px-4 py-3 text-sm">
                          <p className="font-medium text-ink-900 dark:text-white">{actionLabel}</p>
                          <p className="text-xs text-ink-500 dark:text-ink-400">
                            {row.institution_name || row.institution_id || "—"}
                            {row.actor ? ` · ${row.actor}` : ""}
                            {" · "}
                            {formatRequestDateTime(row.created_at)}
                          </p>
                          {row.detail ? (
                            <p className="mt-0.5 text-xs text-ink-600 dark:text-ink-300">{row.detail}</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </section>
      )}

      {tab === "logs" && (
        <ActivityLogPanel
          token={token}
          mode="admin"
          businesses={businesses.map((b) => ({
            institution_id: b.institution_id,
            institution_name: b.institution_name,
          }))}
        />
      )}

      {ledgerView === "subscription" && (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-ink-950/70 backdrop-blur-sm p-3 sm:p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && e.currentTarget.dataset.backdropDown === "1") {
              closeSubscriptionLedger();
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative flex max-h-[90vh] w-[95%] max-w-3xl flex-col gap-4 overflow-hidden rounded-card border border-ink-200 bg-white p-4 shadow-2xl dark:border-ink-700 dark:bg-ink-900 md:w-full md:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-raised flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={closeSubscriptionLedger}
                className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label={t("cancel")}
              >
                <X size={22} />
              </button>
            </div>

            <div className="pr-[7.5rem]">
              <h3 className="flex items-center gap-2 text-lg font-bold text-ink-900 dark:text-ink-100">
                <CreditCard size={20} className="text-brand-600 dark:text-brand-400" />
                {t("subscriptionLedgerTitle")}
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SearchableSelect
                label={t("selectBusinessFilter")}
                value={ledgerScopeBusiness || ""}
                onChange={(value) => setLedgerScopeBusiness(value || null)}
                options={[
                  { value: "", label: t("allBusinesses") },
                  ...ledgerBusinessOptions.map((name) => ({ value: name, label: name })),
                ]}
                placeholder={t("allBusinesses")}
                className="min-w-[200px] flex-1 sm:flex-none sm:min-w-[260px]"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-ink-200 dark:border-ink-800">
              {visibleSubscriptionLedger.length === 0 ? (
                <p className="p-6 text-sm text-ink-500 dark:text-ink-400">{t("ledgerEmpty")}</p>
              ) : (
                <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                  {visibleSubscriptionLedger.map((row) => {
                    const when = formatLedgerDateTime(row.timestamp);
                    return (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="font-mono text-xs text-ink-500 dark:text-ink-400">
                              {when.date}
                            </span>
                            {!ledgerScopeBusiness ? (
                              <span className="text-xs font-semibold text-brand-700 dark:text-brand-400">
                                {row.businessName}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-sm text-ink-800 dark:text-ink-200">
                            {row.plan}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-success-700 dark:text-success-400">
                          {formatMoneyTry(row.amount, lang)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {showSeoModal && (
        <div
          className="fixed inset-0 z-overlay flex items-center justify-center bg-ink-950/70 backdrop-blur-sm p-3 sm:p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && e.currentTarget.dataset.backdropDown === "1") {
              closeSeoModal();
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-card border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-ink-200 px-5 py-4 dark:border-ink-800">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-white">
                    {t("seoModalTitle")}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-warning-700 dark:text-warning-300/90">
                    {t("seoModalHint")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <HeaderActions compact />
                  <button
                    type="button"
                    onClick={closeSeoModal}
                    className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                    aria-label={t("cancel")}
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {seoLoading ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">{t("loadingShort")}</p>
              ) : seoForm ? (
                <form onSubmit={handleSeoSave} className="grid gap-4">
                  <FloatingInput
                    label={t("seoSiteName")}
                    value={seoForm.site_name}
                    onChange={(e) => setSeoForm((p) => ({ ...p, site_name: e.target.value }))}
                  />
                  <FloatingInput
                    label={t("seoTitle")}
                    value={seoForm.title}
                    onChange={(e) => setSeoForm((p) => ({ ...p, title: e.target.value }))}
                    required
                  />
                  <FloatingTextarea
                    label={t("seoDescription")}
                    rows={3}
                    value={seoForm.description}
                    onChange={(e) => setSeoForm((p) => ({ ...p, description: e.target.value }))}
                    required
                  />
                  <FloatingTextarea
                    label={t("seoKeywords")}
                    rows={2}
                    value={seoForm.keywords}
                    onChange={(e) => setSeoForm((p) => ({ ...p, keywords: e.target.value }))}
                  />
                  <FloatingInput
                    label={t("seoFocusQueries")}
                    value={seoForm.focus_queries}
                    onChange={(e) => setSeoForm((p) => ({ ...p, focus_queries: e.target.value }))}
                    placeholder="döviz, dolar tl, döviz bürosu, exchange..."
                  />
                  <FloatingInput
                    label={t("seoCanonical")}
                    value={seoForm.canonical_url}
                    onChange={(e) => setSeoForm((p) => ({ ...p, canonical_url: e.target.value }))}
                  />
                  <FloatingInput
                    label={t("seoOgImage")}
                    value={seoForm.og_image}
                    onChange={(e) => setSeoForm((p) => ({ ...p, og_image: e.target.value }))}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FloatingInput
                      label={t("seoGeoRegion")}
                      value={seoForm.geo_region}
                      onChange={(e) => setSeoForm((p) => ({ ...p, geo_region: e.target.value }))}
                    />
                    <FloatingInput
                      label={t("seoGeoPlace")}
                      value={seoForm.geo_placename}
                      onChange={(e) =>
                        setSeoForm((p) => ({ ...p, geo_placename: e.target.value }))
                      }
                    />
                  </div>
                  <FloatingInput
                    label={t("seoRobots")}
                    value={seoForm.robots}
                    onChange={(e) => setSeoForm((p) => ({ ...p, robots: e.target.value }))}
                  />
                  <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
                    <input
                      type="checkbox"
                      checked={seoForm.structured_data_enabled !== false}
                      onChange={(e) =>
                        setSeoForm((p) => ({
                          ...p,
                          structured_data_enabled: e.target.checked,
                        }))
                      }
                    />
                    {t("seoStructuredData")}
                  </label>

                  {seoError ? (
                    <p className="text-sm text-danger-700 dark:text-danger-300">{seoError}</p>
                  ) : null}
                  {seoSuccess ? (
                    <p className="text-sm text-success-600 dark:text-success-300">{seoSuccess}</p>
                  ) : null}

                  <button type="submit" disabled={seoSaving} className={primaryBtnClass}>
                    {seoSaving ? t("saving") : t("seoSaveBtn")}
                  </button>
                </form>
              ) : (
                <p className="text-sm text-danger-700 dark:text-danger-300">
                  {seoError || t("seoLoadFailed")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {showLogModal && (
        <div
          className="fixed inset-0 z-overlay flex items-center justify-center bg-ink-950/70 backdrop-blur-sm p-3 sm:p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && e.currentTarget.dataset.backdropDown === "1") {
              setShowLogModal(false);
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative rounded-card border border-ink-200 bg-white p-4 md:p-6 w-[95%] md:w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col gap-4 dark:bg-ink-900 dark:border-ink-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-raised flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pr-0 pt-10 sm:pr-[7.5rem] sm:pt-0">
              <h3 className="text-base font-bold text-ink-900 dark:text-ink-100 sm:text-lg">
                {logsView === "customer" ? t("systemLogsTitle") : t("businessLedgerTitle")}
              </h3>
              <div className="flex w-full items-center rounded-lg border border-ink-200 bg-ink-50 p-0.5 text-xs font-semibold sm:w-auto shrink-0 dark:border-ink-700 dark:bg-ink-800">
                <button
                  type="button"
                  onClick={() => setLogsView("customer")}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition sm:flex-none ${
                    logsView === "customer"
                      ? "bg-brand-500/20 text-brand-700 dark:text-brand-300"
                      : "text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-200"
                  }`}
                >
                  <Users size={14} />
                  {t("customerLabel")}
                </button>
                <button
                  type="button"
                  onClick={() => setLogsView("business")}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition sm:flex-none ${
                    logsView === "business"
                      ? "bg-brand-500/20 text-brand-700 dark:text-brand-300"
                      : "text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-200"
                  }`}
                >
                  <Building2 size={14} />
                  {t("businessWord")}
                </button>
              </div>
            </div>

            {logsView === "customer" ? (
              statsLoading ? (
                <p className="text-sm text-ink-600 dark:text-ink-400">{t("loadingGeneric")}</p>
              ) : statsError ? (
                <p className="text-sm text-danger-300">{statsError}</p>
              ) : (
                <>
                  <div className="rounded-xl bg-ink-800 border border-ink-700/80 px-5 py-6 text-center">
                    <p className="text-xs font-medium tracking-wide text-ink-600 dark:text-ink-400">
                      {t("totalUniqueVisitors")}
                    </p>
                    <p className="mt-3 text-4xl font-bold text-success-400">
                      {Number(analyticsData?.total_visitors ?? 0).toLocaleString(
                        lang === "en" ? "en-GB" : "tr-TR"
                      )}
                    </p>
                  </div>

                  <hr className="border-ink-800 my-2" />

                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-ink-200">
                      {t("recentInteractions")}
                    </h4>

                    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
                      <DateRangeFilter
                        from={logDateFrom}
                        to={logDateTo}
                        onFromChange={setLogDateFrom}
                        onToChange={setLogDateTo}
                        t={t}
                      />
                      <SearchableSelect
                        label={t("selectBusinessFilter")}
                        value={filterBusiness}
                        onChange={(value) => setFilterBusiness(value)}
                        options={[
                          { value: "", label: t("allBusinesses") },
                          ...businessFilterOptions.map((name) => ({ value: name, label: name })),
                        ]}
                        placeholder={t("allBusinesses")}
                      />

                      <SearchableSelect
                        label={t("filterCurrencyLabel")}
                        value={filterCurrency}
                        onChange={(value) => setFilterCurrency(value)}
                        options={[
                          { value: "", label: t("allCurrencies") },
                          ...currencyFilterOptions.map((cur) => ({ value: cur, label: cur })),
                        ]}
                        placeholder={t("allCurrencies")}
                      />

                      <SearchableSelect
                        label={t("actionTypeLabel")}
                        value={filterAction}
                        onChange={(value) => setFilterAction(value)}
                        options={[
                          { value: "", label: t("allActions") },
                          { value: "location", label: t("onlyLocationViewers") },
                          { value: "currency", label: t("onlyCurrencyViewers") },
                          { value: "business", label: t("onlyBusinessViewers") },
                        ]}
                        placeholder={t("allActions")}
                      />
                    </div>

                    <ul className="max-h-[300px] space-y-3 overflow-y-auto pr-1">
                      {filteredLogData.length === 0 ? (
                        <li className="rounded-xl border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-ink-500">
                          {logData.length === 0 ? t("noAnonymousSessions") : t("noMatchingRecords")}
                        </li>
                      ) : (
                        filteredLogData.map((session) => (
                          <li
                            key={session.session_id}
                            className="rounded-xl border border-ink-800 bg-ink-950/60 px-4 py-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-medium text-brand-400">
                                {formatRelativeTime(session.created_at)}
                              </span>
                              <span className="text-[11px] text-ink-500">{t("anonymousSession")}</span>
                            </div>
                            <dl className="mt-2 space-y-1.5 text-sm">
                              <div className="flex flex-wrap gap-x-2">
                                <dt className="text-ink-500">{t("estimatedLocation")}</dt>
                                <dd className="text-ink-200">{session.location || "—"}</dd>
                              </div>
                              <div className="flex flex-wrap gap-x-2">
                                <dt className="text-ink-500">{t("viewedBusinesses")}</dt>
                                <dd className="text-ink-200">
                                  {(session.clicked_businesses || []).length
                                    ? session.clicked_businesses.join(", ")
                                    : "—"}
                                </dd>
                              </div>
                              <div className="flex flex-wrap gap-x-2">
                                <dt className="text-ink-500">{t("viewedRates")}</dt>
                                <dd className="text-ink-200">
                                  {(session.viewed_currencies || []).length
                                    ? session.viewed_currencies.join(", ")
                                    : "—"}
                                </dd>
                              </div>
                            </dl>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </>
              )
            ) : (
              <div>
                <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <DateRangeFilter
                    from={logDateFrom}
                    to={logDateTo}
                    onFromChange={setLogDateFrom}
                    onToChange={setLogDateTo}
                    t={t}
                  />
                  <SearchableSelect
                    label={t("selectBusinessFilter")}
                    value={bizLogBusiness}
                    onChange={(value) => setBizLogBusiness(value)}
                    options={[
                      { value: "", label: t("allBusinesses") },
                      ...bizLogBusinessOptions.map((name) => ({ value: name, label: name })),
                    ]}
                    placeholder={t("allBusinesses")}
                  />

                  <SearchableSelect
                    label={t("actionTypeLabel")}
                    value={bizLogActionType}
                    onChange={(value) => setBizLogActionType(value)}
                    options={[
                      { value: "", label: t("allActions") },
                      { value: "profile", label: t("actionTypeProfile") },
                      { value: "margin", label: t("actionTypeMargin") },
                      { value: "branch", label: t("actionTypeBranch") },
                    ]}
                    placeholder={t("allActions")}
                  />
                </div>

                <ul className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
                  {filteredBusinessLogs.length === 0 ? (
                    <li className="rounded-xl border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-ink-500">
                      {t("businessLogsEmpty")}
                    </li>
                  ) : (
                    filteredBusinessLogs.map((log) => {
                      const when = formatLedgerDateTime(log.timestamp);
                      return (
                        <li
                          key={log.id}
                          className="rounded-xl border border-ink-800 bg-ink-950/60 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono text-xs font-medium text-brand-400">
                              {when.label}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${actionTypeBadgeClass[log.actionType]}`}
                            >
                              {actionTypeLabel(log.actionType)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-ink-200">
                            <span className="font-semibold text-ink-100">{log.businessName}</span>{" "}
                            — {log.description}
                          </p>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {businessToDelete && (
        <div
          className="fixed inset-0 z-overlay flex items-center justify-center bg-ink-950/70 backdrop-blur-sm p-3 sm:p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && e.currentTarget.dataset.backdropDown === "1") {
              setBusinessToDelete(null);
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative rounded-card border border-ink-200 bg-white p-4 md:p-6 w-[95%] md:w-full max-w-sm shadow-2xl flex flex-col gap-4 dark:bg-ink-900 dark:border-ink-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-raised flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => setBusinessToDelete(null)}
                className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>
            <div className="flex items-center gap-3 pr-[7.5rem]">
              <div className="w-10 h-10 rounded-full bg-danger-500/20 text-danger-500 flex items-center justify-center shrink-0">
                <Trash2 size={20} />
              </div>
              <h3 className="text-lg font-bold text-ink-900 dark:text-ink-100">{t("deleteBusinessTitle")}</h3>
            </div>

            <p className="text-sm text-ink-600 dark:text-ink-300">
              {t("deleteConfirmTemplate").replace(
                '"{name}"',
                `"${businessToDelete.institution_name || businessToDelete.name}"`
              )}
            </p>
            <p className="text-xs text-danger-700 dark:text-danger-400 font-medium dark:text-danger-400">{t("deleteWarning")}</p>

            <div className="flex items-center justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => setBusinessToDelete(null)}
                className="btn-ghost"
              >
                {t("cancelAlt")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = businessToDelete.id;
                  setBusinessToDelete(null);
                  handleDelete(id);
                }}
                className="btn-danger bg-danger-600 text-white hover:bg-danger-500 hover:text-white"
              >
                {t("confirmDeleteBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div
          className="fixed inset-0 z-overlay flex items-center justify-center bg-ink-950/70 backdrop-blur-sm p-3 sm:p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && e.currentTarget.dataset.backdropDown === "1") {
              setShowResetConfirm(false);
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative rounded-card border border-ink-200 bg-white p-4 md:p-6 w-[95%] md:w-full max-w-sm shadow-2xl flex flex-col gap-4 dark:bg-ink-900 dark:border-ink-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-raised flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="rounded-full p-1 text-ink-600 dark:text-ink-400 transition hover:text-danger-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>
            <h3 className="pr-[7.5rem] text-lg font-bold text-ink-900 dark:text-ink-100">{t("resetSubscriptionBtn")}</h3>
            <p className="text-sm text-ink-500 dark:text-ink-400">{t("resetSubConfirmText")}</p>
            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-ink-600 hover:text-ink-900 transition-colors dark:text-ink-300 dark:hover:text-white"
              >
                {t("cancelAlt")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setShowResetConfirm(false);
                  handleResetSubscription();
                }}
                className="btn-danger bg-danger-600 text-white hover:bg-danger-500 hover:text-white"
              >
                {t("confirmResetBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && (
        <div
          className="fixed inset-0 z-overlay flex items-center justify-center bg-ink-950/70 backdrop-blur-sm p-3 sm:p-4"
          onMouseDown={(e) => {
            e.currentTarget.dataset.backdropDown = e.target === e.currentTarget ? "1" : "0";
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && e.currentTarget.dataset.backdropDown === "1") {
              setShowSuccessModal(false);
            }
          }}
        >
          <div role="dialog" aria-modal="true"
            className="relative rounded-card border border-ink-200 bg-white p-4 md:p-6 w-[95%] md:w-full max-w-xs shadow-2xl flex flex-col items-center text-center gap-3 dark:bg-ink-900 dark:border-ink-700"
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
            <div className="w-12 h-12 rounded-full bg-success-500/20 text-success-500 flex items-center justify-center mb-2">
              <Check className="w-6 h-6" strokeWidth={2.5} />
            </div>
            <h3 className="text-lg font-bold text-ink-900 dark:text-ink-100">{t("successTitle")}</h3>
            <p className="text-sm text-ink-500 dark:text-ink-400">{successModalMessage}</p>
            <button
              type="button"
              onClick={() => setShowSuccessModal(false)}
              className="mt-4 w-full px-4 py-2 text-sm font-bold text-white bg-success-600 hover:bg-success-500 rounded-lg transition-colors"
            >
              {t("okBtn")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const primaryBtnClass = "btn-primary";
