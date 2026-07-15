# MangaLens Current State

- **Current milestone:** Milestone 8 — real local translation after OCR.
- **Current branch:** `codex/milestone-8-real-translation-local-first`, based on
  `main` after merged PRs #9–#12.
- **Current PR:** Draft PR #14, `[codex] Add MangaLens milestone 8 local-first
  translation pipeline`, targets `main` and is mergeable.
- **Landed product stack:** local DBNet + OCR48px, editable geometry-preserving
  horizontal/vertical polygon overlays, and guided overlapping long-page
  capture with background-only ephemeral image assembly.
- **Milestone 8 foundation:** The backend-owned deterministic preview runs after
  OCR, receives only bubble IDs and OCR text, preserves geometry, and safely
  falls back to OCR text on invalid output.
- **Real local translation:** An explicit
  `MANGALENS_TRANSLATION_PROVIDER=ollama` mode uses only
  `127.0.0.1:11434`, accepts the allowlisted TranslateGemma 4B/12B/27B models,
  validates the Ollama envelope and generated JSON, and reports readiness in
  backend health. No API key, remote provider, new Chrome permission, image
  input, text/image logging, or persistence is added.
- **Safe failure:** Missing models, local-engine failures, timeouts, malformed
  translations, duplicate/foreign IDs, and oversized output leave validated
  OCR text and geometry available to editable overlays.
- **Local validation:** `pnpm install --frozen-lockfile`, `pnpm compile`, all
  360 tests, and `pnpm build` pass. Loopback health reports the deterministic
  provider ready by default and the Ollama provider safely not ready when its
  local process/model is absent. The built manifest still has only `storage`,
  `activeTab`, and `scripting` plus the existing `127.0.0.1:8787` host access.
- **Latest implementation commit:** `60e6920` adds the real local
  TranslateGemma provider, explicit configuration, readiness, safe fallback,
  UI status, tests, and setup documentation.
- **Latest CI:** Both push and pull-request `verify` jobs and both genuine
  Docker `ocr-benchmark-verify` jobs passed for `60e6920` on 2026-07-15.
- **Manual QA status:** Docker and Ollama executables are unavailable in this
  environment, and the available browser target cannot load an unpacked Chrome
  extension. Full DBNet → TranslateGemma → overlay QA remains pending on a
  machine with Docker, Ollama, and Chrome.
- **Known research limits:** DBConvNext still has an invalid upstream model
  mapping, and both OCR and translation need a larger separately licensed,
  human-reviewed multilingual corpus before production-quality claims.
- **Exact next task:** Complete manual Chrome QA with Docker, Ollama,
  `translategemma:4b`, and the unpacked extension; fix only confirmed issues,
  then move PR #14 from draft to human review.
