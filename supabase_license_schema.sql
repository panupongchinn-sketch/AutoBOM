-- ════════════════════════════════════════════════════════
--  BIM Viewer — License Key System
--  รัน SQL นี้ใน Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════

-- ── 1. License Keys (Admin สร้างล่วงหน้า) ──────────────
create table if not exists public.license_keys (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,
  label         text not null,
  duration_days integer not null check (duration_days > 0),
  is_active     boolean not null default true,
  bound_user_id uuid default null,        -- user_id แรกที่ activate (1 key = 1 user เท่านั้น)
  bound_email   text default null,        -- email ของ user ที่ activate (ตรวจซ้ำชั้นที่ 2)
  note          text default '',
  created_at    timestamptz not null default now()
);

-- Migration: ถ้า table มีอยู่แล้ว ให้เพิ่ม columns ที่ขาด (idempotent)
alter table public.license_keys
  add column if not exists bound_user_id uuid default null;
alter table public.license_keys
  add column if not exists bound_email text default null;
-- ลบ max_uses / use_count ออก (ไม่จำเป็นเมื่อ enforce 1:1 ด้วย bound_user_id)
-- ถ้า column ยังมีอยู่ก็ไม่กระทบ — แค่ไม่ใช้งานแล้ว

alter table public.license_keys enable row level security;

-- Authenticated users อ่านได้ (เพื่อ validate + ตรวจ bound_user_id)
drop policy if exists "Auth users read license_keys" on public.license_keys;
create policy "Auth users read license_keys"
  on public.license_keys for select
  using (auth.role() = 'authenticated');

-- ── 2. User Licenses (ผูก user กับ key) ────────────────
create table if not exists public.user_licenses (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  license_key_id   uuid not null references public.license_keys(id),
  activated_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now(),
  constraint uq_user_license     unique (user_id),         -- 1 user = 1 license slot
  constraint uq_license_key_user unique (license_key_id)   -- 1 key = 1 user slot (DB-level lock)
);

alter table public.user_licenses enable row level security;

drop policy if exists "Users manage own license" on public.user_licenses;
create policy "Users manage own license"
  on public.user_licenses for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── 3. ตัวอย่าง License Keys เริ่มต้น ──────────────────
insert into public.license_keys (key, label, duration_days, note) values
  ('BIMV-WEEK-0001-DEMO', '1 สัปดาห์',  7,   'Trial 7 days'),
  ('BIMV-MON1-0001-DEMO', '1 เดือน',    30,  'Monthly license'),
  ('BIMV-MON3-0001-DEMO', '3 เดือน',    90,  'Quarterly license'),
  ('BIMV-YR01-0001-DEMO', '1 ปี',       365, 'Annual license'),
  ('BIMV-YR01-0002-DEMO', '1 ปี',       365, 'Annual license'),
  ('BIMV-YR01-0003-DEMO', '1 ปี',       365, 'Annual license')
on conflict (key) do nothing;
