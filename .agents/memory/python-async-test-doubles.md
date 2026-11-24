---
name: Python async test doubles
description: Avoid hidden hangs when mocked synchronous provider calls run in worker threads.
---

Do not let an iterable mock response sequence exhaust inside a synchronous function invoked through `asyncio.to_thread`. Give unexpected calls an explicit assertion failure or a deliberate response.

**Why:** Adding a sleep-photo date verification exhausted a mocked provider response list. Its `StopIteration` could not propagate into the asyncio future, leaving the test pending until the shell timeout instead of reporting a normal failure.

**How to apply:** When adding a provider call or retry, update every finite response fixture. Prefer a callable test double that raises `AssertionError` on unexpected calls, and use a bounded test timeout while checking changed async flows.
