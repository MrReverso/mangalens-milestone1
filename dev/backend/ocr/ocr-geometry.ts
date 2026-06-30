import { OcrFailure } from "./ocr-errors";
import type { OcrBounds } from "./ocr-types";
import type { GoogleVertex } from "./google-vision-response-validator";

const PIXEL_TOLERANCE = 0.001;

export function normalizeParagraphBounds(
  vertices: readonly GoogleVertex[],
  pixelWidth: number,
  pixelHeight: number
): OcrBounds {
  if (vertices.length !== 4 ||
      !Number.isSafeInteger(pixelWidth) || pixelWidth <= 0 ||
      !Number.isSafeInteger(pixelHeight) || pixelHeight <= 0) {
    throw new OcrFailure("ocr-invalid-response");
  }
  const points = vertices.map((vertex) => {
    const x = vertex.x ?? 0;
    const y = vertex.y ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        x < -PIXEL_TOLERANCE || y < -PIXEL_TOLERANCE ||
        x > pixelWidth + PIXEL_TOLERANCE ||
        y > pixelHeight + PIXEL_TOLERANCE) {
      throw new OcrFailure("ocr-invalid-response");
    }
    return {
      x: clampTiny(x, 0, pixelWidth),
      y: clampTiny(y, 0, pixelHeight),
    };
  });
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  if (maxX <= minX || maxY <= minY) {
    throw new OcrFailure("ocr-invalid-response");
  }
  const bounds = {
    x: minX / pixelWidth,
    y: minY / pixelHeight,
    width: (maxX - minX) / pixelWidth,
    height: (maxY - minY) / pixelHeight,
  };
  if (!Object.values(bounds).every(Number.isFinite) ||
      bounds.x < 0 || bounds.y < 0 ||
      bounds.width <= 0 || bounds.height <= 0 ||
      bounds.x + bounds.width > 1 ||
      bounds.y + bounds.height > 1) {
    throw new OcrFailure("ocr-invalid-response");
  }
  return bounds;
}

function clampTiny(value: number, minimum: number, maximum: number): number {
  if (value < minimum && value >= minimum - PIXEL_TOLERANCE) return minimum;
  if (value > maximum && value <= maximum + PIXEL_TOLERANCE) return maximum;
  return value;
}
