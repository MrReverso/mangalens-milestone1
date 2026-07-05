import { describe, expect, it } from "vitest";
import { orderOcrRegions } from "@/dev/backend/ocr/ocr-reading-order";
import type { OcrRegion } from "@/dev/backend/ocr/ocr-types";

function region(
  text: string,
  x: number,
  y: number,
  orientation: OcrRegion["orientation"] = "horizontal"
): OcrRegion {
  return {
    text,
    bounds: { x, y, width: 0.1, height: 0.08 },
    orientation,
  };
}

describe("OCR reading order", () => {
  it("orders horizontal webtoon rows top-to-bottom then left-to-right", () => {
    const ordered = orderOcrRegions([
      region("bottom", 0.2, 0.6),
      region("top-right", 0.7, 0.1),
      region("top-left", 0.1, 0.11),
    ], "ko");
    expect(ordered.map(({ text }) => text)).toEqual([
      "top-left",
      "top-right",
      "bottom",
    ]);
  });

  it("orders Japanese regions right-to-left within the same row", () => {
    const ordered = orderOcrRegions([
      region("left", 0.1, 0.1),
      region("right", 0.7, 0.11),
    ], "ja");
    expect(ordered.map(({ text }) => text)).toEqual(["right", "left"]);
  });

  it("orders vertical columns right-to-left and text top-to-bottom", () => {
    const ordered = orderOcrRegions([
      region("left-column", 0.2, 0.1, "vertical"),
      region("right-bottom", 0.7, 0.4, "vertical"),
      region("right-top", 0.7, 0.1, "vertical"),
    ], "auto");
    expect(ordered.map(({ text }) => text)).toEqual([
      "right-top",
      "right-bottom",
      "left-column",
    ]);
  });

  it("does not mutate provider result order in place", () => {
    const input = [region("later", 0.2, 0.6), region("first", 0.2, 0.1)];
    orderOcrRegions(input, "ko");
    expect(input.map(({ text }) => text)).toEqual(["later", "first"]);
  });
});
