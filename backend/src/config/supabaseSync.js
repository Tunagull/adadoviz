/**
 * Tüm admin / işletme yazmalarını Supabase'e yansıtan dual-write katmanı.
 * SQLite hâlâ çalışır; Supabase kalıcı kaynaktır (Render ephemeral disk).
 * Hatalar loglanır, ana isteği düşürmez (fire-and-forget safe await).
 */

const { supabase } = require("./supabaseClient");

function logErr(op, err) {
  console.warn(`[SUPABASE-SYNC] ${op}:`, err?.message || err);
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
  };
}

async function syncInstitutionUpsert(row) {
  const payload = institutionPayload(row);
  if (!payload?.institution_id) return false;
  return safe("institution.upsert", async () => {
    const { error } = await supabase
      .from("institutions")
      .upsert(payload, { onConflict: "institution_id" });
    if (error) throw error;
  });
}

async function syncInstitutionDelete(institutionId) {
  const id = String(institutionId || "").trim();
  if (!id) return false;
  return safe("institution.delete", async () => {
    await supabase.from("branches").delete().eq("institution_id", id);
    await supabase.from("rate_adjustments").delete().eq("institution_id", id);
    await supabase.from("margin_history").delete().eq("institution_id", id);
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
        address: branch.address || "",
        lat: branch.lat == null ? null : Number(branch.lat),
        lng: branch.lng == null ? null : Number(branch.lng),
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
 * @returns {{ ok: boolean, hasInstitutions: boolean, count: number }}
 *   ok=false ise Supabase'e ULAŞILAMADI demektir (network/auth hatası) — bu
 *   durumda "boş" ile "ulaşılamadı" birbirine KARIŞTIRILMAMALI, çağıran taraf
 *   seed/bootstrap kararını buna göre güvenli tarafta (seed yapma) vermelidir.
 */
async function checkSupabaseHasInstitutions() {
  try {
    const { count, error } = await supabase
      .from("institutions")
      .select("id", { count: "exact", head: true })
      .neq("role", "superadmin");
    if (error) throw error;
    const total = count || 0;
    return { ok: true, hasInstitutions: total > 0, count: total };
  } catch (err) {
    logErr("check.institutions", err);
    return { ok: false, hasInstitutions: false, count: 0 };
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

  let institutions = 0;
  let adjustments = 0;
  let branches = 0;
  let institutionsOk = true;

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

  try {
    const { data: branchRows, error: brErr } = await supabase.from("branches").select("*");
    if (brErr) throw brErr;
    for (const row of branchRows || []) {
      if (typeof upsertBranchRow === "function") {
        upsertBranchRow(row);
        branches += 1;
      }
    }
  } catch (err) {
    logErr("hydrate.branches", err);
  }

  console.log(
    `[SUPABASE-SYNC] Hydrate bitti — ok=${institutionsOk} institutions=${institutions} adjustments=${adjustments} branches=${branches}`
  );
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
  syncPasswordReset,
  syncVisitorSession,
  syncSiteStats,
  checkSupabaseHasInstitutions,
  hydrateAdminDataFromSupabase,
  bootstrapAdminDataToSupabase,
};
