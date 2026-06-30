import type { IncomingMessage, ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { parseMultipart } from "./multipart";
import { validateTranslationApiRequestMetadata } from "../../types/translation-api";
import type { TargetLanguage } from "../../types/extension";

const DEMO_TEXT: Record<TargetLanguage, readonly [string, string, string]> = {
  en: ["We finally made it.", "Stay alert.", "This is only the beginning."],
  es: ["Por fin llegamos.", "Mantente alerta.", "Esto es solo el comienzo."],
  pt: ["Finalmente chegamos.", "Fique alerta.", "Isto é apenas o começo."],
  fr: ["Nous y sommes enfin.", "Reste sur tes gardes.", "Ce n’est que le début."],
  it: ["Ce l’abbiamo finalmente fatta.", "Resta in guardia.", "Questo è solo l’inizio."],
  de: ["Wir haben es endlich geschafft.", "Bleib wachsam.", "Das ist erst der Anfang."],
};

const BOUNDS = [
  { x: 0.08, y: 0.08, width: 0.34, height: 0.13 },
  { x: 0.58, y: 0.24, width: 0.32, height: 0.12 },
  { x: 0.31, y: 0.73, width: 0.38, height: 0.13 },
] as const;

export async function handleTranslationRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = req.url || "";
  const method = req.method || "";

  // 1. Health check endpoint
  if (url === "/health") {
    if (method !== "GET") {
      sendJsonError(res, 405, "method-not-allowed");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "mangalens-development-api",
        contractVersion: 1,
      })
    );
    return;
  }

  // 2. Translation endpoint
  if (url === "/v1/translate") {
    if (method !== "POST") {
      sendJsonError(res, 405, "method-not-allowed");
      return;
    }

    const contentTypeHeader = req.headers["content-type"] || "";
    if (!contentTypeHeader.toLowerCase().includes("multipart/form-data")) {
      sendJsonError(res, 415, "unsupported-media-type");
      return;
    }

    const boundaryMatch = contentTypeHeader.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) {
      sendJsonError(res, 400, "malformed-request");
      return;
    }
    const boundary = boundaryMatch[1];

    // Check Content-Length if available (reject if request is clearly too large)
    const contentLengthHeader = req.headers["content-length"];
    if (contentLengthHeader) {
      const length = parseInt(contentLengthHeader, 10);
      if (Number.isFinite(length) && length > 21 * 1024 * 1024) {
        sendJsonError(res, 413, "payload-too-large");
        return;
      }
    }

    let timeoutTimer: NodeJS.Timeout | null = null;
    let timedOut = false;
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    try {
      await new Promise<void>((resolve, reject) => {
        // Enforce 10s timeout during body parsing
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          reject(new Error("timeout"));
        }, 10000);

        req.on("data", (chunk: Buffer) => {
          if (timedOut) return;
          totalBytes += chunk.length;
          // Reject request body if it exceeds 21 MB limit
          if (totalBytes > 21 * 1024 * 1024) {
            reject(new Error("payload-too-large"));
            return;
          }
          chunks.push(chunk);
        });

        req.on("end", () => {
          if (timedOut) return;
          resolve();
        });

        req.on("error", (err) => {
          reject(err);
        });
      });
    } catch (error: any) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (timedOut) {
        sendJsonError(res, 408, "timeout");
      } else if (error.message === "payload-too-large") {
        sendJsonError(res, 413, "payload-too-large");
      } else {
        sendJsonError(res, 400, "malformed-request");
      }
      return;
    }

    if (timeoutTimer) clearTimeout(timeoutTimer);

    let body = Buffer.concat(chunks);
    let parts = parseMultipart(body, boundary);
    // Erase body reference quickly
    (body as any) = null;

    if (parts.length !== 2) {
      sendJsonError(res, 400, "malformed-request");
      return;
    }

    let metadataPart = parts.find((p) => p.name === "metadata");
    let imagePart = parts.find((p) => p.name === "image");

    if (!metadataPart || !imagePart) {
      sendJsonError(res, 400, "malformed-request");
      return;
    }

    if (metadataPart.filename !== "metadata.json" || imagePart.filename !== "page.png") {
      sendJsonError(res, 400, "malformed-request");
      return;
    }

    if (metadataPart.contentType !== "application/json") {
      sendJsonError(res, 415, "unsupported-media-type");
      return;
    }

    if (imagePart.contentType !== "image/png") {
      sendJsonError(res, 415, "unsupported-media-type");
      return;
    }

    if (metadataPart.data.length > 64 * 1024) {
      sendJsonError(res, 413, "payload-too-large");
      return;
    }

    if (imagePart.data.length === 0) {
      sendJsonError(res, 400, "malformed-request");
      return;
    }

    if (imagePart.data.length > 20 * 1024 * 1024) {
      sendJsonError(res, 413, "payload-too-large");
      return;
    }

    // Validate PNG signature
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (imagePart.data.length < 8 || !imagePart.data.subarray(0, 8).equals(pngHeader)) {
      sendJsonError(res, 400, "malformed-request");
      return;
    }

    let parsedMetadata: any;
    try {
      parsedMetadata = JSON.parse(metadataPart.data.toString("utf8"));
    } catch {
      sendJsonError(res, 400, "malformed-request");
      return;
    }

    const validatedMetadata = validateTranslationApiRequestMetadata(parsedMetadata);
    if (!validatedMetadata) {
      sendJsonError(res, 422, "invalid-contract");
      return;
    }

    if (validatedMetadata.capture.mimeType !== "image/png") {
      sendJsonError(res, 422, "invalid-contract");
      return;
    }

    if (validatedMetadata.capture.byteLength !== imagePart.data.length) {
      sendJsonError(res, 422, "invalid-contract");
      return;
    }

    const targetLang = validatedMetadata.targetLanguage;
    const text = DEMO_TEXT[targetLang] || DEMO_TEXT.en;
    const bubbles = text.map((translatedText, index) => ({
      id: `${validatedMetadata.pageId}-dev-${index + 1}`,
      bounds: BOUNDS[index],
      originalText: `Dev API demo source ${index + 1}`,
      translatedText,
    }));

    // Erase imagePart and parts references quickly
    (parts as any) = null;
    (imagePart as any) = null;

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(
      JSON.stringify({
        contractVersion: 1,
        requestId: validatedMetadata.requestId,
        pageId: validatedMetadata.pageId,
        bubbles,
      })
    );
    return;
  }

  // 3. Fallback for other paths
  sendJsonError(res, 404, "not-found");
}

function sendJsonError(
  res: ServerResponse,
  status: number,
  code: string
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(
    JSON.stringify({
      success: false,
      error: {
        code,
      },
    })
  );
}
