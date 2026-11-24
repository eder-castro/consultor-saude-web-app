---
name: Corrections to health records
description: Safety boundary for follow-up chat messages that correct an already-saved health entry.
---

Treat an explicit correction to an earlier saved meal as a different action from recording new food. Never infer a database target from a meal's time, name, or UI-only validation item ID; require selection of a real owner-scoped saved row and explicit confirmation before modifying or deleting it.

**Why:** In September 2026, a user clarified ingredients in a photographed breakfast, but each follow-up created another meal and converted unspecified ingredients into full-fruit quantities. The chat history is a snapshot of the original interpretation, not authoritative current health data.

**How to apply:** Preserve correction intent through the client, distinguish additions from updates, show what will change, and read the current record by its database ID with an owner filter. Don't let clinical advice or image interpretation promote hidden ingredients and uncertain quantities to facts.

For consolidating multiple saved items, use one atomic, owner-scoped database operation against the exact rows the user reviewed; compare their contents again under lock before replacing them. Keep an authoritative outcome keyed to the correction request, independent of chat-history persistence.

**Why:** Sequential update/delete can leave partial health records after a network failure. A delayed or failed chat-history save can also make an already-applied correction appear pending on reload.

**How to apply:** Require explicit selection of individual rows and a keeper, then confirm the complete before/after preview. On an uncertain response, check the stored outcome before permitting another write; never treat failure to refresh the chat as failure of the database mutation.

The time of a meal describes when the user ate, not necessarily when they sent its photo or message. Users need to correct that time after saving.

**Why:** The user reported sending a lunch photo later than the meal and having the sending time recorded instead of the actual afternoon time.

**How to apply:** Keep a user-reviewed path for correcting the existing meal time without treating the clarification as another meal or inventing an exact time from the word “almoço”.

After-midnight submissions may describe events from the previous day. Never automatically move every late-night record to yesterday.

**Why:** The user reported entering several previous-day events after midnight without noticing that the saved date was today. A sending timestamp is not sufficient evidence of an event date.

**How to apply:** Keep the event date explicit before confirmation and support reviewed corrections of exact saved rows across health types. Preserve pending review edits when navigating away from the chat and back; they remain drafts, not saved health events. Batch date moves must be atomic, owner-scoped and idempotent on retry; leave other records and original chat/analysis snapshots unchanged.