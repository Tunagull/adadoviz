-- AdaDöviz: Super Admin / İşletme paneli kalıcı tabloları
-- Supabase SQL Editor'da bir kez çalıştırın.

-- 1) İşletmeler
CREATE TABLE IF NOT EXISTS public.institutions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  local_id INTEGER,
  institution_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'business',
  subscription TEXT DEFAULT 'Test',
  subscription_type TEXT DEFAULT 'Test',
  subscription_end_date TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  logo_url TEXT,
  email TEXT,
  phone TEXT,
  working_hours TEXT,
  branch_limit INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Şubeler
CREATE TABLE IF NOT EXISTS public.branches (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  local_id INTEGER,
  business_local_id INTEGER,
  institution_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  address TEXT DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  subscription_type TEXT DEFAULT 'Test',
  subscription_start_date TIMESTAMPTZ,
  subscription_end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (institution_id, name)
);

-- 3) Güncel kâr marjları
CREATE TABLE IF NOT EXISTS public.rate_adjustments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  type TEXT NOT NULL,
  margin_type TEXT NOT NULL DEFAULT 'fixed',
  margin_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (institution_id, currency, type)
);

-- 4) Marj geçmişi (yoksa oluştur)
CREATE TABLE IF NOT EXISTS public.margin_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  margin_type TEXT NOT NULL,
  margin_type_value TEXT NOT NULL DEFAULT 'fixed',
  margin_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5) Partnerlik başvuruları
CREATE TABLE IF NOT EXISTS public.partnership_applications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_name TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6) Şifre sıfırlama
CREATE TABLE IF NOT EXISTS public.password_resets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_local_id INTEGER,
  institution_slug TEXT,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7) Ziyaretçi oturumları
CREATE TABLE IF NOT EXISTS public.visitor_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  location TEXT DEFAULT 'Bilinmiyor',
  clicked_businesses TEXT DEFAULT '[]',
  viewed_currencies TEXT DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8) Site istatistikleri
CREATE TABLE IF NOT EXISTS public.site_stats (
  id INTEGER PRIMARY KEY,
  total_visitors INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: SADECE backend (service_role) erişebilir.
-- ⚠️ GÜVENLİK GÜNCELLEMESİ: Bu tablolar için ARTIK "USING (true)" gibi herkese
-- açık politika OLUŞTURULMAZ. RLS aktif + policy yoksa anon/publishable key
-- ile hiçbir okuma/yazma yapılamaz; yalnızca backend'in kullandığı
-- service_role key RLS'i bypass ederek normal çalışmaya devam eder.
-- Detaylı açıklama ve mevcut (varsa) açık politikaların temizlenmesi için
-- backend/supabase_rls_lockdown.sql dosyasını çalıştırın.
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.margin_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partnership_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_stats ENABLE ROW LEVEL SECURITY;

-- Mevcut Supabase kurulumları için şube limiti sütunu
ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS branch_limit INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS whatsapp TEXT DEFAULT '';

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS subscription_type TEXT DEFAULT 'Test';

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMPTZ;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.branch_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  local_id INTEGER,
  business_local_id INTEGER,
  institution_id TEXT NOT NULL,
  business_name TEXT DEFAULT '',
  branch_name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'pending',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.branch_requests ENABLE ROW LEVEL SECURITY;

-- NOT: Bilinçli olarak burada CREATE POLICY ... USING (true) YOK.
-- Backend, .env → SUPABASE_KEY altında service_role key kullanmalıdır.
