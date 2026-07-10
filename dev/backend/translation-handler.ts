import type { IncomingMessage, ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { parseMultipart } from "./multipart";
import {
  validateTranslationApiRequestMetadata,
  validateTranslationApiSuccessResponse,
} from "../../types/translation-api";
import type { OcrProvider } from "./ocr/ocr-provider";
import { OcrFailure, ocrErrorCode, ocrErrorStatus } from "./ocr/ocr-errors";
import { ocrRegionsToBubbles } from "./ocr/ocr-to-bubbles";
import type { TranslationBubble } from "../../types/translation";
import {
  DeterministicLocalTranslationProvider,
  applyValidatedTranslation,
  type TranslationProvider,
  type TranslationProviderStatus,
} from "./translation/translation-provider";

export interface BackendLogEntry {
  readonly timestamp: string;
  readonly method: string;
  readonly pathname: string;
  readonly status: number;
  readonly durationMs: number;
  readonly errorCode?: string;
}

export interface TranslationHandlerDependencies {
  readonly ocrProvider: OcrProvider;
  readonly translationProvider?: TranslationProvider;
  readonly logger?: (entry: BackendLogEntry) => void;
  readonly now?: () => number;
}

const fallbackProvider: OcrProvider = {
  id: "google-vision",
  execution: "remote",
  enabled: false,
  recognize: async () => {
    throw new OcrFailure("ocr-provider-disabled");
  },
};

export const handleTranslationRequest = createTranslationRequestHandler({
  ocrProvider: fallbackProvider,
});

export function createTranslationRequestHandler(
  dependencies: TranslationHandlerDependencies
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? defaultLogger;
  return (req, res) => handleRequest(
    req, res, dependencies.ocrProvider,
    dependencies.translationProvider ?? new DeterministicLocalTranslationProvider(),
    now, logger
  );
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ocrProvider: OcrProvider,
  translationProvider: TranslationProvider,
  now: () => number,
  logger: (entry: BackendLogEntry) => void
): Promise<void> {
  const start = now();
  const url = req.url || "";
  const pathname = url.split("?")[0];
  const method = req.method || "";
  const logRequest = (
    status: number,
    errorCode?: string
  ): void => logger({
    timestamp: new Date(now()).toISOString(),
    method,
    pathname,
    status,
    durationMs: Math.max(0, now() - start),
    ...(errorCode ? { errorCode } : {}),
  });

  // 1. Health check endpoint
  if (pathname === "/health") {
    if (method !== "GET") {
      sendJsonError(res, 405, "method-not-allowed");
      logRequest(405, "method-not-allowed");
      return;
    }
    const healthController = new AbortController();
    const onHealthAborted = () => healthController.abort();
    req.once("aborted", onHealthAborted);
    const healthTimer = setTimeout(() => healthController.abort(), 1_500);
    let ocrReady = ocrProvider.enabled;
    try {
      if (ocrProvider.health) {
        ocrReady = await ocrProvider.health(healthController.signal);
      }
    } catch {
      ocrReady = false;
    } finally {
      clearTimeout(healthTimer);
      req.off("aborted", onHealthAborted);
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
        ocrProvider: ocrProvider.id,
        ocrExecution: ocrProvider.execution,
        ocrEnabled: ocrProvider.enabled,
        ocrReady,
        translationProvider: translationProvider.id,
        translationExecution: translationProvider.execution,
        translationEnabled: translationProvider.enabled,
      })
    );
    logRequest(200);
    return;
  }

  // 2. Translation endpoint
  if (pathname === "/v1/translate") {
    if (method !== "POST") {
      sendJsonError(res, 405, "method-not-allowed");
      logRequest(405, "method-not-allowed");
      return;
    }

    const contentTypeHeader = req.headers["content-type"] || "";
    const parsedContentType = parseMultipartContentType(contentTypeHeader);
    if (!parsedContentType) {
      sendJsonError(res, 415, "unsupported-media-type");
      logRequest(415, "unsupported-media-type");
      return;
    }
    const { boundary } = parsedContentType;

    const contentLengthHeader = req.headers["content-length"];
    if (contentLengthHeader) {
      const length = parseInt(contentLengthHeader, 10);
      if (Number.isFinite(length) && length > 21 * 1024 * 1024) {
        sendJsonError(res, 413, "payload-too-large");
        logRequest(413, "payload-too-large");
        return;
      }
    }

    let settled = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let chunks: Buffer[] | null = [];
    let totalBytes = 0;

    const cleanup = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      chunks = null;
    };

    const bodyPromise = new Promise<Buffer>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        if (settled) return;
        totalBytes += chunk.length;
        if (totalBytes > 21 * 1024 * 1024) {
          settleFailure(new Error("payload-too-large"));
          return;
        }
        chunks?.push(chunk);
      };

      const onEnd = () => {
        if (settled) return;
        if (chunks) {
          settleSuccess(Buffer.concat(chunks));
        } else {
          settleFailure(new Error("aborted"));
        }
      };

      const onError = (err: unknown) => {
        if (settled) return;
        settleFailure(err instanceof Error ? err : new Error("unknown-error"));
      };

      const onAborted = () => {
        if (settled) return;
        settleFailure(new Error("aborted"));
      };

      const settleSuccess = (result: Buffer) => {
        settled = true;
        cleanupListeners();
        cleanup();
        resolve(result);
      };

      const settleFailure = (err: Error) => {
        settled = true;
        cleanupListeners();
        cleanup();
        reject(err);
      };

      const cleanupListeners = () => {
        req.off("data", onData);
        req.off("end", onEnd);
        req.off("error", onError);
        req.off("aborted", onAborted);
      };

      req.on("data", onData);
      req.on("end", onEnd);
      req.on("error", onError);
      req.on("aborted", onAborted);

      timeoutTimer = setTimeout(() => {
        if (settled) return;
        settleFailure(new Error("timeout"));
      }, 10000);
    });

    let body: Buffer;
    try {
      body = await bodyPromise;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "";

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
      logRequest(status, code);
      return;
    }

    const parts = parseMultipart(body, boundary);

    if (parts.length !== 2) {
      sendJsonError(res, 400, "malformed-request");
      logRequest(400, "malformed-request");
      return;
    }

    const metadataPart = parts.find((p) => p.name === "metadata");
    const imagePart = parts.find((p) => p.name === "image");

    if (!metadataPart || !imagePart) {
      sendJsonError(res, 400, "malformed-request");
      logRequest(400, "malformed-request");
      return;
    }

    if (metadataPart.filename !== "metadata.json" || imagePart.filename !== "page.png") {
      sendJsonError(res, 400, "malformed-request");
      logRequest(400, "malformed-request");
      return;
    }

    if (metadataPart.contentType !== "application/json") {
      sendJsonError(res, 415, "unsupported-media-type");
      logRequest(415, "unsupported-media-type");
      return;
    }

    if (imagePart.contentType !== "image/png") {
      sendJsonError(res, 415, "unsupported-media-type");
      logRequest(415, "unsupported-media-type");
      return;
    }

    if (metadataPart.data.length > 64 * 1024) {
      sendJsonError(res, 413, "payload-too-large");
      logRequest(413, "payload-too-large");
      return;
    }

    if (imagePart.data.length === 0) {
      sendJsonError(res, 400, "malformed-request");
      logRequest(400, "malformed-request");
      return;
    }

    if (imagePart.data.length > 20 * 1024 * 1024) {
      sendJsonError(res, 413, "payload-too-large");
      logRequest(413, "payload-too-large");
      return;
    }

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (imagePart.data.length < 8 || !imagePart.data.subarray(0, 8).equals(pngHeader)) {
      sendJsonError(res, 400, "malformed-request");
      logRequest(400, "malformed-request");
      return;
    }

    let parsedMetadata: unknown;
    try {
      parsedMetadata = JSON.parse(metadataPart.data.toString("utf8"));
    } catch {
      sendJsonError(res, 400, "malformed-request");
      logRequest(400, "malformed-request");
      return;
    }

    const validatedMetadata = validateTranslationApiRequestMetadata(parsedMetadata);
    if (!validatedMetadata) {
      sendJsonError(res, 422, "invalid-contract");
      logRequest(422, "invalid-contract");
      return;
    }

    if (validatedMetadata.capture.mimeType !== "image/png") {
      sendJsonError(res, 422, "invalid-contract");
      logRequest(422, "invalid-contract");
      return;
    }

    if (validatedMetadata.capture.byteLength !== imagePart.data.length) {
      sendJsonError(res, 422, "invalid-contract");
      logRequest(422, "invalid-contract");
      return;
    }

    const operationController = new AbortController();
    const onRequestAborted = () => operationController.abort();
    const onResponseClosed = () => {
      if (!res.writableEnded) operationController.abort();
    };
    req.once("aborted", onRequestAborted);
    if (typeof res.once === "function") res.once("close", onResponseClosed);
    const operationTimer = setTimeout(() => operationController.abort(), 14_500);
    let bubbles: TranslationBubble[];
    let translationStatus: TranslationProviderStatus = "unavailable";
    try {
      const result = await ocrProvider.recognize({
        image: imagePart.data,
        mimeType: "image/png",
        pixelWidth: validatedMetadata.capture.pixelWidth,
        pixelHeight: validatedMetadata.capture.pixelHeight,
        sourceLanguage: validatedMetadata.sourceLanguage,
      }, operationController.signal);
      if (operationController.signal.aborted) {
        throw new OcrFailure("ocr-timeout");
      }
      if (result.regions.length === 0) {
        throw new OcrFailure("ocr-no-text");
      }
      bubbles = ocrRegionsToBubbles(
        validatedMetadata.requestId,
        result.regions
      );
      const validatedResponse = validateTranslationApiSuccessResponse({
        contractVersion: 1,
        requestId: validatedMetadata.requestId,
        pageId: validatedMetadata.pageId,
        bubbles,
      });
      if (!validatedResponse) {
        throw new OcrFailure("ocr-invalid-response");
      }
      bubbles = validatedResponse.bubbles;
      try {
        const translated = await translationProvider.translate(
          bubbles.map((bubble) => ({ id: bubble.id, originalText: bubble.originalText })),
          validatedMetadata.sourceLanguage,
          validatedMetadata.targetLanguage,
          operationController.signal
        );
        if (operationController.signal.aborted) throw new OcrFailure("ocr-timeout");
        const validatedTranslation = applyValidatedTranslation(bubbles, translated);
        if (!validatedTranslation) throw new Error("translation-invalid-response");
        bubbles = validatedTranslation;
        translationStatus = "translated";
      } catch (error: unknown) {
        if (operationController.signal.aborted) throw new OcrFailure("ocr-timeout");
        // Translation is a post-OCR enhancement: return the validated OCR text
        // rather than losing usable geometry/text when this local provider fails.
        translationStatus = "unavailable";
      }
    } catch (error: unknown) {
      const code = operationController.signal.aborted
        ? "ocr-timeout"
        : ocrErrorCode(error);
      const status = ocrErrorStatus(code);
      sendJsonError(res, status, code);
      logRequest(status, code);
      return;
    } finally {
      clearTimeout(operationTimer);
      req.off("aborted", onRequestAborted);
      if (typeof res.off === "function") res.off("close", onResponseClosed);
    }

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
        translation: {
          providerId: translationProvider.id,
          execution: translationProvider.execution,
          status: translationStatus,
        },
      })
    );

    logRequest(200);
    return;
  }

  // 3. Fallback for other paths
  sendJsonError(res, 404, "not-found");
  logRequest(404, "not-found");
}

export function parseMultipartContentType(header: string): { boundary: string } | null {
  const parts = header.split(";").map((s) => s.trim());
  if (parts.length !== 2) {
    return null; // Reject extra parameters, trailing semicolons, or missing boundary
  }

  const mediaType = parts[0].toLowerCase();
  if (mediaType !== "multipart/form-data") {
    return null;
  }

  const param = parts[1];
  const match = param.match(/^boundary\s*=\s*(.+)$/i);
  if (!match) {
    return null;
  }

  let boundary = match[1].trim();

  // Reject single-quoted boundaries
  if (boundary.startsWith("'") || boundary.endsWith("'")) {
    return null;
  }

  let isQuoted = false;
  if (boundary.startsWith('"') || boundary.endsWith('"')) {
    if (!boundary.startsWith('"') || !boundary.endsWith('"') || boundary.length < 2) {
      return null; // Mismatched quotes
    }
    boundary = boundary.slice(1, -1);
    isQuoted = true;
  }

  if (boundary.length === 0) {
    return null;
  }

  if (boundary.length > 70) {
    return null;
  }

  // Reject ?, &, # or = inside boundary
  if (/[?&#=]/.test(boundary)) {
    return null;
  }

  // Reject unquoted boundaries containing spaces
  if (!isQuoted && boundary.includes(" ")) {
    return null;
  }

  // Reject control characters
  for (let i = 0; i < boundary.length; i++) {
    const code = boundary.charCodeAt(i);
    if (code < 0x20 || code >= 0x7f) {
      return null;
    }
  }

  if (!/^[a-zA-Z0-9'()+\-./: ]+$/.test(boundary)) {
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

function defaultLogger(entry: BackendLogEntry): void {
  const errorSuffix = entry.errorCode ? ` ${entry.errorCode}` : "";
  console.log(
    `[${entry.timestamp}] ${entry.method} ${entry.pathname} ${entry.status}` +
    ` - ${entry.durationMs.toFixed(0)}ms${errorSuffix}`
  );
}
