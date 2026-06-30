// ── Message Types ──────────────────────────────────────────────
// All inter-script messages are defined here to avoid scattered
// untyped string literals throughout the project.

// ── Commands (popup → content) ─────────────────────────────────

export interface ScanPageMessage {
  readonly type: "SCAN_PAGE";
}

export interface ClearMarkersMessage {
  readonly type: "CLEAR_MARKERS";
}

export interface GetScanStatusMessage {
  readonly type: "GET_SCAN_STATUS";
}

// ── Responses (content → popup) ────────────────────────────────

export interface ScanSuccessResponse {
  readonly success: true;
  readonly detectedImages: number;
}

export interface ScanErrorResponse {
  readonly success: false;
  readonly error: string;
}

export interface ScanStatusResponse {
  readonly type: "SCAN_STATUS";
  readonly detectedImages: number;
  readonly isScanning: boolean;
}

// ── Union types ────────────────────────────────────────────────

export type ExtensionMessage =
  | ScanPageMessage
  | ClearMarkersMessage
  | GetScanStatusMessage;

export type ScanPageResponse = ScanSuccessResponse | ScanErrorResponse;