import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Activity,
  Building2,
  Check,
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
} from "../lib/auth";
import { BusinessBranchesPanel } from "../components/DealerManagement";
import { BusinessLogoField } from "../components/BusinessLogoField";
import { HeaderActions } from "../components/HeaderActions";

const BUSINESS_ACTION_TYPES = ["profile", "margin", "branch"];

const BUSINESS_LOG_TEMPLATES = {
  margin: (name) => `${name} kâr marjını güncelledi`,
  profile: (name) =>
    [
      `${name} admini işletme fotoğrafını değiştirdi`,
      `${name} için telefon numarası güncellendi`,
      `${name} çalışma saatlerini güncelledi`,
      `${name} adres bilgilerini güncelledi`,
    ][Math.floor(Math.random() * 4)],
  branch: (name) =>
    [
      `${name} yeni bir şube ekledi`,
      `${name} şube bilgilerini güncelledi`,
      `${name} bir şubeyi kaldırdı`,
    ][Math.floor(Math.random() * 3)],
};

const FALLBACK_BUSINESS_NAMES = [
  "Akbank",
  "Ziraat Bankası",
  "Garanti BBVA",
  "Yapı Kredi",
  "Sun Döviz",
];

/** UI test amaçlı sahte işletme log verisi (backend'de henüz bu log türü yok). */
function generateMockBusinessLogs(businessNames) {
  const names = businessNames.length > 0 ? businessNames : FALLBACK_BUSINESS_NAMES;
  const now = Date.now();
  const entries = [];
  for (let i = 0; i < 36; i += 1) {
    const name = names[Math.floor(Math.random() * names.length)];
    const actionType = BUSINESS_ACTION_TYPES[Math.floor(Math.random() * BUSINESS_ACTION_TYPES.length)];
    const daysAgo = Math.random() * 14;
    entries.push({
      id: `mock-biz-log-${i}`,
      businessName: name,
      actionType,
      description: BUSINESS_LOG_TEMPLATES[actionType](name),
      timestamp: new Date(now - daysAgo * 86400000).toISOString(),
    });
  }
  return entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
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
  logo_url: null,
};

const emptyEditForm = {
  id: null,
  institution_name: "",
  username: "",
  password: "",
  subscriptionType: "Test",
  manualDays: "0",
  currentRemainingDays: 0,
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
  if (subscriptionType === "Aylık") return 30;
  if (subscriptionType === "Yıllık") return 365;
  if (subscriptionType === "Manuel") {
    const customDays = parseInt(manualDays, 10) || 0;
    return Math.max(0, currentRemainingDays + customDays);
  }
  // Test: sabit 14
  return 14;
}

function formatRemaining(days, t) {
  if (days == null) return "—";
  if (days <= 0) return t("subscriptionExpired");
  return `${days} ${t("daysUnit")} ${t("daysRemainingSuffix")}`;
}

function SubscriptionFields({ form, setForm }) {
  const { t } = useLanguage();
  return (
    <>
      <div className="flex flex-col gap-2">
        <label className="text-xs text-slate-500 font-medium dark:text-slate-400">{t("subscriptionTypeLabel")}</label>
        <select
          value={form.subscriptionType}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, subscriptionType: e.target.value }))
          }
          className="bg-white border border-slate-200 text-slate-800 rounded-lg px-4 py-2 focus:outline-none focus:border-emerald-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
        >
          <option value="Test">{t("subTypeTest")}</option>
          <option value="Aylık">{t("subTypeMonthly")}</option>
          <option value="Yıllık">{t("subTypeYearly")}</option>
          <option value="Manuel">{t("subTypeManual")}</option>
        </select>
      </div>

      {form.subscriptionType === "Manuel" && (
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
      )}
    </>
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
  const [showLogModal, setShowLogModal] = useState(false);
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

  const TABS = useMemo(
    () => [
      { id: "list", label: t("tabList") },
      { id: "edit", label: t("tabEdit") },
      { id: "create", label: t("tabCreate") },
    ],
    [t]
  );

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
    if (!iso) return "—";
    const d = new Date(iso.includes("T") || iso.includes("Z") ? iso : iso.replace(" ", "T") + "Z");
    const locale = lang === "en" ? "en-GB" : "tr-TR";
    if (!Number.isFinite(d.getTime())) {
      // SQLite datetime('now') genelde "YYYY-MM-DD HH:MM:SS"
      const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return "—";
      return `${m[3]}.${m[2]}.${m[1]}`;
    }
    return d.toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  const logData = analyticsData?.sessions || [];

  const mockBusinessLogs = useMemo(
    () => generateMockBusinessLogs(businesses.map((b) => b.institution_name).filter(Boolean)),
    [businesses]
  );

  const bizLogBusinessOptions = useMemo(() => {
    const set = new Set(mockBusinessLogs.map((log) => log.businessName));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [mockBusinessLogs]);

  const filteredBusinessLogs = useMemo(() => {
    return mockBusinessLogs.filter((log) => {
      if (bizLogBusiness && log.businessName !== bizLogBusiness) return false;
      if (bizLogActionType && log.actionType !== bizLogActionType) return false;
      if (!inDateRange(log.timestamp, logDateFrom, logDateTo)) return false;
      return true;
    });
  }, [mockBusinessLogs, bizLogBusiness, bizLogActionType, logDateFrom, logDateTo]);

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

  const openEdit = (biz) => {
    setEditForm({
      id: biz.id,
      institution_name: biz.institution_name || "",
      username: biz.username || "",
      password: "",
      subscriptionType: parseSubscriptionType(biz),
      manualDays: "0",
      currentRemainingDays: Math.max(0, Number(biz.days_remaining) || 0),
      logo_url: biz.logo_url || null,
    });
    setSuccess("");
    setError("");
    setTab("edit");
  };

  const calculatedNewDays = useMemo(
    () =>
      calculateNewDays(
        editForm.subscriptionType,
        editForm.currentRemainingDays,
        editForm.manualDays
      ),
    [editForm.subscriptionType, editForm.currentRemainingDays, editForm.manualDays]
  );

  const createCalculatedDays = useMemo(
    () => calculateNewDays(createForm.subscriptionType, 0, createForm.manualDays),
    [createForm.subscriptionType, createForm.manualDays]
  );

  const handleToggleStatus = async (biz) => {
    const remainingDays = biz.days_remaining;
    if (remainingDays != null && remainingDays <= 0) {
      setError(t("expiredCantActivateMsg"));
      return;
    }
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
        subscription_type: editForm.subscriptionType,
        remaining_days: calculatedNewDays,
        logo_url: editForm.logo_url || null,
      };
      if (editForm.password.trim()) {
        payload.password = editForm.password.trim();
      }
      await updateAdminBusiness(token, editForm.id, payload);
      setSuccess(t("businessUpdatedMsg"));
      setEditForm((prev) => ({
        ...prev,
        password: "",
        currentRemainingDays: calculatedNewDays,
        manualDays: "0",
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
        <Link
          to="/dashboard"
          className="inline-flex items-center text-sm text-slate-500 transition hover:text-teal-600 dark:text-slate-400 dark:hover:text-teal-300"
        >
          ← {t("backToDashboardLink")}
        </Link>
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
          <button
            type="button"
            onClick={() => setShowLogModal(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-teal-500/40 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-teal-300"
          >
            <Activity size={18} />
            {t("logsButton")}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
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
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === item.id
                ? "bg-teal-500/20 text-teal-700 border border-teal-500/40 dark:text-teal-300"
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-100 border border-transparent dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/80"
            }`}
          >
            {item.label}
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
                    <th className="px-4 py-3 font-medium">{t("colRemaining")}</th>
                    <th className="px-4 py-3 font-medium">{t("colRegisteredAt")}</th>
                    <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                    <th className="px-4 py-3 font-medium text-right">{t("colAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {businesses.map((biz) => {
                    const remainingDays = biz.days_remaining;
                    const remainingLabel = formatRemaining(remainingDays, t);
                    const remainingClass =
                      remainingDays == null
                        ? "text-slate-500 font-medium dark:text-slate-400"
                        : remainingDays > 30
                          ? "text-emerald-600 font-medium dark:text-emerald-400"
                          : "text-rose-600 font-bold dark:text-rose-500";
                    const expired = remainingDays != null && remainingDays <= 0;
                    const isActive = !expired && biz.is_active !== false;
                    const toggleDisabled = expired || togglingId === biz.id;
                    return (
                      <tr key={biz.id} className="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800/80 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{biz.id}</td>
                        <td className="px-4 py-3 text-slate-800 font-mono dark:text-slate-200">{biz.username}</td>
                        <td className="px-4 py-3 text-slate-800 dark:text-slate-100">{biz.institution_name}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-teal-700 dark:border-slate-700 dark:bg-slate-950 dark:text-teal-300">
                            {subscriptionTypeLabel(biz.subscription || biz.subscription_type, t)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-xs ${remainingClass}`}>
                          {remainingLabel}
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
                              expired
                                ? t("expiredToggleTitle")
                                : isActive
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
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(biz)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-teal-500/50 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:text-teal-300"
                            >
                              <Pencil size={14} />
                              {t("editBtn")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setBusinessToDelete(biz)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-transparent px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
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

      {tab === "edit" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 dark:border-slate-800 dark:bg-slate-900/80">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{t("editSubscriptionTitle")}</h2>
          {!editForm.id ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t("selectFromListPrompt")}</p>
          ) : (
            <>
              <form onSubmit={handleUpdate} className="grid gap-4 max-w-xl">
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
                <SubscriptionFields form={editForm} setForm={setEditForm} />

                <div className="flex items-center gap-3 mt-2 bg-slate-50 p-3 rounded-lg border border-slate-200 w-fit dark:bg-slate-900/50 dark:border-slate-800">
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] text-slate-500 mb-1 dark:text-slate-400">{t("currentRemainingLabel")}</span>
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {editForm.currentRemainingDays} {t("daysUnit")}
                    </span>
                  </div>

                  <ArrowRight className="text-slate-400 dark:text-slate-500" size={16} />

                  <div className="flex flex-col items-center">
                    <span className="text-[10px] text-emerald-600/80 mb-1 dark:text-emerald-500/70">{t("afterUpdateLabel")}</span>
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {calculatedNewDays} {t("daysUnit")}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 mt-2">
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(true)}
                    disabled={saving}
                    className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-500/20 disabled:opacity-60 dark:text-rose-300"
                  >
                    {t("resetSubscriptionBtn")}
                  </button>
                  <button type="submit" disabled={saving} className={primaryBtnClass}>
                    {saving ? t("saving") : t("saveChangesBtn")}
                  </button>
                </div>
              </form>

              <hr className="border-slate-200 my-8 dark:border-slate-800" />

              <BusinessBranchesPanel
                token={token}
                businessId={editForm.id}
                businessName={editForm.institution_name}
              />
            </>
          )}
        </section>
      )}

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
            <button type="submit" disabled={saving} className={primaryBtnClass}>
              {saving ? t("creatingBtn") : t("createBusinessBtn")}
            </button>
          </form>
        </section>
      )}

      {showLogModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-4"
          onClick={() => setShowLogModal(false)}
        >
          <div
            className="relative bg-slate-900 border border-slate-700 rounded-2xl p-4 md:p-6 w-[95%] md:w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <X
              size={24}
              onClick={() => setShowLogModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors z-10"
              aria-label="Kapat"
            />

            <div className="flex flex-wrap items-center justify-between gap-3 pr-10">
              <h3 className="text-lg font-bold text-slate-100">
                {logsView === "customer" ? t("systemLogsTitle") : t("businessLogsSectionTitle")}
              </h3>
              <div className="flex items-center rounded-lg border border-slate-700 bg-slate-800 p-0.5 text-xs font-semibold shrink-0">
                <button
                  type="button"
                  onClick={() => setLogsView("customer")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                    logsView === "customer"
                      ? "bg-teal-500/20 text-teal-300"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Users size={14} />
                  {t("customerLabel")}
                </button>
                <button
                  type="button"
                  onClick={() => setLogsView("business")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                    logsView === "business"
                      ? "bg-teal-500/20 text-teal-300"
                      : "text-slate-400 hover:text-slate-200"
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
                      <select
                        value={filterBusiness}
                        onChange={(e) => setFilterBusiness(e.target.value)}
                        className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 outline-none focus:border-teal-400"
                        aria-label="İşletme filtresi"
                      >
                        <option value="">{t("allBusinesses")}</option>
                        {businessFilterOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>

                      <select
                        value={filterCurrency}
                        onChange={(e) => setFilterCurrency(e.target.value)}
                        className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 outline-none focus:border-teal-400"
                        aria-label="Döviz filtresi"
                      >
                        <option value="">{t("allCurrencies")}</option>
                        {currencyFilterOptions.map((cur) => (
                          <option key={cur} value={cur}>
                            {cur}
                          </option>
                        ))}
                      </select>

                      <select
                        value={filterAction}
                        onChange={(e) => setFilterAction(e.target.value)}
                        className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 outline-none focus:border-teal-400"
                        aria-label="Aksiyon filtresi"
                      >
                        <option value="">{t("allActions")}</option>
                        <option value="location">{t("onlyLocationViewers")}</option>
                        <option value="currency">{t("onlyCurrencyViewers")}</option>
                        <option value="business">{t("onlyBusinessViewers")}</option>
                      </select>
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
                  <select
                    value={bizLogBusiness}
                    onChange={(e) => setBizLogBusiness(e.target.value)}
                    className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 outline-none focus:border-teal-400"
                    aria-label={t("selectBusinessFilter")}
                  >
                    <option value="">{t("allBusinesses")}</option>
                    {bizLogBusinessOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={bizLogActionType}
                    onChange={(e) => setBizLogActionType(e.target.value)}
                    className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 outline-none focus:border-teal-400"
                    aria-label={t("actionTypeLabel")}
                  >
                    <option value="">{t("allActions")}</option>
                    <option value="profile">{t("actionTypeProfile")}</option>
                    <option value="margin">{t("actionTypeMargin")}</option>
                    <option value="branch">{t("actionTypeBranch")}</option>
                  </select>
                </div>

                <ul className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
                  {filteredBusinessLogs.length === 0 ? (
                    <li className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">
                      {t("businessLogsEmpty")}
                    </li>
                  ) : (
                    filteredBusinessLogs.map((log) => (
                      <li
                        key={log.id}
                        className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-teal-400">
                            {formatRelativeTime(log.timestamp)}
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
                    ))
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
            className="relative bg-slate-900 border border-slate-700 rounded-2xl p-4 md:p-6 w-[95%] md:w-full max-w-sm shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <X
              size={24}
              onClick={() => setBusinessToDelete(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors z-10"
              aria-label="Kapat"
            />
            <div className="flex items-center gap-3 pr-8">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-500 flex items-center justify-center shrink-0">
                <Trash2 size={20} />
              </div>
              <h3 className="text-lg font-bold text-slate-100">{t("deleteBusinessTitle")}</h3>
            </div>

            <p className="text-sm text-slate-300">
              {t("deleteConfirmTemplate").replace(
                '"{name}"',
                `"${businessToDelete.institution_name || businessToDelete.name}"`
              )}
            </p>
            <p className="text-xs text-rose-400 font-medium">{t("deleteWarning")}</p>

            <div className="flex items-center justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => setBusinessToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
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
            className="relative bg-slate-900 border border-slate-700 rounded-2xl p-4 md:p-6 w-[95%] md:w-full max-w-sm shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <X
              size={24}
              onClick={() => setShowResetConfirm(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors z-10"
              aria-label="Kapat"
            />
            <h3 className="pr-8 text-lg font-bold text-slate-100">{t("resetSubscriptionBtn")}</h3>
            <p className="text-sm text-slate-400">{t("resetSubConfirmText")}</p>
            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
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
            className="relative bg-slate-900 border border-slate-700 rounded-2xl p-4 md:p-6 w-[95%] md:w-full max-w-xs shadow-2xl flex flex-col items-center text-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <X
              size={24}
              onClick={() => setShowSuccessModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors z-10"
              aria-label="Kapat"
            />
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center mb-2">
              <Check className="w-6 h-6" strokeWidth={2.5} />
            </div>
            <h3 className="text-lg font-bold text-slate-100">{t("successTitle")}</h3>
            <p className="text-sm text-slate-400">{successModalMessage}</p>
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
