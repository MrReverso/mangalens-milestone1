# MangaLens Current State

- **Current milestone:** Milestone 6A — stable local DBNet + OCR48px backend
  provider contract.
- **Completed work:** Milestone 5 authentic multilingual OCR benchmark,
  documentation, and evidence are complete. DBNet + OCR48px ranked first.
- **Current branch:** `codex/milestone-6-local-ocr-backend`
- **Current PR:** Not opened yet. This branch is stacked on ready PR #9 until
  Milestone 5 is merged.
- **Latest stable commit:** `9aadead9eae3bf00cf9412de590d92fc3d23f7cb`
- **Latest CI:** Run 96 passed both `verify` and `ocr-benchmark-verify`.
- **Active blockers:** PR #9 awaits user merge/review; Docker is unavailable in
  the local environment; DBConvNext has an invalid upstream model mapping.
- **Superseded work:** Draft PR #8 uses a bundled Tesseract/WASM architecture
  and is not the selected Milestone 6 path. It remains untouched.
- **Exact next task:** Implement and test a strict allowlisted local
  `DbnetOcr48pxProvider`, select it as the default development backend provider,
  and keep Google Vision behind exact explicit opt-in.
