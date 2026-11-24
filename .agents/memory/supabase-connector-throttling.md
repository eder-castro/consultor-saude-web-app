---
name: Supabase connector throttling
description: How to avoid user-visible rate-limit failures when assembling health analysis context.
---

Space bursts of Supabase connector calls and retry only safe reads when the connector returns a temporary rate limit.

**Why:** The connector enforces a per-Repl request ceiling. Building analysis context requires several tables, and an initial chat-history save can overlap that burst, making the first analysis exceed the ceiling even under normal single-user use.

**How to apply:** Keep lightweight pacing around connector requests, honor `Retry-After` for GET/HEAD requests, and never expose raw provider errors to the UI. Do not automatically retry non-idempotent writes.

Coordinate storage traffic across bridge invocations, not just within one invocation, and do not synchronize chat history for transient analysis-stage changes.

**Why:** Independent bridge processes do not share their pacing state. Real-time stage updates can also cause identical history writes, competing with the context reads required for analysis.

**How to apply:** Serialize bridge admission per running backend, respect cooldown across invocations, and persist only changes to the durable chat representation. Per-backend coordination does not establish a global limit across multiple deployed instances.

Distinguish provider throttling from application queue-capacity errors even when both return HTTP 429.

**Why:** Masking both as “storage temporarily busy” hides whether waiting for provider recovery or completing pending photos is the appropriate action.

**How to apply:** Preserve the application error meaning, propagate provider retry hints, and log only action/error code/status—not health inputs, photos, identities or raw responses.

In tests of parallel multi-table reads, do not clear and reuse one request recorder immediately after the first rejection.

**Why:** `Promise.all` rejects as soon as one request fails, but other connector calls can still be queued by pacing and append to the recorder during the next assertion.

**How to apply:** Use separate connector mocks and request recorders for the failing multi-table call and the independent follow-up call.