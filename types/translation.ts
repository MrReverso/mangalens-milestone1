import type { SourceLanguage, TargetLanguage } from "@/types/extension";

export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TranslationBubble {
  readonly id: string;
  readonly bounds: NormalizedRect;
  readonly originalText: string;
  readonly translatedText: string;
}

export type PageTranslationStatus =
  | "detected"
  | "queued"
  | "translating"
  | "complete"
  | "error";

export interface PageTranslation {
  readonly pageId: string;
  readonly pageNumber: number;
  status: PageTranslationStatus;
  bubbles: TranslationBubble[];
  error?: string;
}

export interface TranslatePageInput {
  readonly pageId: string;
  readonly pageNumber: number;
  readonly sourceLanguage: SourceLanguage;
  readonly targetLanguage: TargetLanguage;
}

export interface TranslatePageResult {
  readonly pageId: string;
  readonly bubbles: TranslationBubble[];
}

export interface TranslationProvider {
  translatePage(
    input: TranslatePageInput,
    signal: AbortSignal
  ): Promise<TranslatePageResult>;
}

export function validateNormalizedRect(bounds: NormalizedRect): NormalizedRect {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (!values.every(Number.isFinite)) {
    throw new Error("Bubble coordinates must be finite");
  }
  if (bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 ||
      bounds.height <= 0 || bounds.x + bounds.width > 1 ||
      bounds.y + bounds.height > 1) {
    throw new Error("Bubble coordinates must fit within normalized bounds");
  }
  return bounds;
}
