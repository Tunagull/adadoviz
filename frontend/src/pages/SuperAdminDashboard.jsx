import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  LogOut,
  Pencil,
  Plus,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import {
  createAdminBusiness,
  fetchAdminBusinesses,
  updateAdminBusiness,
  updateAdminBusinessStatus,
  resetAdminBusinessSubscription,
  deleteAdminBusiness,
  fetchAdminAnalytics,
  fetchAdminBranchRequests,
  fetchAdminBranchRequestsUnread,
  markAdminBranchRequestsRead,
  updateAdminBranchRequest,
  fetchAdminBranches,
  updateAdminBranch,
} from "../lib/auth";
import { BusinessBranchesPanel } from "../components/DealerManagement";
import { BusinessLogoField } from "../components/BusinessLogoField";
import { HeaderActions } from "../components/HeaderActions";
import { SearchableSelect } from "../components/SearchableSelect";

const BUSINESS_ACTION_TYPES = ["profile", "margin", "branch"];

/** Aylık 500 ₺ · Yıllık 5000 ₺ · Test ücretsiz · Manuel elle girilir */
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
  username: "",
  password: "",
  subscriptionType: "Test",
  manualDays: "0",
  price: "0",
  branchLimit: "1",
  logo_url: null,
};

const emptyEditForm = {
  id: null,
  institution_name: "",
  username: "",
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
function BranchQuotaBadge({ used, limit }) {
  const u = Number(used) || 0;
  const lim = Math.max(1, Number(limit) || 1);
  const label = `${u}/${lim}`;
  if (u > lim) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400"
        title="Şube limiti aşıldı"
      >
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        {label}
      </span>
    );
  }
  if (u < lim) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400"
        title="Eksik şube"
      >
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
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
        <label className="text-xs text-slate-500 font-medium dark:text-slate-400">{t("subscriptionTypeLabel")}</label>
        <SearchableSelect
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
          <div className="flex flex-col gap-2 mt-1">
            <label className="text-xs text-slate-500 font-medium dark:text-slate-400">{t("customDaysLabel")}</label>
            <input
              type="number"
              value={form.manualDays}
              onChange={(e) => setForm((prev) => ({ ...prev, manualDays: e.target.value }))}
              className="bg-white border border-slate-200 text-slate-800 rounded-lg px-4 py-2 focus:outline-none focus:border-emerald-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
              placeholder={t("customDaysPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-2 mt-1">
            <label className="text-xs text-slate-500 font-medium dark:text-slate-400">{t("customPriceLabel")}</label>
            <input
              type="number"
              min="0"
              value={form.price}
              onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
              className="bg-white border border-slate-200 text-slate-800 rounded-lg px-4 py-2 focus:outline-none focus:border-emerald-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
              placeholder={t("customPricePlaceholder")}
            />
          </div>
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
    <div className="mt-2 flex w-fit flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
      <div className="flex flex-col items-center">
        <span className="mb-1 text-[10px] text-slate-500 dark:text-slate-400">{t("currentRemainingLabel")}</span>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{currentLabel}</span>
      </div>
      <ArrowRight className="text-slate-400 dark:text-slate-500" size={16} />
      <div className="flex flex-col items-center">
        <span className="mb-1 text-[10px] text-emerald-600/80 dark:text-emerald-500/70">{t("afterUpdateLabel")}</span>
        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{afterLabel}</span>
      </div>
      <div className="ml-1 flex flex-col items-center border-l border-slate-200 pl-3 dark:border-slate-700">
        <span className="mb-1 text-[10px] text-teal-600/80 dark:text-teal-400/70">{t("subscriptionPriceLabel")}</span>
        <span className="text-sm font-bold tabular-nums text-teal-700 dark:text-teal-300">
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
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all duration-300 sm:text-sm ${
        active
          ? "border-cyan-500/40 bg-cyan-500/20 text-cyan-700 shadow-[0_0_12px_rgba(34,211,238,0.35)] dark:text-cyan-300"
          : "border-slate-200 bg-white text-slate-600 hover:border-cyan-400 hover:text-cyan-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-cyan-400 dark:hover:text-cyan-400"
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
    <div
      className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100"
      title={t("dateRangeLabel")}
    >
      <input
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => onFromChange(e.target.value)}
        aria-label={t("dateFromLabel")}
        className="min-w-0 flex-1 bg-transparent text-slate-100 outline-none [color-scheme:dark]"
      />
      <span className="text-slate-500">–</span>
      <input
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => onToChange(e.target.value)}
        aria-label={t("dateToLabel")}
        className="min-w-0 flex-1 bg-transparent text-slate-100 outline-none [color-scheme:dark]"
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
  const [ledgerView, setLedgerView] = useState(null); // null | "subscription"
  const [ledgerScopeBusiness, setLedgerScopeBusiness] = useState(null); // null = tümü, string = işletme adı
  const [analyticsData, setAnalyticsData] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");
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

  const TABS = useMemo(
    () => [
      { id: "list", label: t("tabList") },
      { id: "create", label: t("tabCreate") },
      { id: "requests", label: t("tabRequests") },
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

  const loadBranchRequestUnread = useCallback(async () => {
    if (!token) return;
    try {
      const unread = await fetchAdminBranchRequestsUnread(token);
      setBranchRequestUnread(unread);
    } catch {
      // sessiz
    }
  }, [token]);

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

  const logData = analyticsData?.sessions || [];

  const businessLedger = useMemo(() => [], []);
  const subscriptionLedger = useMemo(() => [], []);

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

  const editSubscriptionLedger = useMemo(() => {
    const name = editForm.institution_name;
    if (!name) return [];
    return subscriptionLedger.filter((row) => row.businessName === name);
  }, [subscriptionLedger, editForm.institution_name]);

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
    profile: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
    margin: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    branch: "border-amber-500/30 bg-amber-500/10 text-amber-300",
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

  const openEdit = (biz) => {
    setEditForm({
      id: biz.id,
      institution_name: biz.institution_name || "",
      username: biz.username || "",
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

  const createCalculatedDays = useMemo(
    () => calculateNewDays(createForm.subscriptionType, 0, createForm.manualDays),
    [createForm.subscriptionType, createForm.manualDays]
  );

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
        username: createForm.username,
        password: createForm.password,
        subscription_type: createForm.subscriptionType,
        remaining_days: createCalculatedDays,
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
        institution_name: editForm.institution_name,
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
      <div className="min-h-[60vh] flex items-center justify-center text-slate-500 text-sm dark:text-slate-400">
        {t("loadingGeneric")}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-6 sm:px-6 sm:py-8 text-slate-800 dark:text-slate-100">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-all duration-300 hover:border-cyan-400 hover:text-cyan-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-cyan-400 dark:hover:text-cyan-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
        >
          <ArrowLeft className="size-4" />
          {t("backToDashboardLink")}
        </button>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 sm:mb-8 sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-xl bg-gradient-to-tr from-teal-500 to-indigo-500 p-2.5 text-white shadow-lg shadow-teal-900/30">
            <Shield className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white sm:text-2xl">{t("superAdminTitle")}</h1>
            <p className="truncate text-sm text-slate-500 dark:text-slate-400">
              {auth?.username} · {t("superAdminSubtitle")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HeaderActions />
          <SubscriptionLedgerButton
            active={ledgerView === "subscription"}
            onClick={() => openSubscriptionLedger(null)}
          />
          <button
            type="button"
            onClick={() => setShowLogModal(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-all duration-300 hover:border-cyan-400 hover:text-cyan-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-cyan-400 dark:hover:text-cyan-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
          >
            <Activity size={18} />
            {t("logsButton")}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-all duration-300 hover:border-red-500 hover:text-red-500 hover:shadow-[0_0_15px_rgba(239,68,68,0.5)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-red-500 dark:hover:text-red-500 dark:hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]"
          >
            <LogOut size={16} />
            {t("logoutShort")}
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setError("");
              setSuccess("");
            }}
            className={`relative inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-300 ${
              tab === item.id
                ? "bg-cyan-500/20 text-cyan-700 border border-cyan-500/40 dark:text-cyan-300"
                : "text-slate-500 border border-transparent hover:border-cyan-400 hover:text-cyan-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] hover:bg-slate-100 dark:text-slate-400 dark:hover:border-cyan-400 dark:hover:text-cyan-400 dark:hover:bg-slate-800/80 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
            }`}
          >
            {item.label}
            {item.id === "requests" && branchRequestUnread > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-rose-500 px-1 py-0.5 text-[10px] font-bold leading-none text-white shadow">
                {branchRequestUnread > 99 ? "99+" : branchRequestUnread}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {success}
        </div>
      ) : null}

      {tab === "list" && (
        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
              <Building2 size={18} className="text-teal-600 dark:text-teal-400" />
              <h2 className="font-semibold">{t("tabList")}</h2>
            </div>
            <button
              type="button"
              onClick={loadBusinesses}
              className="text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              {t("refresh")}
            </button>
          </div>

          {loading ? (
            <p className="p-6 text-sm text-slate-500 dark:text-slate-400">{t("loadingList")}</p>
          ) : businesses.length === 0 ? (
            <p className="p-6 text-sm text-slate-500 dark:text-slate-400">{t("noBusinessesYet")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950/80 dark:text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("colId")}</th>
                    <th className="px-4 py-3 font-medium">{t("colLoginId")}</th>
                    <th className="px-4 py-3 font-medium">{t("businessName")}</th>
                    <th className="px-4 py-3 font-medium">{t("colSubscription")}</th>
                    <th className="px-4 py-3 font-medium">{t("colBranchCount")}</th>
                    <th className="px-4 py-3 font-medium">{t("colRegisteredAt")}</th>
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
                      <tr key={biz.id} className="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800/80 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{biz.id}</td>
                        <td className="px-4 py-3 text-slate-800 font-mono dark:text-slate-200">
                          <button
                            type="button"
                            onClick={() => openEdit(biz)}
                            title={t("editBtn")}
                            className="font-mono text-cyan-700 underline-offset-2 transition hover:text-cyan-500 hover:underline dark:text-cyan-300 dark:hover:text-cyan-200"
                          >
                            {biz.username}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-slate-800 dark:text-slate-100">{biz.institution_name}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-teal-700 dark:border-slate-700 dark:bg-slate-950 dark:text-teal-300">
                            {t("branchBasedSubscription")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <BranchQuotaBadge used={used} limit={limit} />
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap dark:text-slate-300">
                          {formatRegistrationDate(biz.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isActive}
                            disabled={toggleDisabled}
                            onClick={() => handleToggleStatus(biz)}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${
                              isActive
                                ? "border-emerald-500/50 bg-emerald-500/80"
                                : "border-slate-300 bg-slate-300 dark:border-slate-600 dark:bg-slate-700"
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
                          <span className={`ml-2 text-[11px] ${isActive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {isActive ? t("statusActive") : t("statusInactive")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(biz)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition-all duration-300 hover:border-cyan-400 hover:text-cyan-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-400 dark:hover:text-cyan-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                            >
                              <Pencil size={14} />
                              {t("editBtn")}
                            </button>
                            <button
                              type="button"
                              onClick={() => openBranchSubscriptionModal(biz)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-700 transition hover:border-cyan-400 dark:text-cyan-300"
                            >
                              <CreditCard size={14} />
                              {t("addSubscriptionBtn")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setBusinessToDelete(biz)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500 bg-transparent px-3 py-1.5 text-xs font-medium text-red-600 transition-all duration-300 hover:bg-red-500/10 hover:shadow-[0_0_15px_rgba(239,68,68,0.5)] dark:text-red-400 dark:hover:border-red-500 dark:hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                            >
                              <Trash2 size={14} />
                              {t("deleteBtn")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {showEditModal && editForm.id ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-4"
          onClick={closeEditModal}
        >
          <div
            className="relative flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-200 px-5 pb-3 pt-5 dark:border-slate-800 md:px-6">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {editPanelTab === "edit"
                      ? t("editBusinessTitle")
                      : editPanelTab === "business"
                        ? t("businessLedgerTitle")
                        : t("addSubscriptionTitle")}
                  </h2>
                  <span className="mt-0.5 block truncate text-sm font-mono text-cyan-600 dark:text-cyan-300">
                    {editForm.username}
                    {editForm.institution_name ? ` · ${editForm.institution_name}` : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <HeaderActions compact />
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="rounded-full p-1 text-slate-400 transition hover:text-rose-500"
                    aria-label={t("cancel")}
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>

              <div className="inline-flex w-full max-w-full flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-950/60 sm:w-auto">
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
                        ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                        : "text-slate-500 hover:text-cyan-600 dark:text-slate-400 dark:hover:text-cyan-400"
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
                    <Field label={t("businessName")}>
                      <input
                        value={editForm.institution_name}
                        onChange={(e) => setEditForm((p) => ({ ...p, institution_name: e.target.value }))}
                        className={inputClass}
                        required
                      />
                    </Field>
                    <Field label={t("loginIdEmailField")}>
                      <input
                        value={editForm.username}
                        onChange={(e) => setEditForm((p) => ({ ...p, username: e.target.value }))}
                        className={inputClass}
                        required
                      />
                    </Field>
                    <Field label={t("newPasswordOptionalField")}>
                      <input
                        type="password"
                        value={editForm.password}
                        onChange={(e) => setEditForm((p) => ({ ...p, password: e.target.value }))}
                        className={inputClass}
                        placeholder="••••••••"
                        autoComplete="new-password"
                      />
                    </Field>

                    <Field label={t("branchLimitLabel")}>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={editForm.branchLimit}
                        onChange={(e) =>
                          setEditForm((p) => ({ ...p, branchLimit: e.target.value }))
                        }
                        className={inputClass}
                        required
                      />
                    </Field>

                    <div className="mt-2 flex flex-wrap gap-3">
                      <button type="submit" disabled={saving} className={primaryBtnClass}>
                        {saving ? t("saving") : t("saveChangesBtn")}
                      </button>
                      <button
                        type="button"
                        onClick={closeEditModal}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </form>

                  <hr className="my-8 border-slate-200 dark:border-slate-800" />

                  <BusinessBranchesPanel
                    token={token}
                    businessId={editForm.id}
                    businessName={editForm.institution_name}
                    branchLimit={Math.max(1, parseInt(editForm.branchLimit, 10) || 1)}
                  />
                </>
              ) : editPanelTab === "business" ? (
                editBusinessLedger.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    {t("ledgerEmpty")}
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {editBusinessLedger.map((row) => {
                      const when = formatLedgerDateTime(row.timestamp);
                      return (
                        <li key={row.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-3">
                          <span className="shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400 sm:w-36">
                            {when.label}
                          </span>
                          <span className="text-sm text-slate-800 dark:text-slate-200">{row.description}</span>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {t("addSubscriptionHint")}
                  </p>
                  {branchSubLoading ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">{t("loadingShort")}</p>
                  ) : branchSubError && branchSubList.length === 0 ? (
                    <p className="text-sm text-rose-600 dark:text-rose-300">{branchSubError}</p>
                  ) : branchSubList.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
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
                                  ? "border-cyan-500/50 bg-cyan-500/10"
                                  : "border-slate-200 bg-slate-50 hover:border-cyan-400/50 dark:border-slate-700 dark:bg-slate-950"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-slate-900 dark:text-white">
                                  {branch.name}
                                  {!active ? (
                                    <span className="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-300">
                                      {t("statusInactive")}
                                    </span>
                                  ) : null}
                                </span>
                                <span
                                  className={`text-xs font-semibold ${
                                    !active
                                      ? "text-slate-400"
                                      : branch.subscription_type === "Test"
                                        ? "text-cyan-600 dark:text-cyan-300"
                                        : branch.days_remaining != null &&
                                            branch.days_remaining <= 30
                                          ? "text-rose-600 dark:text-rose-400"
                                          : "text-emerald-600 dark:text-emerald-400"
                                  }`}
                                >
                                  {rem}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
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
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 dark:border-slate-700 dark:bg-slate-950/60">
                      <SubscriptionFields form={branchSubForm} setForm={setBranchSubForm} />
                      <SubscriptionPreview
                        currentDays={branchSubForm.currentRemainingDays}
                        newDays={branchSubCalculatedDays}
                        price={branchSubForm.price}
                        lang={lang}
                        t={t}
                      />
                      {branchSubError ? (
                        <p className="text-xs text-rose-600 dark:text-rose-300">{branchSubError}</p>
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
                          className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-700 transition hover:border-cyan-400 dark:text-cyan-300"
                        >
                          {t("extendOneMonthBtn")}
                        </button>
                        <button
                          type="button"
                          disabled={branchSubSaving}
                          onClick={handleToggleBranchActive}
                          className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
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
          className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-4"
          onClick={closeBranchSubscriptionModal}
        >
          <div
            className="relative flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-200 px-5 py-4 dark:border-slate-800 md:px-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {t("addSubscriptionTitle")}
                  </h2>
                  <p className="mt-0.5 truncate text-sm text-cyan-600 dark:text-cyan-300">
                    {branchSubBusiness.institution_name || branchSubBusiness.username}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t("addSubscriptionHint")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <HeaderActions compact />
                  <button
                    type="button"
                    onClick={closeBranchSubscriptionModal}
                    className="rounded-full p-1 text-slate-400 transition hover:text-rose-500"
                    aria-label={t("cancel")}
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6 space-y-4">
              {branchSubLoading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">{t("loadingShort")}</p>
              ) : branchSubError && branchSubList.length === 0 ? (
                <p className="text-sm text-rose-600 dark:text-rose-300">{branchSubError}</p>
              ) : branchSubList.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
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
                              ? "border-cyan-500/50 bg-cyan-500/10"
                              : "border-slate-200 bg-slate-50 hover:border-cyan-400/50 dark:border-slate-700 dark:bg-slate-950"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-slate-900 dark:text-white">
                              {branch.name}
                            </span>
                            <span
                              className={`text-xs font-semibold ${
                                branch.subscription_type === "Test"
                                  ? "text-cyan-600 dark:text-cyan-300"
                                  : branch.days_remaining != null && branch.days_remaining <= 30
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-emerald-600 dark:text-emerald-400"
                              }`}
                            >
                              {rem}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
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
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 dark:border-slate-700 dark:bg-slate-950/60">
                  <SubscriptionFields form={branchSubForm} setForm={setBranchSubForm} />
                  <SubscriptionPreview
                    currentDays={branchSubForm.currentRemainingDays}
                    newDays={branchSubCalculatedDays}
                    price={branchSubForm.price}
                    lang={lang}
                    t={t}
                  />
                  {branchSubError ? (
                    <p className="text-xs text-rose-600 dark:text-rose-300">{branchSubError}</p>
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
                      className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-700 transition hover:border-cyan-400 dark:text-cyan-300"
                    >
                      {t("extendOneMonthBtn")}
                    </button>
                    <button
                      type="button"
                      disabled={branchSubSaving}
                      onClick={handleToggleBranchActive}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
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
        <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="mb-4 flex items-center gap-2">
            <Plus size={18} className="text-teal-600 dark:text-teal-400" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t("tabCreate")}</h2>
          </div>
          <form onSubmit={handleCreate} className="grid gap-4 max-w-xl">
            <BusinessLogoField
              logoUrl={createForm.logo_url}
              name={createForm.institution_name}
              onChange={(logo_url) => setCreateForm((p) => ({ ...p, logo_url }))}
            />
            <Field label={t("businessName")}>
              <input
                value={createForm.institution_name}
                onChange={(e) => setCreateForm((p) => ({ ...p, institution_name: e.target.value }))}
                className={inputClass}
                required
              />
            </Field>
            <Field label={t("loginIdEmailField")}>
              <input
                value={createForm.username}
                onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))}
                className={inputClass}
                required
              />
            </Field>
            <Field label={t("passwordLabel")}>
              <input
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                className={inputClass}
                required
                autoComplete="new-password"
              />
            </Field>
            <SubscriptionFields form={createForm} setForm={setCreateForm} />
            <Field label={t("branchLimitLabel")}>
              <input
                type="number"
                min="1"
                step="1"
                value={createForm.branchLimit}
                onChange={(e) =>
                  setCreateForm((p) => ({ ...p, branchLimit: e.target.value }))
                }
                className={inputClass}
                required
              />
            </Field>
            <SubscriptionPreview
              currentDays={0}
              newDays={createCalculatedDays}
              price={createForm.price}
              lang={lang}
              t={t}
            />
            <button type="submit" disabled={saving} className={primaryBtnClass}>
              {saving ? t("creatingBtn") : t("createBusinessBtn")}
            </button>
          </form>
        </section>
      )}

      {tab === "requests" && (
        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
              <ClipboardList size={18} className="text-teal-600 dark:text-teal-400" />
              <h2 className="font-semibold">{t("tabRequests")}</h2>
              {branchRequestUnread > 0 ? (
                <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {branchRequestUnread}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={loadBranchRequests}
              className="text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              {t("refresh")}
            </button>
          </div>

          {branchRequestsLoading ? (
            <p className="p-6 text-sm text-slate-500 dark:text-slate-400">{t("loadingShort")}</p>
          ) : branchRequestsError ? (
            <p className="p-6 text-sm text-rose-600 dark:text-rose-300">{branchRequestsError}</p>
          ) : branchRequests.length === 0 ? (
            <p className="p-6 text-sm text-slate-500 dark:text-slate-400">{t("requestsEmpty")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {branchRequests.map((req) => {
                const statusLabel =
                  req.status === "approved"
                    ? t("requestStatusApproved")
                    : req.status === "rejected"
                      ? t("requestStatusRejected")
                      : t("requestStatusPending");
                const statusClass =
                  req.status === "approved"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : req.status === "rejected"
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-amber-600 dark:text-amber-400";
                return (
                  <li
                    key={req.id}
                    className={`px-4 py-4 ${
                      req.status === "pending" && !req.is_read
                        ? "bg-cyan-500/5 dark:bg-cyan-500/10"
                        : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {req.branch_name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {t("requestBusinessLabel")}: {req.business_name || req.institution_id}
                        </p>
                        {req.phone ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {t("phoneLabel")}: {req.phone}
                          </p>
                        ) : null}
                        {req.address ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                            {req.address}
                          </p>
                        ) : null}
                        {req.lat != null && req.lng != null ? (
                          <p className="font-mono text-[10px] text-slate-500">
                            {Number(req.lat).toFixed(5)}, {Number(req.lng).toFixed(5)}
                          </p>
                        ) : null}
                        <p className="text-[11px] text-slate-400">
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
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
                          >
                            <Check size={14} />
                            {t("approveRequestBtn")}
                          </button>
                          <button
                            type="button"
                            disabled={branchRequestActingId === req.id}
                            onClick={() => handleBranchRequestAction(req.id, "rejected")}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 disabled:opacity-50 dark:text-rose-300"
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

      {ledgerView === "subscription" && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-4"
          onClick={closeSubscriptionLedger}
        >
          <div
            className="relative flex max-h-[90vh] w-[95%] max-w-3xl flex-col gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 md:w-full md:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={closeSubscriptionLedger}
                className="rounded-full p-1 text-slate-400 transition hover:text-rose-500"
                aria-label={t("cancel")}
              >
                <X size={22} />
              </button>
            </div>

            <div className="pr-[7.5rem]">
              <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100">
                <CreditCard size={20} className="text-cyan-600 dark:text-cyan-400" />
                {t("subscriptionLedgerTitle")}
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="ledger-business-filter">
                {t("allBusinesses")}
              </label>
              <SearchableSelect
                value={ledgerScopeBusiness || ""}
                onChange={(value) => setLedgerScopeBusiness(value || null)}
                options={[
                  { value: "", label: t("allBusinesses") },
                  ...ledgerBusinessOptions.map((name) => ({ value: name, label: name })),
                ]}
                placeholder={t("allBusinesses")}
                className="min-w-[200px] flex-1 sm:flex-none sm:min-w-[260px]"
                aria-label={t("allBusinesses")}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
              {visibleSubscriptionLedger.length === 0 ? (
                <p className="p-6 text-sm text-slate-500 dark:text-slate-400">{t("ledgerEmpty")}</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleSubscriptionLedger.map((row) => {
                    const when = formatLedgerDateTime(row.timestamp);
                    return (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                              {when.date}
                            </span>
                            {!ledgerScopeBusiness ? (
                              <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-400">
                                {row.businessName}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">
                            {row.plan}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
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

      {showLogModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-4"
          onClick={() => setShowLogModal(false)}
        >
          <div
            className="relative rounded-2xl border border-slate-200 bg-white p-4 md:p-6 w-[95%] md:w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col gap-4 dark:bg-slate-900 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                className="rounded-full p-1 text-slate-400 transition hover:text-rose-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pr-0 pt-10 sm:pr-[7.5rem] sm:pt-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 sm:text-lg">
                {logsView === "customer" ? t("systemLogsTitle") : t("businessLedgerTitle")}
              </h3>
              <div className="flex w-full items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold sm:w-auto shrink-0 dark:border-slate-700 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setLogsView("customer")}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition sm:flex-none ${
                    logsView === "customer"
                      ? "bg-teal-500/20 text-teal-700 dark:text-teal-300"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
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
                      ? "bg-teal-500/20 text-teal-700 dark:text-teal-300"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <Building2 size={14} />
                  {t("businessWord")}
                </button>
              </div>
            </div>

            {logsView === "customer" ? (
              statsLoading ? (
                <p className="text-sm text-slate-400">{t("loadingGeneric")}</p>
              ) : statsError ? (
                <p className="text-sm text-rose-300">{statsError}</p>
              ) : (
                <>
                  <div className="rounded-xl bg-slate-800 border border-slate-700/80 px-5 py-6 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {t("totalUniqueVisitors")}
                    </p>
                    <p className="mt-3 text-4xl font-bold text-emerald-400">
                      {Number(analyticsData?.total_visitors ?? 0).toLocaleString(
                        lang === "en" ? "en-GB" : "tr-TR"
                      )}
                    </p>
                  </div>

                  <hr className="border-slate-800 my-2" />

                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-slate-200">
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
                        value={filterBusiness}
                        onChange={(value) => setFilterBusiness(value)}
                        options={[
                          { value: "", label: t("allBusinesses") },
                          ...businessFilterOptions.map((name) => ({ value: name, label: name })),
                        ]}
                        placeholder={t("allBusinesses")}
                        aria-label={t("allBusinesses")}
                      />

                      <SearchableSelect
                        value={filterCurrency}
                        onChange={(value) => setFilterCurrency(value)}
                        options={[
                          { value: "", label: t("allCurrencies") },
                          ...currencyFilterOptions.map((cur) => ({ value: cur, label: cur })),
                        ]}
                        placeholder={t("allCurrencies")}
                        aria-label={t("allCurrencies")}
                      />

                      <SearchableSelect
                        value={filterAction}
                        onChange={(value) => setFilterAction(value)}
                        options={[
                          { value: "", label: t("allActions") },
                          { value: "location", label: t("onlyLocationViewers") },
                          { value: "currency", label: t("onlyCurrencyViewers") },
                          { value: "business", label: t("onlyBusinessViewers") },
                        ]}
                        placeholder={t("allActions")}
                        aria-label={t("allActions")}
                      />
                    </div>

                    <ul className="max-h-[300px] space-y-3 overflow-y-auto pr-1">
                      {filteredLogData.length === 0 ? (
                        <li className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">
                          {logData.length === 0 ? t("noAnonymousSessions") : t("noMatchingRecords")}
                        </li>
                      ) : (
                        filteredLogData.map((session) => (
                          <li
                            key={session.session_id}
                            className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-medium text-teal-400">
                                {formatRelativeTime(session.created_at)}
                              </span>
                              <span className="text-[11px] text-slate-500">{t("anonymousSession")}</span>
                            </div>
                            <dl className="mt-2 space-y-1.5 text-sm">
                              <div className="flex flex-wrap gap-x-2">
                                <dt className="text-slate-500">{t("estimatedLocation")}</dt>
                                <dd className="text-slate-200">{session.location || "—"}</dd>
                              </div>
                              <div className="flex flex-wrap gap-x-2">
                                <dt className="text-slate-500">{t("viewedBusinesses")}</dt>
                                <dd className="text-slate-200">
                                  {(session.clicked_businesses || []).length
                                    ? session.clicked_businesses.join(", ")
                                    : "—"}
                                </dd>
                              </div>
                              <div className="flex flex-wrap gap-x-2">
                                <dt className="text-slate-500">{t("viewedRates")}</dt>
                                <dd className="text-slate-200">
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
                    value={bizLogBusiness}
                    onChange={(value) => setBizLogBusiness(value)}
                    options={[
                      { value: "", label: t("allBusinesses") },
                      ...bizLogBusinessOptions.map((name) => ({ value: name, label: name })),
                    ]}
                    placeholder={t("allBusinesses")}
                    aria-label={t("selectBusinessFilter")}
                  />

                  <SearchableSelect
                    value={bizLogActionType}
                    onChange={(value) => setBizLogActionType(value)}
                    options={[
                      { value: "", label: t("allActions") },
                      { value: "profile", label: t("actionTypeProfile") },
                      { value: "margin", label: t("actionTypeMargin") },
                      { value: "branch", label: t("actionTypeBranch") },
                    ]}
                    placeholder={t("allActions")}
                    aria-label={t("actionTypeLabel")}
                  />
                </div>

                <ul className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
                  {filteredBusinessLogs.length === 0 ? (
                    <li className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">
                      {t("businessLogsEmpty")}
                    </li>
                  ) : (
                    filteredBusinessLogs.map((log) => {
                      const when = formatLedgerDateTime(log.timestamp);
                      return (
                        <li
                          key={log.id}
                          className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono text-xs font-medium text-teal-400">
                              {when.label}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${actionTypeBadgeClass[log.actionType]}`}
                            >
                              {actionTypeLabel(log.actionType)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-200">
                            <span className="font-semibold text-slate-100">{log.businessName}</span>{" "}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-4"
          onClick={() => setBusinessToDelete(null)}
        >
          <div
            className="relative rounded-2xl border border-slate-200 bg-white p-4 md:p-6 w-[95%] md:w-full max-w-sm shadow-2xl flex flex-col gap-4 dark:bg-slate-900 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => setBusinessToDelete(null)}
                className="rounded-full p-1 text-slate-400 transition hover:text-rose-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>
            <div className="flex items-center gap-3 pr-[7.5rem]">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-500 flex items-center justify-center shrink-0">
                <Trash2 size={20} />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t("deleteBusinessTitle")}</h3>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("deleteConfirmTemplate").replace(
                '"{name}"',
                `"${businessToDelete.institution_name || businessToDelete.name}"`
              )}
            </p>
            <p className="text-xs text-rose-600 font-medium dark:text-rose-400">{t("deleteWarning")}</p>

            <div className="flex items-center justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => setBusinessToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors dark:text-slate-300 dark:hover:text-white dark:bg-slate-800 dark:hover:bg-slate-700"
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
                className="px-4 py-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors shadow-[0_0_15px_rgba(225,29,72,0.4)]"
              >
                {t("confirmDeleteBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-4"
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            className="relative rounded-2xl border border-slate-200 bg-white p-4 md:p-6 w-[95%] md:w-full max-w-sm shadow-2xl flex flex-col gap-4 dark:bg-slate-900 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="rounded-full p-1 text-slate-400 transition hover:text-rose-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>
            <h3 className="pr-[7.5rem] text-lg font-bold text-slate-900 dark:text-slate-100">{t("resetSubscriptionBtn")}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t("resetSubConfirmText")}</p>
            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors dark:text-slate-300 dark:hover:text-white"
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
                className="px-4 py-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors shadow-[0_0_15px_rgba(225,29,72,0.4)] disabled:opacity-60"
              >
                {t("confirmResetBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-4"
          onClick={() => setShowSuccessModal(false)}
        >
          <div
            className="relative rounded-2xl border border-slate-200 bg-white p-4 md:p-6 w-[95%] md:w-full max-w-xs shadow-2xl flex flex-col items-center text-center gap-3 dark:bg-slate-900 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => setShowSuccessModal(false)}
                className="rounded-full p-1 text-slate-400 transition hover:text-rose-500"
                aria-label="Kapat"
              >
                <X size={22} />
              </button>
            </div>
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center mb-2">
              <Check className="w-6 h-6" strokeWidth={2.5} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t("successTitle")}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{successModalMessage}</p>
            <button
              type="button"
              onClick={() => setShowSuccessModal(false)}
              className="mt-4 w-full px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
            >
              {t("okBtn")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-teal-400/70 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

const primaryBtnClass =
  "rounded-lg bg-gradient-to-r from-teal-400 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 transition hover:brightness-110 disabled:opacity-60";
