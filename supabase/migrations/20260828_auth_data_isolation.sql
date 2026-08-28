create extension if not exists pgcrypto;

create table if not exists public.health_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  constraint health_users_email_normalized check (email = lower(trim(email))),
  constraint health_users_email_unique unique (email)
);

create table if not exists public.health_sessions (
  token_hash text primary key,
  user_id uuid not null references public.health_users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists health_sessions_user_id_idx
  on public.health_sessions (user_id);
create index if not exists health_sessions_active_idx
  on public.health_sessions (expires_at)
  where revoked_at is null;

alter table public.health_users enable row level security;
alter table public.health_sessions enable row level security;

alter table public.alimentacao add column if not exists owner_id uuid references public.health_users(id);
alter table public.hidratacao add column if not exists owner_id uuid references public.health_users(id);
alter table public.exercicios add column if not exists owner_id uuid references public.health_users(id);
alter table public.sono add column if not exists owner_id uuid references public.health_users(id);
alter table public.peso add column if not exists owner_id uuid references public.health_users(id);
alter table public.midias add column if not exists owner_id uuid references public.health_users(id);
alter table public.analise add column if not exists owner_id uuid references public.health_users(id);
alter table public.log_json add column if not exists owner_id uuid references public.health_users(id);

create index if not exists alimentacao_owner_data_idx on public.alimentacao (owner_id, data);
create index if not exists hidratacao_owner_data_idx on public.hidratacao (owner_id, data);
create index if not exists exercicios_owner_data_idx on public.exercicios (owner_id, data);
create index if not exists sono_owner_data_idx on public.sono (owner_id, data);
create index if not exists peso_owner_data_idx on public.peso (owner_id, data);
create index if not exists midias_owner_data_idx on public.midias (owner_id, data);
create index if not exists analise_owner_data_idx on public.analise (owner_id, data);
create index if not exists log_json_owner_data_idx on public.log_json (owner_id, data);