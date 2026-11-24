-- Edit or remove only the reviewed declared total; ordinary drink rows are never targets.
create or replace function public.correct_daily_water_total(
  p_owner_id uuid,
  p_data date,
  p_import_key text,
  p_expected_quantity text,
  p_action text,
  p_new_total_ml integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  changed_count integer;
begin
  if not public.health_app_request_authorized() then
    raise exception 'Acesso não autorizado.';
  end if;
  if p_owner_id is null or p_data is null
     or p_import_key is null or p_import_key !~ '^app:[0-9a-f-]{36}$'
     or p_expected_quantity is null or p_expected_quantity !~ '^[1-9][0-9]{0,4} ml$'
     or (p_action = 'update' and (p_new_total_ml is null or p_new_total_ml not between 1 and 15000))
     or (p_action = 'delete' and p_new_total_ml is not null)
     or p_action is null or p_action not in ('update', 'delete') then
    raise exception 'Correção do total diário inválida.';
  end if;

  if p_action = 'update' then
    update public.hidratacao
    set quantidade = p_new_total_ml::text || ' ml'
    where owner_id = p_owner_id and data = p_data
      and import_key = p_import_key and item = 'Total diário de água'
      and quantidade = p_expected_quantity;
  else
    delete from public.hidratacao
    where owner_id = p_owner_id and data = p_data
      and import_key = p_import_key and item = 'Total diário de água'
      and quantidade = p_expected_quantity;
  end if;
  get diagnostics changed_count = row_count;
  return jsonb_build_object('ok', changed_count = 1);
end;
$$;

revoke all on function public.correct_daily_water_total(uuid, date, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.correct_daily_water_total(uuid, date, text, text, text, integer)
  to anon;