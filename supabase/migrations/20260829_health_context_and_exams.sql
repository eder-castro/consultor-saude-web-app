create table if not exists public.health_contexts (
  owner_id uuid primary key references public.health_users(id) on delete cascade,
  clinical_profile text not null default '',
  gem_instructions text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.health_exams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.health_users(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  exam_type text not null,
  exam_date date,
  summary text not null default '',
  extracted_data jsonb not null default '{}'::jsonb,
  uncertainties text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'discarded')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists health_exams_owner_created_idx
  on public.health_exams (owner_id, created_at desc);
create index if not exists health_exams_owner_status_date_idx
  on public.health_exams (owner_id, status, exam_date desc);

alter table public.health_contexts enable row level security;
alter table public.health_exams enable row level security;

revoke all privileges on table public.health_contexts from public, anon, authenticated;
revoke all privileges on table public.health_exams from public, anon, authenticated;
grant select, insert, update on table public.health_contexts to anon;
grant select, insert, update on table public.health_exams to anon;

drop policy if exists server_only_select on public.health_contexts;
drop policy if exists server_only_insert on public.health_contexts;
drop policy if exists server_only_update on public.health_contexts;
create policy server_only_select on public.health_contexts
  for select to anon using (public.health_app_request_authorized());
create policy server_only_insert on public.health_contexts
  for insert to anon with check (public.health_app_request_authorized());
create policy server_only_update on public.health_contexts
  for update to anon
  using (public.health_app_request_authorized())
  with check (public.health_app_request_authorized());

drop policy if exists server_only_select on public.health_exams;
drop policy if exists server_only_insert on public.health_exams;
drop policy if exists server_only_update on public.health_exams;
create policy server_only_select on public.health_exams
  for select to anon using (public.health_app_request_authorized());
create policy server_only_insert on public.health_exams
  for insert to anon with check (public.health_app_request_authorized());
create policy server_only_update on public.health_exams
  for update to anon
  using (public.health_app_request_authorized())
  with check (public.health_app_request_authorized());