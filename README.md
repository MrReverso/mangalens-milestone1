# MangaLens — Milestone 5 OCR Benchmark

MangaLens is a Chrome Manifest V3 prototype for testing manga, manhwa, webtoon,
and comic OCR experiences. The extension can detect page images, capture a fully
visible page, render OCR text as editable overlays, and preserve edits for the
current tab session.

Milestone 5 adds isolated Docker services and a reproducible multilingual
benchmark for local text detection and OCR. It does not add real translation or
a production backend.

Google Cloud Vision remains available only as an explicitly enabled development
comparison and difficult-page fallback. It is disabled by default, requires the
exact `MANGALENS_ENABLE_GOOGLE_VISION=true` opt-in, and is not the preferred
local-first production architecture.

## Current architecture

- **Chrome extension:** WXT, React, and strict TypeScript on Chrome Manifest V3.
  It owns page scanning, visible-page capture, editable OCR overlays, and popup
  controls.
- **Optional loopback development backend:** binds to `127.0.0.1:8787` and
  exposes the development OCR contract. On the Milestone 6 branch it uses the
  local DBNet + OCR48px provider by default. It is not a production deployment.
- **Manga Engine:** an isolated Docker service containing the pinned
  manga-image-translator text detectors and OCR implementations.
- **Paddle Engine:** an isolated Docker service using PaddleOCR 2.8.1 and
  PaddlePaddle 2.6.2 with deterministic model-cache preparation.
- **Benchmark Orchestrator:** invokes each pipeline without silent detector
  fallback, scores results against ground-truth polygons and text, and generates
  JSON, HTML, Markdown, and annotated-image evidence.
- **Google Vision development fallback:** an explicitly paid-provider opt-in
  used for comparison only. Credentials remain server-side and the extension
  has no Google host permissions.

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

- Only a fully visible detected page can be captured; there is no page
  stitching or automatic scrolling.
- OCR edits persist only for the current tab session.
- Google Vision is a development-only comparison and remains disabled by
  default.
- Real translation, production deployment, accounts, billing, durable
  persistence, analytics, downloads, and image inpainting are not implemented.

## Next milestone

Milestone 7 will improve capture and OCR placement quality, beginning with
polygon-aware overlays, vertical-text geometry, reading order, and responsive
text fitting. Expanding capture beyond one fully visible page requires a
separate careful design because MangaLens must not scroll or alter reader pages
destructively. Real translation remains a separate, later reviewed milestone.

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
while retaining the same safe textarea editing behavior.

Google Vision remains disabled by default. Setting the exact value
`MANGALENS_ENABLE_GOOGLE_VISION=true` explicitly selects the remote development
fallback instead of the local provider.

### Manual Chrome walkthrough

1. Run `pnpm fixture`, then open `http://127.0.0.1:4173/capture-test.html`.
2. Run `pnpm dev:ocr-engine` and wait for Manga Engine to become healthy.
3. Run `pnpm dev:backend`; verify its `/health` response has
   `"ocrProvider":"dbnet-ocr48px"` and `"ocrReady":true`.
4. Run `pnpm build`, open `chrome://extensions`, enable Developer mode, and
   load `.output/chrome-mv3` as an unpacked extension.
5. In the fixture tab, choose **Scan Manga Page**, ensure one complete page is
   visible, then choose **Run Local OCR**.
6. Confirm OCR bubbles appear over the page, can be edited, and retain edits
   after hiding/showing overlays and scrolling the nested reader.
7. Stop Manga Engine and retry to confirm the popup reports a friendly local
   OCR failure without exposing raw errors.

The fixture uses only local synthetic SVG pages. Its text and layout are useful
for transport, positioning, and cleanup checks, not for judging OCR accuracy.
