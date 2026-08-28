---
name: Supabase connector RLS
description: How to preserve backend-only access when the Replit Supabase connector uses the anon PostgREST role.
---

The Replit Supabase connector reaches PostgREST as the `anon` database role rather than `service_role`. Revoking all `anon` table privileges therefore blocks both public callers and the application backend.

**Why:** Health records must not be directly readable with ordinary Supabase anonymous access, but the official connector still needs enough grants to perform server-side queries.

**How to apply:** Keep RLS explicitly enabled on every protected table and gate `anon` policies on a server-held credential carried in a custom request header. Store only its hash in a private table, provision that hash through the privileged Supabase administration channel (never an anon-callable initializer), test that an uncredentialed connector request sees no rows, and test that the authorized helper still works.