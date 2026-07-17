import { createServer } from "node:http";
import { createTranslationRequestHandler } from "./translation-handler";
import {
  AdcGoogleAccessTokenProvider,
  installSafeGoogleAuthWarningFilter,
} from "./ocr/google-access-token-provider";
import {
  GOOGLE_VISION_ANNOTATE_ENDPOINT,
  GoogleVisionOcrProvider,
  MAX_GOOGLE_RESPONSE_BYTES,
} from "./ocr/google-vision-ocr-provider";
import { DbnetOcr48pxProvider } from "./ocr/dbnet-ocr48px-provider";
import { createConfiguredTranslationProvider } from "./translation/translation-provider-config";
import {
  OptionalOcrProvider,
  isGoogleVisionExplicitlyEnabled,
} from "./ocr/optional-ocr-provider";

const PORT = 8787;
const HOST = "127.0.0.1";
installSafeGoogleAuthWarningFilter();
const googleAccessTokenProvider = new AdcGoogleAccessTokenProvider();
const googleCloudEnabled = process.env.MANGALENS_TRANSLATION_PROVIDER === "google-cloud";
const googleVisionEnabled = googleCloudEnabled || isGoogleVisionExplicitlyEnabled(
  process.env.MANGALENS_ENABLE_GOOGLE_VISION
);
const handleTranslationRequest = createTranslationRequestHandler({
  ocrProvider: googleVisionEnabled
    ? new OptionalOcrProvider(
      new GoogleVisionOcrProvider(
        googleAccessTokenProvider,
        fetch,
        GOOGLE_VISION_ANNOTATE_ENDPOINT,
        MAX_GOOGLE_RESPONSE_BYTES,
        googleCloudEnabled
          ? process.env.MANGALENS_GOOGLE_CLOUD_PROJECT
          : undefined
      ),
      true
    )
    : new DbnetOcr48pxProvider(),
  translationProvider: createConfiguredTranslationProvider(
    process.env,
    fetch,
    googleAccessTokenProvider
  ),
});

const server = createServer((req, res) => {
  const timestamp = new Date().toISOString();
  const pathname = (req.url || "").split("?")[0];
  const method = req.method || "";

  try {
    handleTranslationRequest(req, res).catch(() => {
      console.error(`[${timestamp}] ${method} ${pathname} 500 - Request failed`);
      if (!res.writableEnded) {
        res.writeHead(500, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(JSON.stringify({ success: false, error: { code: "internal-server-error" } }));
      }
    });
  } catch {
    console.error(`[${timestamp}] ${method} ${pathname} 500 - Server exception`);
    if (!res.writableEnded) {
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify({ success: false, error: { code: "internal-server-error" } }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MangaLens development API listening on http://${HOST}:${PORT}`);
});
