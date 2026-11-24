---
name: Vite hydration stability
description: Replit-specific watcher, runtime and browser instrumentation behavior that can destabilize the Vite preview.
---

Keep Bun's workspace cache excluded from the Vite watcher, and use hydration suppression only on individual form controls that Replit browser tooling mutates before React hydrates.

**Why:** Package installation updates cached TypeScript configs, which caused repeated Vite program reloads during hydration. Browser instrumentation also injected a caret style into form fields before hydration, producing attribute mismatches. Global hydration suppression would hide genuine application bugs.

**How to apply:** Preserve the cache ignore pattern in Vite configuration. If a hydration diff names a tooling-injected attribute, add targeted suppression to only the affected element and verify a fresh browser context has no new hydration warnings.

Run the Vite development server under Node when native NAPI callbacks fail under Bun; this does not require replacing Bun for package management, tests or the backend connector bridge.

**Why:** The preview aborted under Bun with a native threadsafe-function panic ("expect Function, got: Object") when the browser loaded it. Restarting under the same runtime repeated the failure; Node restored the preview.

**How to apply:** For this native panic, check the actual executable rather than relying on a declared Node module, which can exist in configuration without making node available. Keep runtime changes limited to Vite development unless production evidence requires more.
