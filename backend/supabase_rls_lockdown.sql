-- ============================================================================
-- AdaDöviz — RLS Kilitleme (Sadece service_role yazabilsin / okuyabilsin)
-- ============================================================================
--
-- AMAÇ
--   Mevcut şema (supabase_admin_schema.sql) tüm tabloları
--   `USING (true) WITH CHECK (true)` ile HERKESE (anon/publishable key dahil)
--   açık bırakıyordu. Bu script tüm bu "açık" politikaları kaldırır.
--
-- NASIL ÇALIŞIR (Supabase/Postgres RLS davranışı)
--   - Bir tabloda RLS enable ise VE hiçbir policy yoksa: anon/authenticated
--     rolleri için o tabloya HİÇBİR satır dönmez ve hiçbir yazma izni verilmez.
--   - service_role anahtarı RLS'i TAMAMEN BYPASS EDER (Postgres/Supabase'in
--     yerleşik davranışı). Yani backend, .env'deki SUPABASE_KEY değerini
--     service_role key olarak kullandığı sürece hiçbir policy'ye ihtiyaç
--     duymadan normal şekilde çalışmaya devam eder.
--   => Sonuç: policy eklemeye gerek yok, sadece MEVCUT AÇIK policy'leri
--      kaldırmak yeterli ve en güvenli yoldur (varsayılan-reddet).
--
-- UYGULAMA ADIMLARI
--   1) Supabase Dashboard → Project Settings → API → "service_role" key'i kopyala.
--      (ASLA frontend'e veya repoya koymayın; yalnızca backend/.env → SUPABASE_KEY)
--   2) backend/.env içinde SUPABASE_KEY değerini service_role key ile değiştirin.
--   3) Bu dosyayı Supabase SQL Editor'da BİR KEZ çalıştırın.
--   4) Backend'i yeniden başlatın; anon/publishable key ile yapılan tüm
--      doğrudan Supabase istekleri artık reddedilir, yalnızca backend
--      (service_role) erişebilir.
--
-- GERİ ALINABİLİR Mİ?
--   Evet — supabase_admin_schema.sql'deki eski `CREATE POLICY ... USING (true)`
--   bloklarını tekrar çalıştırırsanız eski (güvensiz) duruma dönersiniz.
--   Önerilmez.
-- ============================================================================

-- 1) public şemasındaki TÜM mevcut RLS politikalarını kaldır (tablo adı/policy
--    adı fark etmeksizin) — böylece historical_rates gibi bu dosyanın dışında
--    manuel oluşturulmuş politikalar da (örn. migrateToSupabase.js yorumundaki
--    "Allow backend delete") temizlenmiş olur.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    RAISE NOTICE 'Kaldırıldı: %.% -> %', pol.schemaname, pol.tablename, pol.policyname;
  END LOOP;
END $$;

-- 2) RLS'in tüm hassas tablolarda kesinlikle aktif olduğundan emin ol
--    (idempotent — zaten aktifse hata vermez).
ALTER TABLE IF EXISTS public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.rate_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.margin_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.partnership_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.site_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.historical_rates ENABLE ROW LEVEL SECURITY;

-- 3) FORCE ROW LEVEL SECURITY: tablo sahibi (owner) dahil herkes için RLS'i
--    zorunlu kıl. (service_role zaten bypass eder; bu yalnızca "owner" rolüyle
--    yanlışlıkla bağlanan bir istemcinin de RLS'e tabi olmasını garanti eder.)
ALTER TABLE IF EXISTS public.institutions FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.branches FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.rate_adjustments FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.margin_history FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.partnership_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.password_resets FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.visitor_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.site_stats FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.historical_rates FORCE ROW LEVEL SECURITY;

-- 4) Doğrulama sorgusu — bu dosyayı çalıştırdıktan sonra 0 satır dönmelidir.
--    (public şemada policy kalmadığını teyit eder)
-- SELECT * FROM pg_policies WHERE schemaname = 'public';
