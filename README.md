# MangaLens — Milestone 4B: Google Vision OCR Preview

MangaLens is a Chrome Manifest V3 prototype for manga, manhwa, and webtoon
translation experiences. Milestone 4B adds Google Cloud Vision as an optional
development benchmark and future fallback for difficult pages. It is not the
final local-first OCR architecture, and it does not translate detected text.

## What Milestone 4B adds

- **OCR via Dev API** captures one fully visible detected page and, only after
  explicit paid-provider opt-in, sends the cropped PNG to the loopback backend.
- The backend authenticates with Google Application Default Credentials (ADC)
  and calls exactly
  `https://vision.googleapis.com/v1/images:annotate`.
- Google Vision runs only `DOCUMENT_TEXT_DETECTION`.
- Paragraph symbols are reconstructed into text, and paragraph quadrilaterals
  are normalized using MangaLens's trusted captured pixel dimensions.
- Each valid paragraph becomes an editable MangaLens bubble with
  `originalText` and `translatedText` both set to the detected OCR text.
- Provider responses and errors are runtime-validated and reduced to safe,
  allowlisted contracts before returning to the extension.

The popup explicitly reports **Translation not enabled** after a successful OCR
preview.

## Local demo versus OCR preview

- **Translate Visible Page** uses the deterministic in-extension local demo. It
  never contacts the development backend or Google.
- **OCR via Dev API** sends the captured page through
  `http://127.0.0.1:8787/v1/translate` to Google Vision and displays detected
  text without translating it.

Both modes reuse the same capture coordinator, per-tab operation lock, total
deadline, operation sequence, stale-result protection, content application,
and editable overlay system. They cannot overlap in the same tab.

## Privacy boundary

The PNG may travel only through:

```text
extension background
→ http://127.0.0.1:8787/v1/translate
→ https://vision.googleapis.com/v1/images:annotate
```

Images are sent to Google only after the user clicks **OCR via Dev API**.
Captured images and OCR text are held temporarily in memory and are not written
to disk, Chrome storage, a database, logs, analytics, or cache storage. Google
access tokens remain inside the backend process and are never sent to the
extension.

Google Cloud Vision usage may incur charges under the selected Google Cloud
project's billing account.

Google Vision is disabled unless the backend process receives the exact value:

```text
MANGALENS_ENABLE_GOOGLE_VISION=true
```

Missing, differently-cased, whitespace-padded, or alternative truthy values do
not enable it. While disabled, OCR requests return
`ocr-provider-disabled` without authentication or a Google request.

## Google Cloud setup

1. Create or select a Google Cloud project.
2. Enable billing for that project.
3. Enable the Cloud Vision API.
4. Install and initialize the `gcloud` CLI.
5. Create local Application Default Credentials:

   ```bash
   gcloud auth application-default login
   ```

6. If required, set the ADC quota project:

   ```bash
   gcloud auth application-default set-quota-project PROJECT_ID
   ```

7. Install dependencies:

   ```bash
   pnpm install --frozen-lockfile
   ```

8. Start the opt-in backend on macOS or Linux:

   ```bash
   MANGALENS_ENABLE_GOOGLE_VISION=true pnpm dev:backend
   ```

   On Windows PowerShell:

   ```powershell
   $env:MANGALENS_ENABLE_GOOGLE_VISION="true"
   pnpm dev:backend
   ```

9. In another terminal, start the extension:

   ```bash
   pnpm dev
   ```

10. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select `.output/chrome-mv3`.
11. Open a page containing readable Japanese, Korean, Chinese, or other text.
12. Click **Scan Manga Page** and make one detected page fully visible.
13. Click **OCR via Dev API**.
14. Confirm editable OCR regions appear and the popup says translation is not
    enabled.

The backend binds only to `127.0.0.1:8787`. `GET /health` reports only safe,
injected provider metadata: provider ID, local/remote execution, and whether it
is enabled. It never reports credential, account, quota-project, or token state.

## Development commands

```bash
pnpm install --frozen-lockfile
pnpm compile
pnpm test
pnpm build
pnpm dev:backend
pnpm dev
pnpm fixture
```

## Extension permissions

Normal permissions remain exactly:

- `storage`
- `activeTab`
- `scripting`

Host permissions remain exactly:

- `http://127.0.0.1:8787/*`

The extension has no permission for Google domains. `google-auth-library` and
all Google provider files are development-backend-only and are not bundled into
the Chrome output.

## Current limitations

- OCR preview supports only one detected image fully visible in the viewport.
- Pages taller or wider than the viewport are not stitched or automatically
  scrolled.
- OCR quality may vary on stylized manga lettering and low-resolution text.
- Vertical text is not specially reordered.
- Complex manga reading order is not inferred.
- Paragraph rectangles are axis-aligned bounds around Google's quadrilaterals;
  speech bubbles themselves are not detected.
- OCR text is editable for the current tab session only.
- No real translation, AI translation, inpainting, persistence, account,
  billing, analytics, or production backend exists.

The next milestone should benchmark and add local-first OCR while retaining
Google Vision only as an explicitly enabled comparison and difficult-page
fallback. Real translation remains a later, separately reviewed milestone.
