import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LocalDeterministicTranslationService } from "@/lib/translation/local-deterministic-translation-service";
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

describe("LocalDeterministicTranslationService", () => {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalChrome = (globalThis as any).chrome;

  let mockWorker: any;
  let mockBlocks: { cStart: number; cEnd: number; rStart: number; rEnd: number }[] = [];
  let simulateContextError = false;

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
    simulateContextError = false;
    mockBlocks = [
      { cStart: 100, cEnd: 200, rStart: 100, rEnd: 150 },
      { cStart: 600, cEnd: 700, rStart: 250, rEnd: 300 },
    ];

    // Mock chrome.runtime.getURL
    (globalThis as any).chrome = {
      runtime: {
        getURL: (p: string) => `chrome-extension://mock-id/${p}`,
      },
    };

    globalThis.createImageBitmap = async () => {
      return {
        width: 1000,
        height: 1000,
        close: vi.fn(),
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
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("accepts a valid PNG and returns contract-matching bubbles", async () => {
    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal);
    expect(response).toMatchObject({
      contractVersion: 1,
      requestId: "request-1",
      pageId: "page-1",
    });
    expect((response as { bubbles: any[] }).bubbles).toHaveLength(2);
  });

  it("rejects non-PNG and empty images", async () => {
    const service = new LocalDeterministicTranslationService(0);
    await expect(service.translate({
      image: new Blob(["x"], { type: "image/jpeg" }),
      metadata: metadata(),
    }, new AbortController().signal)).rejects.toThrow("invalid-image");
    
    await expect(service.translate({
      image: new Blob([], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal)).rejects.toThrow("invalid-image");
  });

  it("is deterministic for identical inputs", async () => {
    const service = new LocalDeterministicTranslationService(0);
    const input = {
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    };
    const first = await service.translate(input, new AbortController().signal);
    const second = await service.translate(input, new AbortController().signal);
    expect(second).toEqual(first);
  });

  it("passes arbitrary Japanese text through correctly", async () => {
    mockWorker.recognize.mockResolvedValue({
      data: { text: "本当に大丈夫？" },
    });

    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata("ja"),
    }, new AbortController().signal) as { bubbles: any[] };

    expect(response.bubbles[0].originalText).toBe("本当に大丈夫？");
    expect(response.bubbles[0].translatedText).toBe("本当に大丈夫？");
  });

  it("passes arbitrary Korean text through correctly", async () => {
    mockWorker.recognize.mockResolvedValue({
      data: { text: "무엇을요?" },
    });

    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata("ko"),
    }, new AbortController().signal) as { bubbles: any[] };

    expect(response.bubbles[0].originalText).toBe("무엇을요?");
    expect(response.bubbles[0].translatedText).toBe("무엇을요?");
  });

  it("passes arbitrary Chinese text through correctly", async () => {
    mockWorker.recognize.mockResolvedValue({
      data: { text: "你好吗？" },
    });

    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata("zh"),
    }, new AbortController().signal) as { bubbles: any[] };

    expect(response.bubbles[0].originalText).toBe("你好吗？");
    expect(response.bubbles[0].translatedText).toBe("你好吗？");
  });

  it("passes arbitrary English text through correctly", async () => {
    mockWorker.recognize.mockResolvedValue({
      data: { text: "Stay alert." },
    });

    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata("auto", "en"),
    }, new AbortController().signal) as { bubbles: any[] };

    expect(response.bubbles[0].originalText).toBe("Stay alert.");
    expect(response.bubbles[0].translatedText).toBe("Stay alert.");
  });

  it("handles empty OCR result safely by returning ocr-no-text", async () => {
    mockWorker.recognize.mockResolvedValue({
      data: { text: "" },
    });

    const service = new LocalDeterministicTranslationService(0);
    await expect(service.translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal)).rejects.toThrow("ocr-no-text");
  });

  it("handles OCR engine initialization failure safely by throwing ocr-unavailable", async () => {
    vi.mocked(Tesseract.createWorker).mockRejectedValue(new Error("Failed to init worker"));

    const service = new LocalDeterministicTranslationService(0);
    await expect(service.translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal)).rejects.toThrow("ocr-unavailable");
  });

  it("handles worker recognize failure safely by throwing ocr-unavailable", async () => {
    mockWorker.recognize.mockRejectedValue(new Error("Worker thread crashed"));

    const service = new LocalDeterministicTranslationService(0);
    await expect(service.translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal)).rejects.toThrow("ocr-unavailable");
  });

  it("rejects an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new LocalDeterministicTranslationService().translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts immediately when recognize is pending and terminates the worker", async () => {
    let resolveRecognize: any;
    const pendingPromise = new Promise((resolve) => {
      resolveRecognize = resolve;
    });

    mockWorker.recognize.mockReturnValue(pendingPromise);

    const controller = new AbortController();
    const service = new LocalDeterministicTranslationService(0);

    const promise = service.translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, controller.signal);

    promise.catch(() => {});

    // Let the event loop run to hit the recognize call
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Abort the operation
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(mockWorker.terminate).toHaveBeenCalled();

    // Clean up the promise
    resolveRecognize({ data: { text: "" } });
  });

  it("timeouts when recognize is permanently pending and terminates the worker", async () => {
    vi.useFakeTimers();

    const pendingPromise = new Promise(() => {}); // Permanently pending
    mockWorker.recognize.mockReturnValue(pendingPromise);

    const controller = new AbortController();
    const service = new LocalDeterministicTranslationService(0);

    const promise = service.translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, controller.signal);

    promise.catch(() => {});

    // Advance time asynchronously to get past both abortableDelay and OCR timeout
    await vi.advanceTimersByTimeAsync(26000);

    await expect(promise).rejects.toThrow("ocr-timeout");
    expect(mockWorker.terminate).toHaveBeenCalled();
  });

  it("contains no network client call in the entire module code (no-network guarantee)", async () => {
    const filePath = path.resolve(__dirname, "../lib/translation/local-deterministic-translation-service.ts");
    const source = fs.readFileSync(filePath, "utf8");
    
    // Corrected no-network regex checks
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/);
  });

  it("groups nearby lines belonging to one dialogue block and normalizes coordinate bounds strictly", async () => {
    // Two close vertical boxes (gap is 40px <= 8% of 1000 = 80px)
    mockBlocks = [
      { cStart: 100, cEnd: 200, rStart: 100, rEnd: 150 },
      { cStart: 110, cEnd: 190, rStart: 190, rEnd: 240 },
    ];

    mockWorker.recognize
      .mockResolvedValueOnce({ data: { text: "Line 1" } })
      .mockResolvedValueOnce({ data: { text: "Line 2" } });

    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal) as { bubbles: any[] };

    expect(response.bubbles).toHaveLength(1); // Merged into 1
    const merged = response.bubbles[0];
    expect(merged.originalText).toBe("Line 1\nLine 2");

    // Bounds strict guarantees check
    expect(merged.bounds.x).toBeGreaterThanOrEqual(0);
    expect(merged.bounds.x + merged.bounds.width).toBeLessThanOrEqual(1.00001);
    expect(merged.bounds.y).toBeGreaterThanOrEqual(0);
    expect(merged.bounds.y + merged.bounds.height).toBeLessThanOrEqual(1.00001);
  });

  it("keeps separate dialogue blocks separate", async () => {
    // Two far boxes vertically (gap is 400px > 8% of 1000 = 80px)
    mockBlocks = [
      { cStart: 100, cEnd: 200, rStart: 100, rEnd: 150 },
      { cStart: 100, cEnd: 200, rStart: 550, rEnd: 600 },
    ];

    mockWorker.recognize
      .mockResolvedValueOnce({ data: { text: "Bubble A" } })
      .mockResolvedValueOnce({ data: { text: "Bubble B" } });

    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal) as { bubbles: any[] };

    expect(response.bubbles).toHaveLength(2); // Kept separate
  });

  it("preserves deterministic reading-order sorting primarily top-to-bottom, then left-to-right", async () => {
    mockBlocks = [
      { cStart: 600, cEnd: 700, rStart: 250, rEnd: 300 }, // Bottom
      { cStart: 100, cEnd: 200, rStart: 100, rEnd: 150 }, // Top
    ];

    mockWorker.recognize
      .mockResolvedValueOnce({ data: { text: "Top Bubble" } })
      .mockResolvedValueOnce({ data: { text: "Bottom Bubble" } });

    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal) as { bubbles: any[] };

    expect(response.bubbles).toHaveLength(2);
    // Bubble at y=100 (Top Bubble) must come first in the sorted bubbles array
    expect(response.bubbles[0].originalText).toBe("Top Bubble");
    expect(response.bubbles[1].originalText).toBe("Bottom Bubble");
  });
});
