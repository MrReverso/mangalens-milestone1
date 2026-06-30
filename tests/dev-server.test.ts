import { describe, expect, it } from "vitest";
import { handleTranslationRequest } from "@/dev/backend/translation-handler";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Buffer } from "node:buffer";

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

  const chunks = options.bodyChunks ?? [];
  process.nextTick(() => {
    for (const chunk of chunks) {
      req.emit("data", chunk);
    }
    req.emit("end");
  });

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
    });
  });

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

    // Deterministic translation validation for Spanish
    expect(response.bubbles[0].translatedText).toBe("Por fin llegamos.");
    expect(response.bubbles[1].translatedText).toBe("Mantente alerta.");
    expect(response.bubbles[2].translatedText).toBe("Esto es solo el comienzo.");
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
});
