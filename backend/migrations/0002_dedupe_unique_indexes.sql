-- ============================================================================
-- 0002_dedupe_unique_indexes.sql
--
-- AMAC (denetim 2026-09-06: B-C1 / B-H3)
--   0001 baseline "mukerrer silme gerektirir" diye ERTELEDIGI tekillik
--   indekslerini burada, acikca, kurar. Bu dosya:
--     1) margin_history ve historical_rates tablolarindaki mukerrer satirlari
--        TEK BIR KEZ temizler (her grup icin en yuksek id tutulur),
--     2) tekillik indekslerini kurar,
--     3) payments.local_id icin tam (partial olmayan) tekil indeks ekler
--        (dual-write upsert ON CONFLICT (local_id) icin gerekli).
--
-- KAPSAM
--   * DELETE: yalnizca AYNI dogal anahtara sahip FAZLA kopyalar. Veri kaybi yok
--     — her mantiksal kayittan bir tane kalir.
--   * CREATE UNIQUE INDEX IF NOT EXISTS
--   Idempotent: ikinci kosumda dedupe 0 satir siler, indeksler zaten vardir.
--
-- NEDEN
--   margin_history'de tekillik yoktu: soguk SQLite + ilk marj duzenlemesi her
--   redeploy'da bir tane daha sahte ~10 yil oncesi "baseline" satiri
--   ekliyordu (geri donusu olmayan grafik bozulmasi). historical_rates'te de
--   her redeploy sahte "kur degisti" satiri uretebiliyordu.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) historical_rates — (currency, recorded_at) mukerrerlerini temizle
-- ---------------------------------------------------------------------------
delete from public.historical_rates a
using public.historical_rates b
where a.currency = b.currency
  and a.recorded_at = b.recorded_at
  and a.id < b.id;

create unique index if not exists historical_rates_currency_recorded_uidx
  on public.historical_rates (currency, recorded_at);


-- ---------------------------------------------------------------------------
-- 2) margin_history — (institution_id, currency, margin_type, recorded_at)
--    NOT: Supabase'te `margin_type` sutunu SIDE (buy|sell) tutar; `kind`
--    (fixed|percent) ayri sutundur (margin_type_value). Dogal anahtar bu
--    dorttur.
-- ---------------------------------------------------------------------------
delete from public.margin_history a
using public.margin_history b
where a.institution_id = b.institution_id
  and a.currency = b.currency
  and a.margin_type = b.margin_type
  and a.recorded_at = b.recorded_at
  and a.id < b.id;

create unique index if not exists margin_history_natural_key_uidx
  on public.margin_history (institution_id, currency, margin_type, recorded_at);


-- ---------------------------------------------------------------------------
-- 2b) audit_log — tamper-evident hash zinciri sutunlari (S-M4)
--     Her satirin row_hash'i bir oncekinin prev_hash'ini icerir; bir satir
--     eklenir/silinir/degistirilirse zincir kopar.
-- ---------------------------------------------------------------------------
alter table public.audit_log add column if not exists prev_hash text;
alter table public.audit_log add column if not exists row_hash  text;


-- ---------------------------------------------------------------------------
-- 3) payments.local_id — tam tekil indeks (0001'deki partial indeks yerine,
--    dual-write upsert ON CONFLICT (local_id) icin). Postgres tekil indeksi
--    birden fazla NULL'a izin verir; yalnizca dolu local_id'ler zorlanir.
-- ---------------------------------------------------------------------------
create unique index if not exists payments_local_id_uidx
  on public.payments (local_id);
