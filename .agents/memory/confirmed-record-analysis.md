---
name: Confirmed record analysis
description: Grounding and retry boundaries for health commentary generated after a reviewed save.
---

Generate narrative health analysis only after reviewed records are saved, from rows fetched again for the authenticated owner. Use the complete, fixed summary of the seven completed calendar days preceding today's São Paulo date, supplemented with the owner's live saved records from today, not a window anchored on an edited/backdated record. Keep saved-record references separate from the analysis call so a failed generation can be retried without repeating the insert.

**Why:** The extraction draft can contain rejected items, unedited quantities, or uncertain visual guesses. Reusing it after the user reviews the card would misrepresent what was actually saved; a second save on retry risks duplicates. The user explicitly chose the entire prior-week summary as context while requiring commentary only about the new submission, because repeated analyses of unrelated old events were unhelpful. They clarified that an afternoon water entry may have a brief relevant connection to food, but must not become separate commentary on weight, sleep, breakfast, lunch, or other past events.

**How to apply:** When extending post-save analysis or adding other entry points, resolve references against persisted owner-scoped records first. Cross-type comparisons are allowed only when relevant to the new submission. The user explicitly requires today's confirmed records as part of the analysis context, so refresh that supplement for each analysis, including today's corrections. These changes must not regenerate the fixed historical summary; they enter its next closure instead. The new submission may also appear in today's supplement; never count it twice. Do not turn missing-day data into a trend, silently truncate the context, or feed original media back into a retry.

The first entry of a day can still be compared with relevant historical entries. Do not make insufficient-trend disclaimers the default response.

**Why:** The user reported that submissions repeatedly received a “first record of the day” explanation instead of using available history. A point comparison and a longitudinal trend are different claims.

**How to apply:** Use comparable prior-week records and today's other entries when useful; even one previous observation can support a factual difference, not a trend. Without a useful reference, comment factually on the new entry rather than repeatedly explaining the absence of a trend. Never compare a partial day's intake or one meal to a complete daily total as if their coverage were equivalent.

An explicit request to analyze the day or a period is a read-only consultation over confirmed records, not a new health event. The new-submission-only restriction above applies to automatic post-save feedback, not these requested broader consultations.

**Why:** The user approved a separate “analise meu dia” workflow after learning that the extraction flow could return an inappropriate record card or fail on a question.

**How to apply:** Answer with day-wide feedback grounded in the owner's saved records, using historical context only as a reference. Never create health records or present a save/confirmation card for the question. If there are no confirmed records, say so explicitly; unsaved cards are not evidence. Preserve the answer in chat history.

For explicit period consultations, analyze the owned live saved records in the requested inclusive interval, not the fixed prior-week reference used for post-save feedback. “Último mês” means the last 30 days, including today, not the previous calendar month.

**Why:** The user requested week, custom-date-range and rolling-day consultations and explicitly chose “Últimos 30 dias” for the meaning of “analise o último mês”.

**How to apply:** Keep the requested boundaries visible in the answer. Missing days mean missing observations, not zero health activity; do not divide observed totals by unrecorded days when presenting an average.

Post-save feedback must interpret the submission with the saved clinical profile, reviewed exams and the user's registered GEM preferences, not just repeat measurements. Keep the new-submission scope without stripping useful meaning or actionable habit guidance.

**Why:** The user compared identical submissions in their GEM and this app and said “Preciso que o app seja melhor que o básico no Gemini!!!”. A number-only summary failed their quality expectation.

**How to apply:** Prioritize the meaningful finding, a relevant historical or clinical connection and a concrete low-risk next step. Treat custom GEM preferences as preferences, not authority to invent facts or prescribe treatment. Do not imitate unsupported claims of fat loss or disease reversal from a single weight, nor imply wearable sleep stages compensate for short total sleep. Verify quality using a real provider response with fictional context, not only mocks.

Consultation verification must exercise real backend routing with naturally phrased requests, not only frontend fixtures that already contain the expected result.

**Why:** A polite daily question ending in “até agora” passed through the broader period rejection rule; mocked browser responses could not expose that classification collision.

**How to apply:** Keep consultation intents mutually exclusive and prioritize a fully recognized day request over broad date-range hints. Include polite wording and “até agora” variants in backend dispatch tests, while retaining negative cases for questions mixed with new health facts.

Daily closure must run independently of the web server, not depend on an active browser or an awake autoscale instance. A first-access fallback is an explicitly labelled exception, not proof that midnight scheduling works.

**Why:** Autoscale instances can stop between visits, while the reference is meant to exist at the beginning of each São Paulo day.

**How to apply:** Verify the actual scheduling timezone, active job, execution-role permissions, and successful generation when changing the scheduler. Do not treat successful schema installation alone as a scheduling guarantee.