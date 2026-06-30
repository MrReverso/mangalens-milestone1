# MangaLens — Milestone 4C: Local OCR and Accurate Text Overlay Placement

MangaLens is a Chrome Manifest V3 prototype for manga, manhwa, and webtoon translation experiences. Milestone 4C replaces the placeholder/template-based text overlay logic with a **real local OCR character recognition engine** running entirely client-side. It does not implement real translation yet (translated text is set equal to original text).

---

## Local OCR Architecture

We use **Tesseract.js (v5.1.0)** compiled with WebAssembly (WASM) to run OCR locally in Chrome. 

1. **Service Worker and Web Worker Coordination**:
   - The extension captures the visible page as a PNG.
   - An optimized Connected Component Analysis (CCA) layout algorithm runs inside the Service Worker on an `OffscreenCanvas` to detect high-contrast bounding boxes (potential text areas).
   - The Service Worker spawns a background Web Worker (`new Worker()`) using the locally bundled Tesseract worker script to run the heavy OCR processing off the main event loop.
   - Each detected text region is cropped using `OffscreenCanvas` and passed to the Web Worker for character recognition.

2. **Compliance with Manifest V3 Security (CSP)**:
   - Dynamic remote scripts and WASM downloads are blocked by the extension's Content Security Policy.
   - All Tesseract core, worker, and language files are packaged locally in the extension bundle and loaded using `chrome.runtime.getURL()`.
   - Uses `workerBlobURL: false` to avoid CSP blob evaluation restrictions.

---

## Local Asset Storage & Bundle Impact

To ensure offline availability and security compliance, all required assets are stored locally under the `public/tesseract/` directory:

- **Library Core**: `public/tesseract/tesseract.esm.min.js` (67 kB)
- **Web Worker**: `public/tesseract/worker.min.js` (124 kB)
- **WASM Core**: `public/tesseract/tesseract-core.wasm.js` (4.73 MB) & `public/tesseract/tesseract-core.wasm` (3.46 MB)
- **Language Models**: Stored under `public/tesseract/lang/` using optimized `tessdata_fast` weights:
  - English (`eng.traineddata` — 4.11 MB)
  - Japanese (`jpn.traineddata` — 2.47 MB & `jpn_vert.traineddata` — 3.04 MB for vertical text)
  - Korean (`kor.traineddata` — 1.68 MB)
  - Chinese Simplified (`chi_sim.traineddata` — 2.47 MB)

**Total Extension Bundle Size**: Approximately **22.5 MB**.

---

## Performance & Accuracy Expectations

- **First-Run Performance**: The first OCR operation requires compiling the WebAssembly binary and loading the traineddata model file(s) into memory. This initialization takes approximately **1 to 2 seconds**.
- **Subsequent Runs**: Once initialized, cropping and executing character recognition on individual text bubbles is fast (typically **100ms to 350ms** per region).
- **Supported Languages**: English, Japanese (horizontal and vertical), Korean, and Chinese. Automatic language detection (`auto`) will attempt to load all models in parallel.
- **Accuracy Limitations**:
  - High accuracy on clear manga typography and digital webtoon lettering.
  - Lower accuracy on hand-drawn calligraphy, highly stylized sound effects (sfx), low-contrast overlapping text, and low-resolution images.

---

## Testing Local OCR

### Automated Tests
Run the Vitest suite to verify full-crop binarization, coordinate normalization limits (`x+width <= 1`), deterministic reading order sorting, bubble separation, empty text validation, and abort/timeout behavior:

```bash
pnpm install --frozen-lockfile
pnpm compile
pnpm test
pnpm build
```

### Manual Verification
1. Run the local capture fixture server:
   ```bash
   pnpm fixture
   ```
2. Build the extension:
   ```bash
   pnpm dev
   ```
3. Load the unpacked extension from `.output/chrome-mv3` in Chrome (`chrome://extensions`).
4. Test the fixture page (`http://127.0.0.1:4173/`). Click **Scan Manga Page**, then **Translate Visible Page** (Local OCR).
5. The overlay will load and overlay the text `"VISIBLE PAGE"` exactly on the screen, and the popup status bar will read: `"OCR detected 1 text regions. Translation not enabled yet."`.
