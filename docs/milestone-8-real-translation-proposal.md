# Milestone 8 proposal: safe real translation

## Prerequisite and scope

This is a design-only proposal. Start implementation only after the stacked OCR
and capture PRs (#9 through #12) are reviewed, merged, and their local/manual
verification is complete. Milestone 8 translates already-normalized OCR text;
it does not change capture, OCR engines, image handling, or overlay geometry.

## Recommendation

Adopt a **hybrid provider interface with a local-first default**. The extension
continues to call only `http://127.0.0.1` over the existing loopback backend.
The backend selects one explicit provider configured at startup:

1. `local-offline` is the default and uses a locally installed translation
   engine/model. It makes no network request.
2. `remote-development` is disabled by default. It is available only when an
   exact backend environment opt-in selects a reviewed provider and supplies
   its credential outside the extension.

The first implementation slice should ship only the provider contract plus one
deterministic local development adapter or a real locally installed engine if it
can be reproducibly packaged and evaluated. A remote provider is a later,
separately reviewed opt-in adapter—not the default path.

## Option comparison

| Option | Privacy / credentials | Cost / latency | Quality / setup | Permissions / readiness |
| --- | --- | --- | --- | --- |
| Local offline model | Best: no OCR text leaves device; no provider key | No per-request cost; model-dependent latency | Quality varies by language pair; largest local install burden | No Chrome change; strong production default once evaluated |
| Local backend + configured remote provider | OCR text leaves backend only; key stays in backend env | Usage cost and network latency | Often high quality; simple developer setup | No Chrome change; only opt-in after provider/security review |
| Hybrid local-first interface | Local privacy by default; remote is explicit | Local baseline, remote only when selected | Lets adapters compete behind one contract | No Chrome change; best architectural choice |
| Backend-env API-key development mode | Key never enters extension, but text is remote | Provider-specific cost/latency | Easiest experimentation; weakest production story | No Chrome change; development-only and disabled by default |

## Data flow and contract

`content overlay edit state → background operation coordinator → loopback
backend → TranslationProvider → validated translated bubbles → content apply`.

- OCR has already produced trusted, normalized bubble IDs, page ID, reading
  order, source text, and geometry. Translation receives text plus opaque
  request/page/bubble IDs—never images or capture blobs.
- The backend returns a versioned response with the same request ID, page ID,
  and a one-for-one allowlisted list of bubble IDs and translated strings.
- Treat provider output as unknown at the backend boundary, then treat the
  backend response as unknown again at the extension boundary. Each validator
  rejects missing, duplicated, foreign, expired, reordered-if-required, empty,
  or oversized entries before they reach an overlay.
- `operationSequence`, request expiry, and the current page-session edit merge
  rules stay in force. User edits always win over late provider results.

## Provider interface

Define a backend-only `TranslationProvider` with `id`, `execution` (`local` or
`remote`), `isReady()`, and `translate(request, signal)`. The request contains
only contract version, source/target languages, request/page IDs, and bounded
OCR text entries. The response contains provider metadata safe for UI, matching
IDs, and bounded translated text entries. No provider may receive images,
Chrome messages, or extension storage data.

Provider selection is an explicit backend config enum. Reject unknown provider
IDs; never infer or silently fall back to a paid provider. Provider credentials
are read only from backend process environment/secrets, redacted from errors,
and never logged, returned, stored, or sent to Chrome.

The popup must never accept keys or arbitrary provider URLs. It may display only
safe provider identity/execution/readiness metadata returned by loopback health.
The backend may enable a remote adapter only with an exact environment opt-in,
an exact reviewed HTTPS endpoint allowlist, disabled redirects, bounded request
and response sizes, and a documented user-facing remote-execution indication.
The extension itself never gets remote host permission or a direct network path.

## Privacy and safety rules

- Extension network targets remain loopback-only; no host permission changes.
- Never persist or log images, OCR text, translated text, API keys, or requests.
- Keep input/output size, bubble count, timeout, cancellation, redirects, and
  response content-type limits at the backend boundary.
- Remote execution must be visibly identified as remote and require an exact
  opt-in in backend configuration. It is off by default and unavailable without
  configuration; no per-user key entry or implicit fallback exists.
- Keep current-tab memory-only overlays and edits; clear them using existing
  page/session cleanup.

## Safe error codes

`translation-provider-disabled`, `translation-provider-not-configured`,
`translation-provider-unavailable`, `translation-auth-failed`,
`translation-rate-limited`, `translation-timeout`,
`translation-request-too-large`, `translation-response-too-large`,
`translation-invalid-response`, `translation-unsupported-language`, and
`translation-no-output`, `translation-remote-not-approved`, and
`translation-cancelled`.

Map these to friendly popup text. Do not expose URLs, credentials, provider raw
messages, captured text, or stack traces.

## Test plan

- Unit-test strict request/response validators, size bounds, IDs, duplicate and
  missing bubbles, language selection, provider opt-in, and error mapping.
- Contract-test local provider readiness, cancellation, timeout, malformed
  output, double validation, and no-network local mode.
- Contract-test remote opt-in rejection, exact endpoint allowlisting, redirect
  rejection, credential redaction, and the absence of any extension network
  request or host-permission change.
- Integration-test OCR-result-to-translation application, stale-result
  rejection, editable overlay preservation, cancellation, and backend failure.
- Regression-test fully visible and segmented capture paths unchanged; assert
  image bytes never reach translation requests or Chrome messages.
- Add a licensed, human-reviewed multilingual evaluation corpus before making
  quality claims or enabling a production default.

## Manual QA plan

1. Start the local OCR and selected local translation engines; verify loopback
   health identifies both explicit providers and readiness.
2. OCR a fixture page, translate, edit a bubble while a request is active, and
   verify the edit survives completion, hide/show, scroll, and resize.
3. Repeat with the guided long-page capture flow.
4. Stop the translation engine, cancel mid-request, return malformed output,
   and use an unsupported language; confirm only friendly safe errors appear.
5. With remote mode disabled, confirm it cannot be selected. With a reviewed
   development opt-in, confirm UI labels remote execution and no key appears in
   extension storage, DevTools messages, or logs.

## Out of scope

No LLMs, paid provider default, Google Translate/Gemini/OpenAI/DeepL adapter,
accounts, billing, database, deployment, analytics, export/download, image
inpainting, source-image fetching, automatic scrolling, or Chrome permission
expansion.

## Delivery shape

- **Implementation branch:** `codex/milestone-8-real-translation-local-first`
- **Draft PR title:** `[codex] Add MangaLens local-first translation contract`

### Exact implementation checklist

- [ ] Confirm PRs #9–#12 are merged and local OCR manual QA is green.
- [ ] Select and document one reproducible local translation engine/model.
- [ ] Add backend-only versioned translation request/response schemas and safe
  error mapping; do not modify extension permissions.
- [ ] Add explicit provider configuration, readiness health, cancellation, and
  bounded local transport.
- [ ] Wire validated translated text into existing page-session overlays while
  retaining edit precedence and stale-result protection.
- [ ] Add unit, contract, integration, and capture-regression coverage.
- [ ] Run licensed multilingual human review and document limits.
- [ ] Run compile, test, build, Docker/local health, and manual Chrome QA.
- [ ] Open a draft PR; do not merge or enable remote/paid execution by default.
