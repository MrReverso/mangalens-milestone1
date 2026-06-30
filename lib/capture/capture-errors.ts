import type { CaptureErrorCode } from "@/types/capture";

export class CaptureFailure extends Error {
  constructor(readonly code: CaptureErrorCode) {
    super(code);
    this.name = "CaptureFailure";
  }
}

export function captureErrorCode(error: unknown): CaptureErrorCode {
  return error instanceof CaptureFailure ? error.code : "unexpected-error";
}
