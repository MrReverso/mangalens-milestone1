import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => vi.useRealTimers());

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

  it("changes demo text predictably by target language", async () => {
    const service = new LocalDeterministicTranslationService(0);
    const image = new Blob(["pixels"], { type: "image/png" });
    const english = await service.translate(
      { image, metadata: metadata("en") },
      new AbortController().signal
    ) as { bubbles: Array<{ translatedText: string }> };
    const italian = await service.translate(
      { image, metadata: metadata("it") },
      new AbortController().signal
    ) as { bubbles: Array<{ translatedText: string }> };
    expect(english.bubbles[0].translatedText).toBe("We finally made it.");
    expect(italian.bubbles[0].translatedText)
      .toBe("Ce l’abbiamo finalmente fatta.");
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
});
