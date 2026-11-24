-- Authoritative, owner-scoped outcome for reconciliation and idempotent retries.
create table if not exists public.meal_correction_outcomes (
  owner_id uuid not null,
  correction_id text not null check (length(correction_id) between 1 and 100),
  kept_id bigint not null,
  corrected_count integer not null,
  applied_at timestamptz not null default now(),
  primary key (owner_id, correction_id)
);

alter table public.meal_correction_outcomes enable row level security;
revoke all on public.meal_correction_outcomes from public, anon, authenticated;

create or replace function public.apply_meal_correction(
  p_owner_id uuid,
  p_correction_id text,
  p_record_ids text[],
  p_keep_record_id text,
  p_item text,
  p_quantidade text,
  p_expected_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  prior public.meal_correction_outcomes%rowtype;
  result jsonb;
begin
  if not public.health_app_request_authorized() then
    raise exception 'Acesso não autorizado.';
  end if;
  if p_owner_id is null or p_correction_id is null
     or length(trim(p_correction_id)) not between 1 and 100 then
    raise exception 'Identificador da correção inválido.';
  end if;

  select * into prior from public.meal_correction_outcomes
  where owner_id = p_owner_id and correction_id = p_correction_id;
  if found then
    return jsonb_build_object(
      'ok', true, 'already_applied', true,
      'corrected', prior.corrected_count, 'kept_id', prior.kept_id::text
    );
  end if;

  result := public.replace_meal_records(
    p_owner_id, p_record_ids, p_keep_record_id, p_item, p_quantidade, p_expected_rows
  );
  insert into public.meal_correction_outcomes (
    owner_id, correction_id, kept_id, corrected_count
  ) values (
    p_owner_id, p_correction_id, (result->>'kept_id')::bigint,
    (result->>'corrected')::integer
  );
  return result;
end;
$$;
revoke all on function public.apply_meal_correction(uuid, text, text[], text, text, text, jsonb) from public;
grant execute on function public.apply_meal_correction(uuid, text, text[], text, text, text, jsonb) to anon;

create or replace function public.meal_correction_statuses(
  p_owner_id uuid,
  p_correction_ids text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  result jsonb;
begin
  if not public.health_app_request_authorized() then
    raise exception 'Acesso não autorizado.';
  end if;
  if p_owner_id is null or p_correction_ids is null
     or cardinality(p_correction_ids) > 100 then
    raise exception 'Seleção de correções inválida.';
  end if;
  select coalesce(jsonb_agg(correction_id), '[]'::jsonb) into result
  from public.meal_correction_outcomes
  where owner_id = p_owner_id and correction_id = any(p_correction_ids);
  return result;
end;
$$;
revoke all on function public.meal_correction_statuses(uuid, text[]) from public;
grant execute on function public.meal_correction_statuses(uuid, text[]) to anon;