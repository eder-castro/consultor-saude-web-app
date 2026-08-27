---
name: Vite hydration stability
description: Replit-specific watcher and browser instrumentation behavior that can destabilize TanStack Start hydration.
---

Keep Bun's workspace cache excluded from the Vite watcher, and use hydration suppression only on individual form controls that Replit browser tooling mutates before React hydrates.

**Why:** Package installation updates cached TypeScript configs, which caused repeated Vite program reloads during hydration. Browser instrumentation also injected a caret style into form fields before hydration, producing attribute mismatches. Global hydration suppression would hide genuine application bugs.

**How to apply:** Preserve the cache ignore pattern in Vite configuration. If a hydration diff names a tooling-injected attribute, add targeted suppression to only the affected element and verify a fresh browser context has no new hydration warnings.