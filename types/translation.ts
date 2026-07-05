import type { SourceLanguage, TargetLanguage } from "@/types/extension";

export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export type NormalizedQuadrilateral = readonly [
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
];

export interface TranslationBubble {
  readonly id: string;
  readonly bounds: NormalizedRect;
  readonly polygon?: NormalizedQuadrilateral;
  readonly orientation?: "horizontal" | "vertical";
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

export function validateNormalizedQuadrilateral(
  points: readonly NormalizedPoint[],
  bounds: NormalizedRect
): NormalizedQuadrilateral {
  if (points.length !== 4) {
    throw new Error("Bubble polygon must contain exactly four points");
  }
  const normalized = points.map((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 ||
        point.x < bounds.x || point.x > bounds.x + bounds.width ||
        point.y < bounds.y || point.y > bounds.y + bounds.height) {
      throw new Error("Bubble polygon must fit within normalized bounds");
    }
    return { x: point.x, y: point.y };
  });
  const area = Math.abs(normalized.reduce((sum, point, index) => {
    const next = normalized[(index + 1) % normalized.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  if (!Number.isFinite(area) || area <= Number.EPSILON) {
    throw new Error("Bubble polygon must have positive area");
  }
  return [
    normalized[0],
    normalized[1],
    normalized[2],
    normalized[3],
  ];
}
