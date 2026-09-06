-- ============================================================================
-- 0005_signup_requests.sql
--
-- AMAC (urun boslugu incelemesi 2026-09-06: B1 — self-signup)
--   Public /kayit formu bir BASVURU kaydi olusturur; hesap OLUSTURULMAZ.
--   Superadmin kuyrukta inceleyip Onayla (createBusiness + parola-belirleme
--   linki) ya da Reddet (sebep + e-posta) yapar.
--
-- KAPSAM
--   * signup_requests: basvuru alanlari + status (pending|approved|rejected) +
--     inceleme meta + onaylandiysa created_business_id.
--   * Anti-abuse (ayni e-posta/telefon/kurum-adi tekrar) uygulama katmaninda.
--   Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.
-- ============================================================================

create table if not exists public.signup_requests (
  id bigint generated always as identity primary key,
  institution_name text not null,
  contact_person text not null,
  email text not null,
  phone text not null,
  city text,
  current_rate_info text,
  status text not null default 'pending',
  reject_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_business_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists signup_requests_status_idx
  on public.signup_requests (status, created_at);
