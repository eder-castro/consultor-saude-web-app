---
name: GitHub push authentication
description: Covers the observed mismatch between GitHub OAuth API access and Git CLI authentication in this Replit environment.
---

GitHub OAuth can have full repository write permission while the Git CLI still receives an invalid credential from Replit's askpass helper.

**Why:** Reconnecting both the GitHub App and standard GitHub OAuth connection did not repair HTTPS pushes, although authenticated REST API requests had administrative repository access.

**How to apply:** Test a normal push once, then verify repository permissions through the authenticated API. Do not request or expose personal tokens. If Git transport remains unavailable, use GitHub's Git Data API only when the complete commit graph, trees, authors, dates, and hashes can be preserved and verified before moving the branch reference.