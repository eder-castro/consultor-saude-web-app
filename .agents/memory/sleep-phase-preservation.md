---
name: Sleep phase preservation
description: Durable rule for storing and presenting total sleep together with its measured stages.
---

Keep each sleep session consolidated as one total record, while preserving deep, light, REM, and awake durations in their dedicated fields whenever the source provides them.

**Why:** The total prevents double counting, but the user explicitly wants the measured phases retained for weekly analysis and trend visualization. Awake time must remain visible without being added to total sleep.

**How to apply:** Extraction, storage, context, and dashboard summaries must carry phase fields end to end. In chat confirmation, show total sleep and each phase on separate editable lines while saving one consolidated session. Never replace the stored total with separate stage rows or infer missing phases.