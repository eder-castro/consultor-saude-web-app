---
name: Gemini API model lifecycle
description: Provider behavior observed when selecting Gemini models and handling temporary capacity failures.
---

Keep the Gemini model configurable and treat model availability as provider-managed rather than permanent. Retry transient `429` and `503` responses with short backoff.

**Why:** The provider rejected `gemini-2.5-flash` for a new API user and directed new clients to `gemini-3.6-flash`; the newer model then briefly returned a high-demand `503` before succeeding.

**How to apply:** When Gemini starts returning model-not-found errors, verify the provider's current recommendation instead of retrying the obsolete model. Preserve the configurable model override and transient-capacity retries.