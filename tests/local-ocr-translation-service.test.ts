import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LocalOcrTranslationService,
  resetOffscreenLifecycleForTesting,
} from "@/lib/translation/local-ocr-translation-service";
import type { TranslationApiRequestMetadata } from "@/types/translation-api";
// @ts-ignore
import Tesseract from "@/public/tesseract/tesseract.esm.min.js";

// Mock the Tesseract module import
vi.mock("@/public/tesseract/tesseract.esm.min.js", () => {
  return {
    default: {
      createWorker: vi.fn(),
    },
  };
});

function metadata(
  sourceLanguage = "auto",
  targetLanguage = "en",
  pageId = "page-1",
  pageNumber = 1
): TranslationApiRequestMetadata {
  return {
    contractVersion: 1,
    requestId: "request-1",
    pageId,
    pageNumber,
    sourceLanguage: sourceLanguage as any,
    targetLanguage: targetLanguage as any,
    capture: {
      pageId,
      pageNumber,
      method: "visible-tab-screenshot-crop",
      mimeType: "image/png",
      pixelWidth: 1000,
      pixelHeight: 1000,
      byteLength: 6,
      sha256: "a".repeat(64),
    },
  };
}

describe("LocalOcrTranslationService", () => {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalChrome = (globalThis as any).chrome;
  const originalWindow = (globalThis as any).window;

  let mockWorker: any;
  let mockBlocks: { cStart: number; cEnd: number; rStart: number; rEnd: number }[] = [];
  let simulateContextError = false;
  let mockImageBitmapClose: any;
  let offscreenExists = false;

  function createMockImageData(
    w: number,
    h: number,
    blocks: { cStart: number; cEnd: number; rStart: number; rEnd: number }[]
  ) {
    const data = new Uint8ClampedArray(w * h * 4);
    data.fill(255); // Default to white
    for (const block of blocks) {
      for (let r = block.rStart; r < block.rEnd; r++) {
        if (r >= h) break;
        for (let c = block.cStart; c < block.cEnd; c++) {
          if (c >= w) break;
          const idx = (r * w + c) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
        }
      }
    }
    return { width: w, height: h, data };
  }

  beforeEach(() => {
    resetOffscreenLifecycleForTesting();
    simulateContextError = false;
    mockImageBitmapClose = vi.fn();
    offscreenExists = false;
    mockBlocks = [
      { cStart: 100, cEnd: 200, rStart: 100, rEnd: 150 },
      { cStart: 600, cEnd: 700, rStart: 250, rEnd: 300 },
    ];

    // Mock chrome APIs with realistic offscreen document tracking
    (globalThis as any).chrome = {
      runtime: {
        getURL: (p: string) => `chrome-extension://mock-id/${p}`,
        sendMessage: vi.fn(),
        getContexts: vi.fn().mockImplementation(async () => {
          return offscreenExists
            ? [{ documentUrl: "chrome-extension://mock-id/offscreen.html" }]
            : [];
        }),
      },
      offscreen: {
        createDocument: vi.fn().mockImplementation(async () => {
          offscreenExists = true;
        }),
        closeDocument: vi.fn().mockImplementation(async () => {
          offscreenExists = false;
        }),
      },
    };

    globalThis.createImageBitmap = async () => {
      return {
        width: 1000,
        height: 1000,
        close: mockImageBitmapClose,
      } as any;
    };

    (globalThis as any).OffscreenCanvas = class MockOffscreenCanvas {
      constructor(readonly width: number, readonly height: number) {}
      getContext(_type: string) {
        if (simulateContextError) return null;
        return {
          drawImage() {},
          getImageData: (_x: number, _y: number, w: number, h: number) => {
            return createMockImageData(w, h, mockBlocks);
          },
        };
      }
      async convertToBlob() {
        return new Blob(["png-data"], { type: "image/png" });
      }
    };

    // Default mock worker setup
    mockWorker = {
      recognize: vi.fn().mockResolvedValue({
        data: { text: "Default OCR text" },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(Tesseract.createWorker).mockResolvedValue(mockWorker as any);
  });

  afterEach(() => {
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    (globalThis as any).chrome = originalChrome;
    (globalThis as any).window = originalWindow;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("Direct Execution (Tests / Offscreen Context)", () => {
    it("accepts a valid PNG and returns contract-matching bubbles and closes ImageBitmap", async () => {
      const response = await new LocalOcrTranslationService(0).translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, new AbortController().signal);
      expect(response).toMatchObject({
        contractVersion: 1,
        requestId: "request-1",
        pageId: "page-1",
      });
      expect(mockImageBitmapClose).toHaveBeenCalled();
    });

    it("rejects non-PNG and empty images and closes ImageBitmap if created", async () => {
      const service = new LocalOcrTranslationService(0);
      await expect(service.translate({
        image: new Blob(["x"], { type: "image/jpeg" }),
        metadata: metadata(),
      }, new AbortController().signal)).rejects.toThrow("invalid-image");
      
      await expect(service.translate({
        image: new Blob([], { type: "image/png" }),
        metadata: metadata(),
      }, new AbortController().signal)).rejects.toThrow("invalid-image");
    });

    it("closes ImageBitmap on empty OCR result", async () => {
      mockWorker.recognize.mockResolvedValue({
        data: { text: "" },
      });

      const service = new LocalOcrTranslationService(0);
      await expect(service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, new AbortController().signal)).rejects.toThrow("ocr-no-text");

      expect(mockImageBitmapClose).toHaveBeenCalled();
    });

    it("closes ImageBitmap on recognize failure", async () => {
      mockWorker.recognize.mockRejectedValue(new Error("Recognize failed"));

      const service = new LocalOcrTranslationService(0);
      await expect(service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, new AbortController().signal)).rejects.toThrow("ocr-unavailable");

      expect(mockImageBitmapClose).toHaveBeenCalled();
    });

    it("aborts immediately when recognize is pending and closes ImageBitmap", async () => {
      vi.useFakeTimers();
      let resolveRecognize: any;
      const pendingPromise = new Promise((resolve) => {
        resolveRecognize = resolve;
      });

      mockWorker.recognize.mockReturnValue(pendingPromise);

      const controller = new AbortController();
      const service = new LocalOcrTranslationService(0);

      const promise = service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, controller.signal);

      promise.catch(() => {});

      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(1);
      }

      controller.abort();

      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      expect(mockWorker.terminate).toHaveBeenCalled();
      expect(mockImageBitmapClose).toHaveBeenCalled();

      resolveRecognize({ data: { text: "" } });
    });

    it("timeouts when recognize is permanently pending and closes ImageBitmap", async () => {
      vi.useFakeTimers();

      const pendingPromise = new Promise(() => {});
      mockWorker.recognize.mockReturnValue(pendingPromise);

      const controller = new AbortController();
      const service = new LocalOcrTranslationService(0);

      const promise = service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, controller.signal);

      promise.catch(() => {});

      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(1);
      }

      await vi.advanceTimersByTimeAsync(29000);

      await expect(promise).rejects.toThrow("ocr-timeout");
      expect(mockWorker.terminate).toHaveBeenCalled();
      expect(mockImageBitmapClose).toHaveBeenCalled();
    });

    it("createWorker remains pending, then AbortController aborts, and closes ImageBitmap", async () => {
      vi.useFakeTimers();
      let resolveWorkerPromise: any;
      const createWorkerPromise = new Promise((resolve) => {
        resolveWorkerPromise = resolve;
      });

      vi.mocked(Tesseract.createWorker).mockReturnValue(createWorkerPromise as any);

      const controller = new AbortController();
      const service = new LocalOcrTranslationService(0);

      const promise = service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, controller.signal);

      promise.catch(() => {});

      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(1);
      }

      controller.abort();

      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      expect(mockImageBitmapClose).toHaveBeenCalled();

      resolveWorkerPromise(mockWorker);
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(1);
      }
      expect(mockWorker.terminate).toHaveBeenCalled();
    });
  });

  describe("Service Worker Offscreen Delegation", () => {
    beforeEach(() => {
      // Simulate Service Worker context by deleting global window
      // @ts-ignore
      delete (globalThis as any).window;
    });

    it("ensures offscreen document is opened, sends scan message, and closes document on success", async () => {
      const mockResult = { contractVersion: 1, bubbles: [] };
      vi.mocked(chrome.runtime.sendMessage as any).mockResolvedValue({ success: true, result: mockResult });

      const service = new LocalOcrTranslationService(0);
      const response = await service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, new AbortController().signal);

      expect(chrome.offscreen.createDocument).toHaveBeenCalledOnce();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          target: "offscreen-ocr",
          action: "scan",
        })
      );
      expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
      expect(response).toEqual(mockResult);
    });

    it("manages concurrent scans, opening once and closing document after the last scan completes", async () => {
      let resolveScan1: any;
      let resolveScan2: any;

      const p1 = new Promise((resolve) => { resolveScan1 = resolve; });
      const p2 = new Promise((resolve) => { resolveScan2 = resolve; });

      vi.mocked(chrome.runtime.sendMessage as any)
        .mockImplementationOnce(() => p1 as any)
        .mockImplementationOnce(() => p2 as any);

      const service = new LocalOcrTranslationService(0);

      // Start two simultaneous scans
      const promise1 = service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, new AbortController().signal);

      const promise2 = service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, new AbortController().signal);

      // Wait a tick for the delays to resolve and offscreen document to open
      await new Promise((r) => setTimeout(r, 10));

      // Verify open was only called once
      expect(chrome.offscreen.createDocument).toHaveBeenCalledOnce();
      expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();

      // Resolve scan 1
      resolveScan1({ success: true, result: "Res 1" });
      await promise1;

      // Close should not be called yet since scan 2 is still active
      expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();

      // Resolve scan 2
      resolveScan2({ success: true, result: "Res 2" });
      await promise2;

      // Now close document should be called
      expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    });

    it("sends abort request to offscreen document and cleans up if aborted", async () => {
      vi.mocked(chrome.runtime.sendMessage as any).mockReturnValue(new Promise(() => {}) as any); // pending scan

      const controller = new AbortController();
      const service = new LocalOcrTranslationService(0);

      const promise = service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, controller.signal);

      promise.catch(() => {});

      // Wait a microtask to let delay resolve and scan begin
      await new Promise((r) => setTimeout(r, 10));

      // Abort
      controller.abort();

      await expect(promise).rejects.toMatchObject({ name: "AbortError" });

      // Verifies abort message was sent to offscreen doc
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          target: "offscreen-ocr",
          action: "abort",
        })
      );
      expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    });

    it("handles offscreen document close failure gracefully without throwing scanner errors", async () => {
      vi.mocked(chrome.offscreen.closeDocument).mockRejectedValue(new Error("Close failed"));
      vi.mocked(chrome.runtime.sendMessage as any).mockResolvedValue({ success: true, result: "Done" });

      const service = new LocalOcrTranslationService(0);
      const response = await service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, new AbortController().signal);

      expect(response).toBe("Done");
      expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    });

    it("queues offscreen document opening if a closure is currently pending", async () => {
      let resolveClose: any;
      const closePromise = new Promise<void>((r) => { resolveClose = r; });
      vi.mocked(chrome.offscreen.closeDocument).mockImplementation(async () => {
        offscreenExists = false;
        await closePromise;
      });
      
      let resolveScan1: any;
      const scan1Promise = new Promise((r) => { resolveScan1 = r; });
      vi.mocked(chrome.runtime.sendMessage as any).mockImplementationOnce(() => scan1Promise as any);

      const service = new LocalOcrTranslationService(0);

      // Start scan 1
      const promise1 = service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, new AbortController().signal);

      await new Promise((r) => setTimeout(r, 10)); // let it start

      // Resolve scan 1's message. It will now start closing
      resolveScan1({ success: true, result: "Done 1" });

      // We clear the mocks to trace scan 2
      vi.mocked(chrome.offscreen.createDocument).mockClear();

      // Trigger scan 2. It must wait for the pending close to finish
      let resolveScan2: any;
      const scan2Promise = new Promise((r) => { resolveScan2 = r; });
      vi.mocked(chrome.runtime.sendMessage as any).mockImplementationOnce(() => scan2Promise as any);

      const promise2 = service.translate({
        image: new Blob(["pixels"], { type: "image/png" }),
        metadata: metadata(),
      }, new AbortController().signal);

      await new Promise((r) => setTimeout(r, 10));
      expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();

      // Resolve the close promise. Now the new open/create can proceed
      resolveClose();
      resolveScan2({ success: true, result: "Done 2" });

      await Promise.all([promise1, promise2]);

      expect(chrome.offscreen.createDocument).toHaveBeenCalledOnce();
    });
  });
});
