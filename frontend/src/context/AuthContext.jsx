import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiUrl } from "../lib/api";
import {
  clearAuth,
  getStoredAuth,
  loginBusiness as loginBusinessApi,
  saveAuth,
} from "../lib/auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => getStoredAuth());
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const stored = getStoredAuth();
      if (!stored?.token) {
        if (!cancelled) {
          setAuth(null);
          setBootstrapping(false);
        }
        return;
      }

      try {
        const response = await fetch(apiUrl("/api/admin/me"), {
          headers: { Authorization: `Bearer ${stored.token}` },
        });

        if (!response.ok) {
          clearAuth();
          if (!cancelled) setAuth(null);
          return;
        }

        const me = await response.json();
        const next = {
          token: stored.token,
          username: me.username || stored.username,
          institution_id: me.institution_id || stored.institution_id,
          institution_name: me.institution_name || stored.institution_name,
          role: me.role || stored.role || "business",
          subscription: me.subscription || stored.subscription || "Test",
          subscription_type: me.subscription_type || stored.subscription_type || "Test",
          subscription_end_date: me.subscription_end_date || stored.subscription_end_date || null,
          is_active: me.is_active !== false,
        };
        saveAuth(next);
        if (!cancelled) setAuth(next);
      } catch {
        // Offline / backend down: keep stored token so refresh still feels logged-in.
        if (!cancelled) setAuth(stored);
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    const next = await loginBusinessApi(username, password);
    setAuth(next);
    return next;
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setAuth(null);
  }, []);

  const value = useMemo(
    () => ({
      auth,
      token: auth?.token || null,
      role: auth?.role || "business",
      isAuthenticated: Boolean(auth?.token),
      isSuperAdmin: auth?.role === "superadmin",
      bootstrapping,
      login,
      logout,
    }),
    [auth, bootstrapping, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
