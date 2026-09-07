-- ============================================================================
-- 0007_discount_codes.sql
--
-- AMAC (urun boslugu incelemesi 2026-09-06: S1 — gelir paneli)
--   Superadmin yenileme/yukseltme tahsilatlarinda indirim kodu uygulayabilsin.
--   Kod: yuzde ya da sabit tutar; opsiyonel son kullanma tarihi; opsiyonel
--   maksimum kullanim adedi (0 = sinirsiz). Tahsilat kaydedilirken kod
--   dogrulanir, net tutar dusurulur ve kullanim sayaci artar.
--
-- KAPSAM
--   * discount_codes: code (unique, buyuk harf), tur (percent|fixed), deger,
--     para_birimi, max_kullanim, kullanim_sayisi, gecerlilik_bitis, aktif,
--     aciklama.
--   * payments tablosuna indirim_kodu + indirim_tutari kolonlari (uygulama
--     katmaninda ALTER — SQLite tarafinda columnExists deseni).
--   Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.
--   Supabase sync YOK (rate_alerts / signup_requests gerekcesi — operasyonel,
--   makbuz + audit zaten kaliciyi kayit altina aliyor).
-- ============================================================================

create table if not exists public.discount_codes (
  code             text primary key,
  tur              text not null default 'percent',
  deger            double precision not null default 0,
  para_birimi      text not null default 'TRY',
  max_kullanim     integer not null default 0,
  kullanim_sayisi  integer not null default 0,
  gecerlilik_bitis date,
  aktif            boolean not null default true,
  aciklama         text,
  created_at       timestamptz not null default now()
);

create index if not exists discount_codes_aktif_idx
  on public.discount_codes (aktif);

alter table if exists public.payments
  add column if not exists indirim_kodu   text;
alter table if exists public.payments
  add column if not exists indirim_tutari double precision not null default 0;
