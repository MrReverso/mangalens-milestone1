import { describe, expect, it, vi } from "vitest";
import { HttpTranslationService } from "@/lib/translation/http-translation-service";
import type { TranslationApiRequestMetadata } from "@/types/translation-api";

const metadata: TranslationApiRequestMetadata = {
  contractVersion: 1,
  requestId: "req-123",
  pageId: "page-1",
  pageNumber: 2,
  sourceLanguage: "auto",
  targetLanguage: "en",
  capture: {
    pageId: "page-1",
    pageNumber: 2,
    method: "visible-tab-screenshot-crop" as const,
    mimeType: "image/png",
    byteLength: 10,
    pixelWidth: 100,
    pixelHeight: 100,
    sha256: "a".repeat(64),
  },
};

const imageBlob = new Blob([new Uint8Array(10)], { type: "image/png" });

describe("HttpTranslationService", () => {
  it("selects POST method, credentials omit, redirect error, cache no-store, and multipart body with correct metadata and image filenames", async () => {
    let fetchOptions: RequestInit | undefined;
    let fetchUrl: string | undefined;

    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      fetchUrl = url;
      fetchOptions = init;

      const bodyChunks = [new TextEncoder().encode(JSON.stringify({
        contractVersion: 1,
        requestId: "req-123",
        pageId: "page-1",
        bubbles: [],
      }))];
      
      return {
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        body: {
          getReader() {
            let idx = 0;
            return {
              async read() {
                if (idx < bodyChunks.length) {
                  return { done: false, value: bodyChunks[idx++] };
                }
                return { done: true, value: undefined };
              },
              releaseLock() {},
            };
          },
        },
      } as unknown as Response;
    });

    const service = new HttpTranslationService({
      endpoint: "http://127.0.0.1:8787/v1/translate",
      fetchImpl: mockFetch as any,
    });

    const response = await service.translate({
      image: imageBlob,
      metadata,
    }, new AbortController().signal);

    expect(fetchUrl).toBe("http://127.0.0.1:8787/v1/translate");
    expect(fetchOptions).toBeDefined();
    expect(fetchOptions?.method).toBe("POST");
    expect(fetchOptions?.credentials).toBe("omit");
    expect(fetchOptions?.redirect).toBe("error");
    expect(fetchOptions?.cache).toBe("no-store");
    expect(fetchOptions?.referrerPolicy).toBe("no-referrer");

    // The body must be a FormData object
    const body = fetchOptions?.body as FormData;
    expect(body).toBeInstanceOf(FormData);

    const metadataPart = body.get("metadata") as Blob;
    const imagePart = body.get("image") as Blob;

    expect(metadataPart).toBeDefined();
    expect(imagePart).toBeDefined();

    expect(metadataPart.type).toBe("application/json");
    expect(imagePart.type).toBe("image/png");

    expect(response).toBeDefined();
  });

  it("rejects non-PNG images before dispatching fetch", async () => {
    const mockFetch = vi.fn();
    const service = new HttpTranslationService({
      endpoint: "http://127.0.0.1:8787/v1/translate",
      fetchImpl: mockFetch as any,
    });

    const badBlob = new Blob([new Uint8Array(10)], { type: "image/jpeg" });
    await expect(
      service.translate({ image: badBlob, metadata }, new AbortController().signal)
    ).rejects.toThrow("backend-request-failed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects empty images before dispatching fetch", async () => {
    const mockFetch = vi.fn();
    const service = new HttpTranslationService({
      endpoint: "http://127.0.0.1:8787/v1/translate",
      fetchImpl: mockFetch as any,
    });

    const badBlob = new Blob([], { type: "image/png" });
    await expect(
      service.translate({ image: badBlob, metadata }, new AbortController().signal)
    ).rejects.toThrow("backend-request-failed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects oversized images (>20MB) before dispatching fetch", async () => {
    const mockFetch = vi.fn();
    const service = new HttpTranslationService({
      endpoint: "http://127.0.0.1:8787/v1/translate",
      fetchImpl: mockFetch as any,
    });

    const hugeBlob = {
      size: 21 * 1024 * 1024,
      type: "image/png",
    } as Blob;

    await expect(
      service.translate({ image: hugeBlob, metadata }, new AbortController().signal)
    ).rejects.toThrow("backend-request-failed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects metadata/image size mismatch before dispatching fetch", async () => {
    const mockFetch = vi.fn();
    const service = new HttpTranslationService({
      endpoint: "http://127.0.0.1:8787/v1/translate",
      fetchImpl: mockFetch as any,
    });

    const badMetadata = {
      ...metadata,
      capture: {
        ...metadata.capture,
        byteLength: 9999, // Mismatched size
      },
    };

    await expect(
      service.translate({ image: imageBlob, metadata: badMetadata }, new AbortController().signal)
    ).rejects.toThrow("backend-request-failed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects invalid endpoints on construction and execution", () => {
    expect(() => new HttpTranslationService({
      endpoint: "https://127.0.0.1:8787/v1/translate", // https instead of http
    })).toThrow("must use http:");

    expect(() => new HttpTranslationService({
      endpoint: "http://localhost:8787/v1/translate", // hostname not 127.0.0.1
    })).toThrow("must be 127.0.0.1");

    expect(() => new HttpTranslationService({
      endpoint: "http://127.0.0.1:9090/v1/translate", // port not 8787
    })).toThrow("must be 8787");

    expect(() => new HttpTranslationService({
      endpoint: "http://127.0.0.1:8787/translate", // wrong path
    })).toThrow("must be /v1/translate");
  });

  it("rejects non-2xx response status codes", async () => {
    const mockFetch = vi.fn(async () => {
      return {
        status: 500,
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response;
    });

    const service = new HttpTranslationService({
      endpoint: "http://127.0.0.1:8787/v1/translate",
      fetchImpl: mockFetch as any,
    });

    await expect(
      service.translate({ image: imageBlob, metadata }, new AbortController().signal)
    ).rejects.toThrow("backend-http-error");
  });

  it("rejects non-JSON Content-Type response headers", async () => {
    const mockFetch = vi.fn(async () => {
      return {
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
      } as unknown as Response;
    });

    const service = new HttpTranslationService({
      endpoint: "http://127.0.0.1:8787/v1/translate",
      fetchImpl: mockFetch as any,
    });

    await expect(
      service.translate({ image: imageBlob, metadata }, new AbortController().signal)
    ).rejects.toThrow("backend-invalid-content-type");
  });

  it("rejects responses exceeding maxResponseBytes limit during chunk reading", async () => {
    const chunks = [new Uint8Array(100), new Uint8Array(100)];
    const mockFetch = vi.fn(async () => {
      return {
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        body: {
          getReader() {
            let idx = 0;
            return {
              async read() {
                if (idx < chunks.length) {
                  return { done: false, value: chunks[idx++] };
                }
                return { done: true, value: undefined };
              },
              releaseLock() {},
            };
          },
        },
      } as unknown as Response;
    });

    const service = new HttpTranslationService({
      endpoint: "http://127.0.0.1:8787/v1/translate",
      fetchImpl: mockFetch as any,
      maxResponseBytes: 150, // limit is lower than 200 bytes total response
    });

    await expect(
      service.translate({ image: imageBlob, metadata }, new AbortController().signal)
    ).rejects.toThrow("backend-response-too-large");
  });

  it("rejects invalid or malformed JSON payloads", async () => {
    const chunks = [new TextEncoder().encode("{ malformed json }")];
    const mockFetch = vi.fn(async () => {
      return {
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        body: {
          getReader() {
            let idx = 0;
            return {
              async read() {
                if (idx < chunks.length) {
                  return { done: false, value: chunks[idx++] };
                }
                return { done: true, value: undefined };
              },
              releaseLock() {},
            };
          },
        },
      } as unknown as Response;
    });

    const service = new HttpTranslationService({
      endpoint: "http://127.0.0.1:8787/v1/translate",
      fetchImpl: mockFetch as any,
    });

    await expect(
      service.translate({ image: imageBlob, metadata }, new AbortController().signal)
    ).rejects.toThrow("backend-invalid-json");
  });
});
