import type { TranslationBubble } from "../../../types/translation";
import type { OcrRegion } from "./ocr-types";
import { OcrFailure } from "./ocr-errors";

export function ocrRegionsToBubbles(
  requestId: string,
  regions: readonly OcrRegion[]
): TranslationBubble[] {
  if (!requestId.trim()) throw new OcrFailure("ocr-invalid-response");
  const ids = new Set<string>();
  return regions.map((region, index) => {
    const id = `${requestId}-ocr-${index + 1}`;
    if (ids.has(id)) throw new OcrFailure("ocr-invalid-response");
    ids.add(id);
    return {
      id,
      bounds: region.bounds,
      originalText: region.text,
      translatedText: region.text,
    };
  });
}
