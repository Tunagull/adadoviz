import { useMemo, useState } from "react";
import { HeaderActions } from "../components/HeaderActions";
import { Helmet } from "react-helmet-async";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Lock, KeyRound, CheckCircle2 } from "lucide-react";
import { apiUrl } from "../lib/api";
import { FloatingInput } from "../components/ui/floating-label";
import { useLanguage } from "../context/LanguageContext";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  // A-H4 / A-L2: hata kod olarak saklanır, render'da çevrilir.
  const [errorCode, setErrorCode] = useState("");
  const [serverError, setServerError] = useState("");
  const [done, setDone] = useState(false);

  const errorText = serverError || (errorCode ? t(errorCode) : "");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorCode("");
    setServerError("");

    if (!token) {
      setErrorCode("resetNoToken");
      return;
    }
    if (password.length < 4) {
      setErrorCode("resetTooShort");
      return;
    }
    if (password !== confirm) {
      setErrorCode("resetMismatch");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error) setServerError(data.error);
        else setErrorCode("resetFailed");
        return;
      }
      setDone(true);
    } catch {
      setErrorCode("resetFailed");
    } finally {
      setLoading(false);
    }
  };

  const fieldError = errorCode === "resetTooShort" || errorCode === "resetMismatch" ? errorText : undefined;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="mb-6 flex justify-end">
        <HeaderActions compact />
      </div>
      <Helmet>
        <title>{`${t("resetTitle")} | AdaDöviz`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-900/95 shadow-2xl shadow-brand-900/40 backdrop-blur-xl">
        <div className="border-b border-white/10 bg-gradient-to-r from-ink-900 via-ink-900 to-brand-900/40 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-tr bg-brand-gradient p-2.5 text-white shadow-lg shadow-brand-900/40">
              <KeyRound className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">{t("resetTitle")}</h1>
              <p className="mt-0.5 text-sm text-ink-300">{t("resetSubtitle")}</p>
            </div>
          </div>
        </div>

        {done ? (
          <div role="status" className="space-y-4 px-6 py-8 text-center">
            <CheckCircle2 className="mx-auto size-12 text-success-400" aria-hidden="true" />
            <p className="text-sm text-ink-200">{t("resetDoneMsg")}</p>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="w-full rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:brightness-110"
            >
              {t("resetBackHome")}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6">
            {!token ? (
              <div
                role="alert"
                className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-200"
              >
                {t("resetInvalidLink")}
              </div>
            ) : null}

            <FloatingInput
              id="reset-password"
              label={t("resetNewPassword")}
              icon={Lock}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={!token || loading}
              error={fieldError}
            />

            <FloatingInput
              id="reset-password-confirm"
              label={t("resetConfirmPassword")}
              icon={Lock}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              disabled={!token || loading}
            />

            {errorText && !fieldError ? (
              <div
                role="alert"
                className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-200"
              >
                {errorText}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!token || loading}
              className="w-full rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:brightness-110 disabled:opacity-60"
            >
              {loading ? t("resetUpdating") : t("resetSubmit")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
