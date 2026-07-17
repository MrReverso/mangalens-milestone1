# MangaLens — Local-first manga OCR and translation

MangaLens is a Chrome Manifest V3 prototype for translating manga, manhwa,
webtoon, and comic pages. The extension can detect page images, capture a fully
visible page or user-guided overlapping visible segments, run local OCR, render
translated text as editable overlays, and preserve edits for the current tab
session. The backend supports Google Cloud Vision plus Cloud Translation LLM as
the standard lightweight-device path, as well as an explicitly selected local
DBNet/OCR48px plus TranslateGemma path through Docker and Ollama. No API key is
needed for the local path.

The milestone 9 reader redesign introduces an explicit chapter session and a
reader-first popup. The normal flow prepares the open chapter, reports its
ordered and currently visible page, keeps discovering lazy-loaded pages, and
keeps translation visibility and session cleanup in one place. Normal reader
mode hides numbered diagnostic outlines. Local DBNet/OCR48px + TranslateGemma
remains available unchanged behind
an **Advanced → Local AI processing** opt-in, which is off by default for
devices that are not set up to run Docker and Ollama.

Milestone 5 adds isolated Docker services and a reproducible multilingual
benchmark for local text detection and OCR. It does not add real translation or
a production backend.

The Google Cloud path is an exact server-side opt-in and remains inactive until
deployment credentials are configured. Credentials never enter extension code,
Chrome messages, storage, logs, or this repository.

## Current architecture

- **Chrome extension:** WXT, React, and strict TypeScript on Chrome Manifest V3.
  It owns chapter sessions, page discovery, visible-page capture, editable OCR
  overlays, and reader controls.
- **Optional loopback development backend:** binds to `127.0.0.1:8787`, uses
  local DBNet + OCR48px by default, and owns the post-OCR translation provider.
  The extension never talks directly to OCR or translation engines.
- **Standard cloud engine:** Google Cloud Vision reads page images and Google
  Cloud Translation LLM (`general/translation-llm`) translates bounded OCR text.
  Both calls are backend-only, use server-side Application Default Credentials,
  reject redirects, and runtime-validate bounded provider responses.
- **Local translation engine:** an explicit Ollama opt-in at
  `127.0.0.1:11434` uses an allowlisted TranslateGemma model. Only bounded OCR
  text and opaque bubble IDs reach it; page images never do.
- **Manga Engine:** an isolated Docker service containing the pinned
  manga-image-translator text detectors and OCR implementations.
- **Paddle Engine:** an isolated Docker service using PaddleOCR 2.8.1 and
  PaddlePaddle 2.6.2 with deterministic model-cache preparation.
- **Benchmark Orchestrator:** invokes each pipeline without silent detector
  fallback, scores results against ground-truth polygons and text, and generates
  JSON, HTML, Markdown, and annotated-image evidence.
- **Google Vision comparison fallback:** `MANGALENS_ENABLE_GOOGLE_VISION=true`
  can still pair Vision with a local/preview translator for comparison. The
  standard `google-cloud` selection enables the reviewed cloud OCR + translation
  pair together.

## Milestone 5 pipelines

The benchmark executed:

1. DBNet + OCR48px
2. CTD + manga-ocr for Japanese or PaddleOCR for Korean and English
3. DBConvNext + manga-ocr/PaddleOCR
4. Standalone PaddleOCR detection and recognition

## Benchmark result

GitHub Actions Run 94 completed the genuine benchmark with
`OCR_BENCHMARK_MOCK_DETECTOR=false`.

| Rank | Pipeline | Score | Detection F1 | OCR accuracy | Average time | Runtime failures |
|---:|---|---:|---:|---:|---:|---:|
| 1 | DBNet + OCR48px | 0.927 | 1.000 | 1.000 | 8,645 ms | 0 |
| 2 | CTD + manga-ocr/PaddleOCR | 0.844 | 1.000 | 0.833 | 13,301 ms | 0 |
| 3 | Standalone PaddleOCR | 0.788 | 0.833 | 0.833 | 32,606 ms | 0 |
| 4 | DBConvNext + manga-ocr/PaddleOCR | 0.000 | 0.000 | 0.000 | 19 ms | 6 |

DBNet + OCR48px ranked first on this corpus. DBConvNext could not be evaluated:
the pinned upstream implementation has no valid model URL and fails explicitly
with `InvalidModelMappingException`; the benchmark does not fall back to a
different detector.

The corpus contains only three self-created synthetic CC0 fixtures: one
Japanese manga page, one Korean webtoon page, and one English comic page, with
two known text regions each. These results prove genuine model execution and
provide a reproducible comparison, but they are not sufficient by themselves
for a final production-quality decision. A larger, separately licensed and
human-reviewed corpus is still required.

Detailed benchmark instructions and artifact descriptions are in
[`services/ocr-benchmark/README.md`](services/ocr-benchmark/README.md).

## Verified commands

Extension validation:

```bash
pnpm install --frozen-lockfile
pnpm compile
pnpm test
pnpm build
```

Docker OCR verification:

```bash
docker build --no-cache --progress=plain \
  -t ocr-benchmark-manga-engine \
  -f services/ocr-benchmark/manga_engine/Dockerfile \
  services/ocr-benchmark/manga_engine

docker build --no-cache --progress=plain \
  -t ocr-benchmark-paddle-engine \
  -f services/ocr-benchmark/paddle_engine/Dockerfile \
  services/ocr-benchmark/paddle_engine

docker run --rm --entrypoint python \
  ocr-benchmark-paddle-engine -m pytest -q test_result_parser.py

docker run --rm --entrypoint python \
  ocr-benchmark-paddle-engine verify_paddle_inference.py
```

Genuine multilingual benchmark:

```bash
cd services/ocr-benchmark
docker build -t ocr-benchmark-orchestrator \
  -f orchestrator/Dockerfile orchestrator
OCR_BENCHMARK_MOCK_DETECTOR=false \
  docker compose up -d --no-build --wait manga-engine paddle-engine
docker compose run --rm --no-deps \
  -e OCR_BENCHMARK_MOCK_DETECTOR=false \
  -e OCR_BENCHMARK_INFERENCE_TIMEOUT=900 \
  -e OCR_BENCHMARK_SAMPLE_DIR=/app/samples/benchmark_dataset \
  -e OCR_BENCHMARK_OUTPUT_DIR=/app/results/authentic \
  --entrypoint python benchmark-orchestrator authentic_benchmark.py
docker compose down
```

## Current limitations

- Visible-page cloud translation is wired to the backend provider contract.
  A production backend URL, user authentication, quotas, and billing controls
  are still required before public testing; the current extension transport is
  deliberately loopback-only.
- Larger pages can use **Start Long-Page OCR**. Capture the current visible
  segment, scroll manually with a small overlap, capture the next segment, and
  finish when ready. The extension never auto-scrolls or fetches source images.
  Segment PNGs remain only in background memory and are discarded after finish,
  cancellation, expiry, or failure.
- OCR edits persist only for the current tab session.
- Google Cloud remains disabled until the exact provider selection, project,
  and server-side credentials are configured.
- The real local translation adapter is functional but still needs broader
  multilingual quality evaluation before it can be called production-quality.
  Production deployment, accounts, billing, durable persistence, analytics,
  downloads, and image inpainting are not implemented.

## Milestone 8 local translation

The default backend remains the deterministic no-network preview so local OCR
setup keeps working without another large model. To enable real translation:

```bash
ollama pull translategemma:4b
MANGALENS_TRANSLATION_PROVIDER=ollama pnpm dev:backend
```

The allowlisted `translategemma:12b` and `translategemma:27b` variants may be
selected with `MANGALENS_OLLAMA_MODEL` after pulling them. The 4B model is the
smallest supported default. `GET http://127.0.0.1:8787/health` reports the
translation provider and `translationReady`; a missing or stopped model never
removes usable OCR results.

Ollama requests use only exact loopback endpoints, disable redirects and
credentials, enforce time and response-size bounds, and treat both the Ollama
envelope and generated translation JSON as untrusted. OCR text, translations,
and page images are never logged or persisted.

## Milestone 9 cloud translation

The standard engine uses Google Cloud Vision for document OCR and Google Cloud
Translation LLM for translation. One exact opt-in selects the reviewed pair:

```bash
gcloud auth application-default login
MANGALENS_TRANSLATION_PROVIDER=google-cloud \
MANGALENS_GOOGLE_CLOUD_PROJECT=your-google-cloud-project \
pnpm dev:backend
```

This uses Application Default Credentials; there is no API-key field in the
extension. For production, the backend will use an attached service identity or
secret-managed credential rather than a credential committed to GitHub. The
optional `MANGALENS_GOOGLE_CLOUD_LOCATION` defaults to `us-central1`.

With this configuration, `/health` reports `google-vision` and
`google-translation-llm`. The health request checks whether server credentials
are available without making a paid translation request. Translation errors
preserve validated OCR output as an explicit “translation unavailable” result.

## Milestone 6 local development

Start the winning local Manga Engine in one terminal:

```bash
pnpm dev:ocr-engine
```

Start the loopback backend in another:

```bash
pnpm dev:backend
```

`GET http://127.0.0.1:8787/health` reports the configured provider and an
`ocrReady` boolean based on a bounded Manga Engine readiness probe. OCR requests
use only the exact allowlisted `127.0.0.1:8002` detector and recognizer
endpoints. Redirects, credentials, arbitrary endpoints, and unvalidated engine
responses are rejected.

Validated horizontal/vertical detector direction is preserved through the
backend contract. Vertical OCR regions render with vertical writing geometry
while retaining the same safe textarea editing behavior. Validated detector
quadrilaterals remain normalized and clip overlays to the detected text shape;
axis-aligned bounds still provide stable sizing and editing coordinates.
Regions use deterministic Japanese right-to-left/vertical or webtoon
top-to-bottom ordering, and font size responds to bubble dimensions and edited
text density.

Google Vision remains disabled by default. Setting the exact value
`MANGALENS_ENABLE_GOOGLE_VISION=true` explicitly selects the remote development
fallback instead of the local provider.

### Manual Chrome walkthrough

1. Run `pnpm fixture`, then open `http://127.0.0.1:4173/capture-test.html`.
2. Run `pnpm dev:ocr-engine` and wait for Manga Engine to become healthy.
3. Optionally pull TranslateGemma as shown above, then run `pnpm dev:backend`
   with `MANGALENS_TRANSLATION_PROVIDER=ollama`. Verify `/health` has
   `"ocrProvider":"dbnet-ocr48px"`, `"ocrReady":true`, and
   `"translationReady":true`.
4. Run `pnpm build`, open `chrome://extensions`, enable Developer mode, and
   load `.output/chrome-mv3` as an unpacked extension.
5. In the fixture tab, choose **Prepare this chapter**, open **Advanced**, and
   explicitly enable **Local AI processing**. Ensure one complete page is
   visible, then choose **Translate visible page locally**.
6. Confirm OCR bubbles appear over the page, can be edited, and retain edits
   after hiding/showing overlays and scrolling the nested reader.
7. Stop Manga Engine and retry to confirm the popup reports a friendly local
   OCR failure without exposing raw errors.
8. For a page taller than the viewport, choose **Long-page fallback**, capture
   a segment, manually scroll with overlap, capture another segment, then choose
   **Finish Long-Page OCR**. Confirm bubbles are still editable and that cancel
   clears the session without retaining images.

The fixture uses only local synthetic SVG pages. Its text and layout are useful
for transport, positioning, and cleanup checks, not for judging OCR accuracy.
