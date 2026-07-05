import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  DbnetOcr48pxProvider,
  MANGA_ENGINE_DETECT_ENDPOINT,
  MANGA_ENGINE_RECOGNIZE_ENDPOINT,
  validateMangaEngineEndpoint,
} from "@/dev/backend/ocr/dbnet-ocr48px-provider";
import type { OcrInput } from "@/dev/backend/ocr/ocr-types";

const input: OcrInput = {
  image: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  mimeType: "image/png",
  pixelWidth: 1000,
  pixelHeight: 1400,
  sourceLanguage: "ja",
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function detectionResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    width: 1000,
    height: 1400,
    detector: "default",
    errors: [],
    regions: [{
      id: "region_1",
      pts: [[100, 140], [500, 140], [500, 280], [100, 280]],
      detectorMode: "genuine",
      detectorInferenceRan: true,
    }],
    ...overrides,
  };
}

function recognitionResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    errors: [],
    regions: [{
      id: "region_1",
      text: "こんにちは",
      confidence: 0.97,
    }],
    ...overrides,
  };
}

describe("DBNet + OCR48px endpoint allowlist", () => {
  it("accepts only the two exact loopback endpoints", () => {
    expect(() => validateMangaEngineEndpoint(
      MANGA_ENGINE_DETECT_ENDPOINT
    )).not.toThrow();
    expect(() => validateMangaEngineEndpoint(
      MANGA_ENGINE_RECOGNIZE_ENDPOINT
    )).not.toThrow();
    for (const endpoint of [
      "http://localhost:8002/detect",
      "http://127.0.0.1:8002/other",
      "https://127.0.0.1:8002/detect",
      "http://127.0.0.1:8002/detect?x=1",
      "http://user:pass@127.0.0.1:8002/detect",
    ]) {
      expect(() => validateMangaEngineEndpoint(endpoint))
        .toThrow("ocr-invalid-response");
    }
  });
});

describe("DbnetOcr48pxProvider", () => {
  it("runs genuine default detection then OCR48px and normalizes bounds", async () => {
    const fetchImpl: typeof fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(detectionResponse()))
      .mockResolvedValueOnce(jsonResponse(recognitionResponse()));
    const provider = new DbnetOcr48pxProvider(fetchImpl);
    const result = await provider.recognize(
      input,
      new AbortController().signal
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      MANGA_ENGINE_DETECT_ENDPOINT,
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      MANGA_ENGINE_RECOGNIZE_ENDPOINT,
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({
      regions: [{
        text: "こんにちは",
        bounds: { x: 0.1, y: 0.1, width: 0.4, height: 0.1 },
      }],
    });
    const detectForm = vi.mocked(fetchImpl).mock.calls[0][1]?.body as FormData;
    const recognizeForm =
      vi.mocked(fetchImpl).mock.calls[1][1]?.body as FormData;
    expect(detectForm.get("detector")).toBe("default");
    expect(recognizeForm.get("recognizer")).toBe("ocr48px");
  });

  it("rejects mock detection and never invokes recognition", async () => {
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue(jsonResponse(
      detectionResponse({
        regions: [{
          id: "region_1",
          pts: [[1, 1], [2, 1], [2, 2], [1, 2]],
          detectorMode: "mock",
          detectorInferenceRan: false,
        }],
      })
    ));
    await expect(new DbnetOcr48pxProvider(fetchImpl).recognize(
      input,
      new AbortController().signal
    )).rejects.toThrow("ocr-invalid-response");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("maps network and server failures without exposing raw details", async () => {
    for (const fetchImpl of [
      vi.fn(async () => { throw new Error("private engine detail"); }),
      vi.fn(async () => jsonResponse({}, 500)),
    ]) {
      await expect(new DbnetOcr48pxProvider(fetchImpl).recognize(
        input,
        new AbortController().signal
      )).rejects.toThrow("ocr-unavailable");
    }
  });

  it("rejects malformed geometry, unknown IDs, blank OCR and oversized output", async () => {
    const cases = [
      [
        detectionResponse({ regions: [{
          id: "region_1",
          pts: [[-1, 1], [2, 1], [2, 2], [1, 2]],
          detectorMode: "genuine",
          detectorInferenceRan: true,
        }] }),
        null,
        "ocr-invalid-response",
      ],
      [detectionResponse(), recognitionResponse({
        regions: [{ id: "other", text: "text", confidence: 1 }],
      }), "ocr-invalid-response"],
      [detectionResponse(), recognitionResponse({
        regions: [{ id: "region_1", text: " ", confidence: 0 }],
      }), "ocr-no-text"],
    ] as const;
    for (const [detection, recognition, code] of cases) {
      const fetchImpl: typeof fetch = recognition === null
        ? vi.fn().mockResolvedValue(jsonResponse(detection))
        : vi.fn()
          .mockResolvedValueOnce(jsonResponse(detection))
          .mockResolvedValueOnce(jsonResponse(recognition));
      await expect(new DbnetOcr48pxProvider(fetchImpl).recognize(
        input,
        new AbortController().signal
      )).rejects.toThrow(code);
    }

    const provider = new DbnetOcr48pxProvider(
      vi.fn(async () => jsonResponse(detectionResponse())),
      5
    );
    await expect(provider.recognize(
      input,
      new AbortController().signal
    )).rejects.toThrow("ocr-response-too-large");
  });

  it("propagates cancellation and does not continue to recognition", async () => {
    const controller = new AbortController();
    const fetchImpl: typeof fetch = vi.fn(async () => {
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    });
    await expect(new DbnetOcr48pxProvider(fetchImpl).recognize(
      input,
      controller.signal
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
