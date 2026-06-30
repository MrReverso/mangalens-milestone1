// ── Message Types ──────────────────────────────────────────────
// All inter-script messages are defined here to avoid scattered
// untyped string literals throughout the project.

// ── Commands (popup → content) ─────────────────────────────────
import type { SourceLanguage, TargetLanguage } from "@/types/extension";
import type {
  BackgroundCaptureResponse,
  CapturePrepareResponse,
  CaptureRestoreResponse,
} from "@/types/capture";
import { isNonEmptyString, isPositiveInteger } from "@/types/capture";

export interface ScanPageMessage {
  readonly type: "SCAN_PAGE";
}

export interface ClearMarkersMessage {
  readonly type: "CLEAR_MARKERS";
}

export interface GetScanStatusMessage {
  readonly type: "GET_SCAN_STATUS";
}

export interface StartMockTranslationMessage {
  readonly type: "START_MOCK_TRANSLATION";
  readonly sourceLanguage: SourceLanguage;
  readonly targetLanguage: TargetLanguage;
}

export interface SetTranslationsVisibleMessage {
  readonly type: "SET_TRANSLATIONS_VISIBLE";
  readonly visible: boolean;
}

export interface ClearTranslationsMessage {
  readonly type: "CLEAR_TRANSLATIONS";
}

export interface GetTranslationStatusMessage {
  readonly type: "GET_TRANSLATION_STATUS";
}

export interface PrepareVisiblePageCaptureMessage {
  readonly type: "PREPARE_VISIBLE_PAGE_CAPTURE";
  readonly captureToken: string;
}

export interface RestoreAfterPageCaptureMessage {
  readonly type: "RESTORE_AFTER_PAGE_CAPTURE";
  readonly captureToken: string;
}

export interface CaptureFirstVisiblePageMessage {
  readonly type: "CAPTURE_FIRST_VISIBLE_PAGE";
  readonly tabId: number;
  readonly windowId: number;
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

export interface TranslationStatusResponse {
  readonly type: "TRANSLATION_STATUS";
  readonly totalPages: number;
  readonly queuedPages: number;
  readonly translatingPages: number;
  readonly completedPages: number;
  readonly failedPages: number;
  readonly translationsVisible: boolean;
}

export type TranslationCommandResponse =
  | { readonly success: true; readonly status: TranslationStatusResponse }
  | ScanErrorResponse;

// ── Union types ────────────────────────────────────────────────

export type PopupToContentMessage =
  | ScanPageMessage
  | ClearMarkersMessage
  | GetScanStatusMessage
  | StartMockTranslationMessage
  | SetTranslationsVisibleMessage
  | ClearTranslationsMessage
  | GetTranslationStatusMessage;

export type BackgroundToContentMessage =
  | PrepareVisiblePageCaptureMessage
  | RestoreAfterPageCaptureMessage;

export type ContentScriptMessage =
  | PopupToContentMessage
  | BackgroundToContentMessage;

export type PopupToBackgroundMessage = CaptureFirstVisiblePageMessage;

export type ExtensionMessage = PopupToContentMessage;
export type ScanPageResponse = ScanSuccessResponse | ScanErrorResponse;

export type CaptureContentResponse =
  | CapturePrepareResponse
  | CaptureRestoreResponse;

export type { BackgroundCaptureResponse };

const CONTENT_MESSAGE_TYPES = new Set<string>([
  "SCAN_PAGE",
  "CLEAR_MARKERS",
  "GET_SCAN_STATUS",
  "START_MOCK_TRANSLATION",
  "SET_TRANSLATIONS_VISIBLE",
  "CLEAR_TRANSLATIONS",
  "GET_TRANSLATION_STATUS",
  "PREPARE_VISIBLE_PAGE_CAPTURE",
  "RESTORE_AFTER_PAGE_CAPTURE",
]);

export function isContentScriptMessage(
  value: unknown
): value is ContentScriptMessage {
  if (typeof value !== "object" || value === null ||
      !("type" in value) || typeof value.type !== "string" ||
      !CONTENT_MESSAGE_TYPES.has(value.type)) return false;
  if (value.type === "PREPARE_VISIBLE_PAGE_CAPTURE" ||
      value.type === "RESTORE_AFTER_PAGE_CAPTURE") {
    return "captureToken" in value && isNonEmptyString(value.captureToken);
  }
  return true;
}

export function isPopupToBackgroundMessage(
  value: unknown
): value is PopupToBackgroundMessage {
  return typeof value === "object" && value !== null &&
    "type" in value && value.type === "CAPTURE_FIRST_VISIBLE_PAGE" &&
    "tabId" in value && isPositiveInteger(value.tabId) &&
    "windowId" in value && isPositiveInteger(value.windowId);
}
