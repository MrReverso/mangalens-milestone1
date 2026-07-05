# MangaLens Current State

- **Current milestone:** Milestone 7A — OCR geometry fidelity.
- **Completed work:** The strict local DBNet + OCR48px provider, bounded engine
  readiness probe, extension-facing local OCR action, editable page-session
  overlays, contract-flow verification, failure-path coverage, and manual
  Chrome walkthrough are complete.
- **Current branch:** `codex/milestone-7a-polygon-overlays`
- **Current PR:** Not opened yet; this branch is stacked on draft PR #10.
- **Latest stable implementation commit:** `a62c8f3` adds the local OCR
  contract-flow test and manual Chrome fixture walkthrough.
- **Latest CI:** Runs
  [28749181466](https://github.com/MrReverso/mangalens-milestone1/actions/runs/28749181466)
  and
  [28749180522](https://github.com/MrReverso/mangalens-milestone1/actions/runs/28749180522)
  passed both `verify` and `ocr-benchmark-verify` for `a62c8f3`.
- **Active blockers:** PR #9 awaits user merge/review; Docker is unavailable in
  the local environment; DBConvNext has an invalid upstream model mapping.
- **Superseded work:** Draft PR #8 uses a bundled Tesseract/WASM architecture
  and is not the selected Milestone 6 path. It remains untouched.
- **Exact next task:** Preserve normalized DBNet detector quadrilaterals through
  the strict backend contract and use them for safe polygon-aware overlay
  placement, without changing capture scope or adding real translation.
