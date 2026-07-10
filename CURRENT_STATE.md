# MangaLens Current State

- **Current milestone:** Milestone 7B — expanded page capture is implemented
  and awaiting review.
- **Completed work:** The strict local DBNet + OCR48px provider, bounded engine
  readiness probe, extension-facing local OCR action, editable page-session
  overlays, contract-flow verification, failure-path coverage, and manual
  Chrome walkthrough are complete.
- **Current branch:** `codex/milestone-7b-expanded-capture`, stacked on
  `codex/milestone-7a-polygon-overlays`.
- **Current PR:** Not yet opened; it will be a draft stacked on PR #11.
- **Latest stable implementation commit:** `d2a8d97` records the 7B capture
  decision on top of the 7A geometry work.
- **Latest CI:** Runs
  [28752811382](https://github.com/MrReverso/mangalens-milestone1/actions/runs/28752811382)
  and
  [28752810444](https://github.com/MrReverso/mangalens-milestone1/actions/runs/28752810444)
  passed both `verify` and `ocr-benchmark-verify` for `7117522`.
- **Active blockers:** PR #9 awaits user merge/review; Docker is unavailable in
  the local environment; DBConvNext has an invalid upstream model mapping.
- **Superseded work:** Draft PR #8 uses a bundled Tesseract/WASM architecture
  and is not the selected Milestone 6 path. It remains untouched.
- **Milestone 7B implementation:** Popup-controlled start/capture/finish/cancel
  session flow. Each capture is a visible viewport crop; metadata validates the
  same detected page and meaningful overlap. Segment PNGs remain only in the
  background session and are assembled locally in memory before the existing
  DBNet + OCR48px pipeline applies editable overlays.
- **Validation:** `pnpm compile`, `pnpm test`, and `pnpm build` pass locally.
- **Exact next task:** Commit and push this branch, open a draft PR stacked on
  PR #11, and manually exercise the long-page workflow against the local
  fixture when the local Docker engine is available.
