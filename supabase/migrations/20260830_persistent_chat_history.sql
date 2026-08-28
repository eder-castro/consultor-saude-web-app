create table if not exists public.health_chat_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.health_users(id) on delete cascade,
  client_id text not null,
  role text not null check (role in ('user', 'assistant')),
  kind text not null check (kind in ('text', 'image', 'validation')),
  payload jsonb not null default '{}'::jsonb,
  sequence integer not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, client_id)
);

create index if not exists health_chat_messages_owner_created_idx
  on public.health_chat_messages (owner_id, created_at asc);

alter table public.health_chat_messages enable row level security;
revoke all privileges on table public.health_chat_messages from public, anon, authenticated;
grant select, insert, update on table public.health_chat_messages to anon;

create policy server_only_select on public.health_chat_messages
  for select to anon using (public.health_app_request_authorized());
create policy server_only_insert on public.health_chat_messages
  for insert to anon with check (public.health_app_request_authorized());
create policy server_only_update on public.health_chat_messages
  for update to anon
  using (public.health_app_request_authorized())
  with check (public.health_app_request_authorized());