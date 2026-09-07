-- ============================================================================
-- 0009_payment_proofs.sql
--
-- AMAC (urun boslugu incelemesi 2026-09-06: B5 — self-servis odeme / dekont)
--   Isletme panelden "Yenile / Yukselt" der, plan secer, havale bilgilerini
--   gorur, dekont gorselini yukler. Superadmin dekontu goruntuleyip onaylar:
--   onayda createPayment + abonelik uzatma + makbuz e-postasi. KKTC'de online
--   odeme saglayici sinirli — havale-oncelikli akis.
--
-- KAPSAM
--   * payment_proofs: institution_id, plan_code, amount, method, note,
--     proof_image (base64 data URI), status (pending|approved|rejected),
--     reviewed_by/-at, reject_reason, payment_id (onayda olusan tahsilat).
--   Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.
--   Supabase sync YOK (branch_requests / rate_alerts gerekcesi — onaydan sonra
--   createPayment kalici tahsilati zaten Supabase'e yaziyor).
-- ============================================================================

create table if not exists public.payment_proofs (
  id             bigint generated always as identity primary key,
  institution_id text not null,
  plan_code      text not null,
  amount         double precision,
  method         text,
  note           text,
  proof_image    text not null,
  status         text not null default 'pending',
  reviewed_by    text,
  reviewed_at    timestamptz,
  reject_reason  text,
  payment_id     bigint,
  created_at     timestamptz not null default now()
);

create index if not exists payment_proofs_status_idx
  on public.payment_proofs (status, created_at);
create index if not exists payment_proofs_inst_idx
  on public.payment_proofs (institution_id);
