export interface CaptureViewportRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface CaptureDescriptor {
  readonly captureToken: string;
  readonly pageId: string;
  readonly pageNumber: number;
  readonly imageRect: CaptureViewportRect;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export type CaptureMethod = "visible-tab-screenshot-crop";

export interface CaptureMetadata {
  readonly pageId: string;
  readonly pageNumber: number;
  readonly method: CaptureMethod;
  readonly mimeType: "image/png";
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface CapturedImage {
  readonly blob: Blob;
  readonly metadata: CaptureMetadata;
}

export type CaptureErrorCode =
  | "no-detected-pages"
  | "no-fully-visible-page"
  | "capture-in-progress"
  | "page-disconnected"
  | "page-moved"
  | "invalid-geometry"
  | "screenshot-failed"
  | "crop-failed"
  | "capture-too-large"
  | "unsupported-browser"
  | "restricted-page"
  | "timeout"
  | "unexpected-error";

export interface CaptureError {
  readonly code: CaptureErrorCode;
}

export type CapturePrepareResponse =
  | { readonly success: true; readonly descriptor: CaptureDescriptor }
  | { readonly success: false; readonly error: CaptureError };

export type CaptureRestoreResponse =
  | { readonly success: true }
  | { readonly success: false; readonly error: CaptureError };

export type BackgroundCaptureResponse =
  | { readonly success: true; readonly metadata: CaptureMetadata }
  | { readonly success: false; readonly error: CaptureError };

const CAPTURE_ERROR_CODES = new Set<string>([
  "no-detected-pages",
  "no-fully-visible-page",
  "capture-in-progress",
  "page-disconnected",
  "page-moved",
  "invalid-geometry",
  "screenshot-failed",
  "crop-failed",
  "capture-too-large",
  "unsupported-browser",
  "restricted-page",
  "timeout",
  "unexpected-error",
]);

export function isCaptureDescriptor(value: unknown): value is CaptureDescriptor {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, [
    "captureToken",
    "pageId",
    "pageNumber",
    "imageRect",
    "viewportWidth",
    "viewportHeight",
  ]) &&
    isNonEmptyString(value.captureToken) &&
    isNonEmptyString(value.pageId) &&
    isPositiveInteger(value.pageNumber) &&
    isRecord(value.imageRect) &&
    hasOnlyKeys(value.imageRect, ["top", "left", "width", "height"]) &&
    isFiniteNumber(value.imageRect.top) &&
    isFiniteNumber(value.imageRect.left) &&
    isPositiveFinite(value.imageRect.width) &&
    isPositiveFinite(value.imageRect.height) &&
    isPositiveFinite(value.viewportWidth) &&
    isPositiveFinite(value.viewportHeight) &&
    value.imageRect.top >= -1 &&
    value.imageRect.left >= -1 &&
    value.imageRect.top + value.imageRect.height <= value.viewportHeight + 1 &&
    value.imageRect.left + value.imageRect.width <= value.viewportWidth + 1;
}

export function isCaptureErrorCode(value: unknown): value is CaptureErrorCode {
  return typeof value === "string" && CAPTURE_ERROR_CODES.has(value);
}

export function isCaptureMetadata(value: unknown): value is CaptureMetadata {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "pageId",
      "pageNumber",
      "method",
      "mimeType",
      "pixelWidth",
      "pixelHeight",
      "byteLength",
      "sha256",
    ]) &&
    isNonEmptyString(value.pageId) &&
    isPositiveInteger(value.pageNumber) &&
    value.method === "visible-tab-screenshot-crop" &&
    value.mimeType === "image/png" &&
    isPositiveInteger(value.pixelWidth) &&
    isPositiveInteger(value.pixelHeight) &&
    isPositiveInteger(value.byteLength) &&
    typeof value.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.sha256);
}

export function isBackgroundCaptureResponse(
  value: unknown
): value is BackgroundCaptureResponse {
  if (!isRecord(value) || typeof value.success !== "boolean") return false;
  if (value.success) {
    return hasOnlyKeys(value, ["success", "metadata"]) &&
      isCaptureMetadata(value.metadata);
  }
  return hasOnlyKeys(value, ["success", "error"]) &&
    isRecord(value.error) &&
    hasOnlyKeys(value.error, ["code"]) &&
    isCaptureErrorCode(value.error.code);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}
