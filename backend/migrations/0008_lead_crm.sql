-- ============================================================================
-- 0008_lead_crm.sql
--
-- AMAC (urun boslugu incelemesi 2026-09-06: S5 + S6 — lead CRM + talep analitigi)
--   * signup_requests ve partnership_applications ayri tablolar; operatorun
--     tek bir "lead" listesinde durum (yeni/iletisimde/kazanildi/kayip), not,
--     hatirlatma tarihi ve atanan kisi takip edebilmesi lazim. Mevcut
--     tablolarin semasina dokunmadan ustune bindiren lead_meta tablosu.
--   * search_misses: anasayfa buro aramasi sonuc bulamayinca (normalize
--     sorgu + sehir) loglanir -> "hangi buro/sehir icin talep var ama arz yok".
--
-- KAPSAM
--   * lead_meta: (source, source_id) benzersiz; source = 'signup' | 'partnership'.
--   * search_misses: query, query_norm, city, session_id.
--   Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.
--   Supabase sync YOK (rate_alerts / discount_codes gerekcesi — operasyonel
--   CRM ustu; kaynak kayitlar zaten kalici).
-- ============================================================================

create table if not exists public.lead_meta (
  id          bigint generated always as identity primary key,
  source      text not null,
  source_id   bigint not null,
  status      text not null default 'new',
  note        text,
  reminder_date date,
  assignee    text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists lead_meta_status_idx on public.lead_meta (status);

create table if not exists public.search_misses (
  id         bigint generated always as identity primary key,
  query      text not null,
  query_norm text not null,
  city       text,
  session_id text,
  created_at timestamptz not null default now()
);

create index if not exists search_misses_norm_idx on public.search_misses (query_norm);
create index if not exists search_misses_created_idx on public.search_misses (created_at);
