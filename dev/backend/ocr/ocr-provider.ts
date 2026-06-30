import type { OcrInput, OcrResult } from "./ocr-types";

export interface OcrProvider {
  recognize(input: OcrInput, signal: AbortSignal): Promise<OcrResult>;
}
