import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Sheet } from "./Sheet";
import { BuySellToggle } from "./BuySellToggle";
import { FloatingInput } from "./ui/floating-label";
import { useLanguage } from "../context/LanguageContext";
import { createRateAlert } from "../lib/rateAlerts";

const CURRENCIES = ["USD", "EUR", "GBP"];
const SYMBOL = { USD: "$", EUR: "€", GBP: "£" };

/**
 * P3.2 — kur alarmı kurma modalı (C3). Çift-opt-in: gönderince doğrulama
 * e-postası gider, alarm link tıklanana kadar pasiftir.
 */
export function RateAlertModal({
  open,
  onOpenChange,
  defaultCurrency = "USD",
  defaultSide = "buy",
}) {
  const { t } = useLanguage();
  const [currency, setCurrency] = useState(defaultCurrency);
  const [side, setSide] = useState(defaultSide === "sell" ? "sell" : "buy");
  const [direction, setDirection] = useState("above");
  const [threshold, setThreshold] = useState("");
  const [email, setEmail] = useState("");
  const [kvkk, setKvkk] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // null | "verify" | "already"

  // Not: form durumu her açılışta sıfırdan başlasın diye parent `key` ile
  // remount eder (BestRatePage) — reset efekti yok (lint: set-state-in-effect).

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!kvkk) {
      setError(t("rateAlertKvkkRequired"));
      return;
    }
    setLoading(true);
    try {
      const r = await createRateAlert({
        email,
        currency,
        side,
        direction,
        threshold,
        kvkk: true,
        company_website: honeypot,
      });
      setDone(r.alreadyVerified ? "already" : "verify");
      setThreshold("");
      setEmail("");
      setKvkk(false);
    } catch (err) {
      setError(err.message || t("rateAlertError"));
    } finally {
      setLoading(false);
    }
  };

  const segBtn = (activeSel) =>
    `min-h-[2.75rem] flex-1 rounded-control px-2 text-sm font-medium transition-colors ${
      activeSel
        ? "surface-neon"
        : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-white/5"
    }`;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("rateAlertTitle")}
      description={t("rateAlertLead")}
    >
      {done ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-success-500/30 bg-success-500/10 px-4 py-3 text-sm text-success-800 dark:text-success-200"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>{done === "already" ? t("rateAlertDoneAlready") : t("rateAlertDoneVerify")}</p>
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

          {/* honeypot */}
          <input
            type="text"
            name="company_website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            className="hidden"
          />

          <div className="space-y-1.5">
            <span className="text-sm font-medium">{t("bestRateCurrency")}</span>
            <div className="inline-flex rounded-full border border-ink-300 p-1 dark:border-white/10">
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={currency === c}
                  onClick={() => setCurrency(c)}
                  className={`min-h-[2.75rem] rounded-full px-3 text-sm font-medium transition-colors ${
                    currency === c
                      ? "surface-neon"
                      : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-white/5"
                  }`}
                >
                  {SYMBOL[c]} {c}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t("operationType")}</span>
              <BuySellToggle
                value={side}
                onChange={(v) => setSide(v === "sell" ? "sell" : "buy")}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t("rateAlertDirection")}</span>
              <div className="inline-flex w-full rounded-control border border-ink-300 p-1 dark:border-white/10">
                <button
                  type="button"
                  aria-pressed={direction === "above"}
                  onClick={() => setDirection("above")}
                  className={segBtn(direction === "above")}
                >
                  {t("rateAlertAbove")}
                </button>
                <button
                  type="button"
                  aria-pressed={direction === "below"}
                  onClick={() => setDirection("below")}
                  className={segBtn(direction === "below")}
                >
                  {t("rateAlertBelow")}
                </button>
              </div>
            </div>
          </div>

          <FloatingInput
            label={t("rateAlertThreshold")}
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value.replace(/[^\d.,]/g, ""))}
            required
          />
          <FloatingInput
            label={t("emailLabel")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          <label className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-600 dark:text-ink-300">
            <input
              type="checkbox"
              checked={kvkk}
              onChange={(e) => setKvkk(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500 dark:border-white/20 dark:bg-ink-900"
            />
            <span>{t("rateAlertKvkk")}</span>
          </label>

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? t("submitting") : t("rateAlertSubmit")}
          </button>
          <p className="text-xs text-ink-500 dark:text-ink-400">{t("rateAlertNote")}</p>
        </form>
      )}
    </Sheet>
  );
}

export default RateAlertModal;
