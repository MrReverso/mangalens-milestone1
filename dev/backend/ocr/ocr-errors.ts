export type OcrErrorCode =
  | "ocr-provider-disabled"
  | "ocr-not-configured"
  | "ocr-auth-failed"
  | "ocr-unavailable"
  | "ocr-rate-limited"
  | "ocr-timeout"
  | "ocr-response-too-large"
  | "ocr-invalid-response"
  | "ocr-no-text";

const OCR_ERROR_CODES = new Set<string>([
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

export class OcrFailure extends Error {
  constructor(readonly code: OcrErrorCode) {
    super(code);
    this.name = "OcrFailure";
  }
}

export function isOcrErrorCode(value: unknown): value is OcrErrorCode {
  return typeof value === "string" && OCR_ERROR_CODES.has(value);
}

export function ocrErrorCode(error: unknown): OcrErrorCode {
  if (error instanceof OcrFailure) return error.code;
  if (error instanceof DOMException && error.name === "AbortError") {
    return "ocr-timeout";
  }
  return "ocr-unavailable";
}

export function ocrErrorStatus(code: OcrErrorCode): number {
  switch (code) {
    case "ocr-provider-disabled":
      return 503;
    case "ocr-not-configured":
    case "ocr-auth-failed":
      return 503;
    case "ocr-rate-limited":
      return 429;
    case "ocr-timeout":
      return 408;
    case "ocr-response-too-large":
      return 502;
    case "ocr-invalid-response":
    case "ocr-no-text":
      return 422;
    case "ocr-unavailable":
      return 503;
  }
}
