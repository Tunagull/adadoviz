import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { BrandLogo } from "../components/BrandLogo";
import { HeaderActions } from "../components/HeaderActions";
import { SiteNav } from "../components/SiteNav";
import { FloatingInput, FloatingSelect, FloatingTextarea } from "../components/ui/floating-label";
import { useLanguage } from "../context/LanguageContext";
import { apiUrl } from "../lib/api";
import { CITY_LABELS } from "../lib/cities";

const EMPTY = {
  institution_name: "",
  contact_person: "",
  email: "",
  phone: "",
  city: "",
  current_rate_info: "",
};

/**
 * P3.1 — self-signup başvurusu (B1). Bu form HESAP OLUŞTURMAZ; superadmin
 * onayından sonra hesap açılır ve kullanıcıya parola-belirleme linki gider.
 * Form dili `/partnerlik` ile aynı (`FloatingInput`, `role="alert"`).
 */
export function SignupPage() {
  const { t, lang } = useLanguage();
  const [form, setForm] = useState(EMPTY);
  const [kvkk, setKvkk] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const cityOptions = useMemo(
    () =>
      Object.entries(CITY_LABELS)
        .map(([slug, labels]) => ({ slug, label: labels[lang] || labels.tr }))
        .sort((a, b) => a.label.localeCompare(b.label, "tr")),
    [lang]
  );

  const setField = (name) => (e) => {
    const value = name === "contact_person" ? e.target.value.replace(/[0-9]/g, "") : e.target.value;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!kvkk) {
      setError(t("signupKvkkRequired"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/signup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, kvkk: true, company_website: honeypot }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t("signupError"));
      setDone(true);
      setForm(EMPTY);
      setKvkk(false);
    } catch (err) {
      setError(err.message || t("signupError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900 dark:bg-ink-950 dark:text-white">
      <Helmet>
        <title>{`${t("signupTitle")} | AdaDöviz`}</title>
        <meta name="description" content={t("signupLead")} />
        <meta name="robots" content="noindex, follow" />
      </Helmet>

      <header className="sticky top-0 z-sticky w-full border-b border-ink-200/80 bg-white/80 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80 sm:px-6 sm:py-4 md:py-5">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 sm:gap-4">
          <BrandLogo className="min-w-0 shrink" />
          <SiteNav className="mr-auto ml-2" />
          <HeaderActions />
        </div>
      </header>

      <main className="relative z-raised mx-auto w-full max-w-2xl px-4 py-6 sm:py-14">
        <div className="mb-6 text-center sm:mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("signupTitle")}</h1>
          <p className="mt-3 text-sm text-ink-600 dark:text-ink-400 sm:text-base">{t("signupLead")}</p>
        </div>

        <section className="rounded-2xl border border-ink-200 bg-white p-4 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-ink-900/60 sm:p-6">
          {done ? (
            <div
              role="status"
              className="flex items-start gap-3 rounded-lg border border-success-500/30 bg-success-500/10 px-4 py-3 text-sm text-success-800 dark:text-success-200"
            >
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{t("signupDoneTitle")}</p>
                <p className="mt-1">{t("signupDoneBody")}</p>
                <Link
                  to="/"
                  className="mt-3 inline-block font-semibold text-success-700 underline dark:text-success-300"
                >
                  {t("signupBackHome")}
                </Link>
              </div>
            </div>
          ) : (
            <>
              {error ? (
                <div
                  role="alert"
                  className="mb-4 rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-700 dark:text-danger-200"
                >
                  {error}
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* honeypot — ekranda gizli, botlar doldurur */}
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

                <div className="grid gap-4 sm:grid-cols-2">
                  <FloatingInput
                    label={t("signupInstitution")}
                    name="institution_name"
                    value={form.institution_name}
                    onChange={setField("institution_name")}
                    autoComplete="organization"
                    required
                  />
                  <FloatingInput
                    label={t("signupContact")}
                    name="contact_person"
                    value={form.contact_person}
                    onChange={setField("contact_person")}
                    autoComplete="name"
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FloatingInput
                    label={t("emailLabel")}
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={setField("email")}
                    autoComplete="email"
                    required
                  />
                  <FloatingInput
                    label={t("phoneLabel")}
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={setField("phone")}
                    autoComplete="tel"
                    inputMode="tel"
                    required
                  />
                </div>
                <FloatingSelect
                  label={t("signupCity")}
                  value={form.city}
                  onChange={setField("city")}
                >
                  <option value="">{t("signupCityNone")}</option>
                  {cityOptions.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.label}
                    </option>
                  ))}
                </FloatingSelect>
                <FloatingTextarea
                  label={t("signupRateInfo")}
                  name="current_rate_info"
                  rows={3}
                  value={form.current_rate_info}
                  onChange={setField("current_rate_info")}
                  placeholder={t("signupRateInfoPlaceholder")}
                />

                <label className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-600 dark:text-ink-300">
                  <input
                    type="checkbox"
                    checked={kvkk}
                    onChange={(e) => setKvkk(e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500 dark:border-white/20 dark:bg-ink-900"
                  />
                  <span>{t("signupKvkk")}</span>
                </label>

                <button type="submit" disabled={loading} className="btn-primary w-full sm:w-auto">
                  {loading ? t("submitting") : t("signupSubmit")}
                </button>

                <p className="text-xs text-ink-500 dark:text-ink-400">{t("signupNote")}</p>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default SignupPage;
