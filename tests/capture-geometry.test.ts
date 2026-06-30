import { describe, expect, it } from "vitest";
import { calculateCropGeometry } from "@/lib/capture/capture-geometry";
import type { CaptureDescriptor } from "@/types/capture";

const descriptor: CaptureDescriptor = {
  captureToken: "token",
  pageId: "page-1",
  pageNumber: 1,
  imageRect: { top: 20, left: 10, width: 400, height: 300 },
  viewportWidth: 1000,
  viewportHeight: 800,
};

describe("capture crop geometry", () => {
  it("calculates scale-1 geometry", () => {
    expect(calculateCropGeometry(descriptor, { width: 1000, height: 800 }))
      .toEqual({ x: 10, y: 20, width: 400, height: 300 });
  });

  it("supports high-density screenshots", () => {
    expect(calculateCropGeometry(descriptor, { width: 2000, height: 1600 }))
      .toEqual({ x: 20, y: 40, width: 800, height: 600 });
  });

  it("supports different horizontal and vertical scales", () => {
    expect(calculateCropGeometry(descriptor, { width: 2000, height: 1200 }))
      .toEqual({ x: 20, y: 30, width: 800, height: 450 });
  });

  it("rounds and clamps fractional boundaries safely", () => {
    expect(calculateCropGeometry({
      ...descriptor,
      imageRect: { top: -0.5, left: -0.5, width: 100.2, height: 80.2 },
    }, { width: 1000, height: 800 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
  });

  it("rejects empty or completely out-of-bounds crops", () => {
    expect(() => calculateCropGeometry({
      ...descriptor,
      imageRect: { top: 900, left: 1200, width: 10, height: 10 },
    }, { width: 1000, height: 800 })).toThrow("invalid-geometry");
    expect(() => calculateCropGeometry({
      ...descriptor,
      imageRect: { top: 0, left: 0, width: 0, height: 10 },
    }, { width: 1000, height: 800 })).toThrow("invalid-geometry");
  });

  it("rejects oversized crops", () => {
    expect(() => calculateCropGeometry({
      ...descriptor,
      imageRect: { top: 0, left: 0, width: 6000, height: 5000 },
      viewportWidth: 6000,
      viewportHeight: 5000,
    }, { width: 6000, height: 5000 })).toThrow("capture-too-large");
  });
});
