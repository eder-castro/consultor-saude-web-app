do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'alimentacao',
        'hidratacao',
        'exercicios',
        'sono',
        'peso',
        'midias',
        'analise',
        'log_json'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end $$;

revoke all privileges on table public.alimentacao from anon, authenticated;
revoke all privileges on table public.hidratacao from anon, authenticated;
revoke all privileges on table public.exercicios from anon, authenticated;
revoke all privileges on table public.sono from anon, authenticated;
revoke all privileges on table public.peso from anon, authenticated;
revoke all privileges on table public.midias from anon, authenticated;
revoke all privileges on table public.analise from anon, authenticated;
revoke all privileges on table public.log_json from anon, authenticated;
revoke all privileges on table public.health_users from anon, authenticated;
revoke all privileges on table public.health_sessions from anon, authenticated;