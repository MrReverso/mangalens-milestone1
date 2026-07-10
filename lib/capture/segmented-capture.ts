import { CaptureFailure } from "@/lib/capture/capture-errors";
import { MAX_CAPTURE_PIXELS } from "@/lib/capture/capture-geometry";
import type {
  CapturedImage,
  CaptureSegmentDescriptor,
  CaptureViewportRect,
} from "@/types/capture";

export interface CapturedSegment {
  readonly descriptor: CaptureSegmentDescriptor;
  readonly image: CapturedImage;
}

const MIN_OVERLAP_RATIO = 0.08;
const MIN_SHARED_AXIS_RATIO = 0.5;

export function orderSegments(
  segments: readonly CapturedSegment[]
): readonly CapturedSegment[] {
  return [...segments].sort((first, second) =>
    first.descriptor.segmentRect.top - second.descriptor.segmentRect.top ||
    first.descriptor.segmentRect.left - second.descriptor.segmentRect.left
  );
}

export function hasSufficientOverlap(
  previous: CaptureViewportRect,
  next: CaptureViewportRect
): boolean {
  const overlapWidth = Math.max(0, Math.min(previous.left + previous.width, next.left + next.width) -
    Math.max(previous.left, next.left));
  const overlapHeight = Math.max(0, Math.min(previous.top + previous.height, next.top + next.height) -
    Math.max(previous.top, next.top));
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(previous.width * previous.height, next.width * next.height);
  if (smallerArea <= 0) return false;
  if (overlapArea / smallerArea >= MIN_OVERLAP_RATIO) return true;
  const sharedWidth = overlapWidth / Math.min(previous.width, next.width);
  const sharedHeight = overlapHeight / Math.min(previous.height, next.height);
  return sharedWidth >= MIN_SHARED_AXIS_RATIO && sharedHeight >= MIN_OVERLAP_RATIO;
}

export function canAppendSegment(
  existing: readonly CapturedSegment[],
  next: CapturedSegment
): boolean {
  if (existing.length === 0) return true;
  const first = existing[0]?.descriptor;
  if (!first ||
      next.descriptor.pageId !== first.pageId ||
      next.descriptor.pageNumber !== first.pageNumber ||
      Math.abs(next.descriptor.pageWidth - first.pageWidth) > 1 ||
      Math.abs(next.descriptor.pageHeight - first.pageHeight) > 1 ||
      next.descriptor.naturalWidth !== first.naturalWidth ||
      next.descriptor.naturalHeight !== first.naturalHeight) {
    return false;
  }
  return existing.some((segment) => hasSufficientOverlap(
    segment.descriptor.segmentRect,
    next.descriptor.segmentRect
  ));
}

export async function assembleSegments(
  segments: readonly CapturedSegment[],
  signal: AbortSignal
): Promise<CapturedImage> {
  const first = segments[0];
  if (!first) throw new CaptureFailure("capture-session-not-found");
  const { naturalWidth, naturalHeight, pageId, pageNumber } = first.descriptor;
  if (naturalWidth * naturalHeight > MAX_CAPTURE_PIXELS) {
    throw new CaptureFailure("capture-too-large");
  }
  if (typeof OffscreenCanvas === "undefined" ||
      typeof createImageBitmap === "undefined") {
    throw new CaptureFailure("unsupported-browser");
  }
  const canvas = new OffscreenCanvas(naturalWidth, naturalHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new CaptureFailure("crop-failed");
  for (const segment of orderSegments(segments)) {
    if (signal.aborted) throw new CaptureFailure("timeout");
    const bitmap = await createImageBitmap(segment.image.blob);
    try {
      const rect = segment.descriptor.segmentRect;
      const x = Math.round(rect.left / segment.descriptor.pageWidth * naturalWidth);
      const y = Math.round(rect.top / segment.descriptor.pageHeight * naturalHeight);
      const width = Math.max(1, Math.round(rect.width / segment.descriptor.pageWidth * naturalWidth));
      const height = Math.max(1, Math.round(rect.height / segment.descriptor.pageHeight * naturalHeight));
      context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, x, y, width, height);
    } finally {
      bitmap.close();
    }
  }
  if (signal.aborted) throw new CaptureFailure("timeout");
  const blob = await canvas.convertToBlob({ type: "image/png" });
  if (blob.size <= 0 || blob.size > 20 * 1024 * 1024) {
    throw new CaptureFailure("capture-too-large");
  }
  return {
    blob,
    metadata: {
      pageId,
      pageNumber,
      method: "overlapping-segment-assembly",
      mimeType: "image/png",
      pixelWidth: naturalWidth,
      pixelHeight: naturalHeight,
      byteLength: blob.size,
      sha256: await sha256(blob),
    },
  };
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
