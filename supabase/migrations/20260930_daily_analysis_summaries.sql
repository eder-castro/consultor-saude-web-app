create table if not exists public.health_daily_analysis_summaries (
  owner_id uuid not null references public.health_users(id) on delete cascade,
  para_dia date not null,
  periodo_inicio date not null,
  periodo_fim date not null,
  gerado_em timestamptz not null default clock_timestamp(),
  origem text not null check (origem in ('fechamento_diario', 'primeiro_uso')),
  resumo jsonb not null,
  primary key (owner_id, para_dia),
  check (periodo_inicio = para_dia - 7),
  check (periodo_fim = para_dia - 1),
  check (jsonb_typeof(resumo -> 'dias') = 'array')
);

alter table public.health_daily_analysis_summaries enable row level security;
revoke all on table public.health_daily_analysis_summaries from public, anon, authenticated;
grant select on table public.health_daily_analysis_summaries to anon;

drop policy if exists health_daily_analysis_summaries_server_read
  on public.health_daily_analysis_summaries;
create policy health_daily_analysis_summaries_server_read
  on public.health_daily_analysis_summaries
  for select to anon
  using (public.health_app_request_authorized());

create or replace function public.health_daily_parse_duration_minutes(p_value text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_value text := lower(btrim(coalesce(p_value, '')));
  v_parts text[];
  v_hours numeric;
  v_minutes numeric;
  v_seconds numeric;
begin
  v_parts := regexp_match(v_value, '^([0-9]{1,3}):([0-5][0-9])(?::([0-5][0-9]))?$');
  if v_parts is not null then
    return v_parts[1]::numeric * 60 + v_parts[2]::numeric
      + coalesce(v_parts[3]::numeric, 0) / 60;
  end if;

  v_parts := regexp_match(v_value, '^([0-9]+([.,][0-9]+)?)$');
  if v_parts is not null then
    return replace(v_parts[1], ',', '.')::numeric;
  end if;

  v_parts := regexp_match(
    v_value,
    '^([0-9]+([.,][0-9]+)?)\s*(?:h|hr|hora|horas)(?:\s*([0-9]+([.,][0-9]+)?)\s*(?:minutos|minuto|min|m)?)?\s*$'
  );
  if v_parts is not null then
    v_hours := replace(v_parts[1], ',', '.')::numeric;
    v_minutes := replace(coalesce(v_parts[3], '0'), ',', '.')::numeric;
    if v_minutes >= 60 then return null; end if;
    return v_hours * 60 + v_minutes;
  end if;

  v_parts := regexp_match(
    v_value,
    '^([0-9]+([.,][0-9]+)?)\s*(?:min|minuto|minutos|m)(?:\s+([0-9]+([.,][0-9]+)?)\s*(?:s|seg|segundo|segundos))?\s*$'
  );
  if v_parts is not null then
    v_minutes := replace(v_parts[1], ',', '.')::numeric;
    v_seconds := replace(coalesce(v_parts[3], '0'), ',', '.')::numeric;
    if v_seconds >= 60 then return null; end if;
    return v_minutes + v_seconds / 60;
  end if;

  v_parts := regexp_match(v_value, '^([0-9]+([.,][0-9]+)?)\s*(?:s|seg|segundo|segundos)$');
  if v_parts is not null then
    return replace(v_parts[1], ',', '.')::numeric / 60;
  end if;

  return null;
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end;
$$;

create or replace function public.health_daily_parse_decimal(p_value text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_parts text[];
begin
  v_parts := regexp_match(btrim(coalesce(p_value, '')), '^[[:space:]]*([0-9]+([.,][0-9]+)?)[[:space:]]*');
  if v_parts is null then return null; end if;
  return replace(v_parts[1], ',', '.')::numeric;
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end;
$$;

create or replace function public.health_daily_parse_weight_kg(p_value text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_parts text[];
begin
  v_parts := regexp_match(
    lower(btrim(coalesce(p_value, ''))),
    '^([0-9]+([.,][0-9]+)?)[[:space:]]*(kg)?[[:space:]]*$'
  );
  if v_parts is null then return null; end if;
  return replace(v_parts[1], ',', '.')::numeric;
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end;
$$;

create or replace function public.health_daily_parse_water_ml(p_value text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_parts text[];
  v_quantity numeric;
  v_unit text;
begin
  v_parts := regexp_match(
    coalesce(p_value, ''),
    '([0-9]+([.,][0-9]+)?)[[:space:]]*([[:alpha:]À-ÿ]+)'
  );
  if v_parts is not null then
    v_quantity := replace(v_parts[1], ',', '.')::numeric;
    v_unit := lower(v_parts[3]);
    if left(v_unit, 1) = 'l' then return round(v_quantity * 1000); end if;
    if left(v_unit, 4) = 'copo' then return round(v_quantity * 250); end if;
    return round(v_quantity);
  end if;

  v_quantity := public.health_daily_parse_decimal(p_value);
  if v_quantity is null then return null; end if;
  return round(v_quantity);
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end;
$$;

create or replace function public.health_build_daily_analysis_summary(
  p_owner_id uuid,
  p_para_dia date,
  p_origem text
)
returns public.health_daily_analysis_summaries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_saved public.health_daily_analysis_summaries%rowtype;
  v_dias jsonb;
  v_midnight timestamptz := p_para_dia::timestamp at time zone 'America/Sao_Paulo';
begin
  if p_owner_id is null or p_para_dia is null
     or p_origem not in ('fechamento_diario', 'primeiro_uso') then
    raise exception 'invalid daily health summary parameters';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_owner_id::text || ':' || p_para_dia::text, 0)
  );

  select * into v_saved
  from public.health_daily_analysis_summaries
  where owner_id = p_owner_id and para_dia = p_para_dia;
  if found then return v_saved; end if;

  with datas as (
    select (p_para_dia - n)::date as data
    from generate_series(1, 7) as n
  ),
  dias as (
    select
      d.data,
      w.agua_ml,
      coalesce(r.refeicoes, 0)::integer as refeicoes,
      coalesce(r.alimentos, '[]'::jsonb) as alimentos,
      coalesce(r.alimentos_omitidos, 0)::integer as alimentos_omitidos,
      e.exercicio_min,
      e.atividades,
      e.atividades_omitidas,
      s.sono_min,
      peso.peso_kg,
      array_remove(array[
        case when w.avisos > 0 then
          w.avisos::text || ' registro(s) de água não puderam ser interpretados; o total foi omitido.'
        end,
        case when r.rotulos_longos > 0 then
          r.rotulos_longos::text || ' rótulo(s) de alimento foram abreviados para 120 caracteres.'
        end,
        case when e.avisos > 0 then
          e.avisos::text || ' duração(ões) de exercício não puderam ser interpretadas; o total foi omitido.'
        end,
        case when s.avisos > 0 then
          s.avisos::text || ' duração(ões) de sono não puderam ser interpretadas; o total foi omitido.'
        end,
        case when s.contradicoes > 0 then
          s.contradicoes::text || ' sessão(ões) de sono com totais contraditórios foram omitidas.'
        end,
        case when peso.aviso then
          'O registro de peso mais recente deste dia não pôde ser interpretado.'
        end
      ], null)::text[] as avisos
    from datas d
    cross join lateral (
      with agua as (
        select h.data, h.horario, h.item, h.quantidade, h.id, 0 as fonte_ordem
        from public.hidratacao h
        where h.owner_id = p_owner_id
          and h.data = d.data
          and h.created_at < v_midnight
        union all
        select a.data, a.horario, a.item, a.quantidade, a.id, 1 as fonte_ordem
        from public.alimentacao a
        where a.owner_id = p_owner_id
          and a.data = d.data
          and a.evento_tipo = 'hidratacao'
          and a.created_at < v_midnight
      ),
      sequenciada as (
        select
          *,
          (item = 'Total diário de água') as total_declarado,
          public.health_daily_parse_water_ml(quantidade) as ml,
          row_number() over (
            order by coalesce(horario, '') collate "C",
              (item = 'Total diário de água') asc, fonte_ordem, id
          ) as seq
        from agua
      ),
      corte as (
        select coalesce(max(seq) filter (where total_declarado), 0) as seq
        from sequenciada
      )
      select
        case
          when count(*) = 0 then null
          when count(*) filter (
            where sequenciada.seq >= corte.seq and sequenciada.ml is null
          ) > 0 then null
          else round(coalesce(
            sum(sequenciada.ml) filter (where sequenciada.seq >= corte.seq),
            0
          ))
        end as agua_ml,
        count(*) filter (
          where sequenciada.seq >= corte.seq and sequenciada.ml is null
        )::integer as avisos
      from sequenciada cross join corte
    ) w
    cross join lateral (
      with comidas as (
        select a.id, a.horario, a.item
        from public.alimentacao a
        where a.owner_id = p_owner_id
          and a.data = d.data
          and coalesce(a.evento_tipo, 'alimentacao') = 'alimentacao'
          and a.created_at < v_midnight
      ),
      frequencias as (
        select
          btrim(coalesce(item, '')) as nome,
          count(*)::integer as ocorrencias
        from comidas
        where btrim(coalesce(item, '')) <> ''
        group by btrim(coalesce(item, ''))
      ),
      ordenadas as (
        select
          nome,
          ocorrencias,
          left(nome, 120) || case when char_length(nome) > 120 then '…' else '' end as rotulo,
          row_number() over (order by ocorrencias desc, nome collate "C") as ordem,
          char_length(nome) > 120 as longo
        from frequencias
      )
      select
        (select count(distinct coalesce(horario, '#registro:' || id::text))::integer from comidas)
          as refeicoes,
        coalesce((
          select
          jsonb_agg(
            jsonb_build_object('item', rotulo, 'ocorrencias', ocorrencias)
            order by ordem
          ) filter (where ordem <= 12)
          from ordenadas
        ), '[]'::jsonb) as alimentos,
        (select count(*) from ordenadas where ordem > 12)::integer as alimentos_omitidos,
        (select count(*) from ordenadas where longo)::integer as rotulos_longos
    ) r
    cross join lateral (
      with registros as (
        select
          e.duracao_min,
          e.tipo,
          nullif(to_jsonb(e) -> 'detalhes_exercicio' ->> 'duracao_segundos', '') as segundos_texto
        from public.exercicios e
        where e.owner_id = p_owner_id
          and e.data = d.data
          and e.created_at < v_midnight
      ),
      interpretados as (
        select
          *,
          case
            when segundos_texto ~ '^[0-9]+([.,][0-9]+)?$'
              then replace(segundos_texto, ',', '.')::numeric / 60
            when segundos_texto is not null then null
            else public.health_daily_parse_duration_minutes(duracao_min)
          end as minutos
        from registros
      ),
      frequencias as (
        select btrim(tipo) as nome, count(*)::integer as ocorrencias
        from interpretados
        where btrim(coalesce(tipo, '')) <> ''
        group by btrim(tipo)
      ),
      ordenadas as (
        select
          left(nome, 80) || case when char_length(nome) > 80 then '…' else '' end as rotulo,
          ocorrencias,
          row_number() over (order by ocorrencias desc, nome collate "C") as ordem
        from frequencias
      )
      select
        case
          when count(*) = 0 then null
          when count(*) filter (where minutos is null) > 0 then null
          else round(sum(minutos), 2)
        end as exercicio_min,
        count(*) filter (where minutos is null)::integer as avisos,
        coalesce((
          select jsonb_agg(
            jsonb_build_object('tipo', rotulo, 'ocorrencias', ocorrencias)
            order by ordem
          ) filter (where ordem <= 8)
          from ordenadas
        ), '[]'::jsonb) as atividades,
        (select count(*) from ordenadas where ordem > 8)::integer as atividades_omitidas
      from interpretados
    ) e
    cross join lateral (
      with registros as (
        select
          s.data,
          s.inicio,
          s.fim,
          nullif(btrim(s.duracao_minutos), '') as total_texto,
          public.health_daily_parse_duration_minutes(s.duracao_minutos) as total_min,
          nullif(btrim(s.sono_profundo_min), '') as profundo_texto,
          public.health_daily_parse_duration_minutes(s.sono_profundo_min) as profundo_min,
          nullif(btrim(s.sono_leve_min), '') as leve_texto,
          public.health_daily_parse_duration_minutes(s.sono_leve_min) as leve_min,
          nullif(btrim(s.sono_rem_min), '') as rem_texto,
          public.health_daily_parse_duration_minutes(s.sono_rem_min) as rem_min,
          nullif(btrim(s.acordado_min), '') as acordado_texto,
          public.health_daily_parse_duration_minutes(s.acordado_min) as acordado_min
        from public.sono s
        where s.owner_id = p_owner_id
          and s.data = d.data
          and s.created_at < v_midnight
      ),
      contados as (
        select
          *,
          (case when profundo_texto is not null then 1 else 0 end)
            + (case when leve_texto is not null then 1 else 0 end)
            + (case when rem_texto is not null then 1 else 0 end)
            + (case when acordado_texto is not null then 1 else 0 end) as fases_preenchidas
        from registros
      ),
      classificados as (
        select
          *,
          (fases_preenchidas = 1 and (
            (profundo_texto is not null and profundo_min is not null)
            or (leve_texto is not null and leve_min is not null)
            or (rem_texto is not null and rem_min is not null)
            or (acordado_texto is not null and acordado_min is not null)
          )) as fase_legada,
          (fases_preenchidas = 1 and not (
            (profundo_texto is not null and profundo_min is not null)
            or (leve_texto is not null and leve_min is not null)
            or (rem_texto is not null and rem_min is not null)
            or (acordado_texto is not null and acordado_min is not null)
          )) as fase_legada_invalida,
          case when fases_preenchidas = 1 then null else total_texto end as total_efetivo_texto,
          case when fases_preenchidas = 1 then null else total_min end as total_efetivo_min
        from contados
      ),
      grupos as (
        select
          data, inicio, fim,
          count(*) filter (where total_efetivo_texto is not null)::integer as totais,
          count(*) filter (where total_efetivo_texto is not null and total_efetivo_min is null)::integer as totais_invalidos,
          count(distinct total_efetivo_min) filter (where total_efetivo_min is not null)::integer as total_valores,
          min(total_efetivo_min) filter (where total_efetivo_min is not null) as total_min,
          max(total_efetivo_min) filter (where total_efetivo_min is not null) as total_max,
          min(profundo_min + leve_min + rem_min) filter (
            where total_efetivo_texto is not null
              and profundo_texto is not null and profundo_min is not null
              and leve_texto is not null and leve_min is not null
              and rem_texto is not null and rem_min is not null
          ) as total_detalhes_min,
          max(profundo_min + leve_min + rem_min) filter (
            where total_efetivo_texto is not null
              and profundo_texto is not null and profundo_min is not null
              and leve_texto is not null and leve_min is not null
              and rem_texto is not null and rem_min is not null
          ) as total_detalhes_max,
          count(*) filter (
            where fase_legada and profundo_texto is not null
          )::integer as profundo_registros,
          count(*) filter (
            where fase_legada and leve_texto is not null
          )::integer as leve_registros,
          count(*) filter (
            where fase_legada and rem_texto is not null
          )::integer as rem_registros,
          min(profundo_min) filter (where fase_legada and profundo_texto is not null)
            as fase_profundo_min,
          max(profundo_min) filter (where fase_legada and profundo_texto is not null)
            as fase_profundo_max,
          min(leve_min) filter (where fase_legada and leve_texto is not null)
            as fase_leve_min,
          max(leve_min) filter (where fase_legada and leve_texto is not null)
            as fase_leve_max,
          min(rem_min) filter (where fase_legada and rem_texto is not null)
            as fase_rem_min,
          max(rem_min) filter (where fase_legada and rem_texto is not null)
            as fase_rem_max,
          count(*) filter (
            where fase_legada_invalida
              or (total_efetivo_texto is null and fases_preenchidas <> 1)
                and (
                  (profundo_texto is not null and profundo_min is null)
                  or (leve_texto is not null and leve_min is null)
                  or (rem_texto is not null and rem_min is null)
                )
          )::integer as fases_invalidas
        from classificados
        group by data, inicio, fim
      ),
      fases as (
        select
          *,
          case when profundo_registros > 0 and leve_registros > 0 and rem_registros > 0
            and fases_invalidas = 0
            then fase_profundo_min + fase_leve_min + fase_rem_min
          end as fases_completas_min,
          case when profundo_registros > 0 and leve_registros > 0 and rem_registros > 0
            and fases_invalidas = 0
            then fase_profundo_max + fase_leve_max + fase_rem_max
          end as fases_completas_max,
          (case when profundo_registros > 0 then coalesce(fase_profundo_min, 0) else 0 end)
            + (case when leve_registros > 0 then coalesce(fase_leve_min, 0) else 0 end)
            + (case when rem_registros > 0 then coalesce(fase_rem_min, 0) else 0 end)
            as fases_min
        from grupos
      ),
      reconciliados as (
        select
          *,
          (total_valores > 1)
            or (total_detalhes_min is not null and total_detalhes_min <> total_detalhes_max)
            or (fase_profundo_min is distinct from fase_profundo_max)
            or (fase_leve_min is distinct from fase_leve_max)
            or (fase_rem_min is distinct from fase_rem_max)
            or (fases_completas_min is not null and fases_completas_min <> fases_completas_max)
            or (totais > 0 and total_min is not null and total_detalhes_min is not null
              and total_min <> total_detalhes_min)
            or (totais > 0 and total_min is not null and fases_completas_min is not null
              and total_min <> fases_completas_min)
            or (total_detalhes_min is not null and fases_completas_min is not null
              and total_detalhes_min <> fases_completas_min) as contradicao,
          (totais_invalidos > 0 or (totais = 0 and fases_invalidas > 0)) as invalido,
          case
            when totais > 0 then total_min
            when profundo_registros + leve_registros + rem_registros > 0 then fases_min
            else null
          end as minutos
        from fases
      )
      select
        case
          when count(*) = 0 then null
          when count(*) filter (where contradicao)::integer > 0 then null
          when count(*) filter (where invalido)::integer > 0 then null
          when count(*) filter (where minutos is not null) = 0 then null
          else round(sum(minutos), 2)
        end as sono_min,
        count(*) filter (where invalido)::integer as avisos,
        count(*) filter (where contradicao)::integer as contradicoes
      from reconciliados
    ) s
    cross join lateral (
      with ultimo as (
        select p.valor_kg
        from public.peso p
        where p.owner_id = p_owner_id
          and p.data = d.data
          and p.created_at < v_midnight
        order by p.horario desc nulls last, p.created_at desc, p.id desc
        limit 1
      )
      select
        public.health_daily_parse_weight_kg(valor_kg) as peso_kg,
        (public.health_daily_parse_weight_kg(valor_kg) is null) as aviso
      from ultimo
      union all
      select null::numeric, false
      where not exists (select 1 from ultimo)
      limit 1
    ) peso
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'data', data,
        'agua_ml', agua_ml,
        'refeicoes', refeicoes,
        'alimentos', alimentos,
        'alimentos_omitidos', alimentos_omitidos,
        'exercicio_min', exercicio_min,
        'atividades', atividades,
        'atividades_omitidas', atividades_omitidas,
        'sono_min', sono_min,
        'peso_kg', peso_kg,
        'avisos', to_jsonb(avisos)
      ) order by data
    ),
    '[]'::jsonb
  )
  into v_dias
  from dias;

  insert into public.health_daily_analysis_summaries (
    owner_id, para_dia, periodo_inicio, periodo_fim, origem, resumo
  )
  values (
    p_owner_id, p_para_dia, p_para_dia - 7, p_para_dia - 1, p_origem,
    jsonb_build_object('dias', v_dias)
  )
  on conflict (owner_id, para_dia) do nothing;

  select * into v_saved
  from public.health_daily_analysis_summaries
  where owner_id = p_owner_id and para_dia = p_para_dia;
  return v_saved;
end;
$$;

create or replace function public.health_daily_analysis_context(p_owner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_para_dia date := (clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  v_saved public.health_daily_analysis_summaries%rowtype;
begin
  if not public.health_app_request_authorized() then
    raise exception 'application request is not authorized' using errcode = '42501';
  end if;
  if p_owner_id is null then
    raise exception 'owner is required' using errcode = '22023';
  end if;

  v_saved := public.health_build_daily_analysis_summary(p_owner_id, v_para_dia, 'primeiro_uso');
  return jsonb_build_object(
    'ok', true,
    'para_dia', v_saved.para_dia,
    'periodo', jsonb_build_object('inicio', v_saved.periodo_inicio, 'fim', v_saved.periodo_fim),
    'gerado_em', to_char(v_saved.gerado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'origem', v_saved.origem,
    'resumo', v_saved.resumo
  );
end;
$$;

create or replace function public.health_generate_daily_analysis_summaries()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid;
  v_para_dia date := (clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  v_total integer := 0;
begin
  for v_owner_id in select id from public.health_users order by id
  loop
    begin
      perform public.health_build_daily_analysis_summary(v_owner_id, v_para_dia, 'fechamento_diario');
      v_total := v_total + 1;
    exception when others then
      raise warning 'Could not build daily analysis summary for owner %, date %: %',
        v_owner_id, v_para_dia, sqlerrm;
    end;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.health_daily_parse_duration_minutes(text) from public, anon, authenticated;
revoke all on function public.health_daily_parse_decimal(text) from public, anon, authenticated;
revoke all on function public.health_daily_parse_weight_kg(text) from public, anon, authenticated;
revoke all on function public.health_daily_parse_water_ml(text) from public, anon, authenticated;
revoke all on function public.health_build_daily_analysis_summary(uuid, date, text) from public, anon, authenticated;
revoke all on function public.health_generate_daily_analysis_summaries() from public, anon, authenticated;
revoke all on function public.health_daily_analysis_context(uuid) from public, authenticated;
grant execute on function public.health_daily_analysis_context(uuid) to anon;

do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'health-daily-analysis-summaries',
    '0 3 * * *',
    'select public.health_generate_daily_analysis_summaries();'
  );
exception
  when undefined_file or feature_not_supported or insufficient_privilege then
    raise notice 'pg_cron is unavailable here; daily analysis summaries will be created on first use.';
end;
$cron$;