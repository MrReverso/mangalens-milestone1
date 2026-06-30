import type { OcrProvider } from "./ocr-provider";
import type { OcrInput, OcrResult } from "./ocr-types";
import { OcrFailure } from "./ocr-errors";

export function isGoogleVisionExplicitlyEnabled(
  value: string | undefined
): boolean {
  return value === "true";
}

export class OptionalOcrProvider implements OcrProvider {
  readonly id;
  readonly execution;

  constructor(
    private readonly provider: OcrProvider,
    readonly enabled: boolean
  ) {
    this.id = provider.id;
    this.execution = provider.execution;
  }

  recognize(input: OcrInput, signal: AbortSignal): Promise<OcrResult> {
    if (!this.enabled) {
      return Promise.reject(new OcrFailure("ocr-provider-disabled"));
    }
    return this.provider.recognize(input, signal);
  }
}
