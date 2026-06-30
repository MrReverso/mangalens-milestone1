import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MangaScannerController } from "@/lib/scanner-controller";
import type {
  ExtensionMessage,
  ScanPageResponse,
  ScanStatusResponse,
} from "@/lib/messages";

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
): ScanPageResponse | ScanStatusResponse {
  let response: ScanPageResponse | ScanStatusResponse | undefined;
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
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.querySelector("[data-mangalens-root]")?.remove();
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
});
