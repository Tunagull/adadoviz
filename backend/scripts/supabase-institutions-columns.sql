-- Supabase SQL Editor'da çalıştırın.
-- Bu kolonlar yoksa institution upsert (email dahil) PGRST204 ile düşüyordu.

alter table public.institutions
  add column if not exists branch_limit integer default 1;

alter table public.institutions
  add column if not exists contact_person text;
