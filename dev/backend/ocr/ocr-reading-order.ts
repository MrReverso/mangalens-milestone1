import type { SourceLanguage } from "../../../types/extension";
import type { OcrRegion } from "./ocr-types";

export function orderOcrRegions(
  regions: readonly OcrRegion[],
  sourceLanguage: SourceLanguage
): OcrRegion[] {
  return [...regions].sort((left, right) => {
    if (left.orientation === "vertical" &&
        right.orientation === "vertical") {
      return compareDescending(left.bounds.x, right.bounds.x) ||
        compareAscending(left.bounds.y, right.bounds.y);
    }

    const leftCenterY = left.bounds.y + left.bounds.height / 2;
    const rightCenterY = right.bounds.y + right.bounds.height / 2;
    const rowTolerance = Math.max(
      0.01,
      Math.min(left.bounds.height, right.bounds.height) / 2
    );
    if (Math.abs(leftCenterY - rightCenterY) <= rowTolerance) {
      const xOrder = sourceLanguage === "ja"
        ? compareDescending(left.bounds.x, right.bounds.x)
        : compareAscending(left.bounds.x, right.bounds.x);
      if (xOrder !== 0) return xOrder;
    }
    return compareAscending(left.bounds.y, right.bounds.y) ||
      compareAscending(left.bounds.x, right.bounds.x);
  });
}

function compareAscending(left: number, right: number): number {
  return left - right;
}

function compareDescending(left: number, right: number): number {
  return right - left;
}
