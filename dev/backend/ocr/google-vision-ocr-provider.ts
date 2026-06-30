import type { SourceLanguage } from "../../../types/extension";
import type { OcrProvider } from "./ocr-provider";
import type { OcrInput, OcrRegion, OcrResult } from "./ocr-types";
import type { GoogleAccessTokenProvider } from "./google-access-token-provider";
import { OcrFailure } from "./ocr-errors";
import {
  validateGoogleVisionResponse,
} from "./google-vision-response-validator";
import { reconstructParagraphText } from "./ocr-text";
import { normalizeParagraphBounds } from "./ocr-geometry";

export const GOOGLE_VISION_ANNOTATE_ENDPOINT =
  "https://vision.googleapis.com/v1/images:annotate";

const MAX_GOOGLE_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REGIONS = 100;
const MAX_TOTAL_CHARACTERS = 20_000;

export class GoogleVisionOcrProvider implements OcrProvider {
  constructor(
    private readonly accessTokenProvider: GoogleAccessTokenProvider,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint = GOOGLE_VISION_ANNOTATE_ENDPOINT,
    private readonly maxResponseBytes = MAX_GOOGLE_RESPONSE_BYTES
  ) {
    validateGoogleVisionEndpoint(endpoint);
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
      throw new OcrFailure("ocr-invalid-response");
    }
  }

  async recognize(input: OcrInput, signal: AbortSignal): Promise<OcrResult> {
    throwIfAborted(signal);
    validateInput(input);
    validateGoogleVisionEndpoint(this.endpoint);

    const accessToken = await this.accessTokenProvider.getAccessToken(signal);
    throwIfAborted(signal);
    validateGoogleVisionEndpoint(this.endpoint);

    const requestBody = buildGoogleVisionRequest(input);
    throwIfAborted(signal);
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(requestBody),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        throw new DOMException("OCR cancelled", "AbortError");
      }
      throw new OcrFailure("ocr-unavailable");
    }
    throwIfAborted(signal);

    if (response.redirected) throw new OcrFailure("ocr-invalid-response");
    if (response.status === 401 || response.status === 403) {
      throw new OcrFailure("ocr-auth-failed");
    }
    if (response.status === 429) {
      throw new OcrFailure("ocr-rate-limited");
    }
    if (response.status >= 500) {
      throw new OcrFailure("ocr-unavailable");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new OcrFailure("ocr-invalid-response");
    }
    validateJsonContentType(response.headers.get("content-type"));

    const bytes = await readGoogleResponseBody(
      response,
      this.maxResponseBytes,
      signal
    );
    throwIfAborted(signal);
    let parsed: unknown;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      throwIfAborted(signal);
      if (!text.trim()) throw new OcrFailure("ocr-invalid-response");
      parsed = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        throw new DOMException("OCR cancelled", "AbortError");
      }
      if (error instanceof OcrFailure) throw error;
      throw new OcrFailure("ocr-invalid-response");
    }
    throwIfAborted(signal);

    const paragraphs = validateGoogleVisionResponse(parsed);
    const regions: OcrRegion[] = [];
    let totalCharacters = 0;
    for (const paragraph of paragraphs) {
      throwIfAborted(signal);
      const text = reconstructParagraphText(paragraph);
      if (!text) continue;
      totalCharacters += Array.from(text).length;
      if (totalCharacters > MAX_TOTAL_CHARACTERS ||
          regions.length >= MAX_REGIONS) {
        throw new OcrFailure("ocr-invalid-response");
      }
      regions.push({
        text,
        bounds: normalizeParagraphBounds(
          paragraph.vertices,
          input.pixelWidth,
          input.pixelHeight
        ),
      });
    }
    if (regions.length === 0) throw new OcrFailure("ocr-no-text");
    return { regions };
  }
}

export function validateGoogleVisionEndpoint(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OcrFailure("ocr-invalid-response");
  }
  if (value !== GOOGLE_VISION_ANNOTATE_ENDPOINT ||
      url.protocol !== "https:" ||
      url.hostname !== "vision.googleapis.com" ||
      url.port !== "" ||
      url.pathname !== "/v1/images:annotate" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "") {
    throw new OcrFailure("ocr-invalid-response");
  }
}

export function buildGoogleVisionRequest(input: OcrInput): unknown {
  const request: Record<string, unknown> = {
    image: { content: input.image.toString("base64") },
    features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
  };
  const languageHints = languageHintsFor(input.sourceLanguage);
  if (languageHints) request.imageContext = { languageHints };
  return { requests: [request] };
}

export function languageHintsFor(
  sourceLanguage: SourceLanguage
): readonly string[] | null {
  return sourceLanguage === "auto" ? null : [sourceLanguage];
}

export async function readGoogleResponseBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (!response.body) throw new OcrFailure("ocr-invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let cancelled = false;
  const abortError = () => new DOMException("OCR cancelled", "AbortError");
  const onAbort = () => {
    cancelled = true;
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();

  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (signal.aborted) throw abortError();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        cancelled = true;
        await reader.cancel().catch(() => undefined);
        throw new OcrFailure("ocr-response-too-large");
      }
      chunks.push(value);
    }
    if (signal.aborted) throw abortError();
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) throw abortError();
    if (!cancelled) {
      cancelled = true;
      await reader.cancel().catch(() => undefined);
    }
    if (error instanceof OcrFailure) throw error;
    throw new OcrFailure("ocr-unavailable");
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function validateInput(input: OcrInput): void {
  if (input.mimeType !== "image/png" || input.image.length <= 0 ||
      !Number.isSafeInteger(input.pixelWidth) || input.pixelWidth <= 0 ||
      !Number.isSafeInteger(input.pixelHeight) || input.pixelHeight <= 0 ||
      !["auto", "ja", "ko", "zh"].includes(input.sourceLanguage)) {
    throw new OcrFailure("ocr-invalid-response");
  }
}

function validateJsonContentType(contentType: string | null): void {
  if (!contentType) throw new OcrFailure("ocr-invalid-response");
  const parts = contentType.split(";").map((part) => part.trim());
  if (parts[0].toLowerCase() !== "application/json" || parts.length > 2) {
    throw new OcrFailure("ocr-invalid-response");
  }
  if (parts.length === 2 &&
      !/^charset=utf-8$/iu.test(parts[1].replace(/\s+/gu, ""))) {
    throw new OcrFailure("ocr-invalid-response");
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("OCR cancelled", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
