# MangaLens Current State

- **Current milestone:** Milestone 7A — OCR geometry fidelity is complete.
- **Completed work:** The strict local DBNet + OCR48px provider, bounded engine
  readiness probe, extension-facing local OCR action, editable page-session
  overlays, contract-flow verification, failure-path coverage, and manual
  Chrome walkthrough are complete.
- **Current branch:** `codex/milestone-7a-polygon-overlays`
- **Current PR:** Draft PR #11, stacked on draft PR #10.
- **Latest stable implementation commit:** `7117522` completes deterministic
  reading order and edit-aware responsive text fitting.
- **Latest CI:** Runs
  [28752811382](https://github.com/MrReverso/mangalens-milestone1/actions/runs/28752811382)
  and
  [28752810444](https://github.com/MrReverso/mangalens-milestone1/actions/runs/28752810444)
  passed both `verify` and `ocr-benchmark-verify` for `7117522`.
- **Active blockers:** PR #9 awaits user merge/review; Docker is unavailable in
  the local environment; DBConvNext has an invalid upstream model mapping.
- **Superseded work:** Draft PR #8 uses a bundled Tesseract/WASM architecture
  and is not the selected Milestone 6 path. It remains untouched.
- **Decision needed:** Milestone 7B requires choosing how to capture pages
  larger than the viewport. The recommended path is user-guided overlapping
  segments with ephemeral local assembly; automatic scrolling/stitching and
  broader permissions/source fetching have materially different interaction
  and privacy trade-offs.
- **Exact next task:** After that capture-model decision, create a new Milestone
  7B branch and implement the smallest reviewed vertical-page capture slice.
