import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { apiUrl } from "../lib/api";
import { FloatingInput, FloatingTextarea } from "./ui/floating-label";

const PHONE_MASK_TEMPLATE = "0(5XX) XXX XXXX";

function formatPhoneDisplay(rawDigits) {
  let d = String(rawDigits || "").replace(/\D/g, "").slice(0, 10);
  if (!d.startsWith("5")) d = `5${d.replace(/^5*/, "")}`.slice(0, 10);
  if (!d) d = "5";
  let out = "0(";
  out += d.slice(0, Math.min(3, d.length));
  if (d.length >= 3) out += ")";
  if (d.length > 3) out += ` ${d.slice(3, Math.min(6, d.length))}`;
  if (d.length > 6) out += ` ${d.slice(6, Math.min(10, d.length))}`;
  return out;
}

function buildPhoneMaskGhost(rawDigits) {
  const typed = formatPhoneDisplay(rawDigits);
  return PHONE_MASK_TEMPLATE.split("")
    .map((ch, i) => (i < typed.length ? "\u00A0" : ch))
    .join("");
}

function extractRawPhoneDigits(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length >= 11) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (!digits.startsWith("5")) {
    digits = `5${digits.replace(/^5*/, "")}`.slice(0, 10);
  }
  return digits || "5";
}

/**
 * `hideHeading`: kendi sayfasında form zaten bir <h1> altında duruyor;
 * formun içindeki başlığı ikinci kez basmamak için kapatılabiliyor.
 */
export function PartnershipForm({ className = "", hideHeading = false }) {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    institution_name: "",
    contact_person: "",
    email: "",
    phone: "",
    message: "",
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [rawPhone, setRawPhone] = useState("5");
  const phoneFormattedRef = useRef("0(5");
  const phoneInputRef = useRef(null);

  const syncPhone = (digits) => {
    const next = extractRawPhoneDigits(digits);
    setRawPhone(next);
    phoneFormattedRef.current = formatPhoneDisplay(next);
    setFormData((prev) => ({ ...prev, phone: `+90 ${formatPhoneDisplay(next)}` }));
  };

  const handlePhoneInputChange = (e) => {
    const inputValue = e.target.value;
    const prevFormatted = phoneFormattedRef.current;
    let digits = extractRawPhoneDigits(inputValue);

    if (
      inputValue.length < prevFormatted.length &&
      digits.length >= rawPhone.length &&
      rawPhone.length > 1
    ) {
      digits = rawPhone.slice(0, -1);
    }

    syncPhone(digits);
  };

  const handlePhoneKeyDown = (e) => {
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
    if (rawPhone.length <= 1) {
      e.preventDefault();
      return;
    }
    const before = input.value[start - 1];
    if (before && /\D/.test(before)) {
      e.preventDefault();
      syncPhone(rawPhone.slice(0, -1));
    }
  };

  const handlePhoneFocus = (e) => {
    const lockedUntil = 3;
    const input = e.target;
    requestAnimationFrame(() => {
      const pos = Math.max(input.selectionStart ?? lockedUntil, lockedUntil);
      input.setSelectionRange(pos, pos);
    });
  };

  const handlePhoneClick = (e) => {
    const lockedUntil = 3;
    const input = e.target;
    if ((input.selectionStart ?? 0) < lockedUntil) {
      input.setSelectionRange(lockedUntil, lockedUntil);
    }
  };

  useEffect(() => {
    phoneFormattedRef.current = formatPhoneDisplay(rawPhone);
  }, [rawPhone]);

  const buildPartnershipDefaultMessage = () => {
    const institution = String(formData.institution_name || "").trim() || "…";
    const person = String(formData.contact_person || "").trim() || "…";
    const mail = String(formData.email || "").trim() || "…";
    const tel =
      rawPhone.length >= 10
        ? `+90 ${formatPhoneDisplay(rawPhone)}`
        : String(formData.phone || "").trim() || "…";
    return (
      `${institution} kurumundan ${person} adlı yetkili, AdaDöviz partnerlik programına başvurmak istemektedir. ` +
      `İletişim: ${mail} / ${tel}. Lütfen en kısa sürede dönüş yapınız.`
    );
  };

  const messageIsEmpty = !String(formData.message || "").trim();
  const messagePreview = buildPartnershipDefaultMessage();

  const handleChange = (e) => {
    const { name, value } = e.target;
    let next = value;
    if (name === "contact_person") {
      next = value.replace(/[0-9]/g, "");
    }
    setFormData((prev) => ({ ...prev, [name]: next }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rawPhone.length !== 10) {
      setError(t("phoneIncompleteError") || "Lütfen 10 haneli telefon numarasını eksiksiz girin.");
      return;
    }
    setLoading(true);
    setError("");

    const payload = {
      ...formData,
      phone: `+90 ${formatPhoneDisplay(rawPhone)}`,
      message: messageIsEmpty ? messagePreview : String(formData.message).trim(),
    };

    try {
      const res = await fetch(apiUrl("/api/partnership-apply"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSubmitted(true);
      setFormData({
        institution_name: "",
        contact_person: "",
        email: "",
        phone: "+90 0(5",
        message: "",
      });
      setRawPhone("5");
      phoneFormattedRef.current = "0(5";
      setTimeout(() => setSubmitted(false), 5000);
    } catch (err) {
      setError(err.message || t("applicationSendFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      id="partnership"
      className={`scroll-mt-28 rounded-2xl border border-ink-200 bg-white p-4 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-ink-900/60 sm:p-6 ${className}`}
    >
      {hideHeading ? null : (
        <div className="mb-6">
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">{t("partnership")}</h2>
          <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{t("partnershipDesc")}</p>
        </div>
      )}

      {submitted ? (
        <div className="rounded-lg border border-success-500/30 bg-success-500/10 px-4 py-3 text-sm text-success-700 dark:text-success-200">
          {t("applicationSuccess")}
        </div>
      ) : (
        <>
          {error ? (
            <div className="mb-4 rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-700 dark:text-danger-200">
              {error}
            </div>
          ) : null}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FloatingInput
                label={t("institutionName")}
                type="text"
                name="institution_name"
                placeholder={t("institutionNamePlaceholder")}
                value={formData.institution_name}
                onChange={handleChange}
                required
              />
              <FloatingInput
                label={t("contactPerson")}
                type="text"
                name="contact_person"
                placeholder={t("contactPersonPlaceholder")}
                value={formData.contact_person}
                onChange={handleChange}
                inputMode="text"
                autoComplete="name"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FloatingInput
                label={t("emailLabel")}
                type="email"
                name="email"
                placeholder={t("emailPlaceholder")}
                value={formData.email}
                onChange={handleChange}
                required
              />
              <FloatingInput
                ref={phoneInputRef}
                label={t("phoneLabel")}
                float="always"
                type="tel"
                name="phone"
                value={formatPhoneDisplay(rawPhone)}
                onChange={handlePhoneInputChange}
                onKeyDown={handlePhoneKeyDown}
                onFocus={handlePhoneFocus}
                onClick={handlePhoneClick}
                inputMode="numeric"
                autoComplete="tel-national"
                required
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
                      {buildPhoneMaskGhost(rawPhone)}
                    </span>
                  </>
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <FloatingTextarea
                label={t("messageLabel")}
                name="message"
                rows={4}
                placeholder={t("messagePlaceholder")}
                value={formData.message}
                onChange={handleChange}
              />
              {messageIsEmpty ? (
                <div className="rounded-lg border border-dashed border-brand-500/40 bg-brand-500/5 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                    {t("messageTemplatePreviewLabel")}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600 dark:text-ink-300">
                    {messagePreview}
                  </p>
                </div>
              ) : null}
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full sm:w-auto">
              {loading ? t("submitting") : t("submitApplication")}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
