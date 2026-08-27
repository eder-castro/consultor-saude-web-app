---
name: Spreadsheet-to-Supabase imports
description: Non-obvious constraints for importing the health spreadsheet through Replit integrations.
---

Treat the spreadsheet's time field as free text rather than a database time type, and make imports idempotent with a stable key tied to the source row.

**Why:** The source mixes clock values with period labels such as "Manhã"; a strict time column caused partial batch failures. Stable source-row keys allow safe retries after a partial import.

**How to apply:** Preserve the field as text during future syncs and upsert on the stable import key. CSV export is suitable only for the first tab: the Drive connector ignores `gid`. For multi-tab syncs, export XLSX and read its workbook/worksheet entries. Use the Supabase REST connector for records and Supabase migrations for schema changes.