import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { MapPin, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { HeaderActions } from "./HeaderActions";
import {
  createAdminBranch,
  deleteAdminBranch,
  fetchAdminBranches,
  updateAdminBranch,
} from "../lib/auth";
import "leaflet/dist/leaflet.css";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const KKTC_CENTER = [35.2281, 33.5136];

const emptyBranchForm = {
  id: null,
  name: "",
  phone: "",
  address: "",
  lat: null,
  lng: null,
  subscription_type: "Test",
  subscription_start_date: "",
  remaining_days: "",
};

function toDateInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fromDateInputValue(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

const inputClass =
  "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-teal-400/70 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

const textareaClass =
  "min-h-[100px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-400/70 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

function MapClickHandler({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

async function fetchAddress(lat, lng) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
    { headers: { Accept: "application/json" } }
  );
  if (!response.ok) throw new Error("Adres servisi yanıt vermedi.");
  const data = await response.json();
  if (!data?.address) {
    return { address: data?.display_name || "", lat, lng };
  }

  const { road, suburb, neighbourhood, city, town, village } = data.address;
  const street = road || "";
  const district = suburb || neighbourhood || "";
  const cityName = city || town || village || "";
  const formattedAddress = [street, district, cityName].filter(Boolean).join(", ");

  return {
    address: formattedAddress || data.display_name || "",
    lat,
    lng,
  };
}

function BranchFormModal({
  open,
  businessName,
  formData,
  setFormData,
  geocoding,
  saving,
  error,
  onClose,
  onSave,
  onMapPick,
}) {
  const { t } = useLanguage();
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const hasMarker =
    formData.lat != null &&
    formData.lng != null &&
    Number.isFinite(Number(formData.lat)) &&
    Number.isFinite(Number(formData.lng));

  const title = formData.id
    ? `${businessName} — Şube Düzenleniyor`
    : `${businessName} için Yeni Bayi Ekleniyor`;

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-end justify-center p-0 sm:items-center sm:p-3 md:p-4">
      <button
        type="button"
        aria-label="Kapat"
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(94dvh,94vh)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/50 sm:max-h-[90vh] sm:w-[95%] sm:rounded-2xl md:w-full">
        <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
          <HeaderActions compact />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 transition hover:text-rose-500"
            aria-label="Kapat"
          >
            <X size={22} />
          </button>
        </div>
        <div className="border-b border-slate-200 px-4 py-4 pt-12 dark:border-slate-800 sm:px-5 sm:pr-[7.5rem] sm:pt-4">
          <p className="text-[11px] uppercase tracking-wide text-teal-600 dark:text-teal-400/80">Şube / Bayi</p>
          <h3 className="truncate text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
        </div>

        <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(260px,340px)_1fr]">
          <form
            onSubmit={onSave}
            className="space-y-4 overflow-y-auto border-b border-slate-200 p-5 lg:border-b-0 lg:border-r dark:border-slate-800"
          >
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Şube Adı
              </span>
              <input
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                className={inputClass}
                placeholder="Örn: Lefkoşa Şubesi"
                required
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Telefon
              </span>
              <input
                value={formData.phone}
                onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
                className={inputClass}
                placeholder="Örn: +90 392 000 00 00"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Abonelik Tipi
              </span>
              <select
                value={formData.subscription_type}
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    subscription_type: e.target.value,
                    remaining_days: e.target.value === "Test" ? "" : p.remaining_days,
                  }))
                }
                className={inputClass}
              >
                <option value="Test">{t("subTypeTest")}</option>
                <option value="Aylık">{t("subTypeMonthly")}</option>
                <option value="Yıllık">{t("subTypeYearly")}</option>
                <option value="Manuel">{t("subTypeManual")}</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("subscriptionStartDate")}
              </span>
              <input
                type="date"
                value={formData.subscription_start_date}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, subscription_start_date: e.target.value }))
                }
                className={inputClass}
              />
            </label>

            {formData.subscription_type !== "Test" ? (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {t("remainingSubscription")} ({t("daysUnit")})
                </span>
                <input
                  type="number"
                  min="0"
                  value={formData.remaining_days}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, remaining_days: e.target.value }))
                  }
                  className={inputClass}
                  placeholder="Örn: 30"
                />
              </label>
            ) : (
              <p className="text-[11px] text-teal-400/90">{t("unlimitedSubscription")}</p>
            )}

            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Adres
              </span>
              <textarea
                value={formData.address}
                onChange={(e) => setFormData((p) => ({ ...p, address: e.target.value }))}
                className={textareaClass}
                placeholder="Haritaya tıklayın veya adresi manuel yazın"
              />
              <p className="text-[11px] text-slate-500">
                Haritaya tıklayınca adres otomatik doldurulur.
                {geocoding ? " Adres çözümleniyor..." : ""}
              </p>
              {hasMarker ? (
                <p className="font-mono text-[11px] text-slate-500">
                  {Number(formData.lat).toFixed(5)}, {Number(formData.lng).toFixed(5)}
                </p>
              ) : null}
            </label>

            {error ? (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-400 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 transition hover:brightness-110 disabled:opacity-60"
              >
                <Save size={16} />
                {saving ? "Kaydediliyor..." : "Bayiyi Kaydet"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                İptal
              </button>
            </div>
          </form>

          <div className="relative min-h-[320px] bg-slate-950 lg:min-h-[440px]">
            <MapContainer
              key={`${formData.id || "new"}-${open}`}
              center={hasMarker ? [formData.lat, formData.lng] : KKTC_CENTER}
              zoom={hasMarker ? 14 : 9}
              scrollWheelZoom
              className="h-full min-h-[320px] w-full lg:min-h-[440px]"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapClickHandler onPick={onMapPick} />
              {hasMarker ? <Marker position={[formData.lat, formData.lng]} /> : null}
            </MapContainer>
            <div className="pointer-events-none absolute left-3 top-3 z-[1000] rounded-lg border border-slate-700/80 bg-slate-950/85 px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
              Konum seçmek için haritaya tıklayın
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Seçili işletmeye bağlı şube/bayi yönetimi (parent-child).
 * Döviz kurları işletme seviyesindedir; şubeler yalnızca fiziksel bilgi tutar.
 */
export function BusinessBranchesPanel({
  token,
  businessId,
  businessName,
  branchLimit = 1,
}) {
  const { t } = useLanguage();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [formData, setFormData] = useState(emptyBranchForm);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const limit = Math.max(1, Number(branchLimit) || 1);
  const used = branches.length;
  const atLimit = used >= limit;

  const loadBranches = useCallback(async () => {
    if (!token || !businessId) return;
    setLoading(true);
    setListError("");
    try {
      const rows = await fetchAdminBranches(token, businessId);
      setBranches(rows);
    } catch (err) {
      setListError(err.message || "Şubeler yüklenemedi.");
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, [token, businessId]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const openCreate = () => {
    if (atLimit) {
      setLimitModalOpen(true);
      return;
    }
    setFormData(emptyBranchForm);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (branch) => {
    setFormData({
      id: branch.id,
      name: branch.name || "",
      phone: branch.phone || "",
      address: branch.address || "",
      lat: branch.lat ?? null,
      lng: branch.lng ?? null,
      subscription_type: branch.subscription_type || "Test",
      subscription_start_date: toDateInputValue(
        branch.subscription_start_date || branch.created_at
      ),
      remaining_days:
        branch.subscription_type === "Test" || branch.days_remaining == null
          ? ""
          : String(Math.max(0, branch.days_remaining)),
    });
    setFormError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setFormData(emptyBranchForm);
    setFormError("");
  };

  const handleMapPick = useCallback(async (lat, lng) => {
    setFormData((prev) => ({ ...prev, lat, lng }));
    setGeocoding(true);
    setFormError("");
    try {
      const result = await fetchAddress(lat, lng);
      setFormData((prev) => ({
        ...prev,
        address: result.address,
        lat: result.lat,
        lng: result.lng,
      }));
    } catch (err) {
      console.error("Adres çözümlenirken hata oluştu:", err);
      setFormError("Adres çözümlenirken hata oluştu. Adresi manuel girebilirsiniz.");
    } finally {
      setGeocoding(false);
    }
  }, []);

  const handleSave = async (event) => {
    event.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      const payload = {
        business_id: businessId,
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        address: formData.address.trim(),
        lat: formData.lat,
        lng: formData.lng,
        subscription_type: formData.subscription_type || "Test",
        subscription_start_date:
          fromDateInputValue(formData.subscription_start_date) || new Date().toISOString(),
      };
      if (!payload.name) throw new Error("Şube adı zorunludur.");
      if (payload.subscription_type === "Test") {
        payload.subscription_end_date = null;
        payload.remaining_days = null;
      } else {
        const days = Number(formData.remaining_days);
        if (!Number.isFinite(days) || days < 0) {
          throw new Error("Kalan abonelik günü zorunludur.");
        }
        payload.remaining_days = days;
      }

      if (formData.id) {
        await updateAdminBranch(token, formData.id, payload);
      } else {
        await createAdminBranch(token, payload);
      }
      setModalOpen(false);
      setFormData(emptyBranchForm);
      await loadBranches();
    } catch (err) {
      setFormError(err.message || "Kayıt başarısız.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Bu şubeyi kalıcı olarak silmek istediğinize emin misiniz?")) return;
    try {
      await deleteAdminBranch(token, id);
      await loadBranches();
    } catch (err) {
      setListError(err.message || "Şube silinemedi.");
    }
  };

  return (
    <div className="mt-2">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MapPin size={18} className="text-teal-400" />
            <h3 className="text-base font-semibold text-white">
              {businessName} Şubeleri / Bayileri
            </h3>
          </div>
          <p
            className={`mt-1 text-xs font-medium ${
              atLimit ? "text-amber-300" : "text-slate-400"
            }`}
          >
            {t("branchUsageLabel")}: {used} / {limit}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-2 text-sm font-medium text-teal-300 transition hover:bg-teal-500/20"
        >
          <Plus size={16} />
          {t("addBranchBtn")}
        </button>
      </div>

      {listError ? (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {listError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">{t("branchesLoading")}</p>
      ) : branches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-6 text-sm text-slate-400">
          {t("branchesEmpty")}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {branches.map((branch) => (
            <li
              key={branch.id}
              className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-100">{branch.name}</p>
                  {branch.phone ? (
                    <p className="mt-0.5 text-xs text-slate-400">{branch.phone}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-teal-400/90">
                    {branch.subscription_type === "Test"
                      ? t("unlimitedSubscription")
                      : branch.days_remaining == null
                        ? "—"
                        : branch.days_remaining <= 0
                          ? t("subscriptionExpired")
                          : `${t("remainingSubscription")}: ${branch.days_remaining} ${t("daysUnit")}`}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[12px] text-slate-500">
                    {branch.address || "Adres yok"}
                  </p>
                  {branch.lat != null && branch.lng != null ? (
                    <p className="mt-1 font-mono text-[10px] text-slate-600">
                      {Number(branch.lat).toFixed(4)}, {Number(branch.lng).toFixed(4)}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(branch)}
                    className="rounded-lg border border-slate-700 p-1.5 text-slate-300 transition hover:border-teal-500/50 hover:text-teal-300"
                    title="Düzenle"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(branch.id)}
                    className="rounded-lg border border-rose-500/30 p-1.5 text-rose-400 transition hover:bg-rose-500/10"
                    title="Sil"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <BranchFormModal
        open={modalOpen}
        businessName={businessName}
        formData={formData}
        setFormData={setFormData}
        geocoding={geocoding}
        saving={saving}
        error={formError}
        onClose={closeModal}
        onSave={handleSave}
        onMapPick={handleMapPick}
      />

      {limitModalOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
              onClick={() => setLimitModalOpen(false)}
            >
              <div
                className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
                  <HeaderActions compact />
                  <button
                    type="button"
                    onClick={() => setLimitModalOpen(false)}
                    className="rounded-full p-1 text-slate-400 transition hover:text-rose-500"
                    aria-label={t("cancel")}
                  >
                    <X size={20} />
                  </button>
                </div>
                <h4 className="pr-[7.5rem] text-lg font-semibold text-slate-900 dark:text-white">{t("branchLimitTitle")}</h4>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{t("branchLimitContactMsg")}</p>
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300/90">
                  {t("branchUsageLabel")}: {used} / {limit}
                </p>
                <button
                  type="button"
                  onClick={() => setLimitModalOpen(false)}
                  className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-cyan-500/50 hover:text-cyan-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-cyan-300"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
