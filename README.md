# MangaLens — Milestone 4A: Secure Development Backend Transport

MangaLens is a browser extension prototype for manga, manhwa, and webtoon translation experiences. Milestone 4A introduces a secure local loopback HTTP transport path connecting the background script to a zero-dependency development server.

## Current Milestone Features (Milestone 4A)

- **Development API Transport Mode**: Resolves requests via `HttpTranslationService` to a local loopback backend.
- **Local Demo Mode**: Preserves in-extension mock translation processing using `LocalDeterministicTranslationService`.
- **Exact Loopback Constraints**: Restricts the API to `http://127.0.0.1:8787/v1/translate` (health check at `/health`).
- **Multipart Request Contract**: Packages request metadata (`metadata.json`) and the cropped PNG (`page.png`) into a single `multipart/form-data` request.
- **Response stream safety**: Cancels the response stream safely via `reader.cancel()` if aborted or when the response exceeds 256 KB.
- **Privacy boundaries**: PNG bytes are never logged, written to disk, or sent through Chrome messages.

## Current Limitations

- **No OCR**: The extension does not perform text recognition.
- **No AI**: The extension does not perform AI translation or layout analysis.
- **No Real Translation**: The translation overlays display deterministic demo bubbles only.
- **No Remote/Production Backend**: All requests remain restricted to loopback (localhost).
- **No Auth or Billing**: No accounts, authentication, databases, or payment gateways exist.

---

## Running the Complete Development API Pipeline

### 1. Run the Mock Development Server
In your terminal, execute:
```bash
pnpm dev:backend
```
Expected output:
```
MangaLens development API listening on http://127.0.0.1:8787
```

### 2. Run the Extension Developer Mode
In another terminal, execute:
```bash
pnpm dev
```

### 3. Load the Extension in Chrome
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `.output/chrome-mv3` directory inside the project folder.

### 4. Perform a Translation
1. Navigate to a manga site or run the local fixture page via `pnpm fixture` (open `http://127.0.0.1:4173`).
2. Click **Scan Manga Page**.
3. Select a target language and click **Translate via Dev API**.
4. Observe the progress states ("Capturing Page...", "Processing Translation...", "Applying Translation...").
5. Observe the three editable translation bubbles applied dynamically.
6. Stop the development server, run the action again, and verify the status: `Development translation server is not running`.

---

## Project Structure

```
mangalens/
├── dev/
│   └── backend/             # Development server entry, handlers, and multipart parsers
│       ├── server.ts
│       ├── translation-handler.ts
│       └── multipart.ts
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
│   ├── translation/         # Local coordinator and translation service modes
│   │   ├── http-translation-service.ts
│   │   ├── local-deterministic-translation-service.ts
│   │   ├── translation-coordinator.ts
│   │   └── translation-pipeline-status.ts
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
│   ├── translation-api.ts   # Validated multipart metadata contract
│   ├── translation-pipeline.ts # Local pipeline messages and responses
│   └── translation.ts       # Translation and normalized-coordinate models
├── tests/
│   └── *.test.ts            # Extension, client, coordinator, and server tests
├── public/
│   └── icon/                # Extension icons (16–128 px)
├── wxt.config.ts            # WXT and manifest configuration
├── vitest.config.ts         # Vitest configuration
├── tsconfig.json            # TypeScript configuration (strict mode)
└── package.json
```

---

## Safety and Privacy Boundaries

- **Minimal Permissions**: Restricted to `storage`, `activeTab`, and `scripting`.
- **Strict Host Permission**: Only `http://127.0.0.1:8787/*` is authorized.
- **Image Safety**: Image bytes never cross extension message boundaries and are kept entirely in background script memory.
- **Server Privacy**: The mock dev server never writes PNGs to disk, never logs payload structures, and never triggers external network calls.

---

## Recommended Next Milestone
- **Milestone 4B**: OCR provider integration behind the development API.
