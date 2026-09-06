-- ============================================================================
-- 0003_analytics_business_ids.sql
--
-- AMAC (urun boslugu incelemesi 2026-09-06: S7)
--   visitor_sessions.clicked_businesses tiklamalari isletme ADIYLA tutuyor.
--   Kurum adi degisince tiklama gecmisi kopuyor; iki benzer isim karisiyor.
--   Bu migration id-bazli bir kolon ekler; kod yeni tiklamalari hem isim hem
--   institution_id ile yazar, getClicksByBusiness once id ile eslesir.
--
-- KAPSAM
--   * ALTER TABLE ... ADD COLUMN IF NOT EXISTS — additif, veri kaybi yok.
--   Idempotent: ikinci kosumda kolon zaten vardir.
-- ============================================================================

alter table public.visitor_sessions
  add column if not exists clicked_business_ids text not null default '[]';
