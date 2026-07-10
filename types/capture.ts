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

export interface CapturePageSnapshot {
  readonly pageId: string;
  readonly pageNumber: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

/** A visible crop plus its stable position within a larger detected page. */
export interface CaptureSegmentDescriptor extends CaptureDescriptor,
  CapturePageSnapshot {
  readonly sessionId: string;
  readonly segmentRect: CaptureViewportRect;
}

export interface SegmentedCaptureSessionStatus {
  readonly sessionId: string;
  readonly tabId: number;
  readonly windowId: number;
  readonly pageId: string | null;
  readonly pageNumber: number | null;
  readonly segmentCount: number;
}

export type CaptureMethod =
  | "visible-tab-screenshot-crop"
  | "overlapping-segment-assembly";

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
  | "active-tab-changed"
  | "page-disconnected"
  | "page-moved"
  | "invalid-geometry"
  | "screenshot-failed"
  | "crop-failed"
  | "capture-too-large"
  | "capture-session-not-found"
  | "capture-session-cancelled"
  | "stale-capture-session"
  | "low-overlap"
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

export type CaptureSegmentPrepareResponse =
  | { readonly success: true; readonly descriptor: CaptureSegmentDescriptor }
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
  "active-tab-changed",
  "page-disconnected",
  "page-moved",
  "invalid-geometry",
  "screenshot-failed",
  "crop-failed",
  "capture-too-large",
  "capture-session-not-found",
  "capture-session-cancelled",
  "stale-capture-session",
  "low-overlap",
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

export function isCaptureSegmentDescriptor(
  value: unknown
): value is CaptureSegmentDescriptor {
  if (!isRecord(value) ||
      !hasOnlyKeys(value, [
        "captureToken", "pageId", "pageNumber", "imageRect", "viewportWidth",
        "viewportHeight", "sessionId", "segmentRect", "pageWidth", "pageHeight",
        "naturalWidth", "naturalHeight",
      ]) ||
      !isCaptureDescriptor({
        captureToken: value.captureToken,
        pageId: value.pageId,
        pageNumber: value.pageNumber,
        imageRect: value.imageRect,
        viewportWidth: value.viewportWidth,
        viewportHeight: value.viewportHeight,
      })) {
    return false;
  }
  return isNonEmptyString(value.sessionId) &&
    isViewportRect(value.segmentRect) &&
    isPositiveFinite(value.pageWidth) &&
    isPositiveFinite(value.pageHeight) &&
    isPositiveInteger(value.naturalWidth) &&
    isPositiveInteger(value.naturalHeight) &&
    value.segmentRect.left >= -1 &&
    value.segmentRect.top >= -1 &&
    value.segmentRect.left + value.segmentRect.width <= value.pageWidth + 1 &&
    value.segmentRect.top + value.segmentRect.height <= value.pageHeight + 1;
}

export function isSegmentedCaptureSessionStatus(
  value: unknown
): value is SegmentedCaptureSessionStatus {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "sessionId", "tabId", "windowId", "pageId", "pageNumber", "segmentCount",
    ]) &&
    isNonEmptyString(value.sessionId) &&
    isPositiveInteger(value.tabId) &&
    isPositiveInteger(value.windowId) &&
    (value.pageId === null || isNonEmptyString(value.pageId)) &&
    (value.pageNumber === null || isPositiveInteger(value.pageNumber)) &&
    typeof value.segmentCount === "number" &&
    Number.isInteger(value.segmentCount) && value.segmentCount >= 0;
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
    (value.method === "visible-tab-screenshot-crop" ||
      value.method === "overlapping-segment-assembly") &&
    value.mimeType === "image/png" &&
    isPositiveInteger(value.pixelWidth) &&
    isPositiveInteger(value.pixelHeight) &&
    isPositiveInteger(value.byteLength) &&
    typeof value.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.sha256);
}

function isViewportRect(value: unknown): value is CaptureViewportRect {
  return isRecord(value) &&
    hasOnlyKeys(value, ["top", "left", "width", "height"]) &&
    isFiniteNumber(value.top) &&
    isFiniteNumber(value.left) &&
    isPositiveFinite(value.width) &&
    isPositiveFinite(value.height);
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
