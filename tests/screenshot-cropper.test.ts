import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserScreenshotCropper,
  decodePngDataUrl,
} from "@/lib/capture/screenshot-cropper";

const descriptor = {
  captureToken: "token",
  pageId: "page-1",
  pageNumber: 1,
  imageRect: { top: 0, left: 0, width: 10, height: 10 },
  viewportWidth: 10,
  viewportHeight: 10,
} as const;

describe("screenshot data URL decoding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("decodes PNG bytes locally without fetch", async () => {
    const blob = decodePngDataUrl("data:image/png;base64,AQID");
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("rejects non-PNG and malformed data URLs", () => {
    expect(() => decodePngDataUrl("data:image/jpeg;base64,AQID"))
      .toThrow("screenshot-failed");
    expect(() => decodePngDataUrl("data:image/png;base64,%%%"))
      .toThrow("screenshot-failed");
  });

  it("does no bitmap work when already aborted", async () => {
    const createBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createBitmap);
    vi.stubGlobal("OffscreenCanvas", class {});
    const controller = new AbortController();
    controller.abort();
    await expect(new BrowserScreenshotCropper().crop(
      "data:image/png;base64,AQID",
      descriptor,
      controller.signal
    )).rejects.toThrow("timeout");
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it("closes a late bitmap and stops after cancellation", async () => {
    let resolveBitmap: ((bitmap: ImageBitmap) => void) | undefined;
    const bitmapPromise = new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
    });
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(() => bitmapPromise));
    vi.stubGlobal("OffscreenCanvas", class {});
    const controller = new AbortController();
    const crop = new BrowserScreenshotCropper().crop(
      "data:image/png;base64,AQID",
      descriptor,
      controller.signal
    );
    controller.abort();
    resolveBitmap?.({
      width: 10,
      height: 10,
      close,
    } as unknown as ImageBitmap);
    await expect(crop).rejects.toThrow("timeout");
    expect(close).toHaveBeenCalledOnce();
  });
});
