import { describe, expect, it, vi } from "vitest";
import {
  createTranslationRequestHandler,
  parseMultipartContentType,
} from "@/dev/backend/translation-handler";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Buffer } from "node:buffer";
import { OcrFailure } from "@/dev/backend/ocr/ocr-errors";
import type { OcrErrorCode } from "@/dev/backend/ocr/ocr-errors";
import type { OcrInput } from "@/dev/backend/ocr/ocr-types";

const fakeProviderMetadata = {
  id: "test-fake" as const,
  execution: "local" as const,
  enabled: true,
};

const handleTranslationRequest = createTranslationRequestHandler({
  ocrProvider: {
    ...fakeProviderMetadata,
    recognize: vi.fn(async () => ({
      regions: [
        {
          text: "Detected paragraph one",
          bounds: { x: 0.08, y: 0.08, width: 0.34, height: 0.13 },
        },
        {
          text: "Detected paragraph two",
          bounds: { x: 0.58, y: 0.24, width: 0.32, height: 0.12 },
        },
        {
          text: "Detected paragraph three",
          bounds: { x: 0.31, y: 0.73, width: 0.38, height: 0.13 },
        },
      ],
    })),
  },
  logger: () => undefined,
});

function createMockRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  bodyChunks?: Buffer[];
}): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = options.method ?? "GET";
  req.url = options.url ?? "/";
  req.headers = options.headers ?? {};

  if (options.bodyChunks !== undefined) {
    const chunks = options.bodyChunks;
    process.nextTick(() => {
      for (const chunk of chunks) {
        req.emit("data", chunk);
      }
      req.emit("end");
    });
  }

  return req;
}

function createMockResponse() {
  let status = 200;
  const headers: Record<string, string> = {};
  let body = "";

  const res = {
    writeHead(s: number, h?: any) {
      status = s;
      if (h) {
        for (const [k, v] of Object.entries(h)) {
          headers[k.toLowerCase()] = String(v);
        }
      }
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = String(value);
      return this;
    },
    end(data?: string) {
      if (data) body += data;
    },
    writableEnded: true,
  } as unknown as ServerResponse;

  return {
    res,
    getOutput: () => ({ status, headers, body }),
  };
}

function buildMultipartBody(
  boundary: string,
  parts: { name: string; filename?: string; contentType?: string; data: Buffer }[]
): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    let disposition = `Content-Disposition: form-data; name="${part.name}"`;
    if (part.filename) {
      disposition += `; filename="${part.filename}"`;
    }
    chunks.push(Buffer.from(`${disposition}\r\n`));
    if (part.contentType) {
      chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    }
    chunks.push(Buffer.from("\r\n"));
    chunks.push(part.data);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

const mockMetadata = {
  contractVersion: 1,
  requestId: "req-1",
  pageId: "page-1",
  pageNumber: 2,
  sourceLanguage: "auto",
  targetLanguage: "es",
  capture: {
    pageId: "page-1",
    pageNumber: 2,
    method: "visible-tab-screenshot-crop",
    mimeType: "image/png",
    byteLength: 10,
    pixelWidth: 100,
    pixelHeight: 100,
    sha256: "a".repeat(64),
  },
};

const validPngData = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(2),
]);

function createValidPostRequest(
  metadata: typeof mockMetadata = mockMetadata
): IncomingMessage {
  const boundary = "OcrBoundary";
  const body = buildMultipartBody(boundary, [
    {
      name: "metadata",
      filename: "metadata.json",
      contentType: "application/json",
      data: Buffer.from(JSON.stringify(metadata)),
    },
    {
      name: "image",
      filename: "page.png",
      contentType: "image/png",
      data: validPngData,
    },
  ]);
  return createMockRequest({
    method: "POST",
    url: "/v1/translate",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length),
    },
    bodyChunks: [body],
  });
}

describe("Development Server Handlers", () => {
  it("GET /health health check returns status ok and contractVersion 1", async () => {
    const req = createMockRequest({ method: "GET", url: "/health" });
    const { res, getOutput } = createMockResponse();

    await handleTranslationRequest(req, res);

    const out = getOutput();
    expect(out.status).toBe(200);
    expect(out.headers["content-type"]).toBe("application/json");
    expect(out.headers["cache-control"]).toBe("no-store");
    expect(out.headers["x-content-type-options"]).toBe("nosniff");

    const parsed = JSON.parse(out.body);
    expect(parsed).toEqual({
      status: "ok",
      service: "mangalens-development-api",
      contractVersion: 1,
      ocrProvider: "test-fake",
      ocrExecution: "local",
      ocrEnabled: true,
    });
  });

  it.each([false, true])(
    "GET /health reports injected Google provider enabled=%s dynamically",
    async (enabled) => {
      const handler = createTranslationRequestHandler({
        ocrProvider: {
          id: "google-vision",
          execution: "remote",
          enabled,
          recognize: vi.fn(async () => ({ regions: [] })),
        },
        logger: () => undefined,
      });
      const { res, getOutput } = createMockResponse();
      await handler(createMockRequest({ method: "GET", url: "/health" }), res);
      expect(JSON.parse(getOutput().body)).toEqual({
        status: "ok",
        service: "mangalens-development-api",
        contractVersion: 1,
        ocrProvider: "google-vision",
        ocrExecution: "remote",
        ocrEnabled: enabled,
      });
    }
  );

  it("POST /v1/translate returns deterministic translations based on targetLanguage", async () => {
    const boundary = "WebKitFormBoundary123";
    const body = buildMultipartBody(boundary, [
      {
        name: "metadata",
        filename: "metadata.json",
        contentType: "application/json",
        data: Buffer.from(JSON.stringify(mockMetadata)),
      },
      {
        name: "image",
        filename: "page.png",
        contentType: "image/png",
        data: validPngData,
      },
    ]);

    const req = createMockRequest({
      method: "POST",
      url: "/v1/translate",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(body.length),
      },
      bodyChunks: [body],
    });

    const { res, getOutput } = createMockResponse();
    await handleTranslationRequest(req, res);

    const out = getOutput();
    expect(out.status).toBe(200);
    expect(out.headers["content-type"]).toBe("application/json");

    const response = JSON.parse(out.body);
    expect(response.contractVersion).toBe(1);
    expect(response.requestId).toBe("req-1");
    expect(response.pageId).toBe("page-1");
    expect(response.bubbles).toHaveLength(3);

    expect(response.bubbles[0].translatedText).toBe("Detected paragraph one");
    expect(response.bubbles[0].originalText).toBe("Detected paragraph one");
  });

  it("POST /v1/translate rejects with 400 when metadata part is missing", async () => {
    const boundary = "WebKitFormBoundary123";
    const body = buildMultipartBody(boundary, [
      {
        name: "image",
        filename: "page.png",
        contentType: "image/png",
        data: validPngData,
      },
    ]);

    const req = createMockRequest({
      method: "POST",
      url: "/v1/translate",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      bodyChunks: [body],
    });

    const { res, getOutput } = createMockResponse();
    await handleTranslationRequest(req, res);

    const out = getOutput();
    expect(out.status).toBe(400);
    const parsed = JSON.parse(out.body);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("malformed-request");
  });

  it("POST /v1/translate rejects with 400 when invalid PNG signature is provided", async () => {
    const boundary = "WebKitFormBoundary123";
    const body = buildMultipartBody(boundary, [
      {
        name: "metadata",
        filename: "metadata.json",
        contentType: "application/json",
        data: Buffer.from(JSON.stringify(mockMetadata)),
      },
      {
        name: "image",
        filename: "page.png",
        contentType: "image/png",
        data: Buffer.from("invalid-png-signature"),
      },
    ]);

    const req = createMockRequest({
      method: "POST",
      url: "/v1/translate",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      bodyChunks: [body],
    });

    const { res, getOutput } = createMockResponse();
    await handleTranslationRequest(req, res);

    const out = getOutput();
    expect(out.status).toBe(400);
  });

  it("POST /v1/translate keeps OCR text unchanged across target languages", async () => {
    const languages = ["de", "fr", "it"] as const;

    for (const lang of languages) {
      const boundary = "WebKitFormBoundary123";
      const body = buildMultipartBody(boundary, [
        {
          name: "metadata",
          filename: "metadata.json",
          contentType: "application/json",
          data: Buffer.from(JSON.stringify({ ...mockMetadata, targetLanguage: lang })),
        },
        {
          name: "image",
          filename: "page.png",
          contentType: "image/png",
          data: validPngData,
        },
      ]);
      const req = createMockRequest({
        method: "POST",
        url: "/v1/translate",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        bodyChunks: [body],
      });
      const { res, getOutput } = createMockResponse();
      await handleTranslationRequest(req, res);
      const out = getOutput();
      expect(out.status).toBe(200);
      const response = JSON.parse(out.body);
      expect(response.bubbles[0].translatedText).toBe("Detected paragraph one");
    }
  });

  it("POST /v1/translate rejects duplicate or extra parts", async () => {
    const boundary = "WebKitFormBoundary123";
    
    const bodyDup = buildMultipartBody(boundary, [
      { name: "metadata", filename: "metadata.json", contentType: "application/json", data: Buffer.from(JSON.stringify(mockMetadata)) },
      { name: "metadata", filename: "metadata.json", contentType: "application/json", data: Buffer.from(JSON.stringify(mockMetadata)) },
      { name: "image", filename: "page.png", contentType: "image/png", data: validPngData },
    ]);
    const reqDup = createMockRequest({
      method: "POST",
      url: "/v1/translate",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      bodyChunks: [bodyDup],
    });
    const { res: resDup, getOutput: getOutputDup } = createMockResponse();
    await handleTranslationRequest(reqDup, resDup);
    expect(getOutputDup().status).toBe(400);

    const bodyExtra = buildMultipartBody(boundary, [
      { name: "metadata", filename: "metadata.json", contentType: "application/json", data: Buffer.from(JSON.stringify(mockMetadata)) },
      { name: "image", filename: "page.png", contentType: "image/png", data: validPngData },
      { name: "extra", filename: "extra.txt", contentType: "text/plain", data: Buffer.from("hello") },
    ]);
    const reqExtra = createMockRequest({
      method: "POST",
      url: "/v1/translate",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      bodyChunks: [bodyExtra],
    });
    const { res: resExtra, getOutput: getOutputExtra } = createMockResponse();
    await handleTranslationRequest(reqExtra, resExtra);
    expect(getOutputExtra().status).toBe(400);
  });

  it("POST /v1/translate rejects invalid filenames and invalid MIME types", async () => {
    const boundary = "WebKitFormBoundary123";
    
    const bodyBadFilename = buildMultipartBody(boundary, [
      { name: "metadata", filename: "wrong.json", contentType: "application/json", data: Buffer.from(JSON.stringify(mockMetadata)) },
      { name: "image", filename: "page.png", contentType: "image/png", data: validPngData },
    ]);
    const reqBad = createMockRequest({
      method: "POST",
      url: "/v1/translate",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      bodyChunks: [bodyBadFilename],
    });
    const { res: resBad, getOutput: getOutputBad } = createMockResponse();
    await handleTranslationRequest(reqBad, resBad);
    expect(getOutputBad().status).toBe(400);
  });

  it("POST /v1/translate rejects empty image or byteLength mismatch", async () => {
    const boundary = "WebKitFormBoundary123";
    
    const bodyEmptyImage = buildMultipartBody(boundary, [
      { name: "metadata", filename: "metadata.json", contentType: "application/json", data: Buffer.from(JSON.stringify(mockMetadata)) },
      { name: "image", filename: "page.png", contentType: "image/png", data: Buffer.alloc(0) },
    ]);
    const reqEmpty = createMockRequest({
      method: "POST",
      url: "/v1/translate",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      bodyChunks: [bodyEmptyImage],
    });
    const { res: resEmpty, getOutput: getOutputEmpty } = createMockResponse();
    await handleTranslationRequest(reqEmpty, resEmpty);
    expect(getOutputEmpty().status).toBe(400);

    const bodyMismatch = buildMultipartBody(boundary, [
      { name: "metadata", filename: "metadata.json", contentType: "application/json", data: Buffer.from(JSON.stringify({ ...mockMetadata, capture: { ...mockMetadata.capture, byteLength: 999 } })) },
      { name: "image", filename: "page.png", contentType: "image/png", data: validPngData },
    ]);
    const reqMismatch = createMockRequest({
      method: "POST",
      url: "/v1/translate",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      bodyChunks: [bodyMismatch],
    });
    const { res: resMismatch, getOutput: getOutputMismatch } = createMockResponse();
    await handleTranslationRequest(reqMismatch, resMismatch);
    expect(getOutputMismatch().status).toBe(422);
  });

  it("POST /v1/translate rejects unsupported method or unknown path", async () => {
    const reqMethod = createMockRequest({ method: "GET", url: "/v1/translate" });
    const { res: resMethod, getOutput: getOutputMethod } = createMockResponse();
    await handleTranslationRequest(reqMethod, resMethod);
    expect(getOutputMethod().status).toBe(405);

    const reqPath = createMockRequest({ method: "POST", url: "/v1/unknown" });
    const { res: resPath, getOutput: getOutputPath } = createMockResponse();
    await handleTranslationRequest(reqPath, resPath);
    expect(getOutputPath().status).toBe(404);
  });

  it("rejects media type containing multipart/form-data as a substring or missing boundary", () => {
    expect(parseMultipartContentType("text/plain; note=multipart/form-data")).toBeNull();
    expect(parseMultipartContentType("multipart/mixed; boundary=123")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=123; boundary=456")).toBeNull();
  });

  it("supports quoted boundary parameters", () => {
    const parsed = parseMultipartContentType('multipart/form-data; boundary="WebKitFormBoundaryXYZ"');
    expect(parsed).toEqual({ boundary: "WebKitFormBoundaryXYZ" });
  });

  it("parses correctly even if boundary-like bytes inside the PNG body mimic a delimiter", async () => {
    const boundary = "WebKitFormBoundary123";
    const pngWithFakeBoundary = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(`\r\n--${boundary}`),
      Buffer.from("extra bytes"),
    ]);

    const body = buildMultipartBody(boundary, [
      {
        name: "metadata",
        filename: "metadata.json",
        contentType: "application/json",
        data: Buffer.from(JSON.stringify({ ...mockMetadata, capture: { ...mockMetadata.capture, byteLength: pngWithFakeBoundary.length } })),
      },
      {
        name: "image",
        filename: "page.png",
        contentType: "image/png",
        data: pngWithFakeBoundary,
      },
    ]);

    const req = createMockRequest({
      method: "POST",
      url: "/v1/translate",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      bodyChunks: [body],
    });

    const { res, getOutput } = createMockResponse();
    await handleTranslationRequest(req, res);

    const out = getOutput();
    expect(out.status).toBe(200);
  });

  it("sends exactly one error response when timeout occurs during body chunk reading", async () => {
    vi.useFakeTimers();
    const boundary = "WebKitFormBoundary123";
    const req = createMockRequest({
      method: "POST",
      url: "/v1/translate",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });

    const { res, getOutput } = createMockResponse();
    const handlePromise = handleTranslationRequest(req, res);

    await vi.advanceTimersByTimeAsync(10000);
    await handlePromise;

    const out = getOutput();
    expect(out.status).toBe(408);
    expect(JSON.parse(out.body).error.code).toBe("timeout");
  });

  it("does not include stack trace or exception messages in error bodies", async () => {
    const boundary = "WebKitFormBoundary123";
    const body = buildMultipartBody(boundary, [
      {
        name: "metadata",
        filename: "metadata.json",
        contentType: "application/json",
        data: Buffer.from("{ malformed json"),
      },
      {
        name: "image",
        filename: "page.png",
        contentType: "image/png",
        data: validPngData,
      },
    ]);

    const req = createMockRequest({
      method: "POST",
      url: "/v1/translate",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      bodyChunks: [body],
    });

    const { res, getOutput } = createMockResponse();
    await handleTranslationRequest(req, res);

    const out = getOutput();
    expect(out.status).toBe(400);
    const parsed = JSON.parse(out.body);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("malformed-request");
    expect(parsed.error.message).toBeUndefined();
    expect(out.body).not.toContain("stack");
    expect(out.body).not.toContain("SyntaxError");
  });

  it("strictly validates multipart/form-data Content-Type boundary parameters", () => {
    expect(parseMultipartContentType("multipart/form-data; boundary=VALID")).toEqual({ boundary: "VALID" });
    expect(parseMultipartContentType('multipart/form-data; boundary="VALID"')).toEqual({ boundary: "VALID" });
    expect(parseMultipartContentType('multipart/form-data; boundary="VALID WITH SPACES"')).toEqual({ boundary: "VALID WITH SPACES" });

    expect(parseMultipartContentType("multipart/form-data; boundary=VALID; foo=bar")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=123; boundary=456")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=VALID;")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=VALID WITH SPACES")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=VALID\u0001")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=VAL?ID")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=VAL&ID")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=VAL#ID")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=VAL=ID")).toBeNull();
    expect(parseMultipartContentType('multipart/form-data; boundary="MISMATCHED')).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary='SINGLE_QUOTED'")).toBeNull();
    expect(parseMultipartContentType("multipart/form-data; boundary=" + "A".repeat(71))).toBeNull();
  });

  it("handles request body settlement lifecycle properly, retaining only unrelated listeners and preventing late crashes", async () => {
    const req = new IncomingMessage(new Socket());
    req.method = "POST";
    req.url = "/v1/translate";
    req.headers = {
      "content-type": "multipart/form-data; boundary=boundary",
    };

    const unrelatedErrorListener = () => {};
    req.on("error", unrelatedErrorListener);

    const { res, getOutput } = createMockResponse();
    const promise = handleTranslationRequest(req, res);

    expect(req.listenerCount("data")).toBe(1);
    expect(req.listenerCount("end")).toBe(1);
    expect(req.listenerCount("error")).toBe(2);
    expect(req.listenerCount("aborted")).toBe(1);

    req.emit("data", Buffer.alloc(22 * 1024 * 1024));

    await promise;

    expect(getOutput().status).toBe(413);

    expect(req.listenerCount("data")).toBe(0);
    expect(req.listenerCount("end")).toBe(0);
    expect(req.listenerCount("error")).toBe(1);
    expect(req.listenerCount("aborted")).toBe(0);

    expect(req.listeners("error")[0]).toBe(unrelatedErrorListener);

    expect(() => req.emit("data", Buffer.alloc(100))).not.toThrow();
    expect(() => req.emit("error", new Error("late error"))).not.toThrow();
    expect(() => req.emit("end")).not.toThrow();
  });

  it("ensures client abort settles once and later events are ignored", async () => {
    const req = new IncomingMessage(new Socket());
    req.method = "POST";
    req.url = "/v1/translate";
    req.headers = {
      "content-type": "multipart/form-data; boundary=boundary",
    };
    req.on("error", () => {});

    const { res, getOutput } = createMockResponse();
    const promise = handleTranslationRequest(req, res);

    req.emit("aborted");
    await promise;

    const out = getOutput();
    expect(out.status).toBe(400);

    expect(() => req.emit("data", Buffer.alloc(100))).not.toThrow();
    expect(() => req.emit("error", new Error("late error"))).not.toThrow();
    expect(() => req.emit("end")).not.toThrow();
  });

  it("injects exact validated bytes, dimensions, and source language into OCR", async () => {
    let seenInput: OcrInput | undefined;
    let seenSignal: AbortSignal | undefined;
    const recognize = vi.fn(async (
      ocrInput: OcrInput,
      signal: AbortSignal
    ) => {
      seenInput = ocrInput;
      seenSignal = signal;
      return {
        regions: [{
          text: "検出",
          bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
        }],
      };
    });
    const handler = createTranslationRequestHandler({
      ocrProvider: { ...fakeProviderMetadata, recognize },
      logger: () => undefined,
    });
    const { res, getOutput } = createMockResponse();
    await handler(createValidPostRequest({
      ...mockMetadata,
      sourceLanguage: "ja",
    }), res);
    expect(getOutput().status).toBe(200);
    expect(recognize).toHaveBeenCalledOnce();
    expect(seenInput?.image.equals(validPngData)).toBe(true);
    expect(seenInput).toMatchObject({
      mimeType: "image/png",
      pixelWidth: 100,
      pixelHeight: 100,
      sourceLanguage: "ja",
    });
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("returns OCR regions as untranslated, editable-contract bubbles", async () => {
    const handler = createTranslationRequestHandler({
      ocrProvider: {
        ...fakeProviderMetadata,
        recognize: vi.fn(async () => ({
          regions: [{
            text: "そのまま",
            bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
          }],
        })),
      },
      logger: () => undefined,
    });
    const { res, getOutput } = createMockResponse();
    await handler(createValidPostRequest(), res);
    const response = JSON.parse(getOutput().body);
    expect(response.bubbles).toEqual([{
      id: "req-1-ocr-1",
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
      originalText: "そのまま",
      translatedText: "そのまま",
    }]);
  });

  it.each<readonly [OcrErrorCode, number]>([
    ["ocr-provider-disabled", 503],
    ["ocr-no-text", 422],
    ["ocr-not-configured", 503],
    ["ocr-auth-failed", 503],
    ["ocr-rate-limited", 429],
    ["ocr-timeout", 408],
  ])("returns only safe allowlisted %s errors", async (code, status) => {
    const handler = createTranslationRequestHandler({
      ocrProvider: {
        ...fakeProviderMetadata,
        recognize: vi.fn(async () => {
          throw new OcrFailure(code);
        }),
      },
      logger: () => undefined,
    });
    const { res, getOutput } = createMockResponse();
    await handler(createValidPostRequest(), res);
    expect(getOutput().status).toBe(status);
  });

  it("does not log image bytes, OCR text, IDs, hashes, or provider details", async () => {
    const entries: unknown[] = [];
    const handler = createTranslationRequestHandler({
      ocrProvider: {
        ...fakeProviderMetadata,
        recognize: vi.fn(async () => ({
          regions: [{
            text: "private OCR text",
            bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
          }],
        })),
      },
      logger: (entry) => entries.push(entry),
      now: () => 1_000,
    });
    const { res } = createMockResponse();
    await handler(createValidPostRequest(), res);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("private OCR text");
    expect(serialized).not.toContain("req-1");
    expect(serialized).not.toContain("page-1");
    expect(serialized).not.toContain("a".repeat(64));
    expect(serialized).not.toContain(validPngData.toString("base64"));
  });

  it("aborts provider work and returns ocr-timeout after client cancellation", async () => {
    const recognize = vi.fn((
      _input: OcrInput,
      signal: AbortSignal
    ) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(new DOMException("cancelled", "AbortError"));
      }, { once: true });
    }));
    const handler = createTranslationRequestHandler({
      ocrProvider: { ...fakeProviderMetadata, recognize },
      logger: () => undefined,
    });
    const request = createValidPostRequest();
    const { res, getOutput } = createMockResponse();
    const promise = handler(request, res);
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledOnce());
    request.emit("aborted");
    await promise;
    expect(getOutput().status).toBe(408);
    expect(JSON.parse(getOutput().body)).toEqual({
      success: false,
      error: { code: "ocr-timeout" },
    });
  });

  it("rejects malformed injected OCR regions through the response contract", async () => {
    const handler = createTranslationRequestHandler({
      ocrProvider: {
        ...fakeProviderMetadata,
        recognize: vi.fn(async () => ({
          regions: [{
            text: "",
            bounds: { x: 2, y: 0, width: 1, height: 1 },
          }],
        })),
      },
      logger: () => undefined,
    });
    const { res, getOutput } = createMockResponse();
    await handler(createValidPostRequest(), res);
    expect(getOutput().status).toBe(422);
    expect(JSON.parse(getOutput().body)).toEqual({
      success: false,
      error: { code: "ocr-invalid-response" },
    });
  });
});
