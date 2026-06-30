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
    if (response.status < 200 || response.status >= 300) {
      throw new Error("backend-http-error");
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.toLowerCase().startsWith("application/json")) {
      throw new Error("backend-invalid-content-type");
    }

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
      throw new Error("backend-request-failed");
    }

    // 6. Decode UTF-8 and Parse JSON
    let parsed: unknown;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
      parsed = JSON.parse(text);
    } catch {
      throw new Error("backend-invalid-json");
    }

    return parsed;
  }
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
  try {
    while (true) {
      if (signal.aborted) {
        throw new DOMException("Translation cancelled", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.length;
        if (totalBytes > maxBytes) {
          throw new Error("backend-response-too-large");
        }
        chunks.push(value);
      }
    }
  } finally {
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
