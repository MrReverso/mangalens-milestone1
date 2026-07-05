import type { OcrInput, OcrResult } from "./ocr-types";

export type OcrProviderId =
  | "dbnet-ocr48px"
  | "google-vision"
  | "test-fake";
export type OcrExecution = "local" | "remote";

export interface OcrProvider {
  readonly id: OcrProviderId;
  readonly execution: OcrExecution;
  readonly enabled: boolean;
  recognize(input: OcrInput, signal: AbortSignal): Promise<OcrResult>;
}
