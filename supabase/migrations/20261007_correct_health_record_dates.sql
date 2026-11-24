-- Date-only corrections: all selected rows move atomically, with owner locks
-- and a stored outcome so retrying after a lost response cannot repeat a move.
create table if not exists public.health_date_correction_outcomes (
  owner_id uuid not null references public.health_users(id),
  operation_id text not null,
  request_payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);
alter table public.health_date_correction_outcomes enable row level security;
revoke all on public.health_date_correction_outcomes from public, anon, authenticated;

create or replace function public.change_health_record_dates(
  p_owner_id uuid, p_operation_id text, p_source_date date, p_target_date date, p_records jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ref jsonb;
  row_data jsonb;
  old_request jsonb;
  saved_result jsonb;
  request_data jsonb;
  total_count integer := 0;
  destination_totals integer := 0;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.health_app_request_authorized() or p_owner_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_source_date is null or p_target_date is null or p_source_date = p_target_date
     or p_target_date > today or p_operation_id is null
     or p_operation_id !~* '^[0-9a-f]{8}-[0-9a-f-]{27}$'
     or jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Confira os registros e as datas.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_records) not between 1 and 100 then
    raise exception 'Selecione de 1 a 100 registros.' using errcode = '22023';
  end if;
  -- Serialize date corrections and their idempotent outcomes for this owner.
  -- The existing partial unique water-total index also protects concurrent saves.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));
  request_data := jsonb_build_object(
    'source_date', p_source_date, 'target_date', p_target_date, 'records', p_records
  );
  select request_payload, result into old_request, saved_result
    from public.health_date_correction_outcomes
    where owner_id = p_owner_id and operation_id = p_operation_id;
  if found then
    if old_request <> request_data then
      raise exception 'Esta confirmação já foi usada com outros registros.' using errcode = '22023';
    end if;
    return saved_result;
  end if;
  if (select count(*) from jsonb_array_elements(p_records)) <>
     (select count(distinct (x->>'table', x->>'id')) from jsonb_array_elements(p_records) x) then
    raise exception 'Há registros duplicados na seleção.' using errcode = '22023';
  end if;
  for ref in select value from jsonb_array_elements(p_records) order by value->>'table', value->>'id' loop
    if coalesce(ref->>'table', '') not in ('alimentacao','hidratacao','exercicios','sono','peso')
       or coalesce(ref->>'id', '') !~ '^[1-9][0-9]{0,18}$' then
      raise exception 'Registro inválido.' using errcode = '22023';
    end if;
    execute format('select to_jsonb(r) from public.%I r where id = $1::bigint and owner_id = $2 for update', ref->>'table')
      into row_data using ref->>'id', p_owner_id;
    if row_data is null or (row_data->>'data')::date is distinct from p_source_date then
      raise exception 'Um registro mudou ou não foi encontrado. Atualize a lista antes de confirmar.' using errcode = 'P0001';
    end if;
    if ref->>'table' in ('hidratacao','alimentacao') and row_data->>'item' = 'Total diário de água' then
      total_count := total_count + 1;
    end if;
  end loop;
  if total_count > 0 then
    select (select count(*) from public.hidratacao where owner_id = p_owner_id and data = p_target_date and item = 'Total diário de água') +
           (select count(*) from public.alimentacao where owner_id = p_owner_id and data = p_target_date and evento_tipo = 'hidratacao' and item = 'Total diário de água')
      into destination_totals;
    if total_count + destination_totals > 1 then
      raise exception 'Já existe um total diário de água na data de destino. Corrija os totais separadamente.' using errcode = 'P0001';
    end if;
  end if;
  for ref in select value from jsonb_array_elements(p_records) loop
    execute format('update public.%I set data = $1 where id = $2::bigint and owner_id = $3', ref->>'table')
      using p_target_date, ref->>'id', p_owner_id;
    if p_target_date < today and ref->>'table' in ('hidratacao','alimentacao') then
      execute format('update public.%I set horario = ''23:59'' where id = $1::bigint and owner_id = $2 and item = ''Total diário de água''', ref->>'table')
        using ref->>'id', p_owner_id;
    end if;
  end loop;
  saved_result := jsonb_build_object('ok', true, 'updated', jsonb_array_length(p_records));
  insert into public.health_date_correction_outcomes(owner_id, operation_id, request_payload, result)
    values (p_owner_id, p_operation_id, request_data, saved_result);
  return saved_result;
end;
$$;
revoke all on function public.change_health_record_dates(uuid,text,date,date,jsonb) from public;
grant execute on function public.change_health_record_dates(uuid,text,date,date,jsonb) to anon;
