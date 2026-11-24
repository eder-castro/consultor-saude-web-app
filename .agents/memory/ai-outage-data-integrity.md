---
name: AI outage and data integrity
description: How to degrade the health diary safely when image/text analysis providers are unavailable.
---

Only bypass the analysis provider for fully recognized, explicit numeric text. For a clearly described meal during a provider outage, offer the original text as a reviewable draft without inferring nutrition, portion sizes, or medical advice. Never claim a photo was analyzed when no image-capable provider responded.

**Why:** In September 2026, the primary model repeatedly returned high-demand errors while the fallback hit quota limits; users repeatedly retried valid health entries. An invented extraction would be worse than a visible limitation in a personal health record.

**How to apply:** Keep strict all-or-nothing text recognition for direct records. For other text, preserve the source and require confirmation. Photos must fail clearly unless a real image analysis provider is available.

Keep retry-queue storage/access failures distinct from photo analysis failures. An inaccessible queue must not mark a photo failed, and a generic deferred-photo notice must not claim quota exhaustion.

**Why:** Production showed both provider timeouts/overload and deployment identity failures before claiming queued work; these are separate causes, and later authenticated storage calls succeeded.

**How to apply:** Preserve the pending job when storage is unavailable and allow successful authenticated polling to resume attempts. Continue using the official connector identity flow; never substitute raw deployment renewal credentials.