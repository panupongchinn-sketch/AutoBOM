-- ════════════════════════════════════════════════════════
--  BIM Viewer — Full Schema
--  รัน SQL นี้ใน Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════

-- ── 1. Storage Bucket ──────────────────────────────────
insert into storage.buckets (id, name, public)
values ('bim-models', 'bim-models', false)
on conflict (id) do nothing;

-- Storage policies (drop ก่อนถ้ามีอยู่แล้ว)
drop policy if exists "Users upload own models" on storage.objects;
drop policy if exists "Users read own models"   on storage.objects;
drop policy if exists "Users delete own models" on storage.objects;

create policy "Users upload own models"
  on storage.objects for insert
  with check (
    bucket_id = 'bim-models'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users read own models"
  on storage.objects for select
  using (
    bucket_id = 'bim-models'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users delete own models"
  on storage.objects for delete
  using (
    bucket_id = 'bim-models'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ── 2. Projects Table ──────────────────────────────────
create table if not exists public.bim_projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  model_name   text not null,
  storage_path text not null,
  file_size    bigint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.bim_projects enable row level security;

drop policy if exists "Users manage own projects" on public.bim_projects;
create policy "Users manage own projects"
  on public.bim_projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists bim_projects_user
  on public.bim_projects (user_id, created_at desc);

-- ── 3. Takeoff Items Table ─────────────────────────────
drop table if exists public.takeoff_items cascade;

create table if not exists public.takeoff_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  project_id   uuid not null references public.bim_projects(id) on delete cascade,
  name         text not null,
  category     text not null default 'งานสถาปัตย์',
  qty          numeric(12,3) not null default 1,
  unit         text not null default 'ตร.ม.',
  unit_price   numeric(14,2) not null default 0,
  dims_label   text not null default '',
  created_at   timestamptz not null default now()
);

alter table public.takeoff_items enable row level security;

drop policy if exists "Users manage own takeoff" on public.takeoff_items;
create policy "Users manage own takeoff"
  on public.takeoff_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists takeoff_items_project
  on public.takeoff_items (project_id, created_at asc);
