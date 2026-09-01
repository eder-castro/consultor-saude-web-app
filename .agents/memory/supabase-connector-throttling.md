---
name: Supabase connector throttling
description: How to avoid user-visible rate-limit failures when assembling health analysis context.
---

Space bursts of Supabase connector calls and retry only safe reads when the connector returns a temporary rate limit.

**Why:** The connector enforces a per-Repl request ceiling. Building analysis context requires several tables, and an initial chat-history save can overlap that burst, making the first analysis exceed the ceiling even under normal single-user use.

**How to apply:** Keep lightweight pacing around connector requests, honor `Retry-After` for GET/HEAD requests, and never expose raw provider errors to the UI. Do not automatically retry non-idempotent writes.