---
name: Bun transitive overrides
description: How to handle vulnerable nested JavaScript dependencies when Bun cannot scope overrides by parent.
---

Use flat package overrides when a vulnerable transitive dependency is pinned by
an indirect parent because the Bun version in this environment does not support
nested override objects.

**Why:** Bun accepts the manifest but warns that nested overrides are unsupported,
leaving vulnerable nested lockfile entries unchanged.

**How to apply:** Prefer updating the direct parent first. If an obsolete nested
copy remains, add a flat override within a compatible major version, regenerate
the Bun lockfile, and validate every older consumer with lint, tests, and a full
production build.