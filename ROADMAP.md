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

## Milestone 8 — local-first translation foundation

- [x] Add a backend-owned translation provider after OCR.
  - The deterministic local preview has no network or credentials and validates
    the post-OCR pipeline.
- [x] Add an explicit real local provider using an exact loopback-only Ollama
  contract and allowlisted TranslateGemma models.
  - Preserve OCR geometry and fall back to OCR text on missing, timed-out, or
    malformed local-model output.
  - Keep provider/model identity and readiness explicit without extension-side
    credentials or new permissions.
- [ ] Complete manual Chrome QA and a broader licensed multilingual quality
  evaluation before calling the local model production-ready.
- [ ] Remote/paid providers remain separate explicit opt-ins after review.
- [ ] Do not add accounts, billing, deployment, or paid providers without an
  explicit product decision.

## Known blockers

- DBConvNext cannot be evaluated until its pinned upstream model mapping has a
  valid reviewed model URL.
- The current three-page synthetic benchmark is too small for a final
  production-quality model decision.
- Manual end-to-end OCR and real local translation QA still requires Docker,
  Ollama, and an unpacked-extension-capable Chrome session.

## Milestone 9 — chapter reader redesign

- [x] Add an explicit per-tab chapter reader session with validated start,
  status, and stop commands.
- [x] Replace the development-heavy default popup with chapter discovery,
  target language, visibility, and session controls.
- [x] Preserve DBNet/OCR48px, Ollama/TranslateGemma, expanded capture, and
  diagnostics behind an Advanced section.
- [x] Keep local AI inactive by default and require an explicit persisted
  device opt-in.
- [ ] Add viewport-priority orchestration for real translation across the
  chapter while keeping bounded concurrency and cancellation.
- [ ] Improve bubble masking/typography before evaluating local inpainting.
- [ ] A standard remote engine remains a separate explicit provider, privacy,
  permission, retention, and security decision.
