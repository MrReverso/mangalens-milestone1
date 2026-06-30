import { describe, expect, it } from "vitest";
import {
  validateTranslationApiRequestMetadata,
  validateTranslationApiErrorResponse,
  validateTranslationApiSuccessResponse,
} from "@/types/translation-api";

const valid = {
  contractVersion: 1,
  requestId: "request-1",
  pageId: "page-1",
  bubbles: [{
    id: "bubble-1",
    bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
    originalText: "Original",
    translatedText: "Translated",
  }],
};

describe("future translation API validation", () => {
  it("accepts a valid success response", () => {
    expect(validateTranslationApiSuccessResponse(valid)).toEqual(valid);
  });

  it("rejects invalid normalized coordinates", () => {
    expect(validateTranslationApiSuccessResponse({
      ...valid,
      bubbles: [{
        ...valid.bubbles[0],
        bounds: { x: 0.9, y: 0.1, width: 0.3, height: 0.2 },
      }],
    })).toBeNull();
  });

  it("rejects duplicate bubble IDs", () => {
    expect(validateTranslationApiSuccessResponse({
      ...valid,
      bubbles: [valid.bubbles[0], { ...valid.bubbles[0] }],
    })).toBeNull();
  });

  it("validates future request metadata without an endpoint", () => {
    const request = {
      contractVersion: 1,
      requestId: "request-1",
      pageId: "page-1",
      pageNumber: 1,
      sourceLanguage: "auto",
      targetLanguage: "en",
      capture: {
        pageId: "page-1",
        pageNumber: 1,
        method: "visible-tab-screenshot-crop",
        mimeType: "image/png",
        pixelWidth: 800,
        pixelHeight: 600,
        byteLength: 100,
        sha256: "a".repeat(64),
      },
    };
    expect(validateTranslationApiRequestMetadata(request)).toEqual(request);
    expect(validateTranslationApiRequestMetadata({
      ...request,
      endpoint: "https://example.invalid",
    })).toBeNull();
    expect(validateTranslationApiRequestMetadata({
      ...request,
      pageId: "different-page",
    })).toBeNull();
  });

  it("validates structured future errors", () => {
    const error = {
      contractVersion: 1,
      requestId: "request-1",
      error: { code: "invalid-image", message: "Image is invalid" },
    };
    expect(validateTranslationApiErrorResponse(error)).toEqual(error);
    expect(validateTranslationApiErrorResponse({
      ...error,
      stack: "private implementation detail",
    })).toBeNull();
  });
});
