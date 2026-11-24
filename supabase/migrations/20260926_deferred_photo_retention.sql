-- Give users time to reopen an idle autoscale app without retaining photos indefinitely.
alter table public.health_photo_jobs
  alter column expires_at set default (now() + interval '7 days');