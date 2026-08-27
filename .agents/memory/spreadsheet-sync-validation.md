---
name: Spreadsheet sync validation
description: Safety constraints for validating the health spreadsheet import without creating duplicates.
---

Validate changes to spreadsheet identity and normalization against a read-only snapshot or a rolled-back transaction before allowing writes to the live table. Treat the source time field as text that may contain clock values or period labels.

**Why:** Legacy rows can serialize equivalent values differently, and a live comparison test can misclassify existing rows as new. The sheet also contains labels such as “Manhã”, “Almoço”, and “Noite”.

**How to apply:** First compare predicted new, ignored, and invalid counts without inserting. Exercise reordered rows and malformed values using in-memory payloads. Enable batch writes only after existing rows match; rely on a unique import key for concurrent retries.