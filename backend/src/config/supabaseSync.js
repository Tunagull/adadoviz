/**
 * Tüm admin / işletme yazmalarını Supabase'e yansıtan dual-write katmanı.
 * SQLite hâlâ çalışır; Supabase kalıcı kaynaktır (Render ephemeral disk).
 * Hatalar loglanır, ana isteği düşürmez (fire-and-forget safe await).
 */

const { supabase } = require("./supabaseClient");

const DUAL_WRITE_ERROR_LIMIT = 50;
const dualWriteErrors = [];

function logErr(op, err) {
  const rec = {
    at: new Date().toISOString(),
    op: String(op || "unknown"),
    message: String(err?.message || err || "bilinmeyen hata"),
  };
  dualWriteErrors.unshift(rec);
  if (dualWriteErrors.length > DUAL_WRITE_ERROR_LIMIT) dualWriteErrors.pop();
  console.warn(`[SUPABASE-SYNC] ${op}:`, rec.message);
}

function getDualWriteErrors(limit = 20) {
  const n = Math.min(DUAL_WRITE_ERROR_LIMIT, Math.max(1, Number(limit) || 20));
  return dualWriteErrors.slice(0, n);
}

async function safe(op, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    logErr(op, err);
    return false;
  }
}

function institutionPayload(row) {
  if (!row) return null;
  return {
    local_id: row.id ?? null,
    institution_id: row.institution_id,
    username: row.username,
    password_hash: row.password_hash,
    institution_name: row.institution_name,
    role: row.role || "business",
    subscription: row.subscription || "Test",
    subscription_type: row.subscription_type || "Test",
    subscription_end_date: row.subscription_end_date || null,
    is_active: !(row.is_active === 0 || row.is_active === false),
    logo_url: row.logo_url || null,
    email: row.email || null,
    phone: row.phone || null,
    working_hours: row.working_hours
      ? typeof row.working_hours === "string"
        ? row.working_hours
        : JSON.stringify(row.working_hours)
      : null,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    branch_limit: row.branch_limit == null ? 1 : Number(row.branch_limit) || 1,
    contact_person: row.contact_person || null,
    last_login_at: row.last_login_at || null,
  };
}

function parseMissingColumn(err) {
  const msg = String(err?.message || err || "");
  const m = msg.match(/Could not find the '([^']+)' column/i);
  return m ? m[1] : null;
}

async function syncInstitutionUpsert(row) {
  const payload = institutionPayload(row);
  if (!payload?.institution_id) return false;

  const logoUrl = payload.logo_url || null;
  // Önce çekirdek alanları yaz (logo ayrı — büyük data URL tüm upsert'i düşürmesin)
  const { logo_url: _omitFromCore, ...corePayload } = payload;

  const tryUpsert = async (body) => {
    const { error } = await supabase
      .from("institutions")
      .upsert(body, { onConflict: "institution_id" });
    if (error) throw error;
  };

  // branch_limit / contact_person dahil dene; kolon yoksa yalnızca o alanı çıkarıp tekrar dene.
  let body = { ...corePayload };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await tryUpsert(body);
      break;
    } catch (err) {
      const missing = parseMissingColumn(err);
      if (missing && body[missing] !== undefined) {
        logErr(
          "institution.upsert",
          `${missing} kolonu Supabase'te yok — alansız tekrar deneniyor. (${err.message})`
        );
        const next = { ...body };
        delete next[missing];
        body = next;
        if (attempt === 5) {
          logErr("institution.upsert.retry", err);
          return false;
        }
        continue;
      }
      logErr("institution.upsert", err);
      return false;
    }
  }

  if (logoUrl) {
    const logoOk = await safe("institution.logo_update", async () => {
      const { error } = await supabase
        .from("institutions")
        .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
        .eq("institution_id", payload.institution_id);
      if (error) throw error;
    });
    if (!logoOk) {
      console.warn(
        `[SUPABASE-SYNC] Logo Supabase'e yazılamadı (${payload.institution_id}). Çekirdek kayıt OK; logoyu yeniden yükleyin veya daha küçük görsel kullanın.`
      );
    }
  }

  return true;
}

async function syncInstitutionDelete(institutionId) {
  const id = String(institutionId || "").trim();
  if (!id) return false;
  return safe("institution.delete", async () => {
    await supabase.from("branches").delete().eq("institution_id", id);
    await supabase.from("rate_adjustments").delete().eq("institution_id", id);
    await supabase.from("margin_history").delete().eq("institution_id", id);
    await supabase.from("branch_requests").delete().eq("institution_id", id);
    await supabase.from("business_notifications").delete().eq("institution_id", id);
    await supabase.from("password_resets").delete().eq("institution_slug", id);
    const { error } = await supabase
      .from("institutions")
      .delete()
      .eq("institution_id", id);
    if (error) throw error;
  });
}

async function syncBranchUpsert(branch, institutionId) {
  if (!branch || !institutionId) return false;
  return safe("branch.upsert", async () => {
    const { error } = await supabase.from("branches").upsert(
      {
        local_id: branch.id,
        institution_id: institutionId,
        business_local_id: branch.business_id,
        name: branch.name,
        phone: branch.phone || "",
        whatsapp: branch.whatsapp || "",
        address: branch.address || "",
        lat: branch.lat == null ? null : Number(branch.lat),
        lng: branch.lng == null ? null : Number(branch.lng),
        subscription_type: branch.subscription_type || "Test",
        subscription_start_date: branch.subscription_start_date || null,
        subscription_end_date: branch.subscription_end_date || null,
        is_active: !(branch.is_active === 0 || branch.is_active === false),
        created_at: branch.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "institution_id,name" }
    );
    if (error) throw error;
  });
}

async function syncBranchDelete(branch, institutionId) {
  if (!branch?.name || !institutionId) return false;
  return safe("branch.delete", async () => {
    const { error } = await supabase
      .from("branches")
      .delete()
      .eq("institution_id", institutionId)
      .eq("name", branch.name);
    if (error) throw error;
  });
}

async function syncRateAdjustment(institutionId, currency, type, marginType, marginValue) {
  return safe("rate_adjustments.upsert", async () => {
    const { error } = await supabase.from("rate_adjustments").upsert(
      {
        institution_id: String(institutionId),
        currency,
        type,
        margin_type: marginType || "fixed",
        margin_value: Number(marginValue) || 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "institution_id,currency,type" }
    );
    if (error) throw error;
  });
}

async function syncRateAdjustmentsMap(institutionId, adjustments) {
  const entries = Object.entries(adjustments || {});
  for (const [key, adj] of entries) {
    const [currency, type] = key.split("_");
    if (!currency || !type) continue;
    await syncRateAdjustment(
      institutionId,
      currency,
      type,
      adj.margin_type,
      adj.margin_value
    );
  }
}

async function syncBranchRequestUpsert(row) {
  if (!row?.institution_id || !row?.branch_name) return false;
  return safe("branch_requests.upsert", async () => {
    const payload = {
      local_id: row.id ?? null,
      business_local_id: row.business_id ?? null,
      institution_id: row.institution_id,
      business_name: row.business_name || "",
      branch_name: row.branch_name,
      phone: row.phone || "",
      address: row.address || "",
      lat: row.lat == null || row.lat === "" ? null : Number(row.lat),
      lng: row.lng == null || row.lng === "" ? null : Number(row.lng),
      request_type: row.request_type || "new",
      branch_id: row.branch_id == null ? null : Number(row.branch_id),
      status: row.status || "pending",
      is_read: !!(row.is_read === true || row.is_read === 1),
      admin_note: row.admin_note || null,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: existingRows, error: findErr } = await supabase
      .from("branch_requests")
      .select("id")
      .eq("institution_id", payload.institution_id)
      .eq("branch_name", payload.branch_name)
      .eq("status", payload.status)
      .eq("request_type", payload.request_type)
      .limit(1);
    if (findErr) throw findErr;
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;

    if (existing?.id) {
      const { error } = await supabase
        .from("branch_requests")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw error;
      return;
    }

    const { error } = await supabase.from("branch_requests").insert([payload]);
    if (error) throw error;
  });
}

async function syncPartnershipApplication(row) {
  return safe("partnership.insert", async () => {
    const { error } = await supabase.from("partnership_applications").insert([
      {
        institution_name: row.institution_name,
        contact_person: row.contact_person,
        email: row.email,
        phone: row.phone,
        message: row.message || null,
        created_at: new Date().toISOString(),
      },
    ]);
    if (error) throw error;
  });
}

async function syncAuditLog(row) {
  if (!row?.action) return false;
  return safe("audit_log.insert", async () => {
    const { error } = await supabase.from("audit_log").insert([
      {
        action: row.action,
        actor: row.actor || null,
        institution_id: row.institution_id || null,
        institution_name: row.institution_name || null,
        detail: row.detail || null,
        created_at: row.created_at || new Date().toISOString(),
      },
    ]);
    if (error) throw error;
  });
}

async function compareInstitutionDrift(sqliteRows = []) {
  const drifts = [];
  try {
    const { data, error } = await supabase
      .from("institutions")
      .select("institution_id, email, branch_limit")
      .neq("role", "superadmin");
    if (error) throw error;

    const remote = new Map();
    for (const row of data || []) {
      if (row?.institution_id) remote.set(String(row.institution_id), row);
    }

    const localIds = new Set();
    for (const row of sqliteRows || []) {
      const id = String(row.institution_id || "").trim();
      if (!id) continue;
      localIds.add(id);
      const other = remote.get(id);
      if (!other) {
        drifts.push({
          institution_id: id,
          institution_name: row.institution_name || id,
          field: "missing_in_supabase",
          sqlite: "var",
          supabase: "yok",
        });
        continue;
      }
      const localEmail = String(row.email || "").trim().toLowerCase();
      const remoteEmail = String(other.email || "").trim().toLowerCase();
      if (localEmail !== remoteEmail) {
        drifts.push({
          institution_id: id,
          institution_name: row.institution_name || id,
          field: "email",
          sqlite: row.email || "—",
          supabase: other.email || "—",
        });
      }
      const localLimit = Number(row.branch_limit) || 1;
      const remoteLimit = Number(other.branch_limit) || 1;
      if (localLimit !== remoteLimit) {
        drifts.push({
          institution_id: id,
          institution_name: row.institution_name || id,
          field: "branch_limit",
          sqlite: localLimit,
          supabase: remoteLimit,
        });
      }
    }

    for (const [id] of remote) {
      if (!localIds.has(id)) {
        drifts.push({
          institution_id: id,
          institution_name: id,
          field: "missing_in_sqlite",
          sqlite: "yok",
          supabase: "var",
        });
      }
    }
  } catch (err) {
    logErr("drift.compare", err);
    return { ok: false, error: err?.message || String(err), drifts: [] };
  }
  return { ok: true, error: null, drifts };
}

async function syncPasswordReset(row) {
  return safe("password_resets.upsert", async () => {
    const { error } = await supabase.from("password_resets").upsert(
      {
        institution_local_id: row.institution_id,
        institution_slug: row.institution_slug || null,
        email: row.email,
        token: row.token,
        expires_at: row.expires_at,
        used: !!row.used,
        created_at: row.created_at || new Date().toISOString(),
      },
      { onConflict: "token" }
    );
    if (error) throw error;
  });
}

async function syncVisitorSession(row) {
  return safe("visitor_sessions.upsert", async () => {
    const { error } = await supabase.from("visitor_sessions").upsert(
      {
        session_id: row.session_id,
        location: row.location || "Bilinmiyor",
        clicked_businesses:
          typeof row.clicked_businesses === "string"
            ? row.clicked_businesses
            : JSON.stringify(row.clicked_businesses || []),
        viewed_currencies:
          typeof row.viewed_currencies === "string"
            ? row.viewed_currencies
            : JSON.stringify(row.viewed_currencies || []),
        created_at: row.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id" }
    );
    if (error) throw error;
  });
}

async function syncSiteStats(totalVisitors) {
  return safe("site_stats.upsert", async () => {
    const { error } = await supabase.from("site_stats").upsert(
      {
        id: 1,
        total_visitors: Number(totalVisitors) || 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) throw error;
  });
}

/**
 * Boot sırasında Supabase'te (superadmin hariç) hiç kurum olup olmadığını sorar.
 * Bu, server.js'in "gerçek ilk kurulum mu, yoksa Supabase zaten kalıcı veri
 * içeriyor mu" ayrımını yapabilmesi için kullanılır (bkz. project_audit_report.md, 1.1).
 *
 * @returns {{ ok: boolean, hasInstitutions: boolean, count: number, reason?: string }}
 *   ok=false ise Supabase'e ULAŞILAMADI veya anahtar RLS nedeniyle güvenilir sayım
 *   veremiyor demektir — çağıran taraf seed/bootstrap kararını güvenli tarafta
 *   (seed yapma / bootstrap yapma) vermelidir.
 */
async function checkSupabaseHasInstitutions() {
  const key = String(process.env.SUPABASE_KEY || "");
  const looksLikePublishableOrAnon =
    key.startsWith("sb_publishable_") ||
    key.includes("anon") ||
    key.includes("publishable");

  try {
    const { count, error } = await supabase
      .from("institutions")
      .select("id", { count: "exact", head: true })
      .neq("role", "superadmin");
    if (error) throw error;
    const total = count || 0;

    // RLS "default deny" + anon/publishable key: hata DÖNMEZ, count=0 döner.
    // Bu durumda "boş = ilk kurulum" sanmak seed+bootstrap ile SoT'yi bozar.
    if (total === 0 && looksLikePublishableOrAnon) {
      console.warn(
        "[SUPABASE-SYNC] ⚠️ SUPABASE_KEY publishable/anon görünüyor ve institutions=0. " +
          "RLS lockdown sonrası bu anahtar gerçek veriyi göremez. " +
          "service_role key kullanın; aksi halde seed/bootstrap ATLANIR."
      );
      return {
        ok: false,
        hasInstitutions: false,
        count: 0,
        reason: "publishable_key_rls_mask",
      };
    }

    return { ok: true, hasInstitutions: total > 0, count: total };
  } catch (err) {
    logErr("check.institutions", err);
    return { ok: false, hasInstitutions: false, count: 0, reason: "error" };
  }
}

/**
 * Render ephemeral SQLite sıfırlandığında Supabase'teki kalıcı admin verisini geri yükler.
 * seed'den SONRA çağrılmalı — mevcut satırları institution_id üzerinden günceller.
 *
 * @returns {{ ok: boolean, institutions: number, adjustments: number, branches: number }}
 *   ok=false ise en kritik sorgu (institutions) başarısız olmuştur; çağıran taraf
 *   bu durumda bootstrap'ı (SQLite → Supabase) ÇALIŞTIRMAMALIDIR, aksi halde
 *   eksik/seed'lenmiş yerel veri kalıcı Supabase verisinin üzerine yazılabilir.
 */
async function hydrateAdminDataFromSupabase(applyFns = {}) {
  const {
    upsertInstitutionRow,
    upsertAdjustmentRow,
    upsertBranchRow,
  } = applyFns;

  console.log("[SUPABASE-SYNC] Hydrate (Supabase → SQLite) başlıyor...");

  const key = String(process.env.SUPABASE_KEY || "");
  const looksLikePublishableOrAnon =
    key.startsWith("sb_publishable_") ||
    key.includes("anon") ||
    key.includes("publishable");

  let institutions = 0;
  let adjustments = 0;
  let branches = 0;
  let institutionsOk = true;
  let branchesOk = false;

  try {
    const { data: instRows, error: instErr } = await supabase
      .from("institutions")
      .select("*")
      .neq("role", "superadmin");
    if (instErr) throw instErr;

    for (const row of instRows || []) {
      if (typeof upsertInstitutionRow === "function") {
        upsertInstitutionRow(row);
        institutions += 1;
      }
    }
  } catch (err) {
    institutionsOk = false;
    logErr("hydrate.institutions", err);
  }

  try {
    const { data: adjRows, error: adjErr } = await supabase
      .from("rate_adjustments")
      .select("*");
    if (adjErr) throw adjErr;
    for (const row of adjRows || []) {
      if (typeof upsertAdjustmentRow === "function") {
        upsertAdjustmentRow(row);
        adjustments += 1;
      }
    }
  } catch (err) {
    logErr("hydrate.rate_adjustments", err);
  }

  // Publishable/anon + RLS: select boş dönebilir; SoT güvenilir sayılmaz.
  const soTUntrusted =
    !institutionsOk ||
    (institutions === 0 && looksLikePublishableOrAnon);

  try {
    const { data: branchRows, error: brErr } = await supabase.from("branches").select("*");
    if (brErr) throw brErr;
    branchesOk = true;
    // SoT güvenilirse yerel şubeleri tamamen değiştir (hayalet şube temizliği).
    // Aksi halde yalnızca upsert ile ekle/güncelle; mevcut satırları silme.
    if (!soTUntrusted && typeof applyFns.replaceAllBranches === "function") {
      applyFns.replaceAllBranches(branchRows || []);
      branches = (branchRows || []).length;
    } else {
      for (const row of branchRows || []) {
        if (typeof upsertBranchRow === "function") {
          upsertBranchRow(row);
          branches += 1;
        }
      }
      if (soTUntrusted) {
        console.warn(
          "[SUPABASE-SYNC] Şube replace ATLANDI — SoT güvenilmez (RLS/anahtar); hayalet riski için yalnızca upsert."
        );
      }
    }
  } catch (err) {
    logErr("hydrate.branches", err);
  }

  let branchRequests = 0;
  try {
    const { data: reqRows, error: reqErr } = await supabase
      .from("branch_requests")
      .select("*");
    if (reqErr) throw reqErr;
    for (const row of reqRows || []) {
      if (typeof applyFns.upsertBranchRequestRow === "function") {
        applyFns.upsertBranchRequestRow(row);
        branchRequests += 1;
      }
    }
  } catch (err) {
    logErr("hydrate.branch_requests", err);
  }

  try {
    const { data: auditRows, error: auditErr } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (auditErr) throw auditErr;
    for (const row of auditRows || []) {
      if (typeof applyFns.upsertAuditRow === "function") {
        applyFns.upsertAuditRow(row);
      }
    }
  } catch (err) {
    logErr("hydrate.audit_log", err);
  }

  console.log(
    `[SUPABASE-SYNC] Hydrate bitti — ok=${institutionsOk} institutions=${institutions} adjustments=${adjustments} branches=${branches} branchRequests=${branchRequests} branchesOk=${branchesOk}`
  );

  if (soTUntrusted && institutions === 0) {
    return {
      ok: false,
      institutions,
      adjustments,
      branches,
      reason: "publishable_key_rls_mask",
    };
  }

  return { ok: institutionsOk, institutions, adjustments, branches };
}

/**
 * SQLite'daki mevcut işletme / şube / marj verisini Supabase'e toplu iter.
 * Sunucu açılışında bir kez çağrılır.
 */
async function bootstrapAdminDataToSupabase({
  institutions = [],
  branches = [],
  adjustments = [],
  branchRequests = [],
} = {}) {
  console.log("[SUPABASE-SYNC] Bootstrap başlıyor...");
  let ok = 0;
  let fail = 0;

  for (const row of institutions) {
    const done = await syncInstitutionUpsert(row);
    done ? (ok += 1) : (fail += 1);
  }

  for (const b of branches) {
    const done = await syncBranchUpsert(b, b.institution_id);
    done ? (ok += 1) : (fail += 1);
  }

  for (const a of adjustments) {
    const done = await syncRateAdjustment(
      a.institution_id,
      a.currency,
      a.type,
      a.margin_type,
      a.margin_value
    );
    done ? (ok += 1) : (fail += 1);
  }

  for (const req of branchRequests) {
    const done = await syncBranchRequestUpsert(req);
    done ? (ok += 1) : (fail += 1);
  }

  console.log(`[SUPABASE-SYNC] Bootstrap bitti — ok=${ok} fail=${fail}`);
  return { ok, fail };
}

module.exports = {
  syncInstitutionUpsert,
  syncInstitutionDelete,
  syncBranchUpsert,
  syncBranchDelete,
  syncRateAdjustment,
  syncRateAdjustmentsMap,
  syncPartnershipApplication,
  syncBranchRequestUpsert,
  syncPasswordReset,
  syncVisitorSession,
  syncSiteStats,
  checkSupabaseHasInstitutions,
  hydrateAdminDataFromSupabase,
  bootstrapAdminDataToSupabase,
  getDualWriteErrors,
  syncAuditLog,
  compareInstitutionDrift,
};
