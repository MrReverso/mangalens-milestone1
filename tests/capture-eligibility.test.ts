import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureRectForImage,
  selectFirstFullyVisiblePage,
} from "@/lib/capture/capture-eligibility";

function imageWithRect(rect: DOMRect, connected = true): HTMLImageElement {
  const image = document.createElement("img");
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 800 },
    naturalHeight: { configurable: true, value: 600 },
  });
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect);
  if (connected) document.body.appendChild(image);
  return image;
}

describe("capture eligibility", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      display: "",
      visibility: "",
      opacity: "1",
    } as CSSStyleDeclaration);
  });

  it("accepts a fully visible loaded image", () => {
    expect(captureRectForImage(
      imageWithRect(new DOMRect(10, 20, 600, 500)),
      1000,
      800
    )).toEqual({ top: 20, left: 10, width: 600, height: 500 });
  });

  it("rejects a partially visible image", () => {
    expect(captureRectForImage(
      imageWithRect(new DOMRect(-10, 20, 600, 500)),
      1000,
      800
    )).toBeNull();
  });

  it("rejects an offscreen image", () => {
    expect(captureRectForImage(
      imageWithRect(new DOMRect(10, 900, 600, 500)),
      1000,
      800
    )).toBeNull();
  });

  it("rejects a disconnected image", () => {
    expect(captureRectForImage(
      imageWithRect(new DOMRect(10, 20, 600, 500), false),
      1000,
      800
    )).toBeNull();
  });

  it("rejects non-finite geometry", () => {
    expect(captureRectForImage(
      imageWithRect(new DOMRect(Number.NaN, 20, 600, 500)),
      1000,
      800
    )).toBeNull();
  });

  it("rejects hidden and transparent images", () => {
    const image = imageWithRect(new DOMRect(10, 20, 600, 500));
    vi.mocked(window.getComputedStyle).mockReturnValue({
      display: "",
      visibility: "hidden",
      opacity: "1",
    } as CSSStyleDeclaration);
    expect(captureRectForImage(image, 1000, 800)).toBeNull();
    vi.mocked(window.getComputedStyle).mockReturnValue({
      display: "",
      visibility: "",
      opacity: "0",
    } as CSSStyleDeclaration);
    expect(captureRectForImage(image, 1000, 800)).toBeNull();
  });

  it("selects the eligible page with the lowest page number", () => {
    const second = imageWithRect(new DOMRect(10, 20, 600, 500));
    const first = imageWithRect(new DOMRect(10, 20, 600, 500));
    const selected = selectFirstFullyVisiblePage([
      { pageId: "page-2", pageNumber: 2, element: second },
      { pageId: "page-1", pageNumber: 1, element: first },
    ], 1000, 800);
    expect(selected?.candidate.pageId).toBe("page-1");
  });
});
