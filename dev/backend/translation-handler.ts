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
  const start = Date.now();
  const url = req.url || "";
  const pathname = url.split("?")[0];
  const method = req.method || "";

  // 1. Health check endpoint
  if (pathname === "/health") {
    if (method !== "GET") {
      sendJsonError(res, 405, "method-not-allowed");
      logRequest(method, pathname, 405, Date.now() - start);
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
    logRequest(method, pathname, 200, Date.now() - start);
    return;
  }

  // 2. Translation endpoint
  if (pathname === "/v1/translate") {
    if (method !== "POST") {
      sendJsonError(res, 405, "method-not-allowed");
      logRequest(method, pathname, 405, Date.now() - start);
      return;
    }

    const contentTypeHeader = req.headers["content-type"] || "";
    const parsedContentType = parseMultipartContentType(contentTypeHeader);
    if (!parsedContentType) {
      sendJsonError(res, 415, "unsupported-media-type");
      logRequest(method, pathname, 415, Date.now() - start);
      return;
    }
    const { boundary } = parsedContentType;

    const contentLengthHeader = req.headers["content-length"];
    if (contentLengthHeader) {
      const length = parseInt(contentLengthHeader, 10);
      if (Number.isFinite(length) && length > 21 * 1024 * 1024) {
        sendJsonError(res, 413, "payload-too-large");
        logRequest(method, pathname, 413, Date.now() - start);
        return;
      }
    }

    let settled = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let chunks: Buffer[] | null = [];
    let totalBytes = 0;

    const cleanup = () => {
      settled = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      chunks = null;
      req.removeAllListeners("data");
      req.removeAllListeners("end");
      req.removeAllListeners("error");
      req.removeAllListeners("aborted");
    };

    const bodyPromise = new Promise<Buffer>((resolve, reject) => {
      timeoutTimer = setTimeout(() => {
        if (settled) return;
        reject(new Error("timeout"));
      }, 10000);

      req.on("data", (chunk: Buffer) => {
        if (settled) return;
        totalBytes += chunk.length;
        if (totalBytes > 21 * 1024 * 1024) {
          reject(new Error("payload-too-large"));
          return;
        }
        chunks?.push(chunk);
      });

      req.on("end", () => {
        if (settled) return;
        if (chunks) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error("aborted"));
        }
      });

      req.on("error", (err: unknown) => {
        if (settled) return;
        reject(err);
      });

      req.on("aborted", () => {
        if (settled) return;
        reject(new Error("aborted"));
      });
    });

    let body: Buffer;
    try {
      body = await bodyPromise;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "";
      cleanup();

      let status = 400;
      let code = "malformed-request";

      if (errMsg === "timeout") {
        status = 408;
        code = "timeout";
      } else if (errMsg === "payload-too-large") {
        status = 413;
        code = "payload-too-large";
      }

      sendJsonError(res, status, code);
      logRequest(method, pathname, status, Date.now() - start);
      return;
    }

    cleanup();

    const parts = parseMultipart(body, boundary);
    // Erase body reference immediately
    (body as any) = null;

    if (parts.length !== 2) {
      sendJsonError(res, 400, "malformed-request");
      logRequest(method, pathname, 400, Date.now() - start);
      return;
    }

    const metadataPart = parts.find((p) => p.name === "metadata");
    const imagePart = parts.find((p) => p.name === "image");

    if (!metadataPart || !imagePart) {
      sendJsonError(res, 400, "malformed-request");
      logRequest(method, pathname, 400, Date.now() - start);
      return;
    }

    if (metadataPart.filename !== "metadata.json" || imagePart.filename !== "page.png") {
      sendJsonError(res, 400, "malformed-request");
      logRequest(method, pathname, 400, Date.now() - start);
      return;
    }

    if (metadataPart.contentType !== "application/json") {
      sendJsonError(res, 415, "unsupported-media-type");
      logRequest(method, pathname, 415, Date.now() - start);
      return;
    }

    if (imagePart.contentType !== "image/png") {
      sendJsonError(res, 415, "unsupported-media-type");
      logRequest(method, pathname, 415, Date.now() - start);
      return;
    }

    if (metadataPart.data.length > 64 * 1024) {
      sendJsonError(res, 413, "payload-too-large");
      logRequest(method, pathname, 413, Date.now() - start);
      return;
    }

    if (imagePart.data.length === 0) {
      sendJsonError(res, 400, "malformed-request");
      logRequest(method, pathname, 400, Date.now() - start);
      return;
    }

    if (imagePart.data.length > 20 * 1024 * 1024) {
      sendJsonError(res, 413, "payload-too-large");
      logRequest(method, pathname, 413, Date.now() - start);
      return;
    }

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (imagePart.data.length < 8 || !imagePart.data.subarray(0, 8).equals(pngHeader)) {
      sendJsonError(res, 400, "malformed-request");
      logRequest(method, pathname, 400, Date.now() - start);
      return;
    }

    let parsedMetadata: any;
    try {
      parsedMetadata = JSON.parse(metadataPart.data.toString("utf8"));
    } catch {
      sendJsonError(res, 400, "malformed-request");
      logRequest(method, pathname, 400, Date.now() - start);
      return;
    }

    const validatedMetadata = validateTranslationApiRequestMetadata(parsedMetadata);
    if (!validatedMetadata) {
      sendJsonError(res, 422, "invalid-contract");
      logRequest(method, pathname, 422, Date.now() - start);
      return;
    }

    if (validatedMetadata.capture.mimeType !== "image/png") {
      sendJsonError(res, 422, "invalid-contract");
      logRequest(method, pathname, 422, Date.now() - start);
      return;
    }

    if (validatedMetadata.capture.byteLength !== imagePart.data.length) {
      sendJsonError(res, 422, "invalid-contract");
      logRequest(method, pathname, 422, Date.now() - start);
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

    logRequest(method, pathname, 200, Date.now() - start);
    return;
  }

  // 3. Fallback for other paths
  sendJsonError(res, 404, "not-found");
  logRequest(method, pathname, 404, Date.now() - start);
}

export function parseMultipartContentType(header: string): { boundary: string } | null {
  const parts = header.split(";").map((s) => s.trim());
  if (parts.length < 2) return null;

  const mediaType = parts[0].toLowerCase();
  if (mediaType !== "multipart/form-data") {
    return null;
  }

  let boundary: string | null = null;
  let boundaryCount = 0;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const match = part.match(/^boundary\s*=\s*(.+)$/i);
    if (match) {
      boundaryCount++;
      if (boundaryCount > 1) {
        return null;
      }
      let val = match[1].trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).trim();
      }
      boundary = val;
    } else {
      const lowerPart = part.toLowerCase();
      if (lowerPart.startsWith("boundary")) {
        return null;
      }
    }
  }

  if (!boundary || boundary.length === 0) {
    return null;
  }

  if (boundary.length > 70) {
    return null;
  }

  if (!/^[a-zA-Z0-9'()+,\-./:=? ]+$/.test(boundary)) {
    return null;
  }

  return { boundary };
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

function logRequest(
  method: string,
  pathname: string,
  status: number,
  durationMs: number
): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${method} ${pathname} ${status} - ${durationMs.toFixed(0)}ms`);
}
