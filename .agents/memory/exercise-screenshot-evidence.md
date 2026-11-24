---
name: Exercise screenshot evidence
description: Preserve verbose activity-source data without rejecting the whole extraction or misdiagnosing scaled text.
---

Keep average pace separate from per-segment pace/time details. If a provider puts a verbose transcription into the average field, preserve that text for review rather than truncating it or dropping the entire activity.

**Why:** Actual Google Fit screenshots caused structured extraction to fail because the provider packed splits and other metrics into the short average-pace field.

**How to apply:** Carry the separate detail text through extraction, editable review, confirmation, storage and restoration. Preserve absent values; never infer an average from the splits.

Compare disputed header readings against an enlarged crop of the original source before changing extraction behavior.

**Why:** A scaled screenshot preview made the final time digit look different, while multiple independent model reads agreed with the magnified source.

**How to apply:** Check original pixels instead of repeatedly probing the provider or changing correct extraction based on the chat-sized preview.
