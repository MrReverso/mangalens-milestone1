import type { TranslationService, LocalTranslationInput } from "@/lib/translation/translation-service";
import { validateTranslationApiRequestMetadata } from "@/types/translation-api";

export class HttpTranslationService implements TranslationService {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxResponseBytes: number;

  constructor(options: {
    readonly endpoint: string;
    readonly fetchImpl?: typeof fetch;
    readonly maxResponseBytes?: number;
  }) {
    this.endpoint = options.endpoint;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxResponseBytes = options.maxResponseBytes ?? 256 * 1024;

    if (typeof this.maxResponseBytes !== "number" ||
        !Number.isSafeInteger(this.maxResponseBytes) ||
        this.maxResponseBytes <= 0) {
      throw new Error("Invalid maxResponseBytes value");
    }

    // Validate the configured endpoint immediately on construction
    validateTranslationUrl(this.endpoint);
  }

  async translate(input: LocalTranslationInput, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) {
      throw new DOMException("Translation cancelled", "AbortError");
    }

    // 1. Validations before dispatching fetch
    if (input.image.type !== "image/png") {
      throw new Error("backend-request-failed");
    }
    if (input.image.size <= 0) {
      throw new Error("backend-request-failed");
    }
    // Enforce 20 MB max cropped-image size
    if (input.image.size > 20 * 1024 * 1024) {
      throw new Error("backend-request-failed");
    }

    const metadata = validateTranslationApiRequestMetadata(input.metadata);
    if (!metadata) {
      throw new Error("backend-request-failed");
    }

    // Validate endpoint again before fetch
    validateTranslationUrl(this.endpoint);

    if (metadata.capture.mimeType !== "image/png") {
      throw new Error("backend-request-failed");
    }
    if (metadata.capture.byteLength !== input.image.size) {
      throw new Error("backend-request-failed");
    }
    if (metadata.pageId !== input.metadata.pageId || metadata.pageNumber !== input.metadata.pageNumber) {
      throw new Error("backend-request-failed");
    }

    // 2. Build multipart/form-data
    const formData = new FormData();
    formData.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      "metadata.json"
    );
    formData.append("image", input.image, "page.png");

    // 3. Dispatch fetch request
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        body: formData,
        signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch (error) {
      if (signal.aborted) {
        throw new DOMException("Translation cancelled", "AbortError");
      }
      // Return backend-unavailable for connection refused/fetch errors
      throw new Error("backend-unavailable");
    }

    if (signal.aborted) {
      throw new DOMException("Translation cancelled", "AbortError");
    }

    // 4. Response Safety Checks
    if (response.redirected) {
      throw new Error("backend-request-failed");
    }
    const contentType = response.headers.get("content-type");
    validateContentType(contentType);

    // 5. Read response body using a size-bounded method
    let bodyBytes: Uint8Array;
    try {
      bodyBytes = await readResponseBody(response, this.maxResponseBytes, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (error instanceof Error && error.message === "backend-response-too-large") {
        throw error;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error("backend-http-error");
      }
      throw new Error("backend-request-failed");
    }

    if (signal.aborted) {
      throw new DOMException("Translation cancelled", "AbortError");
    }

    if (response.status < 200 || response.status >= 300) {
      const ocrError = parseBackendOcrError(bodyBytes);
      throw new Error(ocrError ?? "backend-http-error");
    }

    // 6. Decode UTF-8 and Parse JSON
    let parsed: unknown;
    try {
      if (signal.aborted) {
        throw new DOMException("Translation cancelled", "AbortError");
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
      if (signal.aborted) {
        throw new DOMException("Translation cancelled", "AbortError");
      }
      parsed = JSON.parse(text);
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new DOMException("Translation cancelled", "AbortError");
      }
      throw new Error("backend-invalid-json");
    }

    if (signal.aborted) {
      throw new DOMException("Translation cancelled", "AbortError");
    }

    return parsed;
  }
}

const BACKEND_OCR_ERRORS = new Set<string>([
  "ocr-provider-disabled",
  "ocr-not-configured",
  "ocr-auth-failed",
  "ocr-unavailable",
  "ocr-rate-limited",
  "ocr-timeout",
  "ocr-response-too-large",
  "ocr-invalid-response",
  "ocr-no-text",
  "translation-provider-unavailable",
  "translation-invalid-response",
]);

export function parseBackendOcrError(bytes: Uint8Array): string | null {
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value) ||
      Object.keys(value).length !== 2 ||
      value.success !== false ||
      !isRecord(value.error) ||
      Object.keys(value.error).length !== 1 ||
      typeof value.error.code !== "string" ||
      !BACKEND_OCR_ERRORS.has(value.error.code)) {
    return null;
  }
  return value.error.code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateTranslationUrl(urlStr: string): void {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("Invalid translation URL format");
  }
  if (url.protocol !== "http:") {
    throw new Error("Invalid protocol: must use http:");
  }
  if (url.hostname !== "127.0.0.1") {
    throw new Error("Invalid hostname: must be 127.0.0.1");
  }
  if (url.port !== "8787") {
    throw new Error("Invalid port: must be 8787");
  }
  if (url.pathname !== "/v1/translate") {
    throw new Error("Invalid pathname: must be /v1/translate");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("Credentials not allowed in URL");
  }
  if (url.search !== "") {
    throw new Error("Query string not allowed in URL");
  }
  if (url.hash !== "") {
    throw new Error("Fragment not allowed in URL");
  }
}

async function readResponseBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (!response.body) {
    throw new Error("backend-request-failed");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let abortError: DOMException | null = null;

  let cancelled = false;

  const onAbort = () => {
    abortError = new DOMException("Translation cancelled", "AbortError");
    cancelled = true;
    reader.cancel().catch(() => {});
  };

  signal.addEventListener("abort", onAbort);

  try {
    while (true) {
      if (signal.aborted) {
        throw abortError || new DOMException("Translation cancelled", "AbortError");
      }
      const { done, value } = await reader.read();
      if (signal.aborted) {
        throw abortError || new DOMException("Translation cancelled", "AbortError");
      }
      if (done) break;
      if (value) {
        totalBytes += value.length;
        if (totalBytes > maxBytes) {
          cancelled = true;
          await reader.cancel().catch(() => {});
          throw new Error("backend-response-too-large");
        }
        chunks.push(value);
      }
    }
  } catch (error) {
    if (signal.aborted) {
      throw abortError || new DOMException("Translation cancelled", "AbortError");
    }
    if (!cancelled) {
      cancelled = true;
      await reader.cancel().catch(() => {});
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function validateContentType(contentType: string | null): void {
  if (!contentType) {
    throw new Error("backend-invalid-content-type");
  }

  const parts = contentType.split(";").map((p) => p.trim());
  const mediaType = parts[0].toLowerCase();
  
  if (mediaType !== "application/json") {
    throw new Error("backend-invalid-content-type");
  }

  if (parts.length === 1) {
    return;
  }

  if (parts.length > 2) {
    throw new Error("backend-invalid-content-type");
  }

  const param = parts[1];
  if (!param) {
    throw new Error("backend-invalid-content-type");
  }

  const match = param.match(/^charset\s*=\s*(.+)$/i);
  if (!match) {
    throw new Error("backend-invalid-content-type");
  }

  const charsetVal = match[1].trim();
  if (charsetVal.startsWith("'") || charsetVal.endsWith("'")) {
    throw new Error("backend-invalid-content-type");
  }

  let unquoted = charsetVal;
  if (unquoted.startsWith('"') && unquoted.endsWith('"')) {
    unquoted = unquoted.slice(1, -1).trim();
  }

  if (unquoted.toLowerCase() !== "utf-8") {
    throw new Error("backend-invalid-content-type");
  }
}
