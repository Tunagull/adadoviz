-- Supabase SQL Editor'da çalıştırın.
-- Bu kolonlar yoksa institution upsert (email dahil) PGRST204 ile düşüyordu.

alter table public.institutions
  add column if not exists branch_limit integer default 1;

alter table public.institutions
  add column if not exists contact_person text;

alter table public.institutions
  add column if not exists last_login_at timestamptz;

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  action text not null,
  actor text,
  institution_id text,
  institution_name text,
  detail text,
  created_at timestamptz default now()
);

alter table public.audit_log enable row level security;


-- ============================================================================
-- historical_rates tekilliği  (denetim bulgusu Y-03)
-- ----------------------------------------------------------------------------
-- Bu tablo üretimde mevcut (31.08.2026 itibarıyla 8.242 satır) ama ne
-- supabase_admin_schema.sql'de ne de bu dosyanın önceki hâlinde tanımlıydı —
-- dolayısıyla tekillik kısıtı hiç kurulmamış.
--
-- SQLite tarafında aynı sorun ölçüldü: 19.306 satırın 5.779 (currency,
-- recorded_at) grubu mükerrerdi ve grafikler aynı zaman damgasında birden çok
-- nokta çiziyordu. Orada dedupe + unique index uygulandı (19.306 → 7.702).
-- Aşağısı aynısını Supabase tarafında kalıcı hale getirir.
--
-- Önce etkiyi görmek isterseniz (opsiyonel, salt okunur):
--   select count(*) as mukerrer_grup from (
--     select currency, recorded_at from public.historical_rates
--     group by currency, recorded_at having count(*) > 1) t;

-- Aynı (currency, recorded_at) çifti için EN SON eklenen satırı tutar.
delete from public.historical_rates a
using public.historical_rates b
where a.ctid < b.ctid
  and a.currency    = b.currency
  and a.recorded_at = b.recorded_at;

create unique index if not exists historical_rates_currency_time_uidx
  on public.historical_rates (currency, recorded_at);

alter table public.historical_rates enable row level security;


-- ============================================================================
-- ÇALIŞTIRMA SIRASI
-- ----------------------------------------------------------------------------
-- 31.08.2026 üretim taramasında bu dosyadaki kolonların ve tabloların
-- Supabase'e HİÇ uygulanmadığı görüldü. Render'ın diski geçici olduğu için her
-- deploy'da SQLite sıfırlanıp Supabase'ten yeniden doldurulur; Supabase'te
-- karşılığı olmayan alan HER DEPLOY'DA KALICI OLARAK KAYBOLUR.
--
-- Taramada eksik bulunanlar:
--   institutions  → branch_limit, contact_person, last_login_at
--   branches      → whatsapp, is_active, subscription_type,
--                   subscription_start_date, subscription_end_date
--   audit_log / branch_requests / business_notifications → tablolar hiç yok
--
--   1) backend/supabase_admin_schema.sql    ← ÖNCE bu
--        institutions, branches (+ UNIQUE(institution_id,name)),
--        rate_adjustments, margin_history, partnership_applications,
--        password_resets, visitor_sessions, site_stats,
--        branch_requests, business_notifications
--
--   2) bu dosya                              ← SONRA bu
--        institutions.branch_limit / contact_person / last_login_at,
--        audit_log tablosu, historical_rates tekilliği
--
-- DOĞRULAMA — ikisi de çalıştıktan sonra:
--
--   (a) 3 satır dönmeli:
--       select table_name from information_schema.tables
--       where table_schema='public'
--         and table_name in ('audit_log','branch_requests','business_notifications');
--
--   (b) 8 satır dönmeli:
--       select table_name, column_name from information_schema.columns
--       where table_schema='public'
--         and ( (table_name='institutions'
--                and column_name in ('branch_limit','contact_person','last_login_at'))
--            or (table_name='branches'
--                and column_name in ('whatsapp','is_active','subscription_type',
--                                    'subscription_start_date','subscription_end_date')) );
--
--   (c) 0 dönmeli:
--       select count(*) from (
--         select currency, recorded_at from public.historical_rates
--         group by currency, recorded_at having count(*) > 1) t;
-- ============================================================================

-- ============================================================================
-- ABONELİK PAKETLERİ VE TAHSİLAT  (ürün haritası A-01 / A-02 / A-04)
-- ----------------------------------------------------------------------------
-- Render diski geçici; bu tablolar Supabase'te yoksa her deploy'da tüm
-- tahsilat geçmişi kaybolur.
create table if not exists public.plans (
  code       text primary key,
  ad         text not null,
  sure_gun   integer not null,
  fiyat      numeric(10,2) not null default 0,
  kdv_orani  numeric(4,2) not null default 0,
  aktif      boolean not null default true,
  sira       integer not null default 0
);

insert into public.plans (code, ad, sure_gun, fiyat, sira) values
  ('deneme',   'Deneme',             14,    0, 1),
  ('aylik',    'Aylık Abonelik',     30,  500, 2),
  ('yillik',   'Yıllık Abonelik',   365, 5000, 3),
  ('ucretsiz', 'Ücretsiz Listeleme',  0,    0, 4)
on conflict (code) do nothing;

create table if not exists public.payments (
  id              bigint primary key generated always as identity,
  local_id        bigint,
  institution_id  text not null,
  plan_code       text not null,
  tutar           numeric(10,2) not null default 0,
  kdv             numeric(10,2) not null default 0,
  para_birimi     text not null default 'TRY',
  odeme_tarihi    timestamptz not null,
  donem_baslangic date not null,
  donem_bitis     date not null,
  yontem          text,
  durum           text not null default 'odendi',
  fatura_no       text,
  aciklama        text,
  olusturan       text,
  created_at      timestamptz default now()
);

create unique index if not exists payments_local_uidx on public.payments (local_id);
create index if not exists payments_inst_idx  on public.payments (institution_id, odeme_tarihi desc);
create index if not exists payments_donem_idx on public.payments (donem_bitis);

alter table public.plans    enable row level security;
alter table public.payments enable row level security;
