-- Sleep is a reviewed daily measurement, not an additive repeated upload.
-- Existing legacy rows and the legacy consolidation workflow are left intact.
alter table public.health_save_outcomes add column if not exists sleep_replacements jsonb;
do $$
begin
  if to_regprocedure('public.save_health_records_unchecked(uuid,text,jsonb)') is null then
    alter function public.save_health_records(uuid,text,jsonb) rename to save_health_records_unchecked;
  end if;
end;
$$;
revoke all on function public.save_health_records_unchecked(uuid,text,jsonb) from public,anon,authenticated;

create or replace function public.sleep_day_status(p_owner_id uuid, p_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.health_app_request_authorized() or p_owner_id is null or p_date is null then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  select jsonb_build_object('data',p_date,'count',count(*),
    'token',md5(coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb)::text))
    into result from public.sono r where owner_id=p_owner_id and data=p_date;
  return result;
end;
$$;
revoke all on function public.sleep_day_status(uuid,date) from public;
grant execute on function public.sleep_day_status(uuid,date) to anon;

create or replace function public.save_health_records_checked(
  p_owner_id uuid, p_operation_id text, p_entries jsonb,
  p_sleep_replacements jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare prior public.health_save_outcomes%rowtype; day date;
  approval jsonb; status jsonb; result jsonb;
begin
  if not public.health_app_request_authorized() or p_owner_id is null then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  if p_operation_id is null or jsonb_typeof(p_entries) is distinct from 'array'
    or jsonb_typeof(p_sleep_replacements) is distinct from 'array'
    or jsonb_array_length(p_sleep_replacements)>100 then
    raise exception 'Confirmação inválida.' using errcode='22023';
  end if;
  -- Retries acquire the operation lock before serializing owner-level corrections.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_operation_id,0));
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select * into prior from public.health_save_outcomes
    where owner_id=p_owner_id and operation_id=p_operation_id;
  if found then
    if prior.sleep_replacements is not null and prior.sleep_replacements<>p_sleep_replacements then
      raise exception 'Esta confirmação já foi usada com outra substituição.' using errcode='22023';
    end if;
    -- Original RPC verifies the complete entries hash before returning its outcome.
    return public.save_health_records_unchecked(p_owner_id,p_operation_id,p_entries);
  end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e where e->>'table'='sono'
    group by e->'record'->>'data' having count(*)>1) then
    raise exception 'Envie um único total de sono por data, com as fases no mesmo registro.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_sleep_replacements) a
    where not exists(select 1 from jsonb_array_elements(p_entries) e
      where e->>'table'='sono' and e->'record'->>'data'=a->>'data'))
    or (select count(*) from jsonb_array_elements(p_sleep_replacements))<>
       (select count(distinct a->>'data') from jsonb_array_elements(p_sleep_replacements) a) then
    raise exception 'Substituição sem registro de sono correspondente.' using errcode='22023';
  end if;
  for day in select distinct (e->'record'->>'data')::date
    from jsonb_array_elements(p_entries) e where e->>'table'='sono' order by 1 loop
    perform 1 from public.sono where owner_id=p_owner_id and data=day order by id for update;
    status:=public.sleep_day_status(p_owner_id,day);
    select value into approval from jsonb_array_elements(p_sleep_replacements)
      where value->>'data'=day::text;
    if approval is not null then
      if approval->>'expected_token' is distinct from status->>'token' then
        raise exception 'SLEEP_CHANGED: O sono salvo mudou. Confira novamente antes de substituir.' using errcode='P0001';
      end if;
      delete from public.sono where owner_id=p_owner_id and data=day;
    elsif (status->>'count')::int>0 then
      raise exception 'SLEEP_DUPLICATE: Já existe sono nesta data. Revise e confirme a substituição.' using errcode='P0001';
    end if;
  end loop;
  -- Delete and insert (including unrelated groups) roll back together on any error.
  result:=public.save_health_records_unchecked(p_owner_id,p_operation_id,p_entries);
  update public.health_save_outcomes set sleep_replacements=p_sleep_replacements
    where owner_id=p_owner_id and operation_id=p_operation_id;
  return result;
end;
$$;
revoke all on function public.save_health_records_checked(uuid,text,jsonb,jsonb) from public;
grant execute on function public.save_health_records_checked(uuid,text,jsonb,jsonb) to anon;

-- Older published clients also fail safely instead of appending another sleep.
create or replace function public.save_health_records(p_owner_id uuid,p_operation_id text,p_entries jsonb)
returns jsonb language sql security definer set search_path=public as $$
  select public.save_health_records_checked(p_owner_id,p_operation_id,p_entries,'[]'::jsonb);
$$;
revoke all on function public.save_health_records(uuid,text,jsonb) from public;
grant execute on function public.save_health_records(uuid,text,jsonb) to anon;
