---
name: PostgreSQL integration daemons
description: Prevent Bun test helpers from hanging when they start an isolated PostgreSQL server.
---

When a Bun test starts PostgreSQL through `pg_ctl` while capturing subprocess output, redirect the database server log and set the temporary cluster user explicitly.

**Why:** The daemon can inherit the captured stdout pipe, preventing the wrapper from observing EOF after `pg_ctl` exits. Replit database environment variables can also select a role that does not exist in the isolated cluster.

**How to apply:** Give `pg_ctl` a log destination, and pass the same explicit superuser to both `initdb` and `psql` whenever an integration test owns its temporary cluster.

An isolated PostgreSQL cluster is not Supabase: migrations that grant permissions to `anon` and `authenticated` need those roles created in the test fixture. If `pg_ctl` starts on a non-default port, pass the same port explicitly to `psql`; otherwise a missing default socket can look like a server startup failure.
