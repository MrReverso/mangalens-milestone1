import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MangaScannerController } from "@/lib/scanner-controller";

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const bubbles = [{
  id: "local-1",
  bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
  originalText: "Local source",
  translatedText: "Local demo",
}];

function addPage(): HTMLImageElement {
  const image = document.createElement("img");
  Object.defineProperties(image, {
    complete: { value: true },
    naturalWidth: { value: 800 },
    naturalHeight: { value: 1200 },
  });
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
    new DOMRect(10, 10, 800, 1200)
  );
  document.body.appendChild(image);
  return image;
}

describe("content-side local translation application", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      display: "",
      visibility: "",
      opacity: "1",
    } as CSSStyleDeclaration);
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("applies bubbles to the target page and renders editable DOM", () => {
    const controller = new MangaScannerController();
    controller.processImageCandidate(addPage());
    expect(controller.applyTranslationResult(
      "request-1", "mangalens-page-1", bubbles
    )).toEqual({
      success: true,
      pageId: "mangalens-page-1",
      bubbleCount: 1,
    });
    const bubble = document.querySelector<HTMLElement>(
      ".mangalens-translation-bubble"
    );
    expect(bubble?.textContent).toBe("Local demo");
    bubble?.click();
    expect(bubble?.querySelector("textarea")).not.toBeNull();
    controller.destroy();
  });

  it("is idempotent for the same request without duplicate elements", () => {
    const controller = new MangaScannerController();
    controller.processImageCandidate(addPage());
    controller.applyTranslationResult("request-1", "mangalens-page-1", bubbles);
    controller.applyTranslationResult("request-1", "mangalens-page-1", bubbles);
    expect(document.querySelectorAll(".mangalens-translation-bubble")).toHaveLength(1);
    expect(document.querySelectorAll("#mangalens-translation-overlay-root"))
      .toHaveLength(1);
    controller.destroy();
  });

  it("rejects missing, disconnected, and malformed target data", () => {
    const controller = new MangaScannerController();
    const image = addPage();
    controller.processImageCandidate(image);
    expect(controller.applyTranslationResult(
      "request-1", "missing", bubbles
    )).toMatchObject({ success: false, error: { code: "target-page-missing" } });
    image.remove();
    expect(controller.applyTranslationResult(
      "request-1", "mangalens-page-1", bubbles
    )).toMatchObject({
      success: false,
      error: { code: "target-page-disconnected" },
    });
    expect(controller.applyTranslationResult(
      "", "mangalens-page-1", bubbles
    )).toMatchObject({
      success: false,
      error: { code: "invalid-translation-response" },
    });
    controller.destroy();
  });

  it("full clear prevents late results from recreating pages", () => {
    const controller = new MangaScannerController();
    controller.processImageCandidate(addPage());
    controller.applyTranslationResult("request-1", "mangalens-page-1", bubbles);
    controller.messageHandler(
      { type: "CLEAR_MARKERS" },
      {} as chrome.runtime.MessageSender,
      () => undefined
    );
    expect(controller.applyTranslationResult(
      "request-2", "mangalens-page-1", bubbles
    )).toMatchObject({ success: false, error: { code: "target-page-missing" } });
    expect(document.querySelectorAll(".mangalens-translation-bubble")).toHaveLength(0);
    controller.destroy();
  });

  it("saved edits survive visibility changes", () => {
    const controller = new MangaScannerController();
    controller.processImageCandidate(addPage());
    controller.applyTranslationResult("request-1", "mangalens-page-1", bubbles);
    expect(controller.commitBubbleEdit(
      "mangalens-page-1", "local-1", "Edited local demo"
    )).toBe(true);
    let response: unknown;
    controller.messageHandler(
      { type: "SET_TRANSLATIONS_VISIBLE", visible: false },
      {} as chrome.runtime.MessageSender,
      (value) => { response = value; }
    );
    controller.messageHandler(
      { type: "SET_TRANSLATIONS_VISIBLE", visible: true },
      {} as chrome.runtime.MessageSender,
      (value) => { response = value; }
    );
    expect(response).toBeTruthy();
    expect(document.querySelector(".mangalens-translation-bubble")?.textContent)
      .toBe("Edited local demo");
    controller.destroy();
  });
});
