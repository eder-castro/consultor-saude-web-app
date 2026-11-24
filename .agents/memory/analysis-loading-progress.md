---
name: Analysis loading progress
description: Truthful processing stages and the user's visual direction for the health-chat loading.
---

Loading text must reflect work actually reported by the active request, not a sequence of imagined steps advanced by timers.

**Why:** The user asked for loading that explains what is happening behind the scenes. Context lookup, AI interpretation, service retries and result validation are different states; changing text by elapsed time alone would imply work that might not have started.

**How to apply:** Keep progress isolated to the authenticated request, including stages emitted by worker threads. For background photo jobs, show only what their actual status establishes: queued waiting is not active processing.

Use a segmented wheel, a simple stand and a small running hamster silhouette near the bottom, matching the image reference the user supplied. The whole illustration follows the loading text color. Show it for the entire active loading, without a skeleton or delay.

**Why:** The user requested a monochrome, always-visible animation and then supplied a silhouette reference, replacing the earlier outline drawing.

**How to apply:** Keep both light and dark themes tied to the text color, preserve reduced-motion support, and keep previews consistent with the app. Changes to the actual stage must not replace the illustration or restart its animation.

Keep the current body size; shorten only the legs. The hamster should move a little forward and backward along the wheel's curve rather than stay running at a fixed point.

**Why:** The user clarified that the body size was acceptable and explicitly approved the shorter legs, gentler steps and forward/backward travel along the wheel's curve. Preserve this approved direction.

**How to apply:** Keep travel constrained to the circular track and use small alternating leg movements, not large swings.

Keep only the original hamster-in-the-wheel animation in the app; do not activate the screen-roaming adventure.

**Why:** After seeing the adventure preview, the user chose to keep the old animation for publication, superseding the earlier duck.exe-style request.

**How to apply:** Preserve the approved wheel, silhouette, monochrome appearance and reduced-motion behavior for the entire loading period, regardless of duration. Keep the independently requested background history loading; disabling the adventure must not undo that improvement.