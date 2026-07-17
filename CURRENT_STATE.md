# MangaLens Current State

- **Current milestone:** Milestone 9 — chapter reader redesign.
- **Current branch:** `codex/milestone-9-chapter-reader-redesign`, based on the
  completed milestone 8 local-first translation branch.
- **Reader slice:** The popup now starts and restores an explicit per-tab
  chapter session, reports the detected chapter/title/current page, follows
  lazy-loaded page changes, and treats visibility and cleanup as reader
  controls rather than developer operations. Numbered detection outlines are
  hidden during normal reader mode and remain available to diagnostics.
- **Local AI preservation:** DBNet/OCR48px, Ollama/TranslateGemma, long-page
  capture, deterministic preview, and diagnostics remain intact under
  Advanced. Local AI is inactive by default and requires an explicit persisted
  device opt-in.
- **Standard cloud slice:** The normal reader action now targets a backend-owned
  Google Cloud pair: Vision document OCR plus Cloud Translation LLM
  (`general/translation-llm`). The selection requires the exact
  `google-cloud` opt-in and a validated project ID. Access tokens come only from
  server-side Application Default Credentials; Google endpoints and credentials
  do not enter extension code, messages, storage, or logs.
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
  backend health. No API key, new Chrome permission, image input to the local
  translator, text/image logging, or persistence is added.
- **Safe failure:** Missing models, local-engine failures, timeouts, malformed
  translations, duplicate/foreign IDs, and oversized output leave validated
  OCR text and geometry available to editable overlays.
- **Local validation:** `pnpm install --frozen-lockfile`, `pnpm compile`, all
  375 tests, and `pnpm build` pass for the current cloud-provider slice.
  Loopback health reports the deterministic
  provider ready by default and the Ollama provider safely not ready when its
  local process/model is absent. The built manifest still has only `storage`,
  `activeTab`, and `scripting` plus the existing `127.0.0.1:8787` host access.
- **Milestone 8 implementation commit:** `60e6920` adds the real local
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
- **Exact next task:** Add deployable authenticated backend transport and
  viewport-priority chapter orchestration, then complete manual Chrome QA for
  both cloud and local paths.
