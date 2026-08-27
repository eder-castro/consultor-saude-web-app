---
name: Python connector bridge
description: How Python services in this project should access Replit connectors when the Python SDK is unavailable.
---

Python services should delegate connector proxy calls to a small JavaScript helper that uses the official Replit connectors SDK. Do not reimplement connector identity headers or request raw OAuth credentials.

**Why:** The Python connector package named by the integration could not be resolved from this environment's package registry, while the official JavaScript SDK is available and handles identity refresh safely.

**How to apply:** Keep business logic and HTTP endpoints in Python, invoke a narrowly scoped JavaScript helper for connector API calls, return structured JSON, and avoid logging sensitive response bodies.