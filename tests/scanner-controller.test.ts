import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MangaScannerController } from "@/lib/scanner-controller";
import type {
  ExtensionMessage,
  ScanPageResponse,
  ScanStatusResponse,
  TranslationCommandResponse,
  TranslationStatusResponse,
  CaptureContentResponse,
  ApplyTranslationResultResponse,
  ReaderSessionCommandResponse,
  ReaderSessionStatusResponse,
} from "@/lib/messages";
import type {
  TranslatePageInput,
  TranslatePageResult,
  TranslationProvider,
} from "@/types/translation";

class ImmediateProvider implements TranslationProvider {
  calls: TranslatePageInput[] = [];

  translatePage(
    input: TranslatePageInput,
    _signal: AbortSignal
  ): Promise<TranslatePageResult> {
    this.calls.push(input);
    return Promise.resolve({
      pageId: input.pageId,
      bubbles: [{
        id: `${input.pageId}-bubble-1`,
        bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
        originalText: "Mock original",
        translatedText: "Mock translated",
      }],
    });
  }
}

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor() {
    ResizeObserverMock.instances.push(this);
  }
}

function createMangaImage(loaded = true): HTMLImageElement {
  const image = document.createElement("img");
  Object.defineProperties(image, {
    complete: { configurable: true, value: loaded },
    naturalWidth: { configurable: true, value: loaded ? 800 : 0 },
    naturalHeight: { configurable: true, value: loaded ? 1200 : 0 },
  });
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
    new DOMRect(10, 20, 800, 1200)
  );
  return image;
}

function send(
  controller: MangaScannerController,
  message: ExtensionMessage
): ScanPageResponse | ScanStatusResponse | TranslationCommandResponse |
  TranslationStatusResponse | CaptureContentResponse |
  ApplyTranslationResultResponse | ReaderSessionCommandResponse |
  ReaderSessionStatusResponse {
  let response: ScanPageResponse | ScanStatusResponse |
    TranslationCommandResponse | TranslationStatusResponse |
    CaptureContentResponse | ApplyTranslationResultResponse |
    ReaderSessionCommandResponse | ReaderSessionStatusResponse | undefined;
  controller.messageHandler(
    message,
    {} as chrome.runtime.MessageSender,
    (value) => {
      response = value;
    }
  );
  if (!response) throw new Error("Controller did not respond");
  return response;
}

describe("MangaScannerController", () => {
  beforeEach(() => {
    ResizeObserverMock.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
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
    document.querySelector("[data-mangalens-root]")?.remove();
    document.querySelector("[data-mangalens-translation-root]")?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("detects the same image after clear then rescan", () => {
    const image = createMangaImage();
    document.body.appendChild(image);
    const controller = new MangaScannerController();

    expect(send(controller, { type: "SCAN_PAGE" })).toMatchObject({
      success: true,
      detectedImages: 1,
    });
    expect(send(controller, { type: "CLEAR_MARKERS" })).toMatchObject({
      success: true,
      detectedImages: 0,
    });
    expect(send(controller, { type: "SCAN_PAGE" })).toMatchObject({
      success: true,
      detectedImages: 1,
    });

    controller.destroy();
  });

  it("starts and stops a chapter reader session without losing cleanup", () => {
    document.title = "  Chapter 42   | Manga Site  ";
    const first = createMangaImage();
    const second = createMangaImage();
    document.body.append(first, second);
    const controller = new MangaScannerController();

    expect(send(controller, { type: "START_READER_SESSION" })).toMatchObject({
      success: true,
      status: {
        active: true,
        title: "Chapter 42 | Manga Site",
        totalPages: 2,
        currentPage: 1,
        translatedPages: 0,
      },
    });
    expect(document.getElementById("mangalens-overlay-root")?.style.display)
      .toBe("none");
    expect(send(controller, { type: "GET_READER_SESSION_STATUS" }))
      .toMatchObject({ active: true, totalPages: 2 });

    expect(send(controller, { type: "STOP_READER_SESSION" })).toMatchObject({
      success: true,
      status: { active: false, totalPages: 0 },
    });
    expect(document.querySelectorAll(".mangalens-marker")).toHaveLength(0);
    controller.destroy();
  });

  it("keeps discovering lazy chapter pages while reader mode is active", () => {
    const first = createMangaImage();
    document.body.appendChild(first);
    const controller = new MangaScannerController();
    send(controller, { type: "START_READER_SESSION" });

    const next = createMangaImage();
    document.body.appendChild(next);
    next.parentElement?.dispatchEvent(new Event("unused"));
    controller.processImageCandidate(next);

    expect(send(controller, { type: "GET_READER_SESSION_STATUS" }))
      .toMatchObject({ active: true, totalPages: 2 });
    controller.destroy();
  });

  it("processes an initially unloaded lazy image after its load event", () => {
    const image = createMangaImage(false);
    document.body.appendChild(image);
    const controller = new MangaScannerController();

    send(controller, { type: "SCAN_PAGE" });
    expect(document.querySelectorAll(".mangalens-marker")).toHaveLength(0);

    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 800 },
      naturalHeight: { configurable: true, value: 1200 },
    });
    image.dispatchEvent(new Event("load"));

    expect(document.querySelectorAll(".mangalens-marker")).toHaveLength(1);
    expect(send(controller, { type: "GET_SCAN_STATUS" })).toMatchObject({
      detectedImages: 1,
    });
    controller.destroy();
  });

  it("does not add duplicate markers or load listeners on repeated scans", () => {
    const loadedImage = createMangaImage();
    const lazyImage = createMangaImage(false);
    document.body.append(loadedImage, lazyImage);
    const addListener = vi.spyOn(lazyImage, "addEventListener");
    const controller = new MangaScannerController();

    send(controller, { type: "SCAN_PAGE" });
    send(controller, { type: "SCAN_PAGE" });

    expect(document.querySelectorAll(".mangalens-marker")).toHaveLength(1);
    expect(addListener.mock.calls.filter(([type]) => type === "load")).toHaveLength(1);
    controller.destroy();
  });

  it("removes a detached image marker and stops observing it", async () => {
    const image = createMangaImage();
    document.body.appendChild(image);
    const controller = new MangaScannerController();
    send(controller, { type: "SCAN_PAGE" });

    image.remove();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(document.querySelectorAll(".mangalens-marker")).toHaveLength(0);
    expect(send(controller, { type: "GET_SCAN_STATUS" })).toMatchObject({
      detectedImages: 0,
    });
    expect(ResizeObserverMock.instances[0]?.unobserve).toHaveBeenCalledWith(image);
    controller.destroy();
  });

  it("prioritizes a visible page before an earlier offscreen page", () => {
    const offscreen = createMangaImage();
    const visible = createMangaImage();
    vi.mocked(offscreen.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, 2000, 800, 1200)
    );
    vi.mocked(visible.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, 20, 800, 1200)
    );
    document.body.append(offscreen, visible);
    const calls: number[] = [];
    const provider: TranslationProvider = {
      translatePage: (input) => {
        calls.push(input.pageNumber);
        return new Promise<TranslatePageResult>(() => undefined);
      },
    };
    const controller = new MangaScannerController(provider);
    send(controller, { type: "SCAN_PAGE" });
    send(controller, {
      type: "START_MOCK_TRANSLATION",
      sourceLanguage: "auto",
      targetLanguage: "en",
    });
    expect(calls).toEqual([2]);
    controller.destroy();
  });

  it("repeated preview clicks do not duplicate completed bubbles", async () => {
    const image = createMangaImage();
    document.body.appendChild(image);
    const provider = new ImmediateProvider();
    const controller = new MangaScannerController(provider);
    send(controller, { type: "SCAN_PAGE" });
    const preview = {
      type: "START_MOCK_TRANSLATION",
      sourceLanguage: "auto",
      targetLanguage: "en",
    } as const;
    send(controller, preview);
    await Promise.resolve();
    await Promise.resolve();
    send(controller, preview);
    expect(provider.calls).toHaveLength(1);
    expect(document.querySelectorAll(".mangalens-translation-bubble"))
      .toHaveLength(1);
    controller.destroy();
  });

  it("show and hide preserves completed translation results", async () => {
    const image = createMangaImage();
    document.body.appendChild(image);
    const controller = new MangaScannerController(new ImmediateProvider());
    send(controller, { type: "SCAN_PAGE" });
    send(controller, {
      type: "START_MOCK_TRANSLATION",
      sourceLanguage: "auto",
      targetLanguage: "it",
    });
    await Promise.resolve();
    await Promise.resolve();
    send(controller, { type: "SET_TRANSLATIONS_VISIBLE", visible: false });
    send(controller, { type: "SET_TRANSLATIONS_VISIBLE", visible: true });
    expect(document.querySelectorAll(".mangalens-translation-bubble"))
      .toHaveLength(1);
    expect(send(controller, { type: "GET_TRANSLATION_STATUS" })).toMatchObject({
      completedPages: 1,
      translationsVisible: true,
    });
    controller.destroy();
  });

  it("removing an image aborts its translation and removes its session", async () => {
    const image = createMangaImage();
    document.body.appendChild(image);
    let activeSignal: AbortSignal | undefined;
    const provider: TranslationProvider = {
      translatePage: (_input, signal) => {
        activeSignal = signal;
        return new Promise<TranslatePageResult>(() => undefined);
      },
    };
    const controller = new MangaScannerController(provider);
    send(controller, { type: "SCAN_PAGE" });
    send(controller, {
      type: "START_MOCK_TRANSLATION",
      sourceLanguage: "auto",
      targetLanguage: "en",
    });
    image.remove();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(activeSignal?.aborted).toBe(true);
    expect(send(controller, { type: "GET_TRANSLATION_STATUS" }))
      .toMatchObject({ totalPages: 0 });
    expect(document.querySelectorAll(".mangalens-translation-bubble"))
      .toHaveLength(0);
    controller.destroy();
  });

  it("clear translations aborts work but preserves page markers", () => {
    const image = createMangaImage();
    document.body.appendChild(image);
    let activeSignal: AbortSignal | undefined;
    const provider: TranslationProvider = {
      translatePage: (_input, signal) => {
        activeSignal = signal;
        return new Promise<TranslatePageResult>(() => undefined);
      },
    };
    const controller = new MangaScannerController(provider);
    send(controller, { type: "SCAN_PAGE" });
    send(controller, {
      type: "START_MOCK_TRANSLATION",
      sourceLanguage: "auto",
      targetLanguage: "en",
    });
    send(controller, { type: "CLEAR_TRANSLATIONS" });
    expect(activeSignal?.aborted).toBe(true);
    expect(document.querySelectorAll(".mangalens-marker")).toHaveLength(1);
    expect(send(controller, { type: "GET_TRANSLATION_STATUS" }))
      .toMatchObject({
        totalPages: 1,
        queuedPages: 0,
        translatingPages: 0,
        completedPages: 0,
      });
    controller.destroy();
  });

  it("full clear permits rescan and preview again", async () => {
    const image = createMangaImage();
    document.body.appendChild(image);
    const provider = new ImmediateProvider();
    const controller = new MangaScannerController(provider);
    const preview = {
      type: "START_MOCK_TRANSLATION",
      sourceLanguage: "auto",
      targetLanguage: "en",
    } as const;
    send(controller, { type: "SCAN_PAGE" });
    send(controller, preview);
    await Promise.resolve();
    await Promise.resolve();
    send(controller, { type: "CLEAR_MARKERS" });
    send(controller, { type: "SCAN_PAGE" });
    send(controller, preview);
    await Promise.resolve();
    await Promise.resolve();
    expect(provider.calls).toHaveLength(2);
    expect(document.querySelectorAll(".mangalens-marker")).toHaveLength(1);
    expect(document.querySelectorAll(".mangalens-translation-bubble"))
      .toHaveLength(1);
    controller.destroy();
  });

  it("owns saved bubble edits across hide and show", async () => {
    const image = createMangaImage();
    document.body.appendChild(image);
    const controller = new MangaScannerController(new ImmediateProvider());
    send(controller, { type: "SCAN_PAGE" });
    send(controller, {
      type: "START_MOCK_TRANSLATION",
      sourceLanguage: "auto",
      targetLanguage: "en",
    });
    await Promise.resolve();
    await Promise.resolve();
    const bubble = document.querySelector<HTMLElement>(
      ".mangalens-translation-bubble"
    )!;
    bubble.click();
    const editor = bubble.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.value = "Session-owned edit";
    editor.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
    }));
    send(controller, { type: "SET_TRANSLATIONS_VISIBLE", visible: false });
    send(controller, { type: "SET_TRANSLATIONS_VISIBLE", visible: true });
    expect(bubble.textContent).toBe("Session-owned edit");
    expect(document.querySelectorAll(".mangalens-translation-bubble"))
      .toHaveLength(1);
    controller.destroy();
  });

  it("commitBubbleEdit validates identifiers and updates rendered text", async () => {
    const image = createMangaImage();
    document.body.appendChild(image);
    const controller = new MangaScannerController(new ImmediateProvider());
    send(controller, { type: "SCAN_PAGE" });
    send(controller, {
      type: "START_MOCK_TRANSLATION",
      sourceLanguage: "auto",
      targetLanguage: "en",
    });
    await Promise.resolve();
    await Promise.resolve();
    const bubble = document.querySelector<HTMLElement>(
      ".mangalens-translation-bubble"
    )!;
    expect(controller.commitBubbleEdit(
      bubble.dataset.pageId!,
      bubble.dataset.bubbleId!,
      "  Direct commit  "
    )).toBe(true);
    expect(bubble.textContent).toBe("Direct commit");
    expect(controller.commitBubbleEdit(
      "missing-page",
      bubble.dataset.bubbleId!,
      "No"
    )).toBe(false);
    expect(controller.commitBubbleEdit(
      bubble.dataset.pageId!,
      "missing-bubble",
      "No"
    )).toBe(false);
    expect(controller.commitBubbleEdit(
      bubble.dataset.pageId!,
      bubble.dataset.bubbleId!,
      "   "
    )).toBe(false);
    controller.destroy();
  });

  it("clear translations closes editing while preserving page markers", async () => {
    const image = createMangaImage();
    document.body.appendChild(image);
    const controller = new MangaScannerController(new ImmediateProvider());
    send(controller, { type: "SCAN_PAGE" });
    send(controller, {
      type: "START_MOCK_TRANSLATION",
      sourceLanguage: "auto",
      targetLanguage: "en",
    });
    await Promise.resolve();
    await Promise.resolve();
    document.querySelector<HTMLElement>(".mangalens-translation-bubble")!
      .click();
    send(controller, { type: "CLEAR_TRANSLATIONS" });
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelectorAll(".mangalens-translation-bubble"))
      .toHaveLength(0);
    expect(document.querySelectorAll(".mangalens-marker")).toHaveLength(1);
    controller.destroy();
  });

  it("full clear closes editing and permits preview editing after rescan", async () => {
    const image = createMangaImage();
    document.body.appendChild(image);
    const controller = new MangaScannerController(new ImmediateProvider());
    const preview = {
      type: "START_MOCK_TRANSLATION",
      sourceLanguage: "auto",
      targetLanguage: "en",
    } as const;
    send(controller, { type: "SCAN_PAGE" });
    send(controller, preview);
    await Promise.resolve();
    await Promise.resolve();
    document.querySelector<HTMLElement>(".mangalens-translation-bubble")!
      .click();
    send(controller, { type: "CLEAR_MARKERS" });
    expect(document.querySelector("textarea")).toBeNull();
    send(controller, { type: "SCAN_PAGE" });
    send(controller, preview);
    await Promise.resolve();
    await Promise.resolve();
    document.querySelector<HTMLElement>(".mangalens-translation-bubble")!
      .click();
    expect(document.querySelector("textarea")).not.toBeNull();
    controller.destroy();
  });
});
