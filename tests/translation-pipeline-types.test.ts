import { describe, expect, it } from "vitest";
import {
  isApplyTranslationResultResponse,
  isBackgroundTranslationResponse,
  isTranslateVisiblePageMessage,
  validateApplyTranslationResultMessage,
} from "@/types/translation-pipeline";
import { translationPipelineErrorMessage } from "@/lib/translation/translation-pipeline-status";

const bubble = {
  id: "bubble-1",
  bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
  originalText: "Local source",
  translatedText: "Local demo",
};

describe("translation pipeline boundaries", () => {
  it("strictly validates popup requests and languages", () => {
    const request = {
      type: "TRANSLATE_VISIBLE_PAGE_LOCAL",
      tabId: 1,
      windowId: 2,
      sourceLanguage: "auto",
      targetLanguage: "it",
      serviceMode: "local-demo",
    };
    expect(isTranslateVisiblePageMessage(request)).toBe(true);
    expect(isTranslateVisiblePageMessage({ ...request, targetLanguage: "xx" }))
      .toBe(false);
    expect(isTranslateVisiblePageMessage({ ...request, extra: true })).toBe(false);
  });

  it("validates apply messages and rejects bad bubble data", () => {
    const message = {
      type: "APPLY_TRANSLATION_RESULT" as const,
      contractVersion: 1 as const,
      requestId: "request-1",
      pageId: "page-1",
      bubbles: [bubble],
      expiresAt: 100000,
      operationSequence: 1,
    };
    expect(validateApplyTranslationResultMessage(message)).toEqual(message);
    expect(validateApplyTranslationResultMessage({
      ...message,
      bubbles: [bubble, bubble],
    })).toBeNull();
    expect(validateApplyTranslationResultMessage({
      ...message,
      bubbles: [{ ...bubble, translatedText: " " }],
    })).toBeNull();
    expect(validateApplyTranslationResultMessage({
      ...message,
      bubbles: [{ ...bubble, bounds: { ...bubble.bounds, x: 0.9 } }],
    })).toBeNull();
  });

  it("validates safe apply and popup responses", () => {
    expect(isApplyTranslationResultResponse({
      success: true,
      pageId: "page-1",
      bubbleCount: 3,
    })).toBe(true);
    expect(isBackgroundTranslationResponse({
      success: true,
      pageId: "page-1",
      pageNumber: 1,
      bubbleCount: 3,
      demo: true,
      serviceMode: "local-demo",
    })).toBe(true);
    expect(isBackgroundTranslationResponse({
      success: true,
      pageId: "page-1",
      pageNumber: 1,
      bubbleCount: 3,
      demo: true,
      serviceMode: "local-demo",
      blob: new Blob(),
    })).toBe(false);
  });

  it("maps pipeline errors without raw details", () => {
    expect(translationPipelineErrorMessage("target-page-missing"))
      .toBe("The manga page is no longer available");
    expect(translationPipelineErrorMessage("active-tab-changed"))
      .toBe("The active tab changed. Return to the manga tab and try again");
  });
});
