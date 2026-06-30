import type { NormalizedRect } from "@/types/translation";
import { validateNormalizedRect } from "@/types/translation";

export interface PixelRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export function normalizedToViewportRect(
  imageRect: DOMRect,
  bounds: NormalizedRect
): PixelRect {
  validateNormalizedRect(bounds);
  return {
    top: imageRect.top + imageRect.height * bounds.y,
    left: imageRect.left + imageRect.width * bounds.x,
    width: imageRect.width * bounds.width,
    height: imageRect.height * bounds.height,
  };
}

export function isImageVisible(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  return rect.bottom > 0 && rect.right > 0 &&
    rect.top < window.innerHeight && rect.left < window.innerWidth;
}
