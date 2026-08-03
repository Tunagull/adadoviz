import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Lock, Mail, User, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { apiUrl } from "../lib/api";
import { HeaderActions } from "./HeaderActions";

export function BusinessLoginModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setError("");
    setUsername("");
    setPassword("");
    setRememberMe(false);
    setShowForgotModal(false);
    setForgotEmail("");
    setForgotError("");
    setForgotSuccess("");

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (showForgotModal) {
          setShowForgotModal(false);
          return;
        }
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, showForgotModal]);

  if (!isOpen) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setLoading(true);

    try {
      const result = await login(username.trim(), password, { remember: rememberMe });

      if (!result?.token) {
        throw new Error("Token alınamadı");
      }

      setIsLoggingIn(true);
      setLoading(false);

      setTimeout(() => {
        const role = result?.role || "business";
        navigate(role === "superadmin" ? "/super-admin" : "/admin");
      }, 1000);
    } catch (err) {
      setError(err.message || t("loginFailed"));
      setIsLoggingIn(false);
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (event) => {
    event.preventDefault();
    setForgotError("");
    setForgotSuccess("");
    setForgotLoading(true);

    try {
      const res = await fetch(apiUrl("/api/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t("forgotRequestFailed"));
      }
      setForgotSuccess(data.message || t("forgotSuccessDefault"));
    } catch (err) {
      setForgotError(err.message || t("forgotRequestFailed"));
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="business-login-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-500/30 backdrop-blur-sm dark:bg-[#020617]/80"
        onClick={onClose}
        aria-label="Modalı kapat"
      />

      <div className="relative z-10 max-h-[min(94dvh,94vh)] w-full max-w-md overflow-y-auto overflow-x-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl shadow-indigo-950/20 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95 dark:shadow-indigo-950/50 sm:rounded-2xl">
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
        {isLoggingIn ? (
          <div className="p-12 flex flex-col items-center justify-center min-h-[300px]">
            <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mb-4 animate-spin">
              <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <h3 className="text-slate-900 dark:text-white text-xl font-bold">{t("loggingInTitle")}</h3>
            <p className="text-slate-500 dark:text-slate-300 text-sm mt-3">{t("loggingInSubtitle")}</p>
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 bg-gradient-to-r from-white via-slate-50 to-indigo-50 px-4 py-5 pr-14 dark:border-white/10 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/40 sm:px-6 sm:pr-16">
              <div className="flex min-w-0 items-center gap-3">
                <div className="shrink-0 rounded-xl bg-gradient-to-tr from-indigo-500 to-teal-400 p-2.5 text-white shadow-lg shadow-indigo-900/40">
                  <Building2 className="size-5" />
                </div>
                <div className="min-w-0">
                  <h2 id="business-login-title" className="truncate text-lg font-bold text-slate-900 dark:text-white">
                    {t("businessLogin")}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{t("businessLoginSubtitle")}</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 px-4 py-6 sm:px-6">
              <div className="space-y-2">
                <label
                  htmlFor="business-username"
                  className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                >
                  {t("usernameLabel")}
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                  <input
                    id="business-username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder={t("usernamePlaceholder")}
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400 dark:focus:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="business-password"
                  className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                >
                  {t("passwordLabel")}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                  <input
                    id="business-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400 dark:focus:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                    required
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-950"
                    />
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      {t("rememberMe")}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotError("");
                      setForgotSuccess("");
                      setForgotEmail("");
                      setShowForgotModal(true);
                    }}
                    className="text-xs text-teal-400 transition-colors hover:text-teal-300"
                  >
                    {t("forgotPassword")}
                  </button>
                </div>
              </div>

              {error ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
                  {error}
                </div>
              ) : successMessage ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 font-semibold dark:text-emerald-200">
                  ✓ {successMessage}
                </div>
              ) : null}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 transition-all duration-300 hover:border-cyan-400 hover:text-cyan-600 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-cyan-400 dark:hover:text-cyan-400 dark:hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-lg bg-gradient-to-r from-teal-400 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 transition hover:brightness-110 disabled:opacity-60"
                >
                  {loading ? t("loggingIn") : t("loginButton")}
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {showForgotModal ? (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-password-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70"
            onClick={() => setShowForgotModal(false)}
            aria-label="Şifremi unuttum modalını kapat"
          />
          <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
              <HeaderActions compact />
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="rounded-full p-1 text-slate-400 transition hover:text-rose-500"
                aria-label="Kapat"
              >
                <X size={20} />
              </button>
            </div>
            <h3 id="forgot-password-title" className="pt-8 text-base font-bold text-slate-900 dark:text-slate-100 sm:pt-0 sm:pr-[7.5rem]">
              {t("forgotPasswordTitle")}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("forgotPasswordDesc")}</p>

            <form onSubmit={handleForgotSubmit} className="mt-4 space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="forgot-email"
                  className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                >
                  {t("emailOrUsername")}
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                  <input
                    id="forgot-email"
                    type="text"
                    autoComplete="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder={t("emailOrUsernamePlaceholder")}
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(34,211,238,0.4)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    required
                    disabled={forgotLoading}
                  />
                </div>
              </div>

              {forgotError ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
                  {forgotError}
                </div>
              ) : null}
              {forgotSuccess ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                  {forgotSuccess}
                </div>
              ) : null}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowForgotModal(false)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 hover:text-white"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="flex-1 rounded-lg bg-gradient-to-r from-teal-400 to-indigo-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {forgotLoading ? t("sending") : t("send")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
