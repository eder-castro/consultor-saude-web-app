---
name: Persistent chat history
description: Privacy and ownership rules for keeping the health chat across reloads.
---

Persist health chat messages per authenticated owner in Supabase, including pending and resolved validation cards, but display only the current America/Sao_Paulo day. Clear the visible chat at local midnight without deleting prior rows. Never persist uploaded chat image bytes or temporary browser object URLs in chat history; retain only the caption and structured extraction. As an explicitly requested exception, temporarily retain encrypted photo inputs in a separate owner-scoped retry queue until success, cancellation, or expiry.

**Why:** Users rely on the chat as part of their health context and expect it to survive page reloads, but retaining original health images by default would expand sensitive-data exposure unnecessarily. The user specifically requested deferred analysis after closing the app and accepted temporary photo storage, while declining paid alternative vision services.

**How to apply:** Any new chat message kind must have a bounded JSON representation, derive ownership on the backend from the session, rehydrate only the current São Paulo day, and omit transient or original media data. Midnight rollover resets ordinary chat; unresolved photo approvals may appear separately across days so they are not lost. Deferred photo inputs belong only in the encrypted, expiring queue and must be erased when processing completes or the user cancels; persisted error messages omit media. On autoscale hosting, attempts may pause when idle and resume when the user returns, with in-app notification rather than an off-app push.

Historical analysis lookup uses the São Paulo calendar day when the saved chat card was created, not the date of a health measurement mentioned in its analysis.

**Why:** One analysis can discuss several confirmed dates; grouping by a measurement date would duplicate or misplace the original saved result. The separate history is a read-only view of the same persisted analysis, not a replay of older chat messages or photos.

**How to apply:** Keep date boundaries aligned with the chat's day rule and expose only bounded saved analysis text and timestamp from the authenticated owner's history. Do not change current-day chat hydration to load older messages.

Keep a message's displayed São Paulo time stable through analysis, confirmation, retries and reloads; it is the message's original creation time, not its last state change or delayed database synchronization.

**Why:** The user requested times on chat messages. Synchronization is delayed and analysis results replace an existing message, so using save or completion time would make its displayed time change.

**How to apply:** Preserve the original timestamp with message metadata; old history can fall back to the existing server creation time. Pending photo metadata may retain a job reference and time, but never photo bytes or browser URLs.

Keep app resumption separate from authentication: a temporary per-tab, owner/day-scoped text and structured-data snapshot may speed restoration, but only after the server confirms the session. Keep unsent photos in memory across internal navigation, never in browser storage. Clear temporary state on logout or session expiry.

**Why:** The user switches to the phone gallery to choose screenshots and reported long waits on returning. Android may discard the entire tab, which the app cannot prevent; restoring text and metadata must not become an authentication bypass or expand photo retention.

**How to apply:** Preserve drafts across route changes, refresh cached server data in the background, visibly label failed refreshes, and reconcile slow history responses without overwriting edits made while waiting. A real tab reload still requires authentication and selecting unsent photos again. Sign-out must disable background persistence before clearing private state: query observer teardown can emit additional cache events and recreate an already-cleared snapshot.

Open the authenticated chat immediately even on a first visit without a local history snapshot. Load conversations and the daily analysis context in the background; wait for necessary context during analysis, not before allowing input.

**Why:** The user explicitly wants the app usable while the initial history is fetched, so composing or selecting the first photo can overlap that fetch.

**How to apply:** Never gate the composer on remote history hydration. Reconcile arriving history with in-flight messages and edits; do not write the local conversation to the server until reconciliation succeeds. Keep analysis grounded in the server-owned daily context rather than treating an unfinished fetch as an empty history.
