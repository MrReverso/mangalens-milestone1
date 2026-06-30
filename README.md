# MangaLens — Milestone 3A: Safe Image Capture Diagnostics

MangaLens is a browser extension prototype for manga, manhwa, and webtoon
translation experiences. Milestone 3A preserves detection, mock translation,
and session editing while adding a privacy-safe diagnostic pipeline that can
capture one fully visible detected page. It does not perform real translation.

## What Milestone 3A Adds

- Selects the lowest-numbered detected page that is fully inside the viewport
- Temporarily hides all MangaLens overlays for a clean visible-tab screenshot
- Crops screenshot pixels in the background service worker
- Returns only dimensions, PNG byte size, and capture method to the popup
- Cooperatively cancels timed-out stages, retires late work, and bounds overlay
  restoration so retries cannot overlap old capture pipelines
- Defines a validated, versioned contract for a future multipart backend
- Provides a local, copyright-free capture fixture

Captured image bytes are never sent to the popup, uploaded, persisted, logged,
or written to storage. They exist only during one background capture operation.

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
`image/png` part. No endpoint or API client exists in this milestone.

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

- **All translations and bubble positions are mocked locally.**
- **No OCR, real translation, AI model calls, API requests, backend, or image
  processing is implemented.**
- Edits are session-only and are not persisted across refreshes or restarts.
- Capture supports only one fully visible page at a time.
- Pages larger than the viewport require a future scrolling/stitching milestone.
- Capture diagnostics do not start OCR or translation.
- Detection relies on image size heuristics (rendered and natural dimensions). Some non-manga images may be detected, and some manga images may be missed depending on the site's layout.
- The content script is injected programmatically using `activeTab` + `scripting` permissions — it is only injected after the user interacts with the extension popup.
- Only Chrome is tested in this milestone (Firefox and Edge support is planned for future milestones).
- SVG images, CSS background images, and `<picture>` elements are not scanned — only standard `<img>` elements.
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
safe rendering, session ownership, positioning, and teardown.

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
│   ├── background.ts        # Background service worker (init only)
│   └── unlisted-content.ts  # Content script (injected programmatically)
├── components/
│   ├── LanguageSelect.tsx   # Reusable language dropdown component
│   └── LanguageSelect.module.css
├── lib/
│   ├── image-detector.ts    # Manga image detection logic
│   ├── image-position.ts    # Normalized-to-viewport coordinate mapping
│   ├── capture/             # Eligibility, coordinator, cropper, geometry
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

The translation preview is simulated with deterministic local strings and
demonstration positions. No text recognition, real translation, AI, backend,
inpainting, or image modification occurs.
