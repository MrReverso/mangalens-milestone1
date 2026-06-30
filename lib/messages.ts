// ── Message Types ──────────────────────────────────────────────
// All inter-script messages are defined here to avoid scattered
// untyped string literals throughout the project.

// ── Commands (popup → content) ─────────────────────────────────
import type { SourceLanguage, TargetLanguage } from "@/types/extension";

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

export type ExtensionMessage =
  | ScanPageMessage
  | ClearMarkersMessage
  | GetScanStatusMessage
  | StartMockTranslationMessage
  | SetTranslationsVisibleMessage
  | ClearTranslationsMessage
  | GetTranslationStatusMessage;

export type ScanPageResponse = ScanSuccessResponse | ScanErrorResponse;
