---
name: GitHub push authentication
description: Covers the observed mismatch between GitHub OAuth API access and Git CLI authentication in this Replit environment.
---

GitHub OAuth can have full repository write permission while the Git CLI still receives an invalid credential from Replit's askpass helper.

**Why:** Reconnecting both the GitHub App and standard GitHub OAuth connection did not repair HTTPS pushes, although authenticated REST API requests had administrative repository access.

**How to apply:** Test a normal push once, then verify repository permissions through the authenticated API. Do not request or expose personal tokens. If Git transport remains unavailable, use GitHub's Git Data API only when the complete commit graph, trees, authors, dates, and hashes can be preserved and verified before moving the branch reference.

For this public GitHub repository, check outgoing history for conversation attachments and internal workspace material before syncing. Use the configured `origin` as resolved by Git, including the Replit proxy rewrite, rather than bypassing it with a direct GitHub URL.

**Why:** The user approved updating public `main` with current code but without health-related attachments. The approved update was a reviewed snapshot based on public `main`, not a push of the private Replit commit chain. The proxy accepted that Git push.

**How to apply:** Verify the actual remote head and preserve it as the parent of the sanitized snapshot. Exclude changes to conversation uploads, screenshots and agent context, verify the outgoing diff, then push without force. Keep the Replit history intact; because the snapshot and workspace histories differ, do not treat a subsequent ordinary push or the cached ahead count as a safe sync.