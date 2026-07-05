import { createServer } from "node:http";
import { createTranslationRequestHandler } from "./translation-handler";
import {
  AdcGoogleAccessTokenProvider,
  installSafeGoogleAuthWarningFilter,
} from "./ocr/google-access-token-provider";
import { GoogleVisionOcrProvider } from "./ocr/google-vision-ocr-provider";
import { DbnetOcr48pxProvider } from "./ocr/dbnet-ocr48px-provider";
import {
  OptionalOcrProvider,
  isGoogleVisionExplicitlyEnabled,
} from "./ocr/optional-ocr-provider";

const PORT = 8787;
const HOST = "127.0.0.1";
installSafeGoogleAuthWarningFilter();
const googleVisionEnabled = isGoogleVisionExplicitlyEnabled(
  process.env.MANGALENS_ENABLE_GOOGLE_VISION
);
const handleTranslationRequest = createTranslationRequestHandler({
  ocrProvider: googleVisionEnabled
    ? new OptionalOcrProvider(
      new GoogleVisionOcrProvider(new AdcGoogleAccessTokenProvider()),
      true
    )
    : new DbnetOcr48pxProvider(),
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
