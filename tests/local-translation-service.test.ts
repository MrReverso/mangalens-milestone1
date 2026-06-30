import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalDeterministicTranslationService } from "@/lib/translation/local-deterministic-translation-service";
import type { TranslationApiRequestMetadata } from "@/types/translation-api";

function metadata(
  targetLanguage: TranslationApiRequestMetadata["targetLanguage"] = "en",
  pageId = "page-1",
  pageNumber = 1
): TranslationApiRequestMetadata {
  return {
    contractVersion: 1,
    requestId: "request-1",
    pageId,
    pageNumber,
    sourceLanguage: "auto",
    targetLanguage,
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

  // Helpers to draw mock high-contrast blocks in simulated ImageData
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
          data[idx] = 0;     // R
          data[idx + 1] = 0; // G
          data[idx + 2] = 0; // B
        }
      }
    }
    return { width: w, height: h, data };
  }

  let mockBlocks: { cStart: number; cEnd: number; rStart: number; rEnd: number }[] = [];
  let simulateContextError = false;

  beforeEach(() => {
    simulateContextError = false;
    // Set up standard mock blocks for default success tests
    mockBlocks = [
      { cStart: 100, cEnd: 200, rStart: 100, rEnd: 150 }, // rx < 0.5 && ry < 0.4
      { cStart: 600, cEnd: 700, rStart: 250, rEnd: 300 }, // rx > 0.45 && ry > 0.4
      { cStart: 350, cEnd: 450, rStart: 750, rEnd: 800 }, // rx < 0.5 && ry > 0.5
    ];

    globalThis.createImageBitmap = async () => {
      return { width: 1000, height: 1000 } as any;
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
    };
  });

  afterEach(() => {
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    vi.useRealTimers();
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
    expect((response as { bubbles: unknown[] }).bubbles).toHaveLength(3);
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

  it("returns detected text for both fields (originalText and translatedText)", async () => {
    const service = new LocalDeterministicTranslationService(0);
    const image = new Blob(["pixels"], { type: "image/png" });
    const response = await service.translate(
      { image, metadata: metadata("en", "page-webtoon", 2) },
      new AbortController().signal
    ) as { bubbles: Array<{ originalText: string; translatedText: string }> };
    
    // Bubble 1 matches: rx < 0.5 && ry < 0.4 => "Where are we going?"
    expect(response.bubbles[0].originalText).toBe("Where are we going?");
    expect(response.bubbles[0].translatedText).toBe("Where are we going?");
  });

  it("rejects an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new LocalDeterministicTranslationService().translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels during processing (timeout/abort)", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = new LocalDeterministicTranslationService(100).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("contains no network client call (no-network guarantee)", async () => {
    const source = LocalDeterministicTranslationService.prototype.translate.toString();
    expect(source).not.toMatch(/\bffetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/);
  });

  it("groups nearby lines belonging to one dialogue block and normalizes coordinate bounds", async () => {
    // Override blocks: block 1 & 2 are close vertically (gap is 40px <= 8% of 1000 = 80px)
    mockBlocks = [
      { cStart: 100, cEnd: 200, rStart: 100, rEnd: 150 }, // Where are we going?
      { cStart: 110, cEnd: 190, rStart: 190, rEnd: 240 }, // Where are we going?
    ];

    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata("en", "page-webtoon", 2),
    }, new AbortController().signal) as { bubbles: any[] };

    expect(response.bubbles).toHaveLength(1); // Grouped into 1
    const merged = response.bubbles[0];
    expect(merged.originalText).toBe("Where are we going?\nWhere are we going?");
    
    // Bounds check
    expect(merged.bounds.x).toBeGreaterThanOrEqual(0);
    expect(merged.bounds.x).toBeLessThanOrEqual(1);
    expect(merged.bounds.y).toBeGreaterThanOrEqual(0);
    expect(merged.bounds.y).toBeLessThanOrEqual(1);
    expect(merged.bounds.width).toBeGreaterThan(0);
    expect(merged.bounds.height).toBeGreaterThan(0);
  });

  it("keeps separate dialogue blocks separate", async () => {
    // Override blocks: block 1 & 2 are far vertically (gap is 400px > 8% of 1000 = 80px)
    mockBlocks = [
      { cStart: 100, cEnd: 200, rStart: 100, rEnd: 150 },
      { cStart: 100, cEnd: 200, rStart: 550, rEnd: 600 },
    ];

    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal) as { bubbles: any[] };

    expect(response.bubbles).toHaveLength(2); // Kept separate
  });

  it("handles no-text response safely", async () => {
    mockBlocks = []; // No text blocks drawn

    const service = new LocalDeterministicTranslationService(0);
    await expect(service.translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal)).rejects.toThrow("ocr-no-text");
  });

  it("handles unavailable OCR engine safely", async () => {
    simulateContextError = true; // getContext returns null

    const service = new LocalDeterministicTranslationService(0);
    await expect(service.translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal)).rejects.toThrow("ocr-unavailable");
  });

  it("handles invalid or unreadable image safely", async () => {
    // Make createImageBitmap throw
    globalThis.createImageBitmap = async () => {
      throw new Error("unreadable image");
    };

    const service = new LocalDeterministicTranslationService(0);
    await expect(service.translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal)).rejects.toThrow("invalid-image");
  });

  it("preserves deterministic reading-order sorting", async () => {
    // Sort primarily top to bottom, then left to right.
    // Block 1: y=250 (bottom)
    // Block 2: y=100 (top)
    mockBlocks = [
      { cStart: 600, cEnd: 700, rStart: 250, rEnd: 300 },
      { cStart: 100, cEnd: 200, rStart: 100, rEnd: 150 },
    ];

    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal) as { bubbles: any[] };

    expect(response.bubbles).toHaveLength(2);
    // Bubble at y=100 (top) must come first
    expect(response.bubbles[0].bounds.y).toBeLessThan(response.bubbles[1].bounds.y);
  });
});
