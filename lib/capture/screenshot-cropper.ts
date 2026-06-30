import { calculateCropGeometry } from "@/lib/capture/capture-geometry";
import { CaptureFailure } from "@/lib/capture/capture-errors";
import type {
  CaptureDescriptor,
  CapturedImage,
  CaptureMetadata,
} from "@/types/capture";

const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;

export interface ScreenshotCropper {
  crop(
    screenshotDataUrl: string,
    descriptor: CaptureDescriptor,
    signal?: AbortSignal
  ): Promise<CapturedImage>;
}

export class BrowserScreenshotCropper implements ScreenshotCropper {
  async crop(
    screenshotDataUrl: string,
    descriptor: CaptureDescriptor,
    signal?: AbortSignal
  ): Promise<CapturedImage> {
    throwIfAborted(signal);
    if (typeof createImageBitmap !== "function" ||
        typeof OffscreenCanvas === "undefined") {
      throw new CaptureFailure("unsupported-browser");
    }
    try {
      const screenshotBlob = decodePngDataUrl(screenshotDataUrl);
      throwIfAborted(signal);
      const bitmap = await createImageBitmap(screenshotBlob);
      try {
        throwIfAborted(signal);
        const crop = calculateCropGeometry(descriptor, {
          width: bitmap.width,
          height: bitmap.height,
        });
        const canvas = new OffscreenCanvas(crop.width, crop.height);
        const context = canvas.getContext("2d");
        if (!context) throw new CaptureFailure("unsupported-browser");
        throwIfAborted(signal);
        context.drawImage(
          bitmap,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          0,
          0,
          crop.width,
          crop.height
        );
        const blob = await canvas.convertToBlob({ type: "image/png" });
        throwIfAborted(signal);
        if (blob.size > MAX_CAPTURE_BYTES) {
          throw new CaptureFailure("capture-too-large");
        }
        const sha256 = await sha256Hex(blob);
        throwIfAborted(signal);
        const metadata: CaptureMetadata = {
          pageId: descriptor.pageId,
          pageNumber: descriptor.pageNumber,
          method: "visible-tab-screenshot-crop",
          mimeType: "image/png",
          pixelWidth: crop.width,
          pixelHeight: crop.height,
          byteLength: blob.size,
          sha256,
        };
        return { blob, metadata };
      } finally {
        bitmap.close();
      }
    } catch (error: unknown) {
      if (error instanceof CaptureFailure) throw error;
      throw new CaptureFailure("crop-failed");
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CaptureFailure("timeout");
}

export function decodePngDataUrl(dataUrl: string): Blob {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) {
    throw new CaptureFailure("screenshot-failed");
  }
  try {
    const decoded = atob(dataUrl.slice(prefix.length));
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return new Blob([bytes], { type: "image/png" });
  } catch {
    throw new CaptureFailure("screenshot-failed");
  }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
