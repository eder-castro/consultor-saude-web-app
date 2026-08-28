-- The server credential is provisioned through the privileged Supabase
-- administration channel, never by an anon-callable database function.
drop function if exists public.initialize_health_app_secret(text);