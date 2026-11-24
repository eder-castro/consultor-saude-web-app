---
name: Gemini API model lifecycle
description: Provider behavior observed when selecting Gemini models and handling temporary capacity failures.
---

Keep Gemini models configurable and treat availability and quotas as provider-managed rather than permanent. Use the economical model first and escalate ambiguous visual/document extraction to a configurable power model. If escalation is unavailable, preserve the reviewable economical result. Retry transient `429` and `503` responses with short backoff; if one model remains overloaded, try the configured alternate model before failing the request. Do not repeatedly retry explicitly exhausted quota. Keep response schemas to the provider-supported subset and retain a configurable timeout with sufficient headroom.

Validate fallback availability with the live model list and real structured vision and saved-record-analysis requests, not just a short text probe.

Maintain at least three distinct reserve models in addition to the primary. Apply the same reserve chain to every AI stage, including stages that specify their own preferred model.

**Why:** The user explicitly requested at least three fallbacks after the primary and its sole alternate failed during a service interruption.

**How to apply:** Deduplicate model priorities, keep reserves configurable and advance on capacity, quota, communication and retired-model failures. Do not conceal credential or invalid-payload errors with model switching. A shared provider outage can still affect every model.

Do not assume that a model appearing in the provider's model list supports the application's structured-generation and thinking settings.

**Why:** A listed Gemini Flash model rejected `minimal` thinking during live verification, while other Flash versions accepted it. A listed name alone is not a usable fallback.

**How to apply:** Validate each new reserve with the actual multimodal JSON and analysis settings before adding it. Avoid applying thinking settings to all future Flash versions based only on their name.

**Why:** On 2026-10-21, the primary model was overloaded while its configured alternate had exhausted quota. Another economical model worked with the existing integration for both actual exercise screenshots and post-save analysis; no credential replacement was necessary.

**How to apply:** Separate provider capacity/quota failures from malformed extraction. Keep the fallback configurable and do not claim permanent provider availability based on a successful test.

**Why:** The provider rejected `gemini-2.5-flash` for a new API user and directed new clients to `gemini-3.6-flash`; the newer model then briefly returned a high-demand `503` before succeeding. Later, that model exhausted its model-specific quota while `gemini-3.5-flash` remained available for the same key and successfully processed the same structured image request. The provider also rejected array `minItems` and `maxItems` constraints with a generic `INVALID_ARGUMENT`, while accepting the same nested schema without those constraints.

**How to apply:** When Gemini starts returning model-not-found errors, verify the provider's current recommendation instead of retrying the obsolete model. Preserve separate economy and power model overrides. Escalate ambiguous results and route persistent capacity failures to an alternate configured model; never discard a valid economical result merely because the power model is unavailable. Do not hide credential, payload, or validation errors behind fallback. If a structured request returns a generic 400, simplify unsupported schema keywords while retaining application-side validation. Keep `GEMINI_TIMEOUT_SECONDS` high enough for structured generation.

Select the alternate model's thinking level explicitly for simple structured extraction rather than assuming it shares the economical model's latency defaults.

**Why:** Google documents minimal thinking as the Flash-Lite default, but not the Gemini 3 Flash default. Production photo requests suffered timeouts and overload on fallback; switching models alone does not ensure a fast response.

**How to apply:** Check the provider's supported thinking settings per model. Do not apply Flash-specific settings to configurable Pro or other custom models, and do not treat slower responses as proof that quota is exhausted.