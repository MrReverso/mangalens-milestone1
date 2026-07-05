import type { SourceLanguage, TargetLanguage } from "@/types/extension";
import type { CaptureMetadata } from "@/types/capture";
import type { TranslationBubble } from "@/types/translation";
import { validateNormalizedRect } from "@/types/translation";
import { normalizeTranslationText } from "@/lib/translation-text";
import {
  isFiniteNumber,
  isCaptureMetadata,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
} from "@/types/capture";

export interface TranslationApiRequestMetadata {
  readonly contractVersion: 1;
  readonly requestId: string;
  readonly pageId: string;
  readonly pageNumber: number;
  readonly sourceLanguage: SourceLanguage;
  readonly targetLanguage: TargetLanguage;
  readonly capture: CaptureMetadata;
}

export interface TranslationApiSuccessResponse {
  readonly contractVersion: 1;
  readonly requestId: string;
  readonly pageId: string;
  readonly bubbles: TranslationBubble[];
}

export interface TranslationApiErrorResponse {
  readonly contractVersion: 1;
  readonly requestId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

/**
 * Future multipart requests will contain one JSON metadata part and one
 * binary image/png part. Milestone 3A defines validation only—no API client.
 */
export function validateTranslationApiSuccessResponse(
  value: unknown
): TranslationApiSuccessResponse | null {
  if (!isRecord(value) || value.contractVersion !== 1 ||
      !hasOnlyKeys(value, ["contractVersion", "requestId", "pageId", "bubbles"]) ||
      !isNonEmptyString(value.requestId) ||
      !isNonEmptyString(value.pageId) ||
      !Array.isArray(value.bubbles)) {
    return null;
  }

  const ids = new Set<string>();
  const bubbles: TranslationBubble[] = [];
  for (const rawBubble of value.bubbles) {
    if (!isRecord(rawBubble) ||
        !hasOnlyKeys(rawBubble, [
          "id", "bounds", "orientation", "originalText", "translatedText",
        ]) ||
        !isNonEmptyString(rawBubble.id) ||
      ids.has(rawBubble.id) ||
        !isRecord(rawBubble.bounds) ||
        !hasOnlyKeys(rawBubble.bounds, ["x", "y", "width", "height"]) ||
      !isFiniteNumber(rawBubble.bounds.x) ||
      !isFiniteNumber(rawBubble.bounds.y) ||
      !isFiniteNumber(rawBubble.bounds.width) ||
      !isFiniteNumber(rawBubble.bounds.height) ||
      (rawBubble.orientation !== undefined &&
        rawBubble.orientation !== "horizontal" &&
        rawBubble.orientation !== "vertical") ||
      !isNonEmptyString(rawBubble.originalText) ||
        typeof rawBubble.translatedText !== "string") {
      return null;
    }
    const translatedText = normalizeTranslationText(rawBubble.translatedText);
    if (!translatedText) return null;
    try {
      const bounds = validateNormalizedRect({
        x: rawBubble.bounds.x,
        y: rawBubble.bounds.y,
        width: rawBubble.bounds.width,
        height: rawBubble.bounds.height,
      });
      ids.add(rawBubble.id);
      bubbles.push({
        id: rawBubble.id,
        bounds,
        ...(rawBubble.orientation
          ? { orientation: rawBubble.orientation }
          : {}),
        originalText: rawBubble.originalText,
        translatedText,
      });
    } catch {
      return null;
    }
  }

  return {
    contractVersion: 1,
    requestId: value.requestId,
    pageId: value.pageId,
    bubbles,
  };
}

const SOURCE_LANGUAGES = new Set<string>(["auto", "ja", "ko", "zh"]);
const TARGET_LANGUAGES = new Set<string>(["en", "es", "pt", "fr", "it", "de"]);

export function validateTranslationApiRequestMetadata(
  value: unknown
): TranslationApiRequestMetadata | null {
  if (!isRecord(value) ||
      !hasOnlyKeys(value, [
        "contractVersion",
        "requestId",
        "pageId",
        "pageNumber",
        "sourceLanguage",
        "targetLanguage",
        "capture",
      ]) ||
      value.contractVersion !== 1 ||
      !isNonEmptyString(value.requestId) ||
      !isNonEmptyString(value.pageId) ||
      !isPositiveInteger(value.pageNumber) ||
      !isSourceLanguage(value.sourceLanguage) ||
      !isTargetLanguage(value.targetLanguage) ||
      !isCaptureMetadata(value.capture) ||
      value.capture.pageId !== value.pageId ||
      value.capture.pageNumber !== value.pageNumber) {
    return null;
  }
  return {
    contractVersion: 1,
    requestId: value.requestId,
    pageId: value.pageId,
    pageNumber: value.pageNumber,
    sourceLanguage: value.sourceLanguage,
    targetLanguage: value.targetLanguage,
    capture: value.capture,
  };
}

export function validateTranslationApiErrorResponse(
  value: unknown
): TranslationApiErrorResponse | null {
  if (!isRecord(value) ||
      !hasOnlyKeys(value, ["contractVersion", "requestId", "error"]) ||
      value.contractVersion !== 1 ||
      !isNonEmptyString(value.requestId) ||
      !isRecord(value.error) ||
      !hasOnlyKeys(value.error, ["code", "message"]) ||
      !isNonEmptyString(value.error.code) ||
      !isNonEmptyString(value.error.message)) {
    return null;
  }
  return {
    contractVersion: 1,
    requestId: value.requestId,
    error: {
      code: value.error.code,
      message: value.error.message,
    },
  };
}

function isSourceLanguage(value: unknown): value is SourceLanguage {
  return typeof value === "string" && SOURCE_LANGUAGES.has(value);
}

function isTargetLanguage(value: unknown): value is TargetLanguage {
  return typeof value === "string" && TARGET_LANGUAGES.has(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}
