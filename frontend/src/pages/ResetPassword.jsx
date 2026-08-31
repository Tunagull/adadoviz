import { useMemo, useState } from "react";
import { HeaderActions } from "../components/HeaderActions";
import { Helmet } from "react-helmet-async";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Lock, KeyRound, CheckCircle2 } from "lucide-react";
import { apiUrl } from "../lib/api";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!token) {
      setError("Geçersiz sıfırlama bağlantısı. Token bulunamadı.");
      return;
    }
    if (password.length < 4) {
      setError("Şifre en az 4 karakter olmalıdır.");
      return;
    }
    if (password !== confirm) {
      setError("Şifreler eşleşmiyor.");
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
        throw new Error(data.error || "Şifre güncellenemedi.");
      }
      setDone(true);
    } catch (err) {
      setError(err.message || "Şifre güncellenemedi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      {/*
        Tutarlılık: dil ve tema anahtarları diğer tüm sayfalarda var,
        yalnızca bu sayfada eksikti.
      */}
      <div className="mb-6 flex justify-end">
        <HeaderActions compact />
      </div>
      {/* U-08: yönetim sayfaları kendi sekme başlığını verir; robots.txt zaten bu yolları dışlıyor, noindex ile pekiştiriliyor. */}
      <Helmet>
        <title>Şifre Sıfırlama | AdaDöviz</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-900/95 shadow-2xl shadow-brand-900/40 backdrop-blur-xl">
        <div className="border-b border-white/10 bg-gradient-to-r from-ink-900 via-ink-900 to-brand-900/40 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-tr bg-brand-gradient p-2.5 text-white shadow-lg shadow-brand-900/40">
              <KeyRound className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Şifre Sıfırlama</h1>
              <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-400">Yeni şifrenizi belirleyin</p>
            </div>
          </div>
        </div>

        {done ? (
          <div className="space-y-4 px-6 py-8 text-center">
            <CheckCircle2 className="mx-auto size-12 text-success-400" />
            <p className="text-sm text-ink-200">
              Şifreniz başarıyla güncellendi. Artık yeni şifrenizle giriş yapabilirsiniz.
            </p>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="w-full rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:brightness-110"
            >
              Ana Sayfaya Dön
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6">
            {!token ? (
              <div className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-200">
                Geçersiz veya eksik sıfırlama bağlantısı.
              </div>
            ) : null}

            <div className="space-y-2">
              <label
                htmlFor="reset-password"
                className="text-xs font-medium uppercase tracking-wide text-ink-600 dark:text-ink-400"
              >
                Yeni Şifre
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
                <input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-11 w-full rounded-lg border border-ink-700 bg-ink-950 pl-10 pr-3 text-sm text-ink-100 outline-none transition focus:border-brand-400/70 focus:ring-2 focus:ring-brand-500/20"
                  required
                  disabled={!token || loading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="reset-password-confirm"
                className="text-xs font-medium uppercase tracking-wide text-ink-600 dark:text-ink-400"
              >
                Şifre Tekrar
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
                <input
                  id="reset-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="h-11 w-full rounded-lg border border-ink-700 bg-ink-950 pl-10 pr-3 text-sm text-ink-100 outline-none transition focus:border-brand-400/70 focus:ring-2 focus:ring-brand-500/20"
                  required
                  disabled={!token || loading}
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-200">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!token || loading}
              className="w-full rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:brightness-110 disabled:opacity-60"
            >
              {loading ? "Güncelleniyor..." : "Şifreyi Güncelle"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
