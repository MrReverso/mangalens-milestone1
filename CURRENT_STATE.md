# MangaLens Current State

- **Current milestone:** Milestone 7A — OCR geometry fidelity is complete.
- **Completed work:** The strict local DBNet + OCR48px provider, bounded engine
  readiness probe, extension-facing local OCR action, editable page-session
  overlays, contract-flow verification, failure-path coverage, and manual
  Chrome walkthrough are complete.
- **Current branch:** `codex/milestone-7a-polygon-overlays`
- **Current PR:** Draft PR #11, stacked on draft PR #10.
- **Latest stable implementation commit:** `4e025c2` preserves detector
  quadrilaterals and vertical writing through the strict overlay contract.
- **Latest CI:** Runs
  [28752393287](https://github.com/MrReverso/mangalens-milestone1/actions/runs/28752393287)
  and
  [28752392228](https://github.com/MrReverso/mangalens-milestone1/actions/runs/28752392228)
  passed both `verify` and `ocr-benchmark-verify` for `4e025c2`.
- **Active blockers:** PR #9 awaits user merge/review; Docker is unavailable in
  the local environment; DBConvNext has an invalid upstream model mapping.
- **Superseded work:** Draft PR #8 uses a bundled Tesseract/WASM architecture
  and is not the selected Milestone 6 path. It remains untouched.
- **Exact next task:** Validate the completed reading-order and responsive
  text-fitting checkpoint in CI, then scope Milestone 7B capture expansion
  without automatic destructive scrolling.
