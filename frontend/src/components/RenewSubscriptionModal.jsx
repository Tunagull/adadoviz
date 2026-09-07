import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Upload } from "lucide-react";
import { Sheet } from "./Sheet";
import { FloatingInput } from "./ui/floating-label";
import { SearchableSelect } from "./SearchableSelect";
import { useLanguage } from "../context/LanguageContext";
import {
  fetchBankDetails,
  fetchMyPaymentProofs,
  submitPaymentProof,
} from "../lib/auth";

const PROOF_MAX_BYTES = 2_500_000;
const STATUS_TONE = {
  pending: "text-warning-700 dark:text-warning-400",
  approved: "text-success-700 dark:text-success-400",
  rejected: "text-danger-700 dark:text-danger-400",
};

/**
 * P3.6 — self-servis ödeme / dekont (B5). İşletme plan seçer, havale
 * bilgilerini görür, dekont görselini yükler; superadmin onayında abonelik
 * uzar. Parent `key` ile remount eder — reset efekti yok.
 */
export function RenewSubscriptionModal({ open, onOpenChange, token }) {
  const { t } = useLanguage();
  const fileRef = useRef(null);
  const [bank, setBank] = useState(null);
  const [plans, setPlans] = useState([]);
  const [proofs, setProofs] = useState([]);
  const [planCode, setPlanCode] = useState("");
  const [note, setNote] = useState("");
  const [image, setImage] = useState("");
  const [imageName, setImageName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    let alive = true;
    (async () => {
      try {
        const [bd, mp] = await Promise.all([
          fetchBankDetails(token),
          fetchMyPaymentProofs(token).catch(() => ({ proofs: [] })),
        ]);
        if (!alive) return;
        setBank(bd.bank || null);
        setPlans(bd.plans || []);
        setProofs(mp.proofs || []);
      } catch (err) {
        if (alive) setError(err.message || t("renewLoadError"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, token, t]);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(t("renewImageType"));
      return;
    }
    if (file.size > PROOF_MAX_BYTES) {
      setError(t("renewImageBig"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImage(reader.result);
        setImageName(file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!planCode) {
      setError(t("renewPickPlan"));
      return;
    }
    if (!image) {
      setError(t("renewNeedImage"));
      return;
    }
    setLoading(true);
    try {
      await submitPaymentProof(token, {
        plan_code: planCode,
        method: "havale",
        note,
        proof_image: image,
      });
      setDone(true);
    } catch (err) {
      setError(err.message || t("renewError"));
    } finally {
      setLoading(false);
    }
  };

  const hasPending = proofs.some((p) => p.status === "pending");

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("renewTitle")}
      description={t("renewLead")}
    >
      {done ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-success-500/30 bg-success-500/10 px-4 py-3 text-sm text-success-800 dark:text-success-200"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>{t("renewDone")}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 pt-1">
          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-700 dark:text-danger-200"
            >
              {error}
            </div>
          ) : null}

          <SearchableSelect
            label={t("renewPlan")}
            value={planCode}
            onChange={setPlanCode}
            options={plans.map((p) => ({
              value: p.code,
              label: `${p.ad} — ${Number(p.fiyat || 0).toLocaleString("tr-TR")} ₺ / ${p.sure_gun} ${t("renewDaysUnit")}`,
            }))}
            placeholder={t("renewPickPlan")}
          />

          {bank ? (
            <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-3 text-sm dark:border-ink-700 dark:bg-ink-950">
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-600 dark:text-ink-400">
                {t("renewBankTitle")}
              </p>
              <dl className="space-y-1">
                {bank.account_name ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500 dark:text-ink-400">{t("renewBankName")}</dt>
                    <dd className="text-right font-medium text-ink-900 dark:text-ink-100">
                      {bank.account_name}
                    </dd>
                  </div>
                ) : null}
                {bank.bank_name ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500 dark:text-ink-400">{t("renewBankBank")}</dt>
                    <dd className="text-right font-medium text-ink-900 dark:text-ink-100">
                      {bank.bank_name}
                    </dd>
                  </div>
                ) : null}
                {bank.iban ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500 dark:text-ink-400">IBAN</dt>
                    <dd className="text-right font-mono font-medium text-ink-900 dark:text-ink-100">
                      {bank.iban}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {bank.note ? (
                <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{bank.note}</p>
              ) : null}
              {!bank.iban ? (
                <p className="mt-2 text-xs text-warning-700 dark:text-warning-400">
                  {t("renewBankMissing")}
                </p>
              ) : null}
            </div>
          ) : null}

          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFile}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-300 bg-white px-3 py-3 text-sm font-medium text-ink-700 transition hover:border-brand-400 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-200"
            >
              <Upload className="size-4" aria-hidden="true" />
              {imageName || t("renewUpload")}
            </button>
            {image ? (
              <img
                src={image}
                alt={t("renewPreviewAlt")}
                className="mt-2 max-h-40 w-full rounded-lg border border-ink-200 object-contain dark:border-ink-700"
              />
            ) : null}
          </div>

          <FloatingInput
            label={t("renewNote")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <button
            type="submit"
            className="btn-primary btn-sm w-full"
            disabled={loading || hasPending}
          >
            {t("renewSubmit")}
          </button>
          {hasPending ? (
            <p className="text-center text-xs text-warning-700 dark:text-warning-400">
              {t("renewPendingWarn")}
            </p>
          ) : null}
        </form>
      )}

      {proofs.length ? (
        <div className="mt-5 border-t border-ink-200 pt-4 dark:border-ink-700">
          <p className="mb-2 text-xs font-semibold tracking-wide text-ink-600 dark:text-ink-400">
            {t("renewHistory")}
          </p>
          <ul className="space-y-1.5 text-sm">
            {proofs.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-ink-700 dark:text-ink-300">
                  {String(p.created_at || "").slice(0, 10)} · {p.plan_adi || p.plan_code}
                </span>
                <span
                  className={`shrink-0 text-xs font-semibold ${STATUS_TONE[p.status] || ""}`}
                >
                  {t(`renewStatus_${p.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Sheet>
  );
}
