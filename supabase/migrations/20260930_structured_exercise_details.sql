alter table public.exercicios
  add column if not exists detalhes_exercicio jsonb;

create or replace function public.save_health_records(
  p_owner_id uuid,
  p_operation_id text,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  prior public.health_save_outcomes%rowtype;
  entry jsonb;
  row_data jsonb;
  table_name text;
  field_name text;
  column_names text;
  select_names text;
  columns_allowed text[];
  water_key text;
  refs jsonb := '[]'::jsonb;
  digest text;
begin
  if not public.health_app_request_authorized() then
    raise exception 'Acesso não autorizado.';
  end if;
  if p_owner_id is null or p_operation_id is null
     or length(trim(p_operation_id)) not between 1 and 100
     or jsonb_typeof(p_entries) is distinct from 'array'
     or jsonb_array_length(p_entries) not between 1 and 100 then
    raise exception 'Operação de salvamento inválida.';
  end if;

  digest := encode(extensions.digest(p_entries::text, 'sha256'), 'hex');
  -- Serialize retries of the same operation, even if the first request is still running.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_operation_id, 0));
  select * into prior from public.health_save_outcomes
   where owner_id = p_owner_id and operation_id = p_operation_id;
  if found then
    if prior.payload_hash <> digest then
      raise exception 'Esta confirmação já foi usada com outros dados.';
    end if;
    return jsonb_build_object('ok', true, 'saved', prior.saved, 'record_refs', prior.record_refs);
  end if;

  for entry in select value from jsonb_array_elements(p_entries)
  loop
    table_name := entry->>'table';
    row_data := entry->'record';
    if table_name not in ('alimentacao', 'hidratacao', 'exercicios', 'sono', 'peso')
       or jsonb_typeof(row_data) is distinct from 'object'
       or row_data->>'owner_id' is distinct from p_owner_id::text
       or (row_data->>'import_key') !~ '^app:[0-9a-fA-F-]{36}$' then
      raise exception 'Registro de saúde inválido.';
    end if;

    if entry->>'dailyTotal' = 'true' then
      if table_name <> 'hidratacao' or row_data->>'item' <> 'Total diário de água' then
        raise exception 'Total diário de água inválido.';
      end if;
      water_key := public.upsert_daily_water_total(
        p_owner_id, (row_data->>'data')::date, row_data->>'horario',
        row_data->>'quantidade', row_data->>'import_key'
      )->>'import_key';
      refs := refs || jsonb_build_array(jsonb_build_object('table', table_name, 'import_key', water_key));
      continue;
    end if;

    -- Keep the column allowlist narrow; exercise detail JSON is still reviewed app data.
    columns_allowed := case table_name
      when 'alimentacao' then array['owner_id','import_key','data','horario','item','quantidade','midia_id','json_filename','evento_tipo','source_file_id']
      when 'hidratacao' then array['owner_id','import_key','data','horario','item','quantidade','midia_id','json_filename','source_file_id']
      when 'exercicios' then array['owner_id','import_key','data','tipo','duracao_min','intensidade','calorias_estimadas','detalhes_exercicio','midia_id','json_filename','source_file_id']
      when 'sono' then array['owner_id','import_key','data','inicio','fim','duracao_minutos','sono_profundo_min','sono_leve_min','sono_rem_min','acordado_min','midia_id','json_filename','source_file_id']
      when 'peso' then array['owner_id','import_key','data','horario','valor_kg','json_filename','source_file_id']
    end;
    if exists (select 1 from jsonb_object_keys(row_data) as k where k <> all(columns_allowed)) then
      raise exception 'Campo de registro inválido.';
    end if;
    select string_agg(format('%I', c), ','),
           string_agg(format('r.%I', c), ',')
      into column_names, select_names from unnest(columns_allowed) as c;
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) as r',
      table_name, column_names, select_names, table_name
    ) using row_data;
    refs := refs || jsonb_build_array(jsonb_build_object(
      'table', table_name, 'import_key', row_data->>'import_key'
    ));
  end loop;

  insert into public.health_save_outcomes(owner_id, operation_id, payload_hash, record_refs, saved)
  values (p_owner_id, p_operation_id, digest, refs, jsonb_array_length(p_entries));
  return jsonb_build_object('ok', true, 'saved', jsonb_array_length(p_entries), 'record_refs', refs);
end;
$$;

revoke all on function public.save_health_records(uuid, text, jsonb) from public;
grant execute on function public.save_health_records(uuid, text, jsonb) to anon;