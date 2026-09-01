-- ============================================================================
-- 0001_baseline.sql
-- Supabase (Postgres) semasini, bugunku SQLite semasiyla esitler.
--
-- AMAC
--   Denetimde olculen sema kaymasi kapatilir. Render'in diski gecici oldugu
--   icin SQLite her deploy'da sifirlanip Supabase'ten doldurulur; Supabase'te
--   karsiligi olmayan alan HER DEPLOY'DA KALICI OLARAK KAYBOLUR.
--
-- KAPSAM - YALNIZCA EKLEME
--   * CREATE TABLE IF NOT EXISTS
--   * ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   * CREATE INDEX IF NOT EXISTS
--   Hicbir tablo/kolon SILINMEZ, hicbir tip DEGISTIRILMEZ, hicbir satir
--   silinmez veya guncellenmez. Bu dosya iki kez calistirilsa da sonuc aynidir.
--
-- BU DOSYA NEYI BIRLESTIRIYOR
--   backend/supabase_admin_schema.sql                  (hic calistirilmamisti)
--   backend/scripts/supabase-institutions-columns.sql  (hic calistirilmamisti)
--   + eksik olanlar: historical_rates, site_settings, institutions.last_login_at
--   Eski dosyalar referans olarak yerinde birakildi; artik bu dosya gecerlidir.
--
-- BILINCLI OLARAK DISARIDA BIRAKILANLAR
--   bank_admins  -> Kimlik dogrulama artik institutions'tan okuyor (db.js:1134).
--                   Kullanilmayan 20 parola ozeti tasiyor; Postgres'e tasinmaz.
--   historical_rates tekillik indeksi -> Mukerrer satir SILMEYI gerektirdigi
--                   icin ayri ve acikca onaylanacak bir migration'a birakildi.
--                   Bu dosyada hicbir yikici ifade yoktur.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) institutions
-- ---------------------------------------------------------------------------
create table if not exists public.institutions (
  id                    bigint generated always as identity primary key,
  local_id              integer,
  institution_id        text not null unique,
  username              text not null,
  password_hash         text not null,
  institution_name      text not null,
  role                  text not null default 'business',
  subscription          text default 'Test',
  subscription_type     text default 'Test',
  subscription_end_date timestamptz,
  is_active             boolean not null default true,
  logo_url              text,
  email                 text,
  phone                 text,
  contact_person        text,
  working_hours         text,
  branch_limit          integer not null default 1,
  last_login_at         timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

alter table public.institutions add column if not exists local_id              integer;
alter table public.institutions add column if not exists role                  text not null default 'business';
alter table public.institutions add column if not exists subscription          text default 'Test';
alter table public.institutions add column if not exists subscription_type     text default 'Test';
alter table public.institutions add column if not exists subscription_end_date timestamptz;
alter table public.institutions add column if not exists is_active             boolean not null default true;
alter table public.institutions add column if not exists logo_url              text;
alter table public.institutions add column if not exists email                 text;
alter table public.institutions add column if not exists phone                 text;
alter table public.institutions add column if not exists contact_person        text;
alter table public.institutions add column if not exists working_hours         text;
alter table public.institutions add column if not exists branch_limit          integer not null default 1;
alter table public.institutions add column if not exists last_login_at         timestamptz;
alter table public.institutions add column if not exists updated_at            timestamptz default now();


-- ---------------------------------------------------------------------------
-- 2) branches
-- ---------------------------------------------------------------------------
create table if not exists public.branches (
  id                      bigint generated always as identity primary key,
  local_id                integer,
  business_local_id       integer,
  institution_id          text not null,
  name                    text not null,
  phone                   text default '',
  whatsapp                text default '',
  address                 text default '',
  lat                     double precision,
  lng                     double precision,
  subscription_type       text default 'Test',
  subscription_start_date timestamptz,
  subscription_end_date   timestamptz,
  is_active               boolean not null default true,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now(),
  unique (institution_id, name)
);

alter table public.branches add column if not exists local_id                integer;
alter table public.branches add column if not exists business_local_id       integer;
alter table public.branches add column if not exists whatsapp                text default '';
alter table public.branches add column if not exists subscription_type       text default 'Test';
alter table public.branches add column if not exists subscription_start_date timestamptz;
alter table public.branches add column if not exists subscription_end_date   timestamptz;
alter table public.branches add column if not exists is_active               boolean not null default true;
alter table public.branches add column if not exists updated_at              timestamptz default now();


-- ---------------------------------------------------------------------------
-- 3) branch_requests
-- ---------------------------------------------------------------------------
create table if not exists public.branch_requests (
  id                bigint generated always as identity primary key,
  local_id          integer,
  business_local_id integer,
  institution_id    text not null,
  business_name     text default '',
  branch_name       text not null,
  phone             text default '',
  address           text default '',
  lat               double precision,
  lng               double precision,
  request_type      text not null default 'new',
  branch_id         integer,
  status            text not null default 'pending',
  is_read           boolean not null default false,
  admin_note        text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

alter table public.branch_requests add column if not exists request_type text not null default 'new';
alter table public.branch_requests add column if not exists branch_id    integer;
alter table public.branch_requests add column if not exists admin_note   text;


-- ---------------------------------------------------------------------------
-- 4) business_notifications
-- ---------------------------------------------------------------------------
create table if not exists public.business_notifications (
  id                 bigint generated always as identity primary key,
  local_id           integer,
  business_local_id  integer,
  institution_id     text,
  type               text not null,
  title              text default '',
  message            text not null,
  related_request_id integer,
  is_read            boolean not null default false,
  created_at         timestamptz default now()
);

alter table public.business_notifications add column if not exists local_id integer;


-- ---------------------------------------------------------------------------
-- 5) rate_adjustments  (guncel marjlar)
-- ---------------------------------------------------------------------------
create table if not exists public.rate_adjustments (
  id             bigint generated always as identity primary key,
  institution_id text not null,
  currency       text not null,
  type           text not null,
  margin_type    text not null default 'fixed',
  margin_value   double precision not null default 0,
  updated_at     timestamptz default now(),
  unique (institution_id, currency, type)
);


-- ---------------------------------------------------------------------------
-- 6) margin_history
-- ---------------------------------------------------------------------------
create table if not exists public.margin_history (
  id                bigint generated always as identity primary key,
  institution_id    text not null,
  currency          text not null,
  margin_type       text not null,
  margin_type_value text not null default 'fixed',
  margin_value      double precision not null default 0,
  recorded_at       timestamptz not null,
  created_at        timestamptz default now()
);


-- ---------------------------------------------------------------------------
-- 7) partnership_applications
-- ---------------------------------------------------------------------------
create table if not exists public.partnership_applications (
  id               bigint generated always as identity primary key,
  institution_name text not null,
  contact_person   text not null,
  email            text not null,
  phone            text not null,
  message          text,
  created_at       timestamptz default now()
);


-- ---------------------------------------------------------------------------
-- 8) password_resets
-- ---------------------------------------------------------------------------
create table if not exists public.password_resets (
  id                   bigint generated always as identity primary key,
  institution_local_id integer,
  institution_slug     text,
  email                text not null,
  token                text not null unique,
  expires_at           timestamptz not null,
  used                 boolean not null default false,
  created_at           timestamptz default now()
);


-- ---------------------------------------------------------------------------
-- 9) visitor_sessions
--    NOT: Bu tablo yeni analitik modeliyle emekliye ayrilacak (sartname 11).
--    Simdilik parite icin korunur; hicbir satiri silinmez.
-- ---------------------------------------------------------------------------
create table if not exists public.visitor_sessions (
  id                 bigint generated always as identity primary key,
  session_id         text not null unique,
  location           text default 'Bilinmiyor',
  clicked_businesses text default '[]',
  viewed_currencies  text default '[]',
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);


-- ---------------------------------------------------------------------------
-- 10) site_stats
-- ---------------------------------------------------------------------------
create table if not exists public.site_stats (
  id             integer primary key,
  total_visitors integer not null default 0,
  updated_at     timestamptz default now()
);


-- ---------------------------------------------------------------------------
-- 11) site_settings   <- SQLite'ta vardi, Supabase'te hic tanimlanmamisti
-- ---------------------------------------------------------------------------
create table if not exists public.site_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);


-- ---------------------------------------------------------------------------
-- 12) historical_rates  <- uretimde satir var ama semada hic tanimli degildi
--     Tekillik indeksi BURADA DEGIL (mukerrer silme gerektirir, ayri dosya).
-- ---------------------------------------------------------------------------
create table if not exists public.historical_rates (
  id          bigint generated always as identity primary key,
  currency    text not null,
  buy_rate    double precision not null,
  sell_rate   double precision not null,
  recorded_at timestamptz not null default now()
);

create index if not exists historical_rates_currency_time_idx
  on public.historical_rates (currency, recorded_at desc);


-- ---------------------------------------------------------------------------
-- 13) audit_log   <- Supabase'te tablo hic yoktu
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id               bigint generated always as identity primary key,
  local_id         integer,
  action           text not null,
  actor            text,
  institution_id   text,
  institution_name text,
  detail           text,
  created_at       timestamptz default now()
);

create index if not exists audit_log_inst_time_idx
  on public.audit_log (institution_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 14) plans   <- Supabase'te tablo hic yoktu
--     Fiyatlandirma SUBE BASINADIR (urun karari D-3 / D-5).
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  code      text primary key,
  ad        text not null,
  sure_gun  integer not null,
  fiyat     numeric(10,2) not null default 0,
  kdv_orani numeric(4,2)  not null default 0,
  aktif     boolean not null default true,
  sira      integer not null default 0
);

insert into public.plans (code, ad, sure_gun, fiyat, sira) values
  ('deneme',   'Deneme',              14,    0, 1),
  ('aylik',    'Aylik Abonelik',      30,  500, 2),
  ('yillik',   'Yillik Abonelik',    365, 5000, 3),
  ('ucretsiz', 'Ucretsiz Listeleme',   0,    0, 4)
on conflict (code) do nothing;


-- ---------------------------------------------------------------------------
-- 15) payments   <- Supabase'te tablo hic yoktu
--     Su an kurum seviyesinde. Sube iliskisi 0002'de eklenecek;
--     mevcut 21 kayit LEGACY_UNRESOLVED olarak isaretlenecek (D-4).
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id              bigint generated always as identity primary key,
  local_id        integer,
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

create unique index if not exists payments_local_uidx
  on public.payments (local_id) where local_id is not null;
create index if not exists payments_inst_date_idx
  on public.payments (institution_id, odeme_tarihi desc);
create index if not exists payments_donem_idx
  on public.payments (donem_bitis);


-- ---------------------------------------------------------------------------
-- 16) RLS - hepsi kilitli. Policy YOK; yalnizca service_role bypass eder.
-- ---------------------------------------------------------------------------
alter table public.institutions             enable row level security;
alter table public.branches                 enable row level security;
alter table public.branch_requests          enable row level security;
alter table public.business_notifications   enable row level security;
alter table public.rate_adjustments         enable row level security;
alter table public.margin_history           enable row level security;
alter table public.partnership_applications enable row level security;
alter table public.password_resets          enable row level security;
alter table public.visitor_sessions         enable row level security;
alter table public.site_stats               enable row level security;
alter table public.site_settings            enable row level security;
alter table public.historical_rates         enable row level security;
alter table public.audit_log                enable row level security;
alter table public.plans                    enable row level security;
alter table public.payments                 enable row level security;
