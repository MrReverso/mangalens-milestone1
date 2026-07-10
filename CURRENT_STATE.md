# MangaLens Current State

- **Current milestone:** Milestone 8 — deterministic local translation preview
  is being added after the landed OCR and capture stack.
- **Completed work:** The strict local DBNet + OCR48px provider, bounded engine
  readiness probe, extension-facing local OCR action, editable page-session
  overlays, contract-flow verification, failure-path coverage, and manual
  Chrome walkthrough are complete.
- **Current branch:** `codex/milestone-8-real-translation-local-first`, based
  on latest `main` after PRs #9–#12.
- **Current PR:** Not yet opened for Milestone 8.
- **Milestone 8 slice:** A backend-only deterministic local translation preview
  runs after OCR. It receives only bubble IDs and OCR text, preserves OCR
  geometry, and safely falls back to OCR text when translation output is
  malformed or unavailable. It has no remote provider, credentials, or storage.
- **Latest implementation commit:** `27c08af`.
- **Validation:** `pnpm install --frozen-lockfile`, `pnpm compile`, `pnpm test`
  (354 tests), and `pnpm build` pass locally.
- **Latest stable implementation commit:** `b67e610` hardens 7B cleanup for
  active-tab changes, tab closure, and failed assembly/backend paths.
- **Latest CI:** PR #12 is clean and mergeable. Both `verify` and
  `ocr-benchmark-verify` passed on 2026-07-10; there are no review comments.
- **Active blockers:** PR #9 awaits user merge/review; Docker is unavailable in
  the local environment; DBConvNext has an invalid upstream model mapping.
- **Superseded work:** Draft PR #8 uses a bundled Tesseract/WASM architecture
  and is not the selected Milestone 6 path. It remains untouched.
- **Milestone 7B implementation:** Popup-controlled start/capture/finish/cancel
  session flow. Each capture is a visible viewport crop; metadata validates the
  same detected page and meaningful overlap. Segment PNGs remain only in the
  background session and are assembled locally in memory before the existing
  DBNet + OCR48px pipeline applies editable overlays.
- **Validation:** `pnpm compile`, `pnpm test` (349 tests), and `pnpm build`
  pass locally.
- **Manual browser check (2026-07-10):** The local fixture loaded at
  `http://127.0.0.1:4173/capture-test.html` and exposes fully visible, partial,
  tall, and nested-reader images. The loopback health endpoint reported the
  expected `ocrProvider: "dbnet-ocr48px"`, but `ocrReady: false` because this
  environment has no `docker` executable for `pnpm dev:ocr-engine`. The only
  available browser target cannot load unpacked Chrome extensions, so the
  Chrome popup/overlay walkthrough (including guided assembly and backend
  unavailable UI) remains pending on a machine with Docker and Chrome.
- **Final 7B audit (2026-07-10):** `pnpm install --frozen-lockfile`,
  `pnpm compile`, `pnpm test` (349 tests), and `pnpm build` passed. The built
  manifest retains only `storage`, `activeTab`, and `scripting`, with the
  existing loopback backend host permission. Static inspection found no source
  image fetching, automatic scrolling, raw-image/OCR-text logging, or image/OCR
  persistence. Full manual OCR confirmation remains blocked by missing Docker
  and an unavailable unpacked-extension Chrome target.
- **Exact next task:** Run final verification, open the Milestone 8 draft PR,
  then manually confirm translated-preview, OCR fallback, edits, and long-page
  behavior on a machine with Docker and Chrome.
