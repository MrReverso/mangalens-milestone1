# MangaLens — Milestone 3B: Local Translation Pipeline

MangaLens is a browser extension prototype for manga, manhwa, and webtoon
translation experiences. Milestone 3B connects capture, a deterministic local
demo service, validated background orchestration, content-owned page sessions,
and editable translation overlays. It does not perform OCR or real translation.

## What Milestone 3B Adds

- Adds **Translate Visible Page** for an end-to-end local demonstration
- Reuses the Milestone 3A capture lifecycle and its active-tab, timeout,
  restoration, size, and per-tab locking safeguards
- Keeps cropped PNG bytes inside trusted background code
- Passes the PNG to a deterministic local service with no network access
- Runtime-validates request metadata, service output, messages, coordinates,
  bubble IDs, and translated text at each extension boundary
- Applies results through the scanner controller's existing page session, so
  bubbles remain editable and visibility controls continue to work
- Prevents concurrent translation pipelines per tab and discards late work
  after cancellation or timeout

## Running the Complete Local Pipeline

1. Scan a supported page with **Scan Manga Page**.
2. Scroll until one complete detected image fits inside the viewport.
3. Select a target language and click **Translate Visible Page**.
4. Watch the capture, processing, and apply stages in the popup.
5. Click a resulting bubble to edit it with the Milestone 2B controls.

The local service returns the same three fixed bubble positions for a given
page and deterministic demo text for English, Spanish, Portuguese, French,
Italian, or German. The text is not read from or derived from the image.

### Three development actions

- **Preview Translation** runs the original multi-page mock queue without image
  capture.
- **Test Image Capture** captures one fully visible page and returns safe
  diagnostics only.
- **Translate Visible Page** captures one page, processes it in the local demo
  service, validates the result, and applies editable bubbles to that page.

Captured image bytes are never sent through extension messages, uploaded,
persisted, logged, or written to storage. They live only during the background
operation and are released after local processing.

## What Milestone 3A Adds

- Selects the lowest-numbered detected page that is fully inside the viewport
- Temporarily hides all MangaLens overlays for a clean visible-tab screenshot
- Crops screenshot pixels in the background service worker
- Returns only dimensions, PNG byte size, and capture method to the popup
- Cooperatively cancels timed-out stages, retires late work, and bounds overlay
  restoration so retries cannot overlap old capture pipelines
- Revalidates the requested active tab after preparation and after screenshot
  completion so pixels from a switched tab are never cropped
- Defines a validated, versioned contract for a future multipart backend
- Provides a local, copyright-free capture fixture

## Testing Image Capture

1. Scan a supported page with **Scan Manga Page**.
2. Scroll until one complete detected image fits inside the browser viewport.
3. Click **Test Image Capture**.
4. The popup reports the page number, cropped pixel dimensions, and PNG size.

MangaLens hides page markers, badges, translations, and any active editor for
the screenshot, then restores them in a `finally` path. Images taller or wider
than the viewport cannot yet be captured as complete pages. Milestone 3A does
not scroll, stitch screenshots, or fetch original image URLs.

## Local Capture Fixture

```bash
pnpm fixture
```

Open `http://127.0.0.1:4173`. The fixture uses local SVG placeholders and
includes fully visible, partial, oversized, and nested-scroll examples.

## Future Backend Contract

`types/translation-api.ts` defines runtime-validated version 1 metadata for a
future multipart request containing one JSON metadata part and one binary
`image/png` part. Milestone 3B exercises that contract locally; no endpoint or
API client exists.

## What Milestone 2B Adds

- Click any translated bubble to edit it in a focused textarea
- Press **Enter** to save or **Shift+Enter** to insert a line break
- Press **Escape** to cancel and restore the previous text
- Blur the textarea or click outside the bubble to save
- Reject empty and over-1,000-character edits without replacing the text
- Preserve saved edits through scrolling, resizing, and translation visibility
  changes for the current tab session

## What Milestone 2A Adds

- Processes detected pages one at a time through a local mock queue
- Places two simulated translated speech bubbles over every detected page
- Shows translation progress in the popup
- Hides and shows completed bubbles without discarding results
- Clears translation previews separately from detected page markers
- Uses deterministic demo text for English, Spanish, Portuguese, French,
  Italian, and German

Mock bubble locations are fixed demonstration coordinates. They are not
detected from real speech bubbles.

## Using the Mock Translation Preview

1. Scan a supported web page with **Scan Manga Page**.
2. Click **Preview Translation** after one or more pages are detected.
3. Watch the translated-page count update while pages process serially.
4. Toggle **Show translations** to hide or restore the existing overlays.
5. Click **Clear Translations** to cancel processing and remove only translation
   bubbles.
6. Click **Clear Page Markers** to fully reset detection and translations.

## Editing Translation Bubbles

After the preview completes, click a translated bubble on the page. The editor
stays inside that bubble and follows the image while the page scrolls or
resizes. Only one bubble can be edited at a time. Clicking another bubble saves
the current valid edit before opening the next one.

Edits last only for the current tab session; refreshing or navigating away
resets them. **Clear Translations** removes translated bubbles but preserves
detected page markers. **Clear Page Markers** resets the complete scan and
translation session.

## Preserved Milestone 1 Foundation

- Opens a compact popup (360 px wide) with a dark navy UI and teal accent
- Lets the user select a source language and target language (persisted via `chrome.storage.local`)
- Scans the active web page for large images that look like manga or webtoon pages when the user clicks **Scan Manga Page**
- Places numbered visual markers (teal outlines + "Page N" badges) over detected images without modifying the original images
- Markers follow images during window or nested reader-container scrolling, realign on resize, and update if image sizes change
- Detects lazy-loaded or infinite-scroll images after the initial scan, including delayed loads and `src`/`srcset` changes
- Removes markers automatically when their source images leave the page
- Provides a **Clear Page Markers** button to remove all extension UI from the page
- Runs a minimal background service worker that initializes default settings on first install

## Current Limitations

- **All translations and bubble positions are deterministic local demos.**
- **No OCR, real translation, AI model calls, API requests, or backend is
  implemented.**
- Edits are session-only and are not persisted across refreshes or restarts.
- Capture supports only one fully visible page at a time.
- Pages larger than the viewport require a future scrolling/stitching milestone.
- Demo text is not derived from captured image content.
- Capture diagnostics do not start OCR or translation.
- Detection relies on image size heuristics (rendered and natural dimensions). Some non-manga images may be detected, and some manga images may be missed depending on the site's layout.
- The content script is injected programmatically using `activeTab` + `scripting` permissions — it is only injected after the user interacts with the extension popup.
- Only Chrome is tested in this milestone (Firefox and Edge support is planned for future milestones).
- SVG images, CSS background images, and `<picture>` elements are not scanned — only standard `<img>` elements.

The recommended next milestone is an explicitly reviewed development transport
and OCR/translation provider. That milestone must separately review network
permissions, privacy, authentication, retention, and failure behavior before
any captured bytes leave the extension.
- The extension does not work on `chrome://`, `chrome-extension://`, or other restricted browser pages.

## Required Software

- [Node.js](https://nodejs.org/) 18 or later
- [pnpm](https://pnpm.io/) 8 or later

## Installation

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

This starts the WXT dev server and opens Chrome with the extension loaded in development mode. Any changes to source files trigger an automatic rebuild.

## Production Build

```bash
pnpm build
```

The production build outputs to `.output/chrome-mv3/`.

## Type Checking

```bash
pnpm compile
```

## Running Tests

```bash
pnpm test
```

Tests use Vitest with jsdom and cover image detection, fixed-overlay positioning,
nested scrolling, clear/rescan behavior, lazy loading, duplicate prevention, and
removed-image cleanup. Milestone 2A tests additionally cover deterministic mock
translations, normalized coordinate validation, serial queue behavior,
cancellation, visibility, translation positioning, and complete cleanup.
Milestone 2B tests cover keyboard editing, validation, focus, outside clicks,
safe rendering, session ownership, positioning, and teardown. Milestone 3B
tests cover trusted internal capture, deterministic local service output,
strict message/response validation, translation locks, timeout cancellation,
safe content application, editability, and image-byte privacy.

GitHub Actions runs the install, compile, test, and production-build checks on
every push and pull request.

## Loading the Unpacked Extension in Chrome

1. Run `pnpm build` to produce the production output.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the `.output/chrome-mv3` directory inside the `mangalens` project folder.
6. The MangaLens extension icon appears in your toolbar. Pin it for easy access.

## How to Test Image Detection

1. Navigate to a manga, manhwa, or webtoon reading site (e.g., any page with large comic page images).
2. Click the MangaLens extension icon to open the popup.
3. Click **Scan Manga Page**.
4. The status bar shows how many manga pages were detected (e.g., "12 manga pages detected").
5. Large page images on the website will have teal outlines and "Page 1", "Page 2", etc. badges.
6. Scroll the page — markers should stay aligned with their images.
7. Resize the browser window — markers should reposition correctly.

## How to Clear Markers

After a scan, the popup shows a **Clear Page Markers** button. Click it to remove all visual markers and stop the lazy-load observer. The page returns to its original state without a refresh.

## Project Structure

```
mangalens/
├── entrypoints/
│   ├── popup/
│   │   ├── App.tsx          # Main popup React component
│   │   ├── main.tsx         # Popup entry point
│   │   ├── index.html       # Popup HTML shell
│   │   └── style.css        # Popup styles
│   ├── background.ts        # Capture and local-translation orchestration
│   └── unlisted-content.ts  # Content script (injected programmatically)
├── components/
│   ├── LanguageSelect.tsx   # Reusable language dropdown component
│   └── LanguageSelect.module.css
├── lib/
│   ├── image-detector.ts    # Manga image detection logic
│   ├── image-position.ts    # Normalized-to-viewport coordinate mapping
│   ├── capture/             # Eligibility, coordinator, cropper, geometry
│   ├── translation/         # Local service and background coordinator
│   ├── mock-translation-provider.ts # Deterministic local mock results
│   ├── overlay-manager.ts   # Numbered page marker management
│   ├── scanner-controller.ts # Page sessions and scan/translation orchestration
│   ├── translation-overlay-manager.ts # Mock speech-bubble rendering
│   ├── translation-queue.ts # One-page-at-a-time processing
│   ├── translation-text.ts  # Edit normalization and validation
│   ├── messages.ts          # Typed message definitions
│   └── storage.ts           # chrome.storage.local utility
├── types/
│   ├── extension.ts         # Shared extension types and constants
│   ├── capture.ts           # Capture descriptors, metadata, and errors
│   ├── translation-api.ts   # Future validated multipart contract
│   ├── translation-pipeline.ts # Local pipeline messages and responses
│   └── translation.ts       # Translation and normalized-coordinate models
├── tests/
│   └── *.test.ts            # Detection, overlay, queue, and controller tests
├── public/
│   └── icon/                # Extension icons (16–128 px)
├── wxt.config.ts            # WXT and manifest configuration
├── vitest.config.ts         # Vitest configuration
├── tsconfig.json            # TypeScript configuration (strict mode)
└── package.json
```

## Important Note

The translation preview is simulated with deterministic local strings and demonstration positions. No text recognition, real translation, AI, inpainting, or image modification occurs. The development API receives the real cropped PNG, but its translation text and bubble positions are fixed demo values and are not derived from the image content.

---

## Milestone 4A — Secure Development Backend Transport

This milestone introduces a real loopback HTTP transport path connecting the background script to a local Node.js development server.

### Local Demo vs. Development API Mode

1. **Translate Visible Page (Local Demo)**
   - Resolves to in-extension `LocalDeterministicTranslationService`.
   - The cropped PNG remains entirely inside the background process memory.
   - Generates demo bubbles in-extension.

2. **Translate via Dev API (Development API)**
   - Resolves to `HttpTranslationService` which sends a multipart request to the local server.
   - Sends the real cropped PNG and request metadata.
   - The local server validates the payload and returns deterministic mock bubbles.

Both modes share the same capture engine, per-tab locking, timeout architecture, response validators, and transactional content application pathways.

### Development API Origin

- Origin: `http://127.0.0.1:8787`
- Translation endpoint: `http://127.0.0.1:8787/v1/translate`
- Health endpoint: `http://127.0.0.1:8787/health`

*Note: All loopback endpoints are validated strictly on protocol, hostname, port, and query/credentials/fragment exclusion before request dispatching.*

### Multipart Request Contract

Dispatches one POST `multipart/form-data` request with two parts:
1. `metadata` (filename: `metadata.json`, MIME type: `application/json`): Contains `TranslationApiRequestMetadata` JSON.
2. `image` (filename: `page.png`, MIME type: `image/png`): Contains the cropped PNG Blob.

*The request omits cookies, authorization headers, browser history, page/tab URLs, and extension configurations.*

### Request and Response Limits

- **Maximum request size**: ~21 MB
- **Maximum image size**: ~20 MB
- **Maximum metadata size**: ~64 KB
- **Maximum response size**: ~256 KB (enforced via size-bounded stream reader without relying on `Content-Length`)
- **Request timeout**: 10 seconds

### Privacy Boundary

- The cropped PNG is transmitted solely to the loopback endpoint `http://127.0.0.1:8787/v1/translate`.
- The image data never enters the popup script, content script, local extension storage, logs, or any remote/internet hosts.
- The development server processes the request entirely in memory and never persists the image (no disk writes, logging of body bytes, or caching).

### Permission Changes

Permissions are restricted to:
- `storage`, `activeTab`, `scripting` (Standard permissions)
- `host_permissions`: `['http://127.0.0.1:8787/*']` (Loopback host permission)

---

## How to Run and Test the Development Server

### Terminal 1: Run the Backend
```bash
pnpm dev:backend
```
Expected output:
```
MangaLens development API listening on http://127.0.0.1:8787
```

### Terminal 2: Run the Extension Developer Mode
```bash
pnpm dev
```

### Manual Testing Steps

1. Load the unpacked Chrome extension from `.output/chrome-mv3`.
2. Open a supported page or fixture page.
3. Click **Scan Manga Page**.
4. Click **Translate via Dev API**.
5. Observe progress messages: "Capturing Page...", "Processing Translation...", "Applying Translation...".
6. Confirm three editable demo bubbles appear on the target page.
7. Stop the development server (Terminal 1).
8. Click **Translate via Dev API** again.
9. Verify that the popup status bar displays: `Development translation server is not running`.

---

## Recommended Next Milestone
- **Milestone 4B**: OCR provider integration behind the development API.

