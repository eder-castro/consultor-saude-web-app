---
name: Autoscale startup readiness
description: The public proxy can be reachable long before Python becomes available on a cold production instance.
---

Gate the application's interactive pages on both the frontend and backend being ready; show an auto-refreshing startup state rather than a login form that cannot submit.

**Why:** Production logs on 2026-09-24 showed a cold instance accepting requests over five minutes before Python began listening, with repeated login connection refusals during that interval. This is distinct from an invalid password or provider outage.

**How to apply:** When changing the production launcher or proxy, preserve readiness checks for both child services. Readiness messaging prevents failed interactions but does not itself shorten Python's cold start; investigate startup time separately if it persists.

Keep the approved loading animation above the startup heading, and make the startup page self-contained.

**Why:** The user explicitly requested the existing animation above “Preparando seu diário de saúde”. While either child service is starting, ordinary asset requests also pass through the readiness gate; relying on React or external SVG/CSS would undermine the feedback precisely when it is needed.

**How to apply:** Reuse the approved animation with inline SVG and CSS, preserve automatic refresh and reduced-motion support, and avoid making startup feedback depend on client hydration or backend readiness.

Do not infer cold production performance from warm workspace restarts, or attribute all time before Uvicorn's first server message to application startup handlers.

**Why:** Production observations separated a long pre-server interval from a short lifespan startup; local restarts did not reproduce that delay. Changing Uvicorn's automatic protocols or bundling pure-Python dependencies showed no reliable local import benefit and was deliberately rejected.

**How to apply:** Compare interpreter entry, framework/application imports, API initialization, and HTTP readiness separately. Use production measurements after an approved republication before claiming the long cold-start delay is resolved. Preserve the existing server defaults unless an experiment demonstrates a gain.