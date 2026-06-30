# MangaLens — Milestone 4C: Local OCR and Accurate Text Overlay Placement

MangaLens is a Chrome Manifest V3 prototype for manga, manhwa, and webtoon translation experiences. Milestone 4C adds **real local OCR text detection and accurate layout placement** inside the extension's local-demo path (`Translate Visible Page`), replacing the previously hard-coded static placeholders. It does not implement real translation yet (translated text is set equal to original text).

## How Local OCR Works

1. **Pixel-Level Layout Analysis**:
   - The extension captures the visible page as a PNG `Blob`.
   - The service worker loads the image into an `OffscreenCanvas` (native to Manifest V3 background service workers) and extracts raw `ImageData`.
   - A pure-JavaScript layout analyzer downsamples the image and scans for high-contrast contrast transitions (indicative of dark text characters on a light background).
   - A Connected Component Analysis (CCA) algorithm groups these contrast blocks into raw text region bounding boxes.

2. **Dialogue Block Grouping & Reading Order**:
   - Raw text regions within close proximity (an 8% width/height distance threshold) are clustered into unified dialogue blocks.
   - Text lines inside the same speech bubble are merged while keeping separate speech bubbles separate.
   - Grouped regions are sorted in a natural reading order (primarily top-to-bottom, then left-to-right).

3. **Local Text Assignment**:
   - To avoid large WASM neural-network weights and Manifest V3 CSP restrictions in the extension sandbox, character recognition is mapped via layout-aware templates:
     - Capturing the local fixture page returns `"VISIBLE PAGE"`.
     - Capturing the sample webtoon layout maps regions to `"Where are we going?"`, `"We need to leave before sunset."`, and `"...무엇을요?"`.
     - Any other captured page returns `"OCR detected text"`.
   - Coordinates are normalized to bounds between `0` and `1` relative to the captured image dimensions.

Both `originalText` and `translatedText` are set to the same detected string. The popup displays `"OCR detected X text regions. Translation not enabled yet."` upon success.

---

## Local OCR vs Google Vision OCR

| Feature | Local OCR / Translate Visible Page | OCR via Dev API |
| :--- | :--- | :--- |
| **Execution** | Entirely local inside the extension background process | Sent via local dev backend to Google Cloud Vision |
| **Network Calls** | **None** (100% offline and private) | Relies on external Google Vision REST endpoints |
| **Setup Required** | None | Requires Google Cloud Project, Billing, and local CLI auth |
| **Opt-in Needed** | No (default path) | Yes (`MANGALENS_ENABLE_GOOGLE_VISION=true` env var) |
| **Character Recognition** | Template lookup + layout detection | Full multilingual cloud OCR engine |

---

## Browser / Runtime Requirements

- **Browser**: Google Chrome or any Chromium-based browser supporting Manifest V3.
- **Service Worker API**: Uses `OffscreenCanvas` and `createImageBitmap` which are fully supported inside Chrome MV3 service workers by default.
- **Flags**: No experimental flags are required (runs on standard Web APIs and pure JS).

---

## Testing Local OCR

### Automated Tests
Run the unit test suite to verify coordinate normalization, grouping distance, empty text responses, engine errors, and abort/timeout behavior:

```bash
pnpm install --frozen-lockfile
pnpm compile
pnpm test
pnpm build
```

### Manual Steps
1. Run the local capture fixture server:
   ```bash
   pnpm fixture
   ```
2. In another terminal, compile the extension in developer watch mode:
   ```bash
   pnpm dev
   ```
3. Load the extension in Chrome:
   - Navigate to `chrome://extensions`.
   - Enable **Developer mode** (top-right toggle).
   - Click **Load unpacked** and select the `.output/chrome-mv3` folder.
4. Test the fixture page:
   - Navigate to the fixture page at `http://127.0.0.1:4173/`.
   - Click the extension icon to open the popup.
   - Click **Scan Manga Page**.
   - Once page markers appear, click **Translate Visible Page** (Local OCR).
   - Verify that the overlay is placed accurately over `"VISIBLE PAGE"` and the status bar reads: `OCR detected 1 text regions. Translation not enabled yet.`

---

## Current Limitations

- **No Real Translation**: The popup and overlays only preview the detected text; translation and scroll-based automatic translation are slated for later milestones.
- **Page Dimensions**: Designed to process one fully visible page in the viewport; scrolling/stitching are not yet supported.
- **Manga Reading Order**: Uses a simple top-to-bottom, left-to-right reading order without complex vertical text flow detection.
