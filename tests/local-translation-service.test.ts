import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalDeterministicTranslationService } from "@/lib/translation/local-deterministic-translation-service";
import type { TranslationApiRequestMetadata } from "@/types/translation-api";

function metadata(targetLanguage: TranslationApiRequestMetadata["targetLanguage"] = "en"):
TranslationApiRequestMetadata {
  return {
    contractVersion: 1,
    requestId: "request-1",
    pageId: "page-1",
    pageNumber: 1,
    sourceLanguage: "auto",
    targetLanguage,
    capture: {
      pageId: "page-1",
      pageNumber: 1,
      method: "visible-tab-screenshot-crop",
      mimeType: "image/png",
      pixelWidth: 800,
      pixelHeight: 1200,
      byteLength: 6,
      sha256: "a".repeat(64),
    },
  };
}

describe("LocalDeterministicTranslationService", () => {
  const originalTextDetector = (globalThis as any).TextDetector;
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  beforeEach(() => {
    (globalThis as any).TextDetector = class MockTextDetector {
      async detect() {
        return [
          { boundingBox: { x: 80, y: 80, width: 340, height: 130 }, rawValue: "Detected Text 1" },
          { boundingBox: { x: 580, y: 240, width: 320, height: 120 }, rawValue: "Detected Text 2" },
          { boundingBox: { x: 310, y: 730, width: 380, height: 130 }, rawValue: "Detected Text 3" },
        ];
      }
    };
    globalThis.createImageBitmap = async () => {
      return { width: 1000, height: 1000 } as any;
    };
  });

  afterEach(() => {
    (globalThis as any).TextDetector = originalTextDetector;
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

  it("does not translate text and returns detected text for both fields", async () => {
    const service = new LocalDeterministicTranslationService(0);
    const image = new Blob(["pixels"], { type: "image/png" });
    const response = await service.translate(
      { image, metadata: metadata("en") },
      new AbortController().signal
    ) as { bubbles: Array<{ originalText: string; translatedText: string }> };
    expect(response.bubbles[0].originalText).toBe("Detected Text 1");
    expect(response.bubbles[0].translatedText).toBe("Detected Text 1");
  });

  it("rejects an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new LocalDeterministicTranslationService().translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels during processing", async () => {
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

  it("contains no network client call", async () => {
    const source = LocalDeterministicTranslationService.prototype.translate
      .toString();
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/);
  });

  it("groups nearby lines belonging to one dialogue block and normalizes coordinate bounds", async () => {
    (globalThis as any).TextDetector = class MockTextDetector {
      async detect() {
        return [
          { boundingBox: { x: 100, y: 100, width: 200, height: 50 }, rawValue: "Hello" },
          { boundingBox: { x: 110, y: 160, width: 180, height: 40 }, rawValue: "World" },
          { boundingBox: { x: 500, y: 500, width: 100, height: 50 }, rawValue: "Separate" },
        ];
      }
    };

    const response = await new LocalDeterministicTranslationService(0).translate({
      image: new Blob(["pixels"], { type: "image/png" }),
      metadata: metadata(),
    }, new AbortController().signal) as { bubbles: any[] };

    expect(response.bubbles).toHaveLength(2);
    
    const merged = response.bubbles.find((b) => b.originalText.includes("Hello"));
    expect(merged.originalText).toBe("Hello\nWorld");
    expect(merged.translatedText).toBe("Hello\nWorld");
    expect(merged.bounds).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
    });
  });
});
