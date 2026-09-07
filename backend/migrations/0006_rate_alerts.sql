-- ============================================================================
-- 0006_rate_alerts.sql
--
-- AMAC (urun boslugu incelemesi 2026-09-06: C3 — kur alarmi)
--   Ziyaretci bir e-posta + esik girer ("USD alis 41 uzerine cikinca haber ver").
--   Cift-opt-in: dogrulama e-postasi gelir, link tiklanana kadar alarm pasif.
--   Her kur yenilemesinden sonra job eslesen dogrulanmis alarmlari kontrol eder,
--   kosul saglaninca (ve son 12 saatte tetiklenmediyse) e-posta yollar.
--   Yonetim: /alarm/:token sayfasi (token e-postadaki linkte).
--
-- KAPSAM
--   * rate_alerts: email, currency (USD|EUR|GBP), side (buy|sell),
--     direction (above|below), threshold, verified (cift-opt-in), active,
--     armed (yalnizca esik gecisinde tetikle — kosul once FALSE olmali),
--     last_fired_at (12sa debounce), manage_token.
--   Anti-abuse (e-posta basina alarm limiti, ayni alarm tekrari) uygulama
--   katmaninda. Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.
--   Supabase sync YOK (admin_notifications / analytics_events / signup_requests
--   gerekcesi — operasyonel, kritik-kalici degil; dogrulama e-postasi + token
--   zaten kullanicida).
-- ============================================================================

create table if not exists public.rate_alerts (
  id bigint generated always as identity primary key,
  email text not null,
  currency text not null,
  side text not null,
  direction text not null,
  threshold double precision not null,
  verified boolean not null default false,
  active boolean not null default true,
  armed boolean not null default true,
  last_fired_at timestamptz,
  manage_token text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists rate_alerts_token_idx
  on public.rate_alerts (manage_token);
create index if not exists rate_alerts_email_idx
  on public.rate_alerts (lower(email));
create index if not exists rate_alerts_active_idx
  on public.rate_alerts (active, verified);
