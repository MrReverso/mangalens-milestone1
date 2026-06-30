import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayManager } from "@/lib/overlay-manager";

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

describe("OverlayManager", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    document.querySelector("[data-mangalens-root]")?.remove();
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.querySelector("[data-mangalens-root]")?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses fixed-overlay viewport coordinates without scroll offsets", () => {
    const image = document.createElement("img");
    document.body.appendChild(image);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      new DOMRect(45, 120, 800, 1200)
    );
    vi.stubGlobal("scrollX", 500);
    vi.stubGlobal("scrollY", 900);

    const overlay = new OverlayManager();
    overlay.addMarker({ element: image, pageNumber: 1 });

    const marker = document.querySelector<HTMLElement>(".mangalens-marker");
    expect(marker?.style.top).toBe("120px");
    expect(marker?.style.left).toBe("45px");
    expect(marker?.style.transition).toBe("");
  });

  it("realigns a marker when a nested scrolling container scrolls", () => {
    const reader = document.createElement("div");
    const image = document.createElement("img");
    reader.appendChild(image);
    document.body.appendChild(reader);

    let top = 300;
    vi.spyOn(image, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(20, top, 800, 1200)
    );

    const overlay = new OverlayManager();
    overlay.addMarker({ element: image, pageNumber: 1 });
    overlay.startListening();

    top = 75;
    reader.dispatchEvent(new Event("scroll"));

    const marker = document.querySelector<HTMLElement>(".mangalens-marker");
    expect(marker?.style.top).toBe("75px");
    overlay.clearAll();
  });

  it("removes the capture scroll listener during cleanup", () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    const overlay = new OverlayManager();
    overlay.startListening();
    overlay.clearAll();

    expect(removeListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      true
    );
  });
});
