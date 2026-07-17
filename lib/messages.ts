// ── Message Types ──────────────────────────────────────────────
// All inter-script messages are defined here to avoid scattered
// untyped string literals throughout the project.

// ── Commands (popup → content) ─────────────────────────────────
import type { SourceLanguage, TargetLanguage } from "@/types/extension";
import type {
  BackgroundCaptureResponse,
  CapturePrepareResponse,
  CaptureRestoreResponse,
  CaptureSegmentPrepareResponse,
  SegmentedCaptureSessionStatus,
} from "@/types/capture";
import {
  isNonEmptyString,
  isPositiveInteger,
  isSegmentedCaptureSessionStatus,
} from "@/types/capture";
import type {
  ApplyTranslationResultMessage,
  ApplyTranslationResultResponse,
  BackgroundTranslationResponse,
  TranslateVisiblePageMessage,
} from "@/types/translation-pipeline";
import {
  isSourceLanguage,
  isTargetLanguage,
  isTranslateVisiblePageMessage,
  validateApplyTranslationResultMessage,
} from "@/types/translation-pipeline";

export interface ScanPageMessage {
  readonly type: "SCAN_PAGE";
}

export interface StartReaderSessionMessage {
  readonly type: "START_READER_SESSION";
}

export interface GetReaderSessionStatusMessage {
  readonly type: "GET_READER_SESSION_STATUS";
}

export interface StopReaderSessionMessage {
  readonly type: "STOP_READER_SESSION";
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

export interface PrepareCaptureSegmentMessage {
  readonly type: "PREPARE_CAPTURE_SEGMENT";
  readonly captureToken: string;
  readonly sessionId: string;
  readonly expectedPageId: string | null;
}

export interface CaptureFirstVisiblePageMessage {
  readonly type: "CAPTURE_FIRST_VISIBLE_PAGE";
  readonly tabId: number;
  readonly windowId: number;
}

export interface StartExpandedCaptureMessage {
  readonly type: "START_EXPANDED_CAPTURE";
  readonly tabId: number;
  readonly windowId: number;
  readonly sourceLanguage: SourceLanguage;
  readonly targetLanguage: TargetLanguage;
  readonly serviceMode: "development-api";
}

export interface CaptureExpandedSegmentMessage {
  readonly type: "CAPTURE_EXPANDED_SEGMENT";
  readonly tabId: number;
  readonly windowId: number;
  readonly sessionId: string;
}

export interface FinishExpandedCaptureMessage {
  readonly type: "FINISH_EXPANDED_CAPTURE";
  readonly tabId: number;
  readonly windowId: number;
  readonly sessionId: string;
}

export interface CancelExpandedCaptureMessage {
  readonly type: "CANCEL_EXPANDED_CAPTURE";
  readonly tabId: number;
  readonly sessionId: string;
}

export interface GetExpandedCaptureStatusMessage {
  readonly type: "GET_EXPANDED_CAPTURE_STATUS";
  readonly tabId: number;
  readonly windowId: number;
}

export type ExpandedCaptureResponse =
  | { readonly success: true; readonly status: SegmentedCaptureSessionStatus }
  | { readonly success: false; readonly error: { readonly code: string } };

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

export interface ReaderSessionStatusResponse {
  readonly type: "READER_SESSION_STATUS";
  readonly active: boolean;
  readonly title: string;
  readonly url: string;
  readonly totalPages: number;
  readonly currentPage: number | null;
  readonly translatedPages: number;
  readonly failedPages: number;
}

export type ReaderSessionCommandResponse =
  | { readonly success: true; readonly status: ReaderSessionStatusResponse }
  | ScanErrorResponse;

export type TranslationCommandResponse =
  | { readonly success: true; readonly status: TranslationStatusResponse }
  | ScanErrorResponse;

// ── Union types ────────────────────────────────────────────────

export type PopupToContentMessage =
  | ScanPageMessage
  | StartReaderSessionMessage
  | GetReaderSessionStatusMessage
  | StopReaderSessionMessage
  | ClearMarkersMessage
  | GetScanStatusMessage
  | StartMockTranslationMessage
  | SetTranslationsVisibleMessage
  | ClearTranslationsMessage
  | GetTranslationStatusMessage;

export type BackgroundToContentMessage =
  | PrepareVisiblePageCaptureMessage
  | PrepareCaptureSegmentMessage
  | RestoreAfterPageCaptureMessage
  | ApplyTranslationResultMessage;

export type ContentScriptMessage =
  | PopupToContentMessage
  | BackgroundToContentMessage;

export type PopupToBackgroundMessage =
  | CaptureFirstVisiblePageMessage
  | TranslateVisiblePageMessage
  | StartExpandedCaptureMessage
  | CaptureExpandedSegmentMessage
  | FinishExpandedCaptureMessage
  | CancelExpandedCaptureMessage
  | GetExpandedCaptureStatusMessage;

export type ExtensionMessage = PopupToContentMessage;
export type ScanPageResponse = ScanSuccessResponse | ScanErrorResponse;

export type CaptureContentResponse =
  | CapturePrepareResponse
  | CaptureSegmentPrepareResponse
  | CaptureRestoreResponse;

export type { BackgroundCaptureResponse };
export type {
  ApplyTranslationResultResponse,
  BackgroundTranslationResponse,
  TranslateVisiblePageMessage,
};

const CONTENT_MESSAGE_TYPES = new Set<string>([
  "SCAN_PAGE",
  "START_READER_SESSION",
  "GET_READER_SESSION_STATUS",
  "STOP_READER_SESSION",
  "CLEAR_MARKERS",
  "GET_SCAN_STATUS",
  "START_MOCK_TRANSLATION",
  "SET_TRANSLATIONS_VISIBLE",
  "CLEAR_TRANSLATIONS",
  "GET_TRANSLATION_STATUS",
  "PREPARE_VISIBLE_PAGE_CAPTURE",
  "PREPARE_CAPTURE_SEGMENT",
  "RESTORE_AFTER_PAGE_CAPTURE",
  "APPLY_TRANSLATION_RESULT",
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
  if (value.type === "PREPARE_CAPTURE_SEGMENT") {
    return "captureToken" in value && isNonEmptyString(value.captureToken) &&
      "sessionId" in value && isNonEmptyString(value.sessionId) &&
      "expectedPageId" in value &&
      (value.expectedPageId === null || isNonEmptyString(value.expectedPageId));
  }
  if (value.type === "APPLY_TRANSLATION_RESULT") {
    return validateApplyTranslationResultMessage(value) !== null;
  }
  return true;
}

export function isCaptureFirstVisiblePageMessage(
  value: unknown
): value is CaptureFirstVisiblePageMessage {
  return typeof value === "object" && value !== null &&
    "type" in value && value.type === "CAPTURE_FIRST_VISIBLE_PAGE" &&
    "tabId" in value && isPositiveInteger(value.tabId) &&
    "windowId" in value && isPositiveInteger(value.windowId);
}

export function isPopupToBackgroundMessage(
  value: unknown
): value is PopupToBackgroundMessage {
  return isCaptureFirstVisiblePageMessage(value) ||
    isTranslateVisiblePageMessage(value) ||
    isStartExpandedCaptureMessage(value) ||
    isCaptureExpandedSegmentMessage(value) ||
    isFinishExpandedCaptureMessage(value) ||
    isCancelExpandedCaptureMessage(value) ||
    isGetExpandedCaptureStatusMessage(value);
}

export function isStartExpandedCaptureMessage(
  value: unknown
): value is StartExpandedCaptureMessage {
  return isRecordWithKeys(value, [
    "type", "tabId", "windowId", "sourceLanguage", "targetLanguage", "serviceMode",
  ]) && value.type === "START_EXPANDED_CAPTURE" &&
    isPositiveInteger(value.tabId) && isPositiveInteger(value.windowId) &&
    isSourceLanguage(value.sourceLanguage) && isTargetLanguage(value.targetLanguage) &&
    value.serviceMode === "development-api";
}

export function isCaptureExpandedSegmentMessage(
  value: unknown
): value is CaptureExpandedSegmentMessage {
  return isRecordWithKeys(value, ["type", "tabId", "windowId", "sessionId"]) &&
    value.type === "CAPTURE_EXPANDED_SEGMENT" &&
    isPositiveInteger(value.tabId) && isPositiveInteger(value.windowId) &&
    isNonEmptyString(value.sessionId);
}

export function isFinishExpandedCaptureMessage(
  value: unknown
): value is FinishExpandedCaptureMessage {
  return isRecordWithKeys(value, ["type", "tabId", "windowId", "sessionId"]) &&
    value.type === "FINISH_EXPANDED_CAPTURE" &&
    isPositiveInteger(value.tabId) && isPositiveInteger(value.windowId) &&
    isNonEmptyString(value.sessionId);
}

export function isCancelExpandedCaptureMessage(
  value: unknown
): value is CancelExpandedCaptureMessage {
  return isRecordWithKeys(value, ["type", "tabId", "sessionId"]) &&
    value.type === "CANCEL_EXPANDED_CAPTURE" &&
    isPositiveInteger(value.tabId) && isNonEmptyString(value.sessionId);
}

export function isGetExpandedCaptureStatusMessage(
  value: unknown
): value is GetExpandedCaptureStatusMessage {
  return isRecordWithKeys(value, ["type", "tabId", "windowId"]) &&
    value.type === "GET_EXPANDED_CAPTURE_STATUS" &&
    isPositiveInteger(value.tabId) && isPositiveInteger(value.windowId);
}

export function isExpandedCaptureResponse(
  value: unknown
): value is ExpandedCaptureResponse {
  if (typeof value !== "object" || value === null ||
      !("success" in value) || typeof value.success !== "boolean") return false;
  if (value.success) {
    return Object.keys(value).length === 2 && "status" in value &&
      isSegmentedCaptureSessionStatus(value.status);
  }
  return Object.keys(value).length === 2 && "error" in value &&
    typeof value.error === "object" && value.error !== null &&
    "code" in value.error && typeof value.error.code === "string";
}

export function isReaderSessionStatusResponse(
  value: unknown
): value is ReaderSessionStatusResponse {
  return isRecordWithKeys(value, [
    "type", "active", "title", "url", "totalPages", "currentPage",
    "translatedPages", "failedPages",
  ]) && value.type === "READER_SESSION_STATUS" &&
    typeof value.active === "boolean" &&
    typeof value.title === "string" && typeof value.url === "string" &&
    Number.isSafeInteger(value.totalPages) && (value.totalPages as number) >= 0 &&
    (value.currentPage === null ||
      Number.isSafeInteger(value.currentPage) && (value.currentPage as number) > 0) &&
    Number.isSafeInteger(value.translatedPages) &&
    (value.translatedPages as number) >= 0 &&
    Number.isSafeInteger(value.failedPages) && (value.failedPages as number) >= 0;
}

export function isReaderSessionCommandResponse(
  value: unknown
): value is ReaderSessionCommandResponse {
  if (typeof value !== "object" || value === null ||
      !("success" in value) || typeof value.success !== "boolean") return false;
  if (value.success) {
    return Object.keys(value).length === 2 && "status" in value &&
      isReaderSessionStatusResponse(value.status);
  }
  return Object.keys(value).length === 2 && "error" in value &&
    typeof value.error === "string";
}

function isRecordWithKeys(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value);
}
