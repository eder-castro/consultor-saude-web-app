alter table public.sono
  add column if not exists sleep_correction_key text;

create unique index if not exists sono_sleep_correction_key_uidx
  on public.sono (sleep_correction_key)
  where sleep_correction_key is not null;

create or replace function public.health_sleep_value_minutes(value text)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized text := lower(trim(coalesce(value, '')));
  hours_match text[];
  minutes_match text[];
  number_match text[];
begin
  if normalized = '' then
    return null;
  end if;

  hours_match := regexp_match(normalized, '([0-9]+([.,][0-9]+)?)\s*h');
  if hours_match is not null then
    minutes_match := regexp_match(normalized, '([0-9]+([.,][0-9]+)?)\s*(min|m)([^a-z]|$)');
    return round(
      replace(hours_match[1], ',', '.')::numeric * 60
      + coalesce(replace(minutes_match[1], ',', '.')::numeric, 0)
    )::integer;
  end if;

  minutes_match := regexp_match(normalized, '([0-9]+([.,][0-9]+)?)\s*(min|m)([^a-z]|$)');
  if minutes_match is not null then
    return round(replace(minutes_match[1], ',', '.')::numeric)::integer;
  end if;

  number_match := regexp_match(normalized, '([0-9]+([.,][0-9]+)?)');
  if number_match is null then
    return null;
  end if;
  return round(replace(number_match[1], ',', '.')::numeric)::integer;
end;
$$;

revoke all on function public.health_sleep_value_minutes(text) from public;

create or replace function public.consolidate_sleep_records(
  p_owner_id uuid,
  p_record_ids text[],
  p_total_sleep_min integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  correction_key text;
  selected_record_ids bigint[];
  existing_record public.sono%rowtype;
  selected_count integer;
  distinct_dates integer;
  distinct_starts integer;
  distinct_ends integer;
  eligible_count integer;
  selected_data public.sono.data%type;
  selected_start public.sono.inicio%type;
  selected_end public.sono.fim%type;
  deep_minutes integer;
  light_minutes integer;
  rem_minutes integer;
  awake_minutes integer;
  new_record_id public.sono.id%type;
begin
  if not public.health_app_request_authorized() then
    raise exception 'Acesso não autorizado.';
  end if;

  if p_owner_id is null
     or p_record_ids is null
     or cardinality(p_record_ids) = 0
     or cardinality(p_record_ids) > 20
     or p_total_sleep_min is null
     or p_total_sleep_min < 1
     or p_total_sleep_min > 1440 then
    raise exception 'Informe registros válidos e um total entre 1 e 1440 minutos.';
  end if;

  if exists (
    select 1
      from unnest(p_record_ids) as record_id
     where record_id !~ '^[0-9]+$'
  ) then
    raise exception 'Um ou mais identificadores de sono são inválidos.';
  end if;

  if exists (
    select 1
      from unnest(p_record_ids) as record_id
     where record_id::numeric < 1
        or record_id::numeric > 9223372036854775807
  ) then
    raise exception 'Um ou mais identificadores de sono estão fora do intervalo válido.';
  end if;

  select array_agg(record_id::bigint order by record_id::bigint)
    into selected_record_ids
    from (
      select distinct record_id
        from unnest(p_record_ids) as record_id
    ) selected;

  if cardinality(selected_record_ids) <> cardinality(p_record_ids) then
    raise exception 'Não envie o mesmo registro de sono mais de uma vez.';
  end if;

  select encode(
    extensions.digest(
      p_owner_id::text
      || ':'
      || array_to_string(
        selected_record_ids,
        ','
      )
      || ':'
      || p_total_sleep_min::text,
      'sha256'
    ),
    'hex'
  ) into correction_key;

  perform pg_advisory_xact_lock(hashtextextended(correction_key, 0));

  select *
    into existing_record
    from public.sono
   where owner_id = p_owner_id
     and sleep_correction_key = correction_key
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'corrected', false,
      'replaced', 0,
      'record_id', existing_record.id::text
    );
  end if;

  perform 1
    from public.sono
   where owner_id = p_owner_id
     and id = any(selected_record_ids)
   order by id
   for update;

  select count(*),
         count(distinct data::text),
         count(distinct coalesce(inicio::text, '')),
         count(distinct coalesce(fim::text, '')),
         min(data),
         min(inicio),
         min(fim),
         sum(public.health_sleep_value_minutes(sono_profundo_min::text)),
         sum(public.health_sleep_value_minutes(sono_leve_min::text)),
         sum(public.health_sleep_value_minutes(sono_rem_min::text)),
         sum(public.health_sleep_value_minutes(acordado_min::text))
    into selected_count,
         distinct_dates,
         distinct_starts,
         distinct_ends,
         selected_data,
         selected_start,
         selected_end,
         deep_minutes,
         light_minutes,
         rem_minutes,
         awake_minutes
    from public.sono
   where owner_id = p_owner_id
     and id = any(selected_record_ids);

  if selected_count <> cardinality(selected_record_ids) then
    raise exception 'Um ou mais registros não existem ou não pertencem à conta.';
  end if;

  if distinct_dates <> 1 or distinct_starts <> 1 or distinct_ends <> 1 then
    raise exception 'Selecione somente linhas da mesma sessão de sono.';
  end if;

  if exists (
    select 1
      from public.sono
     where owner_id = p_owner_id
       and id = any(selected_record_ids)
       and (
         (
           (case when nullif(trim(sono_profundo_min::text), '') is not null then 1 else 0 end)
           + (case when nullif(trim(sono_leve_min::text), '') is not null then 1 else 0 end)
           + (case when nullif(trim(sono_rem_min::text), '') is not null then 1 else 0 end)
           + (case when nullif(trim(acordado_min::text), '') is not null then 1 else 0 end)
         ) <> 1
         or coalesce(
           public.health_sleep_value_minutes(sono_profundo_min::text),
           public.health_sleep_value_minutes(sono_leve_min::text),
           public.health_sleep_value_minutes(sono_rem_min::text),
           public.health_sleep_value_minutes(acordado_min::text)
         ) is null
       )
  ) then
    raise exception 'Selecione somente linhas antigas de estágio de sono.';
  end if;

  select count(*)
    into eligible_count
    from public.sono
   where owner_id = p_owner_id
     and data is not distinct from selected_data
     and inicio is not distinct from selected_start
     and fim is not distinct from selected_end
     and (
       (case when nullif(trim(sono_profundo_min::text), '') is not null then 1 else 0 end)
       + (case when nullif(trim(sono_leve_min::text), '') is not null then 1 else 0 end)
       + (case when nullif(trim(sono_rem_min::text), '') is not null then 1 else 0 end)
       + (case when nullif(trim(acordado_min::text), '') is not null then 1 else 0 end)
     ) = 1
     and coalesce(
       public.health_sleep_value_minutes(sono_profundo_min::text),
       public.health_sleep_value_minutes(sono_leve_min::text),
       public.health_sleep_value_minutes(sono_rem_min::text),
       public.health_sleep_value_minutes(acordado_min::text)
     ) is not null;

  if selected_count <> eligible_count then
    raise exception 'Selecione a sessão inteira para evitar contagem duplicada de sono.';
  end if;

  insert into public.sono (
    owner_id,
    import_key,
    data,
    inicio,
    fim,
    duracao_minutos,
    sono_profundo_min,
    sono_leve_min,
    sono_rem_min,
    acordado_min,
    source_file_id,
    sleep_correction_key
  )
  values (
    p_owner_id,
    'sleep-correction:' || correction_key,
    selected_data,
    selected_start,
    selected_end,
    p_total_sleep_min::text || ' min',
    case when deep_minutes is null then null else deep_minutes::text || ' min' end,
    case when light_minutes is null then null else light_minutes::text || ' min' end,
    case when rem_minutes is null then null else rem_minutes::text || ' min' end,
    case when awake_minutes is null then null else awake_minutes::text || ' min' end,
    'sleep-correction',
    correction_key
  )
  returning id into new_record_id;

  delete from public.sono
   where owner_id = p_owner_id
     and id = any(selected_record_ids);

  return jsonb_build_object(
    'ok', true,
    'corrected', true,
    'replaced', selected_count,
    'record_id', new_record_id::text
  );
end;
$$;

revoke all on function public.consolidate_sleep_records(uuid, text[], integer) from public;
grant execute on function public.consolidate_sleep_records(uuid, text[], integer) to anon;