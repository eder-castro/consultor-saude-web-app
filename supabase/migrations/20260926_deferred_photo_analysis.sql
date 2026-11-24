-- Images are encrypted by the application before insertion and removed on completion
-- or expiry. Only the authenticated server connector can access this table.
create table if not exists public.health_photo_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.health_users(id) on delete cascade,
  encrypted_input text,
  result jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed', 'reviewed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '48 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists health_photo_jobs_due_idx
  on public.health_photo_jobs (next_attempt_at)
  where status in ('pending', 'processing');
create index if not exists health_photo_jobs_owner_idx
  on public.health_photo_jobs (owner_id, created_at desc);

alter table public.health_photo_jobs enable row level security;
revoke all privileges on public.health_photo_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.health_photo_jobs to anon;

create policy server_only_select on public.health_photo_jobs
  for select to anon using (public.health_app_request_authorized());
create policy server_only_insert on public.health_photo_jobs
  for insert to anon with check (public.health_app_request_authorized());
create policy server_only_update on public.health_photo_jobs
  for update to anon
  using (public.health_app_request_authorized())
  with check (public.health_app_request_authorized());
create policy server_only_delete on public.health_photo_jobs
  for delete to anon using (public.health_app_request_authorized());

create or replace function public.claim_health_photo_job()
returns setof public.health_photo_jobs
language plpgsql
security invoker
set search_path = public
as $$
declare
  candidate public.health_photo_jobs%rowtype;
begin
  if not public.health_app_request_authorized() then
    return;
  end if;

  update public.health_photo_jobs
    set status = 'failed', encrypted_input = null, updated_at = now()
    where status in ('pending', 'processing')
      and (expires_at <= now() or attempts >= 8);

  select * into candidate
    from public.health_photo_jobs
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'processing' and claimed_at < now() - interval '5 minutes')
    order by next_attempt_at, created_at
    for update skip locked
    limit 1;

  if found then
    update public.health_photo_jobs
      set status = 'processing', attempts = attempts + 1,
          claimed_at = now(), updated_at = now()
      where id = candidate.id
      returning * into candidate;
    return next candidate;
  end if;
end;
$$;

revoke all on function public.claim_health_photo_job() from public, authenticated;
grant execute on function public.claim_health_photo_job() to anon;