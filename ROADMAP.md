# MangaLens Roadmap

The roadmap prioritizes the shortest safe path from the current prototype to a
usable local-first OCR MVP. Milestones remain reviewable and are never merged or
deployed automatically.

## Completed

- [x] Milestones 1–4: page scanning, capture, mock overlays, editing, typed
  loopback transport, and explicitly enabled Google Vision development OCR.
- [x] Milestone 5: isolated OCR benchmark services, three CC0 multilingual
  fixtures, genuine detector execution, evidence artifacts, and a reviewed
  recommendation of DBNet + OCR48px.

## Milestone 6 — local DBNet + OCR48px MVP

- [x] **6A: Stable backend provider contract**
  - Add a strict local provider for the allowlisted loopback Manga Engine.
  - Validate detector/OCR responses at runtime and normalize trusted geometry.
  - Preserve cancellation, bounded response sizes, structured errors, and safe
    provider metadata.
  - Keep Google Vision disabled by default and explicitly selectable.
- [x] **6B: Local service readiness**
  - Add meaningful health/readiness checks for the backend and Manga Engine.
  - Document and script the local Docker startup path without new Chrome
    permissions.
- [x] **6C: Extension integration**
  - Make the existing OCR action use the local provider by default.
  - Preserve editable overlays, current-tab edits, operation sequencing, and
    friendly structured errors.
- [ ] **6D: End-to-end verification**
  - Test capture → loopback backend → DBNet/OCR48px → normalized bubbles.
  - Cover cancellation, timeout, unavailable engine, malformed responses,
    cleanup, and Google fallback opt-in.
  - Add a manual Chrome fixture walkthrough.

## Milestone 7 — capture and placement quality

- [ ] Expand capture beyond one fully visible page without automatic destructive
  page interaction.
- [ ] Improve polygon-to-overlay placement, vertical text, reading order, and
  responsive text fitting.
- [ ] Evaluate on a larger separately licensed and human-reviewed corpus.

## Later milestone — real translation

- [ ] Define and review a separate real-translation architecture only after the
  local OCR MVP is stable.
- [ ] Do not add accounts, billing, deployment, or paid providers without an
  explicit product decision.

## Known blockers

- DBConvNext cannot be evaluated until its pinned upstream model mapping has a
  valid reviewed model URL.
- The current three-page synthetic benchmark is too small for a final
  production-quality model decision.
- Milestone 5 PR #9 is ready and green but remains unmerged pending user review.
