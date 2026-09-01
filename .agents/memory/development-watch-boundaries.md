---
name: Development watch boundaries
description: Why frontend development watchers must exclude Replit-managed internal directories.
---

Keep Replit-managed `.local` and `.agents` trees outside the frontend development watcher.

**Why:** Internal skill/template updates can modify many nested TypeScript configs at once. Vite may repeatedly clear its SSR module graph during that burst, temporarily loading a context consumer separately from its provider and crashing SSR.

**How to apply:** Preserve these watch exclusions when changing Vite configuration. If SSR reports a hook outside its provider immediately after internal tooling changes, inspect reload-storm logs before restructuring the provider tree.