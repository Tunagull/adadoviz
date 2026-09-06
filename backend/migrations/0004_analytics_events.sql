-- ============================================================================
-- 0004_analytics_events.sql
--
-- AMAC (urun boslugu incelemesi 2026-09-06: B3 — isletme analitik paneli)
--   Buro sahibine "kac goruntulenme / arama / yol tarifi / WhatsApp" verisi
--   gostermek icin ince bir olay tablosu. visitor_sessions oturum-bazli
--   ozet tutuyor; bu tablo tekil, zaman damgali olaylari tutar ki 7/30 gun
--   zaman serisi ve sehir/para-birimi kirilimi cikarilabilsin.
--
-- KAPSAM
--   * analytics_events: institution_id (numerik PK), event, session_id,
--     currency, city, created_at.
--   * event whitelist uygulama katmaninda: view|call|whatsapp|directions|
--     search_impression.
--   Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.
-- ============================================================================

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  institution_id bigint references public.institutions(id) on delete cascade,
  event text not null,
  session_id text,
  currency text,
  city text,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_inst_created_idx
  on public.analytics_events (institution_id, created_at);

create index if not exists analytics_events_created_idx
  on public.analytics_events (created_at);
