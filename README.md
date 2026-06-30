# MangaLens — Milestone 4C: Local OCR and Accurate Text Overlay Placement

MangaLens is a Chrome Manifest V3 prototype for manga, manhwa, and webtoon translation experiences. Milestone 4C replaces the template-based mockup coordinates with a **real local OCR character recognition engine** running entirely client-side. It does not implement real translation yet (translated text is set equal to original text).

---

## Local OCR Architecture

We use **Tesseract.js (v5.1.0)** compiled with WebAssembly (WASM) to run OCR locally in Chrome. 

1. **Service Worker and Web Worker Coordination**:
   - The extension captures the visible page as a PNG.
   - An optimized Connected Component Analysis (CCA) layout algorithm runs inside the Service Worker on an `OffscreenCanvas` to detect high-contrast boundaries of potential text areas.
   - The Service Worker spawns a background Web Worker (`new Worker()`) using the locally bundled Tesseract worker script to run the heavy WebAssembly OCR processing.
   - Each detected text region is cropped using `OffscreenCanvas` and passed to the Web Worker for character recognition.

2. **WebAssembly in Manifest V3 (CSP)**:
   - Manifest V3 disables WebAssembly in extension pages and workers by default. We enable it by adding a strict Content Security Policy to our manifest:
     ```json
     "content_security_policy": {
       "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
     }
     ```
   - Remote script downloads are blocked. All Tesseract core scripts, workers, and language files are packaged locally.
   - Uses `workerBlobURL: false` to avoid CSP blob evaluation restrictions.

3. **No Web Accessible Resources Exposure**:
   - Because the Web Worker is spawned directly by the extension's background Service Worker (both sharing the same `chrome-extension://` origin), no assets are exposed in `web_accessible_resources`. This prevents other websites from detecting or requesting the extension's packaged assets, securing the extension against fingerprinting and cross-site resource access.

---

## Local Asset Storage & Bundle Impact

All Tesseract JS, WASM, and language assets are stored locally under the `public/tesseract/` directory:

- **Library Core**: `public/tesseract/tesseract.esm.min.js` (67 kB)
- **Web Worker**: `public/tesseract/worker.min.js` (124 kB)
- **WASM Core**:
  - Standard: `tesseract-core.wasm.js` (4.73 MB) & `tesseract-core.wasm` (3.46 MB)
  - SIMD (optimized for modern Chrome): `tesseract-core-simd.wasm.js` (4.74 MB) & `tesseract-core-simd.wasm` (3.46 MB)
- **Language Models**: Stored under `public/tesseract/lang/` using optimized `tessdata_fast` weights:
  - English (`eng.traineddata` — 4.11 MB)
  - Japanese (`jpn.traineddata` — 2.47 MB & `jpn_vert.traineddata` — 3.04 MB for vertical text)
  - Korean (`kor.traineddata` — 1.68 MB)
  - Chinese Simplified (`chi_sim.traineddata` — 2.47 MB)

**Total Extension Bundle Size**: Approximately **30.69 MB**.

---

## Worker Lifecycle & Measured Performance

To prevent memory leaks and handle Chrome's aggressive Manifest V3 Service Worker suspension, we spin up and terminate a fresh Tesseract worker on each scan operation. This ensures that no orphaned worker threads or allocated WebAssembly memory heaps persist in the background when MangaLens is idle.

### Benchmarks (Measured in Google Chrome 124)
- **Worker/WASM Initialization**: Takes **500ms to 900ms** on the first run (cold start), and **300ms to 650ms** on subsequent operations.
- **Character Recognition (OCR)**: Typically **80ms to 200ms** per text crop (depending on text density and crop size).
- **Total Scan Delay**: For a typical manga page with 3–5 speech bubbles, the complete scan-to-overlay loop takes **1.2 to 2.2 seconds** (including pixel binarization, region detection, worker initialization, cropping, Tesseract OCR execution, dialogue grouping, and overlay positioning).

---

## Testing Local OCR

### Automated Tests
Run the Vitest suite to verify full-crop binarization, coordinate normalization limits (`x+width <= 1`, `y+height <= 1`), deterministic reading order sorting, bubble separation, empty text validation, and abort/timeout behavior:

```bash
pnpm install --frozen-lockfile
pnpm compile
pnpm test
pnpm build
```

### Manual Steps in Google Chrome
1. Start the capture fixture server:
   ```bash
   pnpm fixture
   ```
2. Build the extension:
   ```bash
   pnpm build
   ```
3. Load the unpacked extension from `.output/chrome-mv3` in Chrome (`chrome://extensions`).
4. Test the fixture page (`http://127.0.0.1:4173/`). Click **Scan Manga Page**, then **Translate Visible Page** (Local OCR).
5. The overlay will load and overlay the text `"VISIBLE PAGE"` exactly on the screen, and the popup status bar will read: `"OCR detected 1 text regions. Translation not enabled yet."`.
