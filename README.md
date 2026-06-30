# MangaLens — Milestone 1: Extension Foundation & Manga Image Detection

MangaLens is a browser extension for translating manga, manhwa, and webtoons directly on websites. This milestone implements the extension foundation and manga page image detection — no translation or backend functionality is included yet.

## What Milestone 1 Does

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

- **No translation, OCR, AI model calls, or backend APIs are implemented.**
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

## Running Tests

```bash
pnpm test
```

Tests use Vitest with jsdom and cover image detection, fixed-overlay positioning,
nested scrolling, clear/rescan behavior, lazy loading, duplicate prevention, and
removed-image cleanup.

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
│   ├── overlay-manager.ts   # Visual marker overlay management
│   ├── messages.ts          # Typed message definitions
│   └── storage.ts           # chrome.storage.local utility
├── types/
│   └── extension.ts         # Shared types and constants
├── tests/
│   └── image-detector.test.ts  # Unit tests for detection logic
├── public/
│   └── icon/                # Extension icons (16–128 px)
├── wxt.config.ts            # WXT and manifest configuration
├── vitest.config.ts         # Vitest configuration
├── tsconfig.json            # TypeScript configuration (strict mode)
└── package.json
```

## Note

**Translation is not implemented.** This milestone only detects manga page images and places visual markers. No text recognition, translation, inpainting, or image modification occurs.
