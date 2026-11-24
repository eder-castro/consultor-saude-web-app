-- Replace explicitly selected meal rows in one transaction. Never identify
-- targets by a guessed time or by client-only chat validation IDs.
create or replace function public.replace_meal_records(
  p_owner_id uuid,
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
  ids bigint[];
  keep_id bigint;
  current_row public.alimentacao%rowtype;
  expected jsonb;
  selected_date date;
  matched_count integer := 0;
  changed_count integer;
begin
  if not public.health_app_request_authorized() then
    raise exception 'Acesso não autorizado.';
  end if;

  if p_owner_id is null or p_record_ids is null
     or cardinality(p_record_ids) not between 1 and 100
     or p_keep_record_id is null
     or p_item is null or length(trim(p_item)) not between 1 and 200
     or p_quantidade is null or length(trim(p_quantidade)) not between 1 and 100
     or jsonb_typeof(p_expected_rows) is distinct from 'array' then
    raise exception 'Seleção ou descrição da correção inválida.';
  end if;
  if jsonb_array_length(p_expected_rows) <> cardinality(p_record_ids) then
    raise exception 'A revisão não corresponde aos itens selecionados.';
  end if;
  if exists (
    select 1 from unnest(p_record_ids || p_keep_record_id) as selected_id
    where selected_id !~ '^[1-9][0-9]{0,18}$'
       or selected_id::numeric > 9223372036854775807
  ) then
    raise exception 'Um ou mais identificadores são inválidos.';
  end if;

  select array_agg(selected_id::bigint) into ids from unnest(p_record_ids) as selected_id;
  keep_id := p_keep_record_id::bigint;
  if keep_id <> all(ids)
     or (select count(distinct selected_id) from unnest(ids) as selected_id) <> cardinality(ids) then
    raise exception 'Selecione itens distintos e indique qual registro manter.';
  end if;

  for current_row in
    select * from public.alimentacao
    where id = any(ids) and owner_id = p_owner_id and evento_tipo = 'alimentacao'
    for update
  loop
    select snapshot into expected
    from jsonb_array_elements(p_expected_rows) as snapshot
    where snapshot->>'id' = current_row.id::text
    limit 1;
    if expected is null
       or current_row.data is null
       or current_row.data::text is distinct from expected->>'data'
       or current_row.horario is distinct from expected->>'horario'
       or current_row.item is distinct from expected->>'item'
       or coalesce(current_row.quantidade, 'N/A') is distinct from expected->>'quantidade'
       or (selected_date is not null and current_row.data <> selected_date) then
      raise exception 'Os itens mudaram desde a revisão. Atualize a lista antes de corrigir.';
    end if;
    selected_date := current_row.data;
    matched_count := matched_count + 1;
  end loop;
  if matched_count <> cardinality(ids) then
    raise exception 'Um ou mais itens não existem ou não pertencem a esta conta.';
  end if;

  update public.alimentacao
  set item = trim(p_item), quantidade = trim(p_quantidade)
  where id = keep_id and owner_id = p_owner_id and evento_tipo = 'alimentacao';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'Não foi possível atualizar o item escolhido.';
  end if;

  delete from public.alimentacao
  where id = any(ids) and id <> keep_id
    and owner_id = p_owner_id and evento_tipo = 'alimentacao';
  get diagnostics changed_count = row_count;
  if changed_count <> cardinality(ids) - 1 then
    raise exception 'Não foi possível remover todos os itens escolhidos.';
  end if;

  return jsonb_build_object(
    'ok', true, 'corrected', cardinality(ids), 'kept_id', keep_id::text
  );
end;
$$;

revoke all on function public.replace_meal_records(uuid, text[], text, text, text, jsonb) from public;
grant execute on function public.replace_meal_records(uuid, text[], text, text, text, jsonb) to anon;