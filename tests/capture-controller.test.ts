import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MangaScannerController } from "@/lib/scanner-controller";
import type {
  TranslatePageInput,
  TranslatePageResult,
  TranslationProvider,
} from "@/types/translation";

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

class ImmediateProvider implements TranslationProvider {
  translatePage(
    input: TranslatePageInput,
    _signal: AbortSignal
  ): Promise<TranslatePageResult> {
    return Promise.resolve({
      pageId: input.pageId,
      bubbles: [{
        id: `${input.pageId}-bubble-1`,
        bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
        originalText: "Original",
        translatedText: "Translated",
      }],
    });
  }
}

function createVisibleMangaImage(): HTMLImageElement {
  const image = document.createElement("img");
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 800 },
    naturalHeight: { configurable: true, value: 600 },
  });
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 30, 600, 500)
  );
  document.body.appendChild(image);
  return image;
}

function command(controller: MangaScannerController, message: unknown): void {
  controller.messageHandler(
    message,
    {} as chrome.runtime.MessageSender,
    vi.fn()
  );
}

async function translatedController(): Promise<MangaScannerController> {
  createVisibleMangaImage();
  const controller = new MangaScannerController(new ImmediateProvider());
  command(controller, { type: "SCAN_PAGE" });
  command(controller, {
    type: "START_MOCK_TRANSLATION",
    sourceLanguage: "auto",
    targetLanguage: "en",
  });
  await Promise.resolve();
  await Promise.resolve();
  return controller;
}

describe("MangaScannerController capture preparation", () => {
  beforeEach(() => {
    vi.stubGlobal("innerWidth", 1000);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", vi.fn(
      (callback: FrameRequestCallback) => {
        queueMicrotask(() => callback(0));
        return 1;
      }
    ));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      display: "",
      visibility: "",
      opacity: "1",
    } as CSSStyleDeclaration);
    document.querySelector("[data-mangalens-root]")?.remove();
    document.querySelector("[data-mangalens-translation-root]")?.remove();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("hides both overlay roots and waits two paint frames", async () => {
    const controller = await translatedController();
    const response = await controller.prepareVisiblePageCapture("token-1");
    expect(response.success).toBe(true);
    expect(vi.mocked(requestAnimationFrame)).toHaveBeenCalledTimes(2);
    expect(document.getElementById("mangalens-overlay-root")?.style.visibility)
      .toBe("hidden");
    expect(document.getElementById("mangalens-translation-overlay-root")
      ?.style.visibility).toBe("hidden");
    controller.restoreAfterPageCapture("token-1");
    controller.destroy();
  });

  it("saves a valid active edit before suppression", async () => {
    const controller = await translatedController();
    const bubble = document.querySelector<HTMLElement>(
      ".mangalens-translation-bubble"
    )!;
    bubble.click();
    bubble.querySelector<HTMLTextAreaElement>("textarea")!.value =
      "Saved for capture";
    const response = await controller.prepareVisiblePageCapture("token-2");
    expect(response.success).toBe(true);
    expect(document.querySelector("textarea")).toBeNull();
    expect(bubble.textContent).toBe("Saved for capture");
    controller.restoreAfterPageCapture("token-2");
    controller.destroy();
  });

  it("restores markers and preserves Show translations=false", async () => {
    const controller = await translatedController();
    command(controller, {
      type: "SET_TRANSLATIONS_VISIBLE",
      visible: false,
    });
    await controller.prepareVisiblePageCapture("token-3");
    expect(controller.restoreAfterPageCapture("token-3").success).toBe(true);
    expect(document.getElementById("mangalens-overlay-root")?.style.visibility)
      .toBe("visible");
    const translationRoot = document.getElementById(
      "mangalens-translation-overlay-root"
    );
    expect(translationRoot?.style.visibility).toBe("visible");
    expect(translationRoot?.style.display).toBe("none");
    controller.destroy();
  });

  it("does not let a mismatched token restore another capture", async () => {
    const controller = await translatedController();
    await controller.prepareVisiblePageCapture("token-4");
    expect(controller.restoreAfterPageCapture("wrong-token")).toEqual({
      success: false,
      error: { code: "capture-in-progress" },
    });
    expect(document.getElementById("mangalens-overlay-root")?.style.visibility)
      .toBe("hidden");
    controller.restoreAfterPageCapture("token-4");
    controller.destroy();
  });

  it("failsafe timer restores hidden overlays", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (
      callback: FrameRequestCallback
    ) => {
      callback(0);
      return 1;
    });
    const controller = await translatedController();
    await controller.prepareVisiblePageCapture("token-5");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(document.getElementById("mangalens-overlay-root")?.style.visibility)
      .toBe("visible");
    controller.destroy();
  });

  it("controller destruction restores overlays and clears capture state", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (
      callback: FrameRequestCallback
    ) => {
      callback(0);
      return 1;
    });
    const controller = await translatedController();
    await controller.prepareVisiblePageCapture("token-6");
    controller.destroy();
    expect(document.getElementById("mangalens-overlay-root")).toBeNull();
    expect(document.getElementById("mangalens-translation-overlay-root"))
      .toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns no fully visible page rather than capturing a partial image", async () => {
    const image = createVisibleMangaImage();
    vi.mocked(image.getBoundingClientRect).mockReturnValue(
      new DOMRect(20, -100, 600, 500)
    );
    const controller = new MangaScannerController();
    command(controller, { type: "SCAN_PAGE" });
    expect(await controller.prepareVisiblePageCapture("token-7")).toEqual({
      success: false,
      error: { code: "no-fully-visible-page" },
    });
    controller.destroy();
  });

  it("returns no-detected-pages before any scan", async () => {
    const controller = new MangaScannerController();
    expect(await controller.prepareVisiblePageCapture("token-empty")).toEqual({
      success: false,
      error: { code: "no-detected-pages" },
    });
    controller.destroy();
  });

  it("rejects a second prepared capture until the first is restored", async () => {
    const controller = await translatedController();
    expect((await controller.prepareVisiblePageCapture("token-a")).success)
      .toBe(true);
    expect(await controller.prepareVisiblePageCapture("token-b")).toEqual({
      success: false,
      error: { code: "capture-in-progress" },
    });
    controller.restoreAfterPageCapture("token-a");
    expect(controller.restoreAfterPageCapture("token-a")).toEqual({
      success: true,
    });
    controller.destroy();
  });

  it("restores overlays when the page moves during paint", async () => {
    const image = createVisibleMangaImage();
    const controller = new MangaScannerController();
    command(controller, { type: "SCAN_PAGE" });
    vi.mocked(image.getBoundingClientRect)
      .mockReturnValueOnce(new DOMRect(20, 30, 600, 500))
      .mockReturnValueOnce(new DOMRect(20, 60, 600, 500));
    expect(await controller.prepareVisiblePageCapture("token-move")).toEqual({
      success: false,
      error: { code: "page-moved" },
    });
    expect(document.getElementById("mangalens-overlay-root")?.style.visibility)
      .toBe("visible");
    controller.destroy();
  });

  it("ignores background-only capture commands intended for the service worker", () => {
    const controller = new MangaScannerController();
    const sendResponse = vi.fn();
    expect(controller.messageHandler(
      { type: "CAPTURE_FIRST_VISIBLE_PAGE", tabId: 1, windowId: 1 },
      {} as chrome.runtime.MessageSender,
      sendResponse
    )).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("can render and edit normally after capture restoration", async () => {
    const controller = await translatedController();
    await controller.prepareVisiblePageCapture("token-8");
    controller.restoreAfterPageCapture("token-8");
    const bubble = document.querySelector<HTMLElement>(
      ".mangalens-translation-bubble"
    )!;
    bubble.click();
    expect(bubble.querySelector("textarea")).not.toBeNull();
    controller.destroy();
  });
});
