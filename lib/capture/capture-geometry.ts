import { CaptureFailure } from "@/lib/capture/capture-errors";
import type { CaptureDescriptor } from "@/types/capture";

export const MAX_CAPTURE_PIXELS = 25_000_000;

export interface ScreenshotSize {
  readonly width: number;
  readonly height: number;
}

export interface PixelCropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function calculateCropGeometry(
  descriptor: CaptureDescriptor,
  screenshot: ScreenshotSize
): PixelCropRect {
  const numbers = [
    descriptor.viewportWidth,
    descriptor.viewportHeight,
    descriptor.imageRect.top,
    descriptor.imageRect.left,
    descriptor.imageRect.width,
    descriptor.imageRect.height,
    screenshot.width,
    screenshot.height,
  ];
  if (!numbers.every(Number.isFinite) ||
      descriptor.viewportWidth <= 0 || descriptor.viewportHeight <= 0 ||
      descriptor.imageRect.width <= 0 || descriptor.imageRect.height <= 0 ||
      screenshot.width <= 0 || screenshot.height <= 0) {
    throw new CaptureFailure("invalid-geometry");
  }
  const scaleX = screenshot.width / descriptor.viewportWidth;
  const scaleY = screenshot.height / descriptor.viewportHeight;
  const left = Math.floor(descriptor.imageRect.left * scaleX);
  const top = Math.floor(descriptor.imageRect.top * scaleY);
  const right = Math.ceil(
    (descriptor.imageRect.left + descriptor.imageRect.width) * scaleX
  );
  const bottom = Math.ceil(
    (descriptor.imageRect.top + descriptor.imageRect.height) * scaleY
  );
  const x = Math.max(0, Math.min(screenshot.width, left));
  const y = Math.max(0, Math.min(screenshot.height, top));
  const clampedRight = Math.max(0, Math.min(screenshot.width, right));
  const clampedBottom = Math.max(0, Math.min(screenshot.height, bottom));
  const width = clampedRight - x;
  const height = clampedBottom - y;
  if (width <= 0 || height <= 0) {
    throw new CaptureFailure("invalid-geometry");
  }
  if (width * height > MAX_CAPTURE_PIXELS) {
    throw new CaptureFailure("capture-too-large");
  }
  return { x, y, width, height };
}
