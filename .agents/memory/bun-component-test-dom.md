---
name: Bun component test DOM
description: Why component suites need one shared DOM when run together under Bun.
---

Component suites that import Testing Library in the same Bun test run must not independently replace the global document after the first import.

**Why:** Testing Library's screen retains the document present at import time; Bun can reuse the imported module across test files. Separately passing tests then fail in the combined suite because screen searches an old, empty document.

**How to apply:** Initialize one shared DOM before importing Testing Library and run the combined test command when adding another component test file. Keep document cleanup limited to rendered components rather than closing the shared DOM between files.

Use DOM event constructors from that same window when testing Radix dialogs under Bun, rather than mixing Bun's built-in Event with JSDOM targets.

**Why:** Radix dispatches custom focus and dismiss-layer events. JSDOM rejects events from another runtime realm, which makes a working dialog fail only in component tests.

**How to apply:** Expose the shared window's Event and CustomEvent alongside its DOM globals before importing dialog components.