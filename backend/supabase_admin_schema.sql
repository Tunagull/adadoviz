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
  address TEXT DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
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

-- RLS: backend publishable key ile yazabilsin (şimdilik açık; sonra service_role'a geçin)
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.margin_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partnership_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_stats ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "institutions_all" ON public.institutions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "branches_all" ON public.branches FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "rate_adjustments_all" ON public.rate_adjustments FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "margin_history_all" ON public.margin_history FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "partnership_all" ON public.partnership_applications FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "password_resets_all" ON public.password_resets FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "visitor_sessions_all" ON public.visitor_sessions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "site_stats_all" ON public.site_stats FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
