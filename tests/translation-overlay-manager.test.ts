import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationOverlayManager } from "@/lib/translation-overlay-manager";
import type { TranslationBubble } from "@/types/translation";

let resizeCallback: ResizeObserverCallback;
class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
    ResizeObserverMock.instances.push(this);
  }
}

class MutationObserverMock {
  static instances: MutationObserverMock[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn((): MutationRecord[] => []);
  constructor(_callback: MutationCallback) {
    MutationObserverMock.instances.push(this);
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
    ResizeObserverMock.instances = [];
    MutationObserverMock.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("MutationObserver", MutationObserverMock);
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

  it("uses detector-provided vertical writing geometry", () => {
    const image = document.createElement("img");
    document.body.appendChild(image);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 500, 1000)
    );
    const manager = new TranslationOverlayManager();
    manager.renderPage("page-1", image, [{
      ...bubbles[0],
      orientation: "vertical",
    }]);

    const bubble = document.querySelector<HTMLElement>(
      ".mangalens-translation-bubble"
    );
    expect(bubble?.style.writingMode).toBe("vertical-rl");
    expect(bubble?.style.textOrientation).toBe("mixed");
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
    const bubble = document.querySelector<HTMLElement>(
      ".mangalens-translation-bubble"
    );
    expect(bubble?.textContent).toBe("Translated");
    expect(bubble?.style.display).toBe("flex");
    expect(document.querySelectorAll(".mangalens-translation-bubble"))
      .toHaveLength(1);
    manager.clear();
  });

  it("shows bubbles rendered while translations were hidden", () => {
    const image = document.createElement("img");
    document.body.appendChild(image);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1000, 500)
    );
    const manager = new TranslationOverlayManager();
    manager.setVisible(false);
    manager.renderPage("page-1", image, bubbles);

    const root = document.getElementById("mangalens-translation-overlay-root");
    const bubble = document.querySelector<HTMLElement>(
      ".mangalens-translation-bubble"
    );
    expect(root?.style.display).toBe("none");
    expect(bubble?.style.display).toBe("flex");

    manager.setVisible(true);
    expect(root?.style.display).toBe("block");
    expect(bubble?.style.display).toBe("flex");
    expect(bubble?.textContent).toBe("Translated");
    expect(manager.pageCount).toBe(1);
    manager.clear();
  });

  it("repeated visibility changes reuse one root and one bubble", () => {
    const image = document.createElement("img");
    document.body.appendChild(image);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1000, 500)
    );
    const manager = new TranslationOverlayManager();
    manager.renderPage("page-1", image, bubbles);
    manager.setVisible(false);
    manager.setVisible(true);
    manager.setVisible(false);
    manager.setVisible(true);
    expect(document.querySelectorAll("#mangalens-translation-overlay-root"))
      .toHaveLength(1);
    expect(document.querySelectorAll(".mangalens-translation-bubble"))
      .toHaveLength(1);
    expect(manager.pageCount).toBe(1);
    manager.clear();
  });

  it("fully cleans up the final page and can render and edit again", () => {
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const cancelFrame = vi.mocked(cancelAnimationFrame);
    const image = document.createElement("img");
    document.body.appendChild(image);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1000, 500)
    );
    const manager = new TranslationOverlayManager();
    manager.renderPage("page-1", image, bubbles);
    window.dispatchEvent(new Event("scroll"));
    manager.removePage("page-1");

    expect(document.getElementById("mangalens-translation-overlay-root"))
      .toBeNull();
    expect(removeWindowListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      true
    );
    expect(removeWindowListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function)
    );
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
      true
    );
    expect(ResizeObserverMock.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(MutationObserverMock.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalled();

    manager.renderPage("page-2", image, bubbles);
    expect(document.querySelectorAll("#mangalens-translation-overlay-root"))
      .toHaveLength(1);
    document.querySelector<HTMLElement>(".mangalens-translation-bubble")!
      .click();
    expect(document.querySelector("textarea")).not.toBeNull();
    manager.clear();
  });

  it("keeps resources until the second of two pages is removed", () => {
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const firstImage = document.createElement("img");
    const secondImage = document.createElement("img");
    document.body.append(firstImage, secondImage);
    vi.spyOn(firstImage, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1000, 500)
    );
    vi.spyOn(secondImage, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 600, 1000, 500)
    );
    const manager = new TranslationOverlayManager();
    manager.renderPage("page-1", firstImage, bubbles);
    manager.renderPage("page-2", secondImage, bubbles);

    manager.removePage("page-1");
    expect(manager.pageCount).toBe(1);
    expect(document.getElementById("mangalens-translation-overlay-root"))
      .not.toBeNull();
    expect(removeWindowListener).not.toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      true
    );
    expect(ResizeObserverMock.instances[0].disconnect).not.toHaveBeenCalled();

    manager.removePage("page-2");
    expect(manager.pageCount).toBe(0);
    expect(document.getElementById("mangalens-translation-overlay-root"))
      .toBeNull();
    expect(ResizeObserverMock.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(MutationObserverMock.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(removeWindowListener.mock.calls.filter(([type]) => type === "scroll"))
      .toHaveLength(1);
    manager.clear();
  });
});
