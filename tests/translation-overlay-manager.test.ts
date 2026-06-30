import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationOverlayManager } from "@/lib/translation-overlay-manager";
import type { TranslationBubble } from "@/types/translation";

let resizeCallback: ResizeObserverCallback;
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
}

const bubbles: TranslationBubble[] = [{
  id: "bubble-1",
  bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
  originalText: "Original",
  translatedText: "Translated",
}];

describe("TranslationOverlayManager", () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    document.querySelector("[data-mangalens-translation-root]")?.remove();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function flushFrame(): void {
    const callback = frames.shift();
    callback?.(0);
  }

  it("maps normalized bubble coordinates onto the image rectangle", () => {
    const image = document.createElement("img");
    document.body.appendChild(image);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      new DOMRect(50, 100, 1000, 500)
    );
    const manager = new TranslationOverlayManager();
    manager.renderPage("page-1", image, bubbles);

    const bubble = document.querySelector<HTMLElement>(
      ".mangalens-translation-bubble"
    );
    expect(bubble?.style.left).toBe("150px");
    expect(bubble?.style.top).toBe("200px");
    expect(bubble?.style.width).toBe("300px");
    expect(bubble?.style.height).toBe("50px");
    manager.clear();
  });

  it("updates bubble positions after nested scrolling", () => {
    const reader = document.createElement("div");
    const image = document.createElement("img");
    reader.appendChild(image);
    document.body.appendChild(reader);
    let top = 100;
    vi.spyOn(image, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, top, 1000, 500)
    );
    const manager = new TranslationOverlayManager();
    manager.renderPage("page-1", image, bubbles);
    top = 20;
    reader.dispatchEvent(new Event("scroll"));
    flushFrame();
    expect(document.querySelector<HTMLElement>(
      ".mangalens-translation-bubble"
    )?.style.top).toBe("120px");
    manager.clear();
  });

  it("updates bubble dimensions after image resizing", () => {
    const image = document.createElement("img");
    document.body.appendChild(image);
    let width = 1000;
    vi.spyOn(image, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, width, 500)
    );
    const manager = new TranslationOverlayManager();
    manager.renderPage("page-1", image, bubbles);
    width = 500;
    resizeCallback([], {} as ResizeObserver);
    flushFrame();
    expect(document.querySelector<HTMLElement>(
      ".mangalens-translation-bubble"
    )?.style.width).toBe("150px");
    manager.clear();
  });

  it("hides and shows without discarding rendered results", () => {
    const image = document.createElement("img");
    document.body.appendChild(image);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1000, 500)
    );
    const manager = new TranslationOverlayManager();
    manager.renderPage("page-1", image, bubbles);
    manager.setVisible(false);
    expect(document.getElementById("mangalens-translation-overlay-root")
      ?.style.display).toBe("none");
    manager.setVisible(true);
    expect(manager.pageCount).toBe(1);
    expect(document.querySelector(".mangalens-translation-bubble")
      ?.textContent).toBe("Translated");
    manager.clear();
  });
});
