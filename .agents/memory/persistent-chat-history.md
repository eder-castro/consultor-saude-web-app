---
name: Persistent chat history
description: Privacy and ownership rules for keeping the health chat across reloads.
---

Persist health chat messages per authenticated owner in Supabase, including pending and resolved validation cards. Never persist uploaded chat image bytes or temporary browser object URLs; retain only the caption and structured extraction.

**Why:** Users rely on the chat as part of their health context and expect it to survive page reloads, but retaining original health images by default would expand sensitive-data exposure unnecessarily.

**How to apply:** Any new chat message kind must have a bounded JSON representation, derive ownership on the backend from the session, rehydrate safely after login, and omit transient or original media data. A failed image analysis may retain compressed bytes only in the active browser memory long enough for an immediate retry; persisted error messages must omit them.