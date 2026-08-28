-- Apply only after initialize-app-access has returned initialized=true.
-- The revocation makes the one-time bootstrap impossible to call again publicly.
revoke all on function public.initialize_health_app_secret(text) from public, anon, authenticated;