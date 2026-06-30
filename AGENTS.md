# MangaLens Project Instructions

MangaLens is a Chrome Manifest V3 extension developed in incremental milestones.
The React popup sends typed commands; the singleton content controller owns page
sessions and overlays; the background service worker owns browser-level capture.

Run before delivery:

- `pnpm install --frozen-lockfile`
- `pnpm compile`
- `pnpm test`
- `pnpm build`

Keep permissions minimal unless a milestone explicitly changes them. Add no
network requests unless explicitly requested. Never pass DOM elements through
Chrome messages; use typed messages with runtime validation. Preserve existing
tests and behavior. Work on branches, open draft PRs, never commit to `main`,
and never merge automatically.

Keep popup, content-script, and background responsibilities separated. Never use
`innerHTML` or unsafe HTML. Clean up listeners, observers, timers, locks, and
AbortControllers.

Captured image bytes must never cross extension message boundaries. Runtime
validate every backend-style response, apply translation results through
scanner-controller page sessions, and keep local/demo services deterministic.

- Network access must be isolated behind TranslationService implementations.
- Production endpoints require explicit permission and security review.
- Never manually set multipart Content-Type.
- Treat every backend response as unknown until runtime validation.
- Never log or persist captured image payloads.
- Development servers must bind to loopback only.
- Redirects and credentials must remain disabled for translation transport.
- External OCR requests must remain backend-only behind exact allowlisted
  provider endpoint constants.
- Google credentials must use server-side ADC and must never enter extension
  code, messages, storage, or logs.
- Treat OCR provider responses as untrusted; map failures to safe allowlisted
  codes and normalize geometry using trusted MangaLens capture dimensions.
- Never log or persist images or OCR text.
- Real translation requires a separate reviewed milestone.
- Extension permissions must never include Google domains.
