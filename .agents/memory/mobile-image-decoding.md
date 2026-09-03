---
name: Mobile image decoding
description: Cross-browser rule for preparing chat and exam photos before Gemini analysis.
---

Decode user-selected photos through an HTML image element before drawing them to a canvas and exporting a normalized JPEG.

**Why:** Chrome on Android can display a camera photo in an image element while `createImageBitmap()` rejects the same file with “The source image could not be decoded.” Passing that browser exception through creates a misleading analysis error even though the API was never called.

**How to apply:** Use the browser's regular image decoder for camera/gallery uploads, verify natural dimensions and canvas/blob output, revoke temporary object URLs, and replace native decoder messages with actionable localized guidance.