create table if not exists public.health_app_config (
  singleton boolean primary key default true check (singleton),
  secret_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.health_app_config enable row level security;
revoke all privileges on table public.health_app_config from public, anon, authenticated;

alter table public.alimentacao enable row level security;
alter table public.hidratacao enable row level security;
alter table public.exercicios enable row level security;
alter table public.sono enable row level security;
alter table public.peso enable row level security;
alter table public.midias enable row level security;
alter table public.analise enable row level security;
alter table public.log_json enable row level security;
alter table public.health_users enable row level security;
alter table public.health_sessions enable row level security;

create or replace function public.health_app_request_authorized()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.health_app_config
    where singleton = true
      and secret_hash = encode(
        extensions.digest(
          coalesce(
            current_setting('request.headers', true)::json ->> 'x-health-app-secret',
            ''
          ),
          'sha256'
        ),
        'hex'
      )
  );
$$;

revoke all on function public.health_app_request_authorized() from public;
grant execute on function public.health_app_request_authorized() to anon, authenticated;

grant select, insert, update on table public.alimentacao to anon;
grant select, insert, update on table public.hidratacao to anon;
grant select, insert, update on table public.exercicios to anon;
grant select, insert, update on table public.sono to anon;
grant select, insert, update on table public.peso to anon;
grant select, insert, update on table public.midias to anon;
grant select, insert, update on table public.analise to anon;
grant select, insert, update on table public.log_json to anon;
grant select, insert, update on table public.health_users to anon;
grant select, insert, update on table public.health_sessions to anon;

do $$
declare
  table_name text;
  policy_record record;
begin
  foreach table_name in array array[
    'alimentacao',
    'hidratacao',
    'exercicios',
    'sono',
    'peso',
    'midias',
    'analise',
    'log_json',
    'health_users',
    'health_sessions'
  ]
  loop
    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
    end loop;

    execute format(
      'create policy server_only_select on public.%I for select to anon using (public.health_app_request_authorized())',
      table_name
    );
    execute format(
      'create policy server_only_insert on public.%I for insert to anon with check (public.health_app_request_authorized())',
      table_name
    );
    execute format(
      'create policy server_only_update on public.%I for update to anon using (public.health_app_request_authorized()) with check (public.health_app_request_authorized())',
      table_name
    );
  end loop;
end $$;