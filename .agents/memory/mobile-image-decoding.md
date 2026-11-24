---
name: Mobile image decoding
description: Cross-browser rule for preparing chat and exam photos before Gemini analysis.
---

Decode user-selected photos through an HTML image element before drawing them to a canvas and exporting a normalized JPEG.

**Why:** Chrome on Android can display a camera photo in an image element while `createImageBitmap()` rejects the same file with “The source image could not be decoded.” Passing that browser exception through creates a misleading analysis error even though the API was never called.

**How to apply:** Use the browser's regular image decoder for camera/gallery uploads, verify natural dimensions and canvas/blob output, revoke temporary object URLs, and replace native decoder messages with actionable localized guidance.

Treat image conversion as an optimization, not a prerequisite for sending a supported original image.

When FileReader fails, try the same Blob's arrayBuffer before declaring the selected file inaccessible; respect an explicit read cancellation.

**Why:** Android gallery failures can be specific to the browser reading path. Decoder fallback alone does not help when the initial byte read fails.

**How to apply:** Preserve the selected file and bytes, use bounded chunks when converting binary data to base64, and retain the actionable inaccessible-file error if both readers fail. Never imply that an image reached AI analysis when reading failed.

**Why:** The user again reported a visibly displayed food photo being rejected as unreadable even after the HTML decoder change. The old catch grouped decoder, canvas, encoding and file-read failures under one misleading format warning.

**How to apply:** Read selected bytes once, prefer a data URL for decoding, and prepare multiple photos sequentially to reduce mobile memory pressure. When conversion fails, send supported originals only after checking their actual format and the backend size limit. Do not relabel HEIC as JPEG. Preserve explicit errors for inaccessible files, oversized originals and unsupported formats; do not invent an image analysis.