---
name: Sleep phase preservation
description: Durable rule for storing and presenting total sleep together with its measured stages.
---

Keep each sleep session consolidated as one total record, while preserving deep, light, REM, and awake durations in their dedicated fields whenever the source provides them.

**Why:** The total prevents double counting, but the user explicitly wants the measured phases retained for weekly analysis and trend visualization. Awake time must remain visible without being added to total sleep.

**How to apply:** Extraction, storage, context, and dashboard summaries must carry phase fields end to end. In chat confirmation, show total sleep and each phase on separate editable lines while saving one consolidated session. Never replace the stored total with separate stage rows or infer missing phases.

Preserve the sleep app's explicit low/normal/high classification separately from each phase's duration. Missing classifications remain unknown, including historical records; never calculate a classification from a duration or percentage.

**Why:** The user requested the classifications shown in sleep screenshots to be stored and charted, with distinctions usable by color-blind viewers.

**How to apply:** Carry the source classifications through extraction, review, atomic save and chart data. Identify phases with their original colors and labels, and indicate levels with textures and text. Display chart durations as zero-padded `HH:MMh`, including `00:00h` for a measured zero. Unknown durations remain absent, not zero.

Keep the weekly sleep phases in stacked bars, one column per day, rather than separate side-by-side bars. Use the original phase colors; vary texture within the same color for normal/medium and low levels.

**Why:** The user rejected both the grouped-bar presentation and the classification-color palette. They explicitly requested the earlier stacked bars and original phase colors, with textures for medium and low instead of changing their colors.

**How to apply:** Preserve visible segment boundaries when adjacent phases have the same classification. Retain the independently recorded sleep-total line; awake time is not part of that total. Keep phase names and classifications available in the tooltip and accessible list.

Do not assume a valid structured vision response has read all the sleep measurements.

**Why:** The user supplied a sleep dashboard image with clearly legible phase durations in its lower table, but the extraction omitted light sleep and awake time. Stronger prompt instructions alone still produced omissions in a real-image check. A second read also encountered provider unavailability, so completeness cannot be treated as guaranteed.

**How to apply:** Check the entire image, including tables below the chart, and map “Despertar” to awake time. Recheck incomplete photo extraction with a focused table transcription, using stable session references plus a directly transcribed matching total, rather than asking the model to rewrite every health group. Preserve measurements already read and unrelated records, and retain a reviewable result with a visible warning if checking fails or fields remain absent. Never fill a phase by subtraction or replace an absent value with zero.

The sleep recheck needs its own configured fallback path when the preferred model is overloaded.

**Why:** The original full extraction and generic recheck both omitted legible lower-table values in a real screenshot. A focused recheck initially failed because it used only an overloaded model; a fallback-enabled focused read recovered every visible phase.

**How to apply:** Do not treat a successfully parsed initial response or a single-model retry as proof of complete photo extraction. Validate changes against a legible real image as well as fixtures, and distinguish unavailability from absent source measurements.

Sleep screenshots use the date displayed inside the sleep app, not the upload day or the phone's status bar. Check this even when the first extraction already contains every phase.

**Why:** The user explicitly asked for the image's date to determine which saved day is compared, after an incorrect sleep upload and its correction were added together.

**How to apply:** Transcribe the image date in the focused reread, preserve it in the review and warn when it cannot be verified. A same-owner, same-date sleep upload must warn and offer explicit replacement, never silently add or replace. Replacement covers that day's existing sleep rows only, rolls back with the new save on failure and uses an optimistic snapshot so a changed saved record requires fresh review. Keep retries idempotent, including older published save clients.