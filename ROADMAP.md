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
- [x] **6D: End-to-end verification**
  - Test capture → loopback backend → DBNet/OCR48px → normalized bubbles.
  - Cover cancellation, timeout, unavailable engine, malformed responses,
    cleanup, and Google fallback opt-in.
  - Add a manual Chrome fixture walkthrough.

## Milestone 7 — capture and placement quality

- [x] **7A: OCR geometry fidelity**
  - [x] Preserve validated detector direction through OCR and render vertical
    text with vertical writing geometry.
  - [x] Preserve normalized detector quadrilaterals and apply safe
    polygon-aware bubble placement.
  - [x] Improve deterministic reading order and responsive text fitting.
- [x] **7B: Expanded page capture**
  - User-guided overlapping visible segments, strict page/overlap validation,
    and background-only ephemeral local assembly.
  - No automatic scrolling, source-image fetching, persistent image storage, or
    new Chrome permissions; the existing fully visible-page path remains intact.
  - Segment/session cleanup covers cancellation, expiry, active-tab changes,
    backend failures, and service-worker memory loss.
- [ ] Evaluate on a larger separately licensed and human-reviewed corpus.

## Later milestone — real translation

- [ ] **Milestone 8: local-first real translation**
  - Design proposal: `docs/milestone-8-real-translation-proposal.md`.
  - Prerequisite: PRs #9–#12 merged/reviewed and local OCR/expanded-capture
    manual QA complete.
  - Local offline translation is the default; any remote/paid provider is a
    backend-only, explicit opt-in after separate review.
- [ ] Do not add accounts, billing, deployment, or paid providers without an
  explicit product decision.

## Known blockers

- DBConvNext cannot be evaluated until its pinned upstream model mapping has a
  valid reviewed model URL.
- The current three-page synthetic benchmark is too small for a final
  production-quality model decision.
- Milestone 5 PR #9 is ready and green but remains unmerged pending user review.
