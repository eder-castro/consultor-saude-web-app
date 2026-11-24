-- Reject duplicates rather than deleting or silently choosing a prior declaration.
create unique index if not exists hidratacao_one_daily_total_per_owner_date
  on public.hidratacao (owner_id, data)
  where item = 'Total diário de água' and owner_id is not null;

create or replace function public.upsert_daily_water_total(
  p_owner_id uuid,
  p_data date,
  p_horario text,
  p_quantidade text,
  p_import_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  saved_key text;
  milliliters integer;
begin
  if not public.health_app_request_authorized() then
    raise exception 'Acesso não autorizado.';
  end if;
  if p_owner_id is null or p_data is null
     or p_horario is null or p_horario !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or p_quantidade is null or p_quantidade !~ '^[1-9][0-9]{0,4} ml$'
     or p_import_key is null or p_import_key !~ '^app:[0-9a-f-]{36}$' then
    raise exception 'Total diário de água inválido.';
  end if;
  milliliters := split_part(p_quantidade, ' ', 1)::integer;
  if milliliters > 15000 then
    raise exception 'Total diário de água fora do limite.';
  end if;

  insert into public.hidratacao (
    owner_id, import_key, data, horario, item, quantidade, source_file_id
  ) values (
    p_owner_id, p_import_key, p_data, p_horario,
    'Total diário de água', p_quantidade, 'app'
  )
  on conflict (owner_id, data)
    where item = 'Total diário de água' and owner_id is not null
  do update set
    quantidade = excluded.quantidade,
    horario = excluded.horario
  where public.hidratacao.import_key ~ '^app:[0-9a-f-]{36}$'
  returning import_key into saved_key;

  if saved_key is null then
    raise exception 'O total diário existente precisa ser revisado antes de atualizar.';
  end if;
  return jsonb_build_object('import_key', saved_key);
end;
$$;

revoke all on function public.upsert_daily_water_total(uuid, date, text, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_daily_water_total(uuid, date, text, text, text)
  to anon;