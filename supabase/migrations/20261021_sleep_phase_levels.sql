-- Add source-reported phase classifications without changing old measurements.
alter table public.sono add column if not exists sono_niveis jsonb;
alter table public.sono add constraint sono_niveis_object
  check (sono_niveis is null or jsonb_typeof(sono_niveis) = 'object');

-- Keep the existing atomic/idempotent save and its replacement protections.
-- Its explicit insert allowlist must include the new column.
do $$
declare definition text; updated text;
begin
  select pg_get_functiondef('public.save_health_records_unchecked(uuid,text,jsonb)'::regprocedure)
    into definition;
  updated := replace(definition, '''acordado_min'',''midia_id''',
    '''acordado_min'',''sono_niveis'',''midia_id''');
  if updated = definition then
    raise exception 'Sleep save allowlist not found; migration aborted';
  end if;
  execute updated;
end;
$$;
notify pgrst, 'reload schema';
