-- ════════════════════════════════════════════════════════
--  BIM Viewer — Takeoff Records Table
--  รัน SQL นี้ใน Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════

create table if not exists public.takeoff_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  project     text not null default 'Default',   -- ชื่อโปรเจกต์ / ชื่อไฟล์ GLB
  name        text not null,                      -- ชื่อ mesh / รายการ
  category    text not null default 'งานสถาปัตย์',
  qty         numeric(12,3) not null default 1,
  unit        text not null default 'ตร.ม.',
  unit_price  numeric(14,2) not null default 0,
  dims_label  text not null default '',           -- เช่น "3.00×2.50×0.20 ม."
  created_at  timestamptz not null default now()
);

-- Index เพื่อดึงเร็วตาม user + project
create index if not exists takeoff_items_user_project
  on public.takeoff_items (user_id, project, created_at desc);

-- Row Level Security — แต่ละ user เห็นแค่ข้อมูลตัวเอง
alter table public.takeoff_items enable row level security;

create policy "Users can read own takeoff"
  on public.takeoff_items for select
  using (auth.uid() = user_id);

create policy "Users can insert own takeoff"
  on public.takeoff_items for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own takeoff"
  on public.takeoff_items for delete
  using (auth.uid() = user_id);
