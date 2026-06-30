import type { CaptureErrorCode } from "@/types/capture";
import {
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
} from "@/types/capture";
import type { SourceLanguage, TargetLanguage } from "@/types/extension";
import type { TranslationBubble } from "@/types/translation";
import { validateTranslationApiSuccessResponse } from "@/types/translation-api";

export type TranslationServiceMode = "local-demo" | "development-api";
export type TranslationResultKind = "local-demo" | "ocr-preview";

export type TranslationPipelineStage = "capturing" | "processing" | "applying";

export interface TranslateVisiblePageMessage {
  readonly type: "TRANSLATE_VISIBLE_PAGE_LOCAL";
  readonly tabId: number;
  readonly windowId: number;
  readonly sourceLanguage: SourceLanguage;
  readonly targetLanguage: TargetLanguage;
  readonly serviceMode: TranslationServiceMode;
}

export interface ApplyTranslationResultMessage {
  readonly type: "APPLY_TRANSLATION_RESULT";
  readonly contractVersion: 1;
  readonly requestId: string;
  readonly pageId: string;
  readonly bubbles: TranslationBubble[];
  readonly expiresAt: number;
  readonly operationSequence: number;
}

export type ApplyTranslationResultResponse =
  | {
      readonly success: true;
      readonly pageId: string;
      readonly bubbleCount: number;
    }
  | {
      readonly success: false;
      readonly error: {
        readonly code:
          | "target-page-missing"
          | "target-page-disconnected"
          | "stale-translation-result"
          | "invalid-translation-response"
          | "apply-failed";
      };
    };

export type TranslationPipelineErrorCode =
  | CaptureErrorCode
  | "translation-in-progress"
  | "invalid-language"
  | "invalid-service-mode"
  | "invalid-translation-response"
  | "translation-service-failed"
  | "target-page-missing"
  | "target-page-disconnected"
  | "stale-translation-result"
  | "apply-failed"
  | "backend-unavailable"
  | "backend-request-failed"
  | "backend-http-error"
  | "backend-invalid-content-type"
  | "backend-response-too-large"
  | "backend-invalid-json"
  | "backend-invalid-response"
  | "backend-timeout"
  | "ocr-provider-disabled"
  | "ocr-not-configured"
  | "ocr-auth-failed"
  | "ocr-unavailable"
  | "ocr-rate-limited"
  | "ocr-timeout"
  | "ocr-response-too-large"
  | "ocr-invalid-response"
  | "ocr-no-text";

export type BackgroundTranslationResponse =
  | {
      readonly success: true;
      readonly pageId: string;
      readonly pageNumber: number;
      readonly bubbleCount: number;
      readonly resultKind: TranslationResultKind;
      readonly serviceMode: TranslationServiceMode;
    }
  | {
      readonly success: false;
      readonly error: { readonly code: TranslationPipelineErrorCode };
    };

export interface TranslationPipelineProgressMessage {
  readonly type: "TRANSLATION_PIPELINE_PROGRESS";
  readonly tabId: number;
  readonly stage: TranslationPipelineStage;
}

const SOURCE_LANGUAGES = new Set<string>(["auto", "ja", "ko", "zh"]);
const TARGET_LANGUAGES = new Set<string>(["en", "es", "pt", "fr", "it", "de"]);
const PIPELINE_ERRORS = new Set<string>([
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
  "unsupported-browser",
  "restricted-page",
  "timeout",
  "unexpected-error",
  "translation-in-progress",
  "invalid-language",
  "invalid-service-mode",
  "invalid-translation-response",
  "translation-service-failed",
  "target-page-missing",
  "target-page-disconnected",
  "stale-translation-result",
  "apply-failed",
  "backend-unavailable",
  "backend-request-failed",
  "backend-http-error",
  "backend-invalid-content-type",
  "backend-response-too-large",
  "backend-invalid-json",
  "backend-invalid-response",
  "backend-timeout",
  "ocr-provider-disabled",
  "ocr-not-configured",
  "ocr-auth-failed",
  "ocr-unavailable",
  "ocr-rate-limited",
  "ocr-timeout",
  "ocr-response-too-large",
  "ocr-invalid-response",
  "ocr-no-text",
]);

export function isSourceLanguage(value: unknown): value is SourceLanguage {
  return typeof value === "string" && SOURCE_LANGUAGES.has(value);
}

export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return typeof value === "string" && TARGET_LANGUAGES.has(value);
}

export function isTranslateVisiblePageMessage(
  value: unknown
): value is TranslateVisiblePageMessage {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "type", "tabId", "windowId", "sourceLanguage", "targetLanguage", "serviceMode",
    ]) &&
    value.type === "TRANSLATE_VISIBLE_PAGE_LOCAL" &&
    isPositiveInteger(value.tabId) &&
    isPositiveInteger(value.windowId) &&
    isSourceLanguage(value.sourceLanguage) &&
    isTargetLanguage(value.targetLanguage) &&
    (value.serviceMode === "local-demo" || value.serviceMode === "development-api");
}

export function validateApplyTranslationResultMessage(
  value: unknown
): ApplyTranslationResultMessage | null {
  if (!isRecord(value) ||
      !hasOnlyKeys(value, [
        "type", "contractVersion", "requestId", "pageId", "bubbles", "expiresAt", "operationSequence",
      ]) ||
      value.type !== "APPLY_TRANSLATION_RESULT") {
    return null;
  }
  if (typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) {
    return null;
  }
  if (typeof value.operationSequence !== "number" || !Number.isSafeInteger(value.operationSequence) || value.operationSequence <= 0) {
    return null;
  }
  const validated = validateTranslationApiSuccessResponse({
    contractVersion: value.contractVersion,
    requestId: value.requestId,
    pageId: value.pageId,
    bubbles: value.bubbles,
  });
  return validated
    ? {
        type: "APPLY_TRANSLATION_RESULT",
        expiresAt: value.expiresAt,
        operationSequence: value.operationSequence,
        ...validated,
      }
    : null;
}

export function isApplyTranslationResultResponse(
  value: unknown
): value is ApplyTranslationResultResponse {
  if (!isRecord(value) || typeof value.success !== "boolean") return false;
  if (value.success) {
    return hasOnlyKeys(value, ["success", "pageId", "bubbleCount"]) &&
      isNonEmptyString(value.pageId) &&
      Number.isInteger(value.bubbleCount) &&
      typeof value.bubbleCount === "number" &&
      value.bubbleCount >= 0;
  }
  return hasOnlyKeys(value, ["success", "error"]) &&
    isRecord(value.error) &&
    hasOnlyKeys(value.error, ["code"]) &&
    [
      "target-page-missing",
      "target-page-disconnected",
      "stale-translation-result",
      "invalid-translation-response",
      "apply-failed",
    ].includes(String(value.error.code));
}

export function isBackgroundTranslationResponse(
  value: unknown
): value is BackgroundTranslationResponse {
  if (!isRecord(value) || typeof value.success !== "boolean") return false;
  if (value.success) {
    return hasOnlyKeys(value, [
      "success", "pageId", "pageNumber", "bubbleCount", "resultKind", "serviceMode",
    ]) &&
      isNonEmptyString(value.pageId) &&
      isPositiveInteger(value.pageNumber) &&
      Number.isInteger(value.bubbleCount) &&
      typeof value.bubbleCount === "number" &&
      value.bubbleCount >= 0 &&
      (value.serviceMode === "local-demo" || value.serviceMode === "development-api") &&
      ((value.serviceMode === "local-demo" && value.resultKind === "local-demo") ||
       (value.serviceMode === "development-api" &&
        value.resultKind === "ocr-preview"));
  }
  return hasOnlyKeys(value, ["success", "error"]) &&
    isRecord(value.error) &&
    hasOnlyKeys(value.error, ["code"]) &&
    typeof value.error.code === "string" &&
    PIPELINE_ERRORS.has(value.error.code);
}

export function isTranslationPipelineProgressMessage(
  value: unknown
): value is TranslationPipelineProgressMessage {
  return isRecord(value) &&
    hasOnlyKeys(value, ["type", "tabId", "stage"]) &&
    value.type === "TRANSLATION_PIPELINE_PROGRESS" &&
    isPositiveInteger(value.tabId) &&
    (value.stage === "capturing" ||
      value.stage === "processing" ||
      value.stage === "applying");
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key)) &&
    allowed.every((key) => key in value);
}
