import { apiUrl, getApiBase } from "./api";

export { getApiBase };

const AUTH_STORAGE_KEY = "finsight_business_auth";

export function getStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token) return null;
    if (!parsed?.institution_id && parsed?.role !== "superadmin") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAuth(auth) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearAuth() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export async function loginBusiness(username, password) {
  const response = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Giriş başarısız.");
  }

  const auth = {
    token: data.token,
    username: data.username,
    institution_id: data.institution_id,
    institution_name: data.institution_name,
    role: data.role || "business",
    subscription: data.subscription || "Test",
    subscription_type: data.subscription_type || "Test",
    subscription_end_date: data.subscription_end_date || null,
    is_active: data.is_active !== false,
  };
  saveAuth(auth);
  return auth;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export async function fetchAdminRates(token) {
  const response = await fetch(apiUrl("/api/admin/rates"), {
    headers: authHeaders(token),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Oranlar alınamadı.");
  }
  return data;
}

export async function saveAdminRates(token, currencies) {
  const response = await fetch(apiUrl("/api/admin/rates"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ currencies }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Oranlar kaydedilemedi.");
  }
  return data;
}

export async function changeBusinessPassword(token, { oldPassword, newPassword }) {
  const response = await fetch(apiUrl("/api/business/change-password"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Şifre değiştirilemedi.");
  }
  return data;
}

export async function fetchAdminBusinesses(token) {
  const response = await fetch(apiUrl("/api/admin/businesses"), {
    headers: authHeaders(token),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "İşletmeler alınamadı.");
  }
  return data.businesses || [];
}

export async function createAdminBusiness(token, payload) {
  const response = await fetch(apiUrl("/api/admin/businesses"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "İşletme oluşturulamadı.");
  }
  return data.business;
}

export async function updateAdminBusiness(token, id, payload) {
  const response = await fetch(apiUrl(`/api/admin/businesses/${id}`), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "İşletme güncellenemedi.");
  }
  return data.business;
}

export async function updateAdminBusinessStatus(token, id, is_active) {
  const response = await fetch(apiUrl(`/api/admin/businesses/${id}/status`), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ is_active }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Durum güncellenemedi.");
  }
  return data.business;
}

export async function resetAdminBusinessSubscription(token, id) {
  const response = await fetch(apiUrl(`/api/admin/businesses/${id}/reset-subscription`), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Abonelik sıfırlanamadı.");
  }
  return data.business;
}

export async function deleteAdminBusiness(token, id) {
  const response = await fetch(apiUrl(`/api/admin/businesses/${id}`), {
    method: "DELETE",
    headers: authHeaders(token),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "İşletme silinemedi.");
  }
  return data;
}

export async function fetchAdminBranches(token, businessId) {
  const response = await fetch(apiUrl(`/api/admin/businesses/${businessId}/branches`), {
    headers: authHeaders(token),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Şubeler alınamadı.");
  }
  return data.branches || [];
}

export async function createAdminBranch(token, payload) {
  const response = await fetch(apiUrl("/api/admin/branches"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Şube oluşturulamadı.");
  }
  return data.branch;
}

export async function updateAdminBranch(token, id, payload) {
  const response = await fetch(apiUrl(`/api/admin/branches/${id}`), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Şube güncellenemedi.");
  }
  return data.branch;
}

export async function deleteAdminBranch(token, id) {
  const response = await fetch(apiUrl(`/api/admin/branches/${id}`), {
    method: "DELETE",
    headers: authHeaders(token),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Şube silinemedi.");
  }
  return data;
}

export async function fetchAdminStats(token) {
  const response = await fetch(apiUrl("/api/admin/stats"), {
    headers: authHeaders(token),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "İstatistikler alınamadı.");
  }
  return data;
}

export async function fetchAdminAnalytics(token, limit = 50) {
  const response = await fetch(apiUrl(`/api/admin/analytics?limit=${limit}`), {
    headers: authHeaders(token),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Analitik alınamadı.");
  }
  return data;
}
