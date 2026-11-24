---
name: Python connector bridge
description: How Python services in this project should access Replit connectors when the Python SDK is unavailable.
---

Python services should delegate connector proxy calls to a small JavaScript helper that uses the official Replit connectors SDK. Do not reimplement connector identity headers or request raw OAuth credentials.

**Why:** The Python connector package named by the integration could not be resolved from this environment's package registry, while the official JavaScript SDK is available and handles identity refresh safely. Each helper invocation starts a new JavaScript process, so sequential connector steps on latency-sensitive paths can noticeably amplify autoscale cold starts.

**How to apply:** Keep business logic and HTTP endpoints in Python, invoke a narrowly scoped JavaScript helper for connector API calls, return structured JSON, and avoid logging sensitive response bodies. Consolidate dependent connector operations into one helper action on interactive paths such as login, while retaining verification and safe error handling.