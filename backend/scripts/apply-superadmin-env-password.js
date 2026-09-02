/**
 * One-shot: SUPERADMIN_INITIAL_PASSWORD → SQLite (ve mümkünse Supabase).
 * Şifreyi loglamaz.
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const {
  initDb,
  findAdminByUsername,
  updateInstitutionPassword,
  getInstitutionFullById,
} = require("../src/db");
const { syncInstitutionUpsert } = require("../src/config/supabaseSync");

async function main() {
  const username = String(process.env.SUPERADMIN_USERNAME || "tuna").trim();
  const password = process.env.SUPERADMIN_INITIAL_PASSWORD;
  if (!password) {
    console.error("[RESET] SUPERADMIN_INITIAL_PASSWORD .env içinde yok.");
    process.exit(1);
  }

  initDb({ skipBusinessSeed: true });
  const admin = findAdminByUsername(username);
  if (!admin || admin.role !== "superadmin") {
    console.error(`[RESET] Super admin bulunamadı: ${username}`);
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 10);
  updateInstitutionPassword(admin.id, hash);

  const full = getInstitutionFullById(admin.id);
  let supabaseOk = false;
  if (full) {
    supabaseOk = await syncInstitutionUpsert(full);
  }

  const verify = findAdminByUsername(username);
  const matches = bcrypt.compareSync(password, verify.password_hash);
  if (!matches) {
    console.error("[RESET] Hash yazıldı ama doğrulama başarısız.");
    process.exit(1);
  }

  console.log(
    `[RESET] Super admin şifresi güncellendi (user=${username}, supabase=${supabaseOk ? "ok" : "skip/fail"}).`
  );
}

main().catch((err) => {
  console.error("[RESET]", err.message || err);
  process.exit(1);
});
