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
    };
    expect(isTranslateVisiblePageMessage(request)).toBe(true);
    expect(isTranslateVisiblePageMessage({ ...request, targetLanguage: "xx" }))
      .toBe(false);
    expect(isTranslateVisiblePageMessage({ ...request, extra: true })).toBe(false);
  });

  it("validates apply messages and rejects bad bubble data", () => {
    const message = {
      type: "APPLY_TRANSLATION_RESULT",
      contractVersion: 1,
      requestId: "request-1",
      pageId: "page-1",
      bubbles: [bubble],
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
      localDemo: true,
    })).toBe(true);
    expect(isBackgroundTranslationResponse({
      success: true,
      pageId: "page-1",
      pageNumber: 1,
      bubbleCount: 3,
      localDemo: true,
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
