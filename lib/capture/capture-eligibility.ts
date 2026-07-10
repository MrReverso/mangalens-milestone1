import type { CaptureViewportRect } from "@/types/capture";

const TOLERANCE = 1;

export interface CapturePageCandidate {
  readonly pageId: string;
  readonly pageNumber: number;
  readonly element: HTMLImageElement;
}

export interface VisibleSegment {
  readonly imageRect: CaptureViewportRect;
  readonly segmentRect: CaptureViewportRect;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

export function captureRectForImage(
  image: HTMLImageElement,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight
): CaptureViewportRect | null {
  if (!image.isConnected || !image.complete ||
      image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
  const style = window.getComputedStyle(image);
  if (style.display === "none" || style.visibility === "hidden" ||
      Number.parseFloat(style.opacity || "1") <= 0) return null;
  const rect = image.getBoundingClientRect();
  const values = [
    rect.top, rect.left, rect.right, rect.bottom, rect.width, rect.height,
    viewportWidth, viewportHeight,
  ];
  if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 ||
      viewportWidth <= 0 || viewportHeight <= 0) return null;
  if (rect.top < -TOLERANCE || rect.left < -TOLERANCE ||
      rect.right > viewportWidth + TOLERANCE ||
      rect.bottom > viewportHeight + TOLERANCE) return null;
  return {
    top: Math.max(0, rect.top),
    left: Math.max(0, rect.left),
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Returns the currently visible portion of an image. Unlike the one-shot
 * capture helper, partial visibility is intentional here: the user advances
 * the page manually between captures.
 */
export function visibleSegmentForImage(
  image: HTMLImageElement,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight
): VisibleSegment | null {
  if (!image.isConnected || !image.complete ||
      image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
  const style = window.getComputedStyle(image);
  if (style.display === "none" || style.visibility === "hidden" ||
      Number.parseFloat(style.opacity || "1") <= 0) return null;
  const rect = image.getBoundingClientRect();
  const values = [
    rect.top, rect.left, rect.right, rect.bottom, rect.width, rect.height,
    viewportWidth, viewportHeight,
  ];
  if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 ||
      viewportWidth <= 0 || viewportHeight <= 0) return null;
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewportWidth, rect.right);
  const bottom = Math.min(viewportHeight, rect.bottom);
  if (right - left <= 1 || bottom - top <= 1) return null;
  return {
    imageRect: { top, left, width: right - left, height: bottom - top },
    segmentRect: {
      top: top - rect.top,
      left: left - rect.left,
      width: right - left,
      height: bottom - top,
    },
    pageWidth: rect.width,
    pageHeight: rect.height,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  };
}

export function selectFirstFullyVisiblePage(
  candidates: Iterable<CapturePageCandidate>,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight
): { candidate: CapturePageCandidate; rect: CaptureViewportRect } | null {
  const ordered = [...candidates].sort((a, b) => a.pageNumber - b.pageNumber);
  for (const candidate of ordered) {
    const rect = captureRectForImage(
      candidate.element,
      viewportWidth,
      viewportHeight
    );
    if (rect) return { candidate, rect };
  }
  return null;
}

export function captureRectsMatch(
  first: CaptureViewportRect,
  second: CaptureViewportRect
): boolean {
  return Math.abs(first.top - second.top) <= TOLERANCE &&
    Math.abs(first.left - second.left) <= TOLERANCE &&
    Math.abs(first.width - second.width) <= TOLERANCE &&
    Math.abs(first.height - second.height) <= TOLERANCE;
}
