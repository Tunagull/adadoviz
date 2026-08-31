#!/usr/bin/env node
/**
 * Migration kosucusu — Faz 0.1
 *
 * backend/migrations/*.sql dosyalarini dosya adi sirasiyla, her birini tek bir
 * islem (transaction) icinde uygular ve public.schema_migrations tablosuna
 * kaydeder.
 *
 * KULLANIM
 *   npm run migrate:status   Neyin uygulandigini / bekledigini listeler
 *   npm run migrate:dry      Bekleyenleri gosterir, HICBIR SEY UYGULAMAZ
 *   npm run migrate          Bekleyenleri uygular
 *
 * ORTAM DEGISKENI
 *   DATABASE_URL  Supabase > Project Settings > Database > Connection string
 *                 Deploy'da "Transaction pooler" (port 6543) tercih edilir.
 *                 DIKKAT: Bu deger SUPABASE_KEY'den FARKLIDIR. SUPABASE_KEY
 *                 PostgREST icin API anahtaridir; migration dogrudan Postgres
 *                 baglantisi ister.
 *
 * GUVENLIK
 *   - Baglanti dizesi paroladan dolayi hicbir ciktida gosterilmez.
 *   - pg_advisory_lock ile ayni anda tek kosum garanti edilir (iki Render
 *     instance'i ayni anda deploy olursa cakismasin diye).
 *   - Uygulanmis bir dosyanin icerigi sonradan degistirilirse checksum tutmaz
 *     ve kosucu calismayi REDDEDER. Migration dosyalari degistirilmez;
 *     duzeltme yeni bir dosya olarak eklenir.
 *   - Kosucu uygulama boot'unda DEGIL, deploy adiminda calisir.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

require("dotenv").config();

let Client;
try {
  ({ Client } = require("pg"));
} catch {
  console.error(
    "\n[migrate] 'pg' paketi kurulu degil.\n" +
      "         Kurmak icin: npm install pg\n"
  );
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const LOCK_KEY = 4936042; // bu projeye ozel sabit advisory lock kimligi

const MODE = process.argv.includes("--status")
  ? "status"
  : process.argv.includes("--dry-run")
    ? "dry"
    : "apply";

/** migrations/ icindeki .sql dosyalarini ada gore sirali okur. */
function loadMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`[migrate] Dizin yok: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
      return {
        filename,
        version: filename.split("_")[0],
        sql,
        checksum: crypto.createHash("sha256").update(sql).digest("hex"),
      };
    });
}

/**
 * Baglanti dizesini gosterirken paroladan arindirir.
 * Sadece host/port/veritabani adi loglanir.
 */
function safeTarget(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return "(cozumlenemeyen DATABASE_URL)";
  }
}

async function main() {
  const files = loadMigrationFiles();
  if (files.length === 0) {
    console.log("[migrate] migrations/ bos — yapilacak is yok.");
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "\n[migrate] DATABASE_URL tanimli degil.\n\n" +
        "  Supabase panelinden alin:\n" +
        "    Project Settings > Database > Connection string > URI\n" +
        "  ve backend/.env icine ekleyin:\n" +
        "    DATABASE_URL=postgresql://postgres:<PAROLA>@<HOST>:6543/postgres\n\n" +
        "  NOT: Bu deger SUPABASE_KEY'den farklidir.\n\n" +
        `  Bu arada su ${files.length} dosya bekliyor:\n` +
        files.map((f) => `    - ${f.filename}`).join("\n") +
        "\n\n  Alternatif: dosyalari Supabase SQL Editor'a elle yapistirabilirsiniz;\n" +
        "  hepsi idempotent yazildi (iki kez calismasi zararsizdir).\n"
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    // Supabase TLS zorunlu; sertifika zinciri havuz uzerinden dogrulanamiyor.
    ssl: { rejectUnauthorized: false },
    application_name: "adadoviz-migrate",
  });

  await client.connect();
  console.log(`[migrate] Hedef: ${safeTarget(url)}`);

  try {
    await client.query(`
      create table if not exists public.schema_migrations (
        version      text primary key,
        filename     text not null,
        checksum     text not null,
        applied_at   timestamptz not null default now(),
        execution_ms integer
      )
    `);

    const { rows: applied } = await client.query(
      "select version, filename, checksum, applied_at from public.schema_migrations"
    );
    const appliedByVersion = new Map(applied.map((r) => [r.version, r]));

    // Uygulanmis bir dosya sonradan degistirilmis mi?
    const drifted = [];
    for (const file of files) {
      const prev = appliedByVersion.get(file.version);
      if (prev && prev.checksum !== file.checksum) drifted.push(file.filename);
    }
    if (drifted.length > 0) {
      console.error(
        "\n[migrate] DURDURULDU — uygulanmis migration dosyalari degistirilmis:\n" +
          drifted.map((f) => `    - ${f}`).join("\n") +
          "\n\n  Uygulanmis bir dosya degistirilmez. Duzeltmeyi YENI bir dosya\n" +
          "  olarak ekleyin (orn. 0002_...sql).\n"
      );
      process.exit(1);
    }

    const pending = files.filter((f) => !appliedByVersion.has(f.version));

    if (MODE === "status" || MODE === "dry") {
      console.log("\n  DURUM      VERSIYON  DOSYA");
      for (const file of files) {
        const prev = appliedByVersion.get(file.version);
        const state = prev ? "uygulandi" : "BEKLIYOR ";
        const when = prev
          ? prev.applied_at.toISOString().slice(0, 19).replace("T", " ")
          : "";
        console.log(
          `  ${state}  ${file.version.padEnd(8)}  ${file.filename}  ${when}`
        );
      }
      console.log(
        `\n  Toplam ${files.length} dosya, ${pending.length} bekliyor.` +
          (MODE === "dry" ? "  (--dry-run: hicbir sey uygulanmadi)\n" : "\n")
      );
      return;
    }

    if (pending.length === 0) {
      console.log("[migrate] Her sey guncel — uygulanacak dosya yok.");
      return;
    }

    // Iki instance ayni anda deploy olursa yalnizca biri ilerlesin.
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    console.log(`[migrate] Kilit alindi. ${pending.length} dosya uygulanacak.\n`);

    try {
      for (const file of pending) {
        const started = Date.now();
        process.stdout.write(`  -> ${file.filename} ... `);
        try {
          await client.query("begin");
          await client.query(file.sql);
          await client.query(
            `insert into public.schema_migrations (version, filename, checksum, execution_ms)
             values ($1, $2, $3, $4)`,
            [file.version, file.filename, file.checksum, Date.now() - started]
          );
          await client.query("commit");
          console.log(`tamam (${Date.now() - started} ms)`);
        } catch (err) {
          await client.query("rollback");
          console.log("BASARISIZ");
          console.error(
            `\n[migrate] ${file.filename} uygulanamadi; islem geri alindi.\n` +
              `          Veritabani bu dosyadan onceki durumda.\n\n` +
              `  ${err.message}\n`
          );
          process.exitCode = 1;
          return;
        }
      }
      console.log(`\n[migrate] ${pending.length} dosya uygulandi.`);
    } finally {
      await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`\n[migrate] Beklenmeyen hata: ${err.message}\n`);
  process.exit(1);
});
