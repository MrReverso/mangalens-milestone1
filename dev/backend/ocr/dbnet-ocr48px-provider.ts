import type { OcrProvider } from "./ocr-provider";
import type { OcrBounds, OcrInput, OcrRegion, OcrResult } from "./ocr-types";
import { OcrFailure } from "./ocr-errors";

export const MANGA_ENGINE_ORIGIN = "http://127.0.0.1:8002";
export const MANGA_ENGINE_HEALTH_ENDPOINT =
  `${MANGA_ENGINE_ORIGIN}/health`;
export const MANGA_ENGINE_DETECT_ENDPOINT =
  `${MANGA_ENGINE_ORIGIN}/detect`;
export const MANGA_ENGINE_RECOGNIZE_ENDPOINT =
  `${MANGA_ENGINE_ORIGIN}/recognize-japanese`;

const MAX_ENGINE_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REGIONS = 100;
const MAX_TEXT_CHARACTERS = 20_000;

interface DetectionRegion {
  readonly id: string;
  readonly points: readonly (readonly [number, number])[];
  readonly direction: "h" | "v";
}

export class DbnetOcr48pxProvider implements OcrProvider {
  readonly id = "dbnet-ocr48px" as const;
  readonly execution = "local" as const;
  readonly enabled = true;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxResponseBytes = MAX_ENGINE_RESPONSE_BYTES
  ) {
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
      throw new OcrFailure("ocr-invalid-response");
    }
  }

  async health(signal: AbortSignal): Promise<boolean> {
    throwIfAborted(signal);
    validateMangaEngineEndpoint(MANGA_ENGINE_HEALTH_ENDPOINT);
    let response: Response;
    try {
      response = await this.fetchImpl(MANGA_ENGINE_HEALTH_ENDPOINT, {
        method: "GET",
        signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) throw abortError();
      return false;
    }
    throwIfAborted(signal);
    if (response.redirected ||
        response.status < 200 ||
        response.status >= 300) {
      return false;
    }
    try {
      validateJsonContentType(response.headers.get("content-type"));
      const value = await readJsonResponse(
        response,
        this.maxResponseBytes,
        signal
      );
      return isRecord(value) &&
        value.status === "healthy" &&
        isNonEmptyString(value.engineVersion) &&
        isNonEmptyString(value.engineCommit);
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) throw abortError();
      return false;
    }
  }

  async recognize(input: OcrInput, signal: AbortSignal): Promise<OcrResult> {
    validateInput(input);
    throwIfAborted(signal);

    const detectionForm = new FormData();
    detectionForm.append("detector", "default");
    detectionForm.append(
      "image",
      new Blob([new Uint8Array(input.image)], { type: "image/png" }),
      "page.png"
    );
    const detectionResponse = await this.request(
      MANGA_ENGINE_DETECT_ENDPOINT,
      detectionForm,
      signal
    );
    const regions = validateDetectionResponse(
      detectionResponse,
      input.pixelWidth,
      input.pixelHeight
    );
    if (regions.length === 0) throw new OcrFailure("ocr-no-text");
    throwIfAborted(signal);

    const recognitionForm = new FormData();
    recognitionForm.append("recognizer", "ocr48px");
    recognitionForm.append("regions", JSON.stringify(regions.map((region) => ({
      id: region.id,
      pts: region.points,
      direction: region.direction,
    }))));
    recognitionForm.append(
      "image",
      new Blob([new Uint8Array(input.image)], { type: "image/png" }),
      "page.png"
    );
    const recognitionResponse = await this.request(
      MANGA_ENGINE_RECOGNIZE_ENDPOINT,
      recognitionForm,
      signal
    );
    return {
      regions: validateRecognitionResponse(
        recognitionResponse,
        regions,
        input.pixelWidth,
        input.pixelHeight
      ),
    };
  }

  private async request(
    endpoint: string,
    body: FormData,
    signal: AbortSignal
  ): Promise<unknown> {
    validateMangaEngineEndpoint(endpoint);
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        body,
        signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) throw abortError();
      throw new OcrFailure("ocr-unavailable");
    }
    throwIfAborted(signal);
    if (response.redirected) throw new OcrFailure("ocr-invalid-response");
    if (response.status >= 500) throw new OcrFailure("ocr-unavailable");
    if (response.status < 200 || response.status >= 300) {
      throw new OcrFailure("ocr-invalid-response");
    }
    validateJsonContentType(response.headers.get("content-type"));
    return readJsonResponse(response, this.maxResponseBytes, signal);
  }
}

export function validateMangaEngineEndpoint(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OcrFailure("ocr-invalid-response");
  }
  if ((value !== MANGA_ENGINE_HEALTH_ENDPOINT &&
       value !== MANGA_ENGINE_DETECT_ENDPOINT &&
       value !== MANGA_ENGINE_RECOGNIZE_ENDPOINT) ||
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.port !== "8002" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "") {
    throw new OcrFailure("ocr-invalid-response");
  }
}

function validateDetectionResponse(
  value: unknown,
  pixelWidth: number,
  pixelHeight: number
): DetectionRegion[] {
  if (!isRecord(value) ||
      value.width !== pixelWidth ||
      value.height !== pixelHeight ||
      value.detector !== "default" ||
      !Array.isArray(value.errors) ||
      value.errors.length !== 0 ||
      !Array.isArray(value.regions) ||
      value.regions.length > MAX_REGIONS) {
    throw new OcrFailure("ocr-invalid-response");
  }
  const ids = new Set<string>();
  return value.regions.map((raw): DetectionRegion => {
    if (!isRecord(raw) ||
        !isNonEmptyString(raw.id) ||
        ids.has(raw.id) ||
        raw.detectorMode !== "genuine" ||
        raw.detectorInferenceRan !== true ||
        (raw.direction !== "h" && raw.direction !== "v") ||
        !Array.isArray(raw.pts) ||
        raw.pts.length !== 4) {
      throw new OcrFailure("ocr-invalid-response");
    }
    const points = raw.pts.map((point): readonly [number, number] => {
      if (!Array.isArray(point) || point.length !== 2 ||
          !isFiniteNumber(point[0]) || !isFiniteNumber(point[1]) ||
          point[0] < 0 || point[0] > pixelWidth ||
          point[1] < 0 || point[1] > pixelHeight) {
        throw new OcrFailure("ocr-invalid-response");
      }
      return [point[0], point[1]];
    });
    ids.add(raw.id);
    normalizePoints(points, pixelWidth, pixelHeight);
    return { id: raw.id, points, direction: raw.direction };
  });
}

function validateRecognitionResponse(
  value: unknown,
  detections: readonly DetectionRegion[],
  pixelWidth: number,
  pixelHeight: number
): OcrRegion[] {
  if (!isRecord(value) ||
      !Array.isArray(value.errors) ||
      value.errors.length !== 0 ||
      !Array.isArray(value.regions) ||
      value.regions.length > detections.length ||
      value.regions.length > MAX_REGIONS) {
    throw new OcrFailure("ocr-invalid-response");
  }
  const detectionsById = new Map(
    detections.map((region) => [region.id, region] as const)
  );
  const seen = new Set<string>();
  let totalCharacters = 0;
  const regions: OcrRegion[] = [];
  for (const raw of value.regions) {
    if (!isRecord(raw) ||
        !isNonEmptyString(raw.id) ||
        seen.has(raw.id) ||
        !detectionsById.has(raw.id) ||
        typeof raw.text !== "string" ||
        !isFiniteNumber(raw.confidence) ||
        raw.confidence < 0 ||
        raw.confidence > 1) {
      throw new OcrFailure("ocr-invalid-response");
    }
    seen.add(raw.id);
    const text = raw.text.trim();
    if (!text) continue;
    totalCharacters += Array.from(text).length;
    if (totalCharacters > MAX_TEXT_CHARACTERS) {
      throw new OcrFailure("ocr-invalid-response");
    }
    const detection = detectionsById.get(raw.id);
    if (!detection) throw new OcrFailure("ocr-invalid-response");
    regions.push({
      text,
      bounds: normalizePoints(detection.points, pixelWidth, pixelHeight),
      polygon: normalizePolygon(detection.points, pixelWidth, pixelHeight),
      orientation: detection.direction === "v" ? "vertical" : "horizontal",
    });
  }
  if (regions.length === 0) throw new OcrFailure("ocr-no-text");
  return regions;
}

function normalizePoints(
  points: readonly (readonly [number, number])[],
  pixelWidth: number,
  pixelHeight: number
): OcrBounds {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  if (maxX <= minX || maxY <= minY) {
    throw new OcrFailure("ocr-invalid-response");
  }
  return {
    x: minX / pixelWidth,
    y: minY / pixelHeight,
    width: (maxX - minX) / pixelWidth,
    height: (maxY - minY) / pixelHeight,
  };
}

function normalizePolygon(
  points: readonly (readonly [number, number])[],
  pixelWidth: number,
  pixelHeight: number
): readonly [
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
] {
  if (points.length !== 4) throw new OcrFailure("ocr-invalid-response");
  const normalize = ([x, y]: readonly [number, number]) => ({
    x: x / pixelWidth,
    y: y / pixelHeight,
  });
  return [
    normalize(points[0]),
    normalize(points[1]),
    normalize(points[2]),
    normalize(points[3]),
  ];
}

async function readJsonResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<unknown> {
  if (!response.body) throw new OcrFailure("ocr-invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new OcrFailure("ocr-response-too-large");
      }
      chunks.push(value);
    }
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) throw abortError();
    if (error instanceof OcrFailure) throw error;
    throw new OcrFailure("ocr-unavailable");
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new OcrFailure("ocr-invalid-response");
  }
}

function validateInput(input: OcrInput): void {
  if (input.mimeType !== "image/png" ||
      input.image.length <= 0 ||
      !Number.isSafeInteger(input.pixelWidth) ||
      input.pixelWidth <= 0 ||
      !Number.isSafeInteger(input.pixelHeight) ||
      input.pixelHeight <= 0) {
    throw new OcrFailure("ocr-invalid-response");
  }
}

function validateJsonContentType(value: string | null): void {
  if (!value ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(value)) {
    throw new OcrFailure("ocr-invalid-response");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" &&
    !Number.isNaN(value) &&
    Number.isFinite(value);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException("OCR cancelled", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
