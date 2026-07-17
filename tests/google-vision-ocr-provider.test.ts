import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_VISION_ANNOTATE_ENDPOINT,
  GoogleVisionOcrProvider,
  buildGoogleVisionRequest,
  readGoogleResponseBody,
  validateGoogleVisionEndpoint,
} from "@/dev/backend/ocr/google-vision-ocr-provider";
import type { GoogleAccessTokenProvider } from "@/dev/backend/ocr/google-access-token-provider";
import { OcrFailure } from "@/dev/backend/ocr/ocr-errors";
import type { OcrInput } from "@/dev/backend/ocr/ocr-types";

const input: OcrInput = {
  image: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  mimeType: "image/png",
  pixelWidth: 100,
  pixelHeight: 100,
  sourceLanguage: "auto",
};

const tokenProvider: GoogleAccessTokenProvider = {
  getAccessToken: vi.fn(async () => "secret-access-token"),
};

function rawParagraph(text = "文字"): unknown {
  return {
    boundingBox: {
      vertices: [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 30 },
        { x: 10, y: 30 },
      ],
    },
    words: [{
      symbols: [...text].map((symbol) => ({ text: symbol })),
    }],
  };
}

function visionResponse(
  paragraphs: unknown[] = [rawParagraph()]
): unknown {
  return {
    responses: [{
      fullTextAnnotation: {
        pages: [{ blocks: [{ paragraphs }] }],
      },
    }],
  };
}

function jsonResponse(
  value: unknown,
  options: ResponseInit = {}
): Response {
  return new Response(JSON.stringify(value), {
    status: options.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(options.headers ?? {}),
    },
  });
}

describe("Google Vision endpoint allowlist", () => {
  it("uses the exact Google endpoint", () => {
    expect(GOOGLE_VISION_ANNOTATE_ENDPOINT)
      .toBe("https://vision.googleapis.com/v1/images:annotate");
    expect(() => validateGoogleVisionEndpoint(
      GOOGLE_VISION_ANNOTATE_ENDPOINT
    )).not.toThrow();
  });

  it.each([
    "http://vision.googleapis.com/v1/images:annotate",
    "https://evil.example/v1/images:annotate",
    "https://vision.googleapis.com:443/v1/images:annotate",
    "https://vision.googleapis.com/v1/images:annotate?key=secret",
    "https://vision.googleapis.com/v1/images:annotate#fragment",
    "https://user:password@vision.googleapis.com/v1/images:annotate",
    "https://vision.googleapis.com/v1/other",
  ])("rejects unsafe endpoint %s", (endpoint) => {
    expect(() => validateGoogleVisionEndpoint(endpoint))
      .toThrow("ocr-invalid-response");
  });
});

describe("Google Vision request construction", () => {
  it("base64 encodes one PNG without a data URL prefix", () => {
    const request = buildGoogleVisionRequest(input) as {
      requests: Array<{ image: { content: string } }>;
    };
    expect(request.requests).toHaveLength(1);
    expect(request.requests[0].image.content).toBe(input.image.toString("base64"));
    expect(request.requests[0].image.content).not.toContain("data:");
  });

  it("requests only DOCUMENT_TEXT_DETECTION", () => {
    const serialized = JSON.stringify(buildGoogleVisionRequest(input));
    expect(serialized).toContain("DOCUMENT_TEXT_DETECTION");
    expect(serialized).not.toMatch(/LABEL|FACE|LOGO|LANDMARK|SAFE_SEARCH|OBJECT/);
  });

  it("omits hints for auto and maps ja, ko and zh exactly", () => {
    const auto = JSON.stringify(buildGoogleVisionRequest(input));
    expect(auto).not.toContain("imageContext");
    for (const language of ["ja", "ko", "zh"] as const) {
      const request = buildGoogleVisionRequest({
        ...input,
        sourceLanguage: language,
      }) as {
        requests: Array<{ imageContext: { languageHints: string[] } }>;
      };
      expect(request.requests[0].imageContext.languageHints).toEqual([language]);
    }
  });

  it("contains no MangaLens identifiers, URLs, settings, or hash metadata", () => {
    const serialized = JSON.stringify(buildGoogleVisionRequest(input));
    expect(serialized).not.toMatch(
      /requestId|pageId|pageNumber|sha256|source website|tabUrl|title|targetLanguage/
    );
  });
});

describe("GoogleVisionOcrProvider", () => {
  it("adds a validated quota project only when configured by the server", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(visionResponse()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
      }));
    const provider = new GoogleVisionOcrProvider(
      tokenProvider,
      fetchImpl as typeof fetch,
      GOOGLE_VISION_ANNOTATE_ENDPOINT,
      4 * 1024 * 1024,
      "mangalens-test1"
    );

    await provider.recognize(input, new AbortController().signal);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      "x-goog-user-project": "mangalens-test1",
    });
    expect(() => new GoogleVisionOcrProvider(
      tokenProvider,
      fetchImpl as typeof fetch,
      GOOGLE_VISION_ANNOTATE_ENDPOINT,
      4 * 1024 * 1024,
      "../invalid"
    )).toThrow("ocr-invalid-response");
  });

  it("uses the token only in Authorization and sends hardened fetch options once", async () => {
    let seenUrl: string | URL | Request = "";
    let seenInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = vi.fn(async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return jsonResponse(visionResponse());
    });
    const provider = new GoogleVisionOcrProvider(tokenProvider, fetchImpl);
    const result = await provider.recognize(
      input,
      new AbortController().signal
    );
    expect(result.regions).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(seenUrl).toBe(GOOGLE_VISION_ANNOTATE_ENDPOINT);
    expect(seenInit).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!seenInit) throw new Error("Fetch options were not captured");
    const headers = seenInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-access-token");
    expect(String(seenInit.body)).not.toContain("secret-access-token");
    expect(seenInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("prevents fetch after authentication failure", async () => {
    const fetchImpl = vi.fn();
    const provider = new GoogleVisionOcrProvider({
      getAccessToken: vi.fn(async () => {
        throw new OcrFailure("ocr-auth-failed");
      }),
    }, fetchImpl);
    await expect(provider.recognize(input, new AbortController().signal))
      .rejects.toThrow("ocr-auth-failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prevents fetch when aborted during or immediately after authentication", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn();
    const provider = new GoogleVisionOcrProvider({
      getAccessToken: vi.fn(async () => {
        controller.abort();
        return "discarded-token";
      }),
    }, fetchImpl);
    await expect(provider.recognize(input, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [429, "ocr-rate-limited"],
    [500, "ocr-unavailable"],
    [503, "ocr-unavailable"],
    [401, "ocr-auth-failed"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const provider = new GoogleVisionOcrProvider(tokenProvider, vi.fn(
      async () => jsonResponse({}, { status })
    ));
    await expect(provider.recognize(input, new AbortController().signal))
      .rejects.toThrow(code);
  });

  it("maps network failure safely and never returns the token in errors", async () => {
    const fetchImpl = vi.fn(
      async () => { throw new Error("secret-access-token private detail"); }
    );
    const provider = new GoogleVisionOcrProvider(tokenProvider, fetchImpl);
    let message = "";
    try {
      await provider.recognize(input, new AbortController().signal);
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("ocr-unavailable");
    expect(message).not.toContain("secret-access-token");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects redirects, missing bodies, and invalid content types", async () => {
    const redirected = jsonResponse(visionResponse());
    Object.defineProperty(redirected, "redirected", { value: true });
    for (const response of [
      redirected,
      new Response(null, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    ]) {
      const provider = new GoogleVisionOcrProvider(
        tokenProvider,
        vi.fn(async () => response)
      );
      await expect(provider.recognize(input, new AbortController().signal))
        .rejects.toThrow("ocr-invalid-response");
    }
  });

  it("rejects malformed JSON, provider errors, multiple responses and no text", async () => {
    const cases = [
      new Response("{", {
        headers: { "Content-Type": "application/json" },
      }),
      jsonResponse({ responses: [{ error: { code: 7, message: "private" } }] }),
      jsonResponse({ responses: [{}, {}] }),
      jsonResponse({ responses: [{}] }),
    ];
    const expected = [
      "ocr-invalid-response",
      "ocr-invalid-response",
      "ocr-invalid-response",
      "ocr-no-text",
    ];
    for (let index = 0; index < cases.length; index++) {
      const provider = new GoogleVisionOcrProvider(
        tokenProvider,
        vi.fn(async () => cases[index])
      );
      await expect(provider.recognize(input, new AbortController().signal))
        .rejects.toThrow(expected[index]);
    }
  });

  it("enforces maximum region and total character limits", async () => {
    const tooMany = Array.from({ length: 101 }, () => rawParagraph("a"));
    const tooMuchText = Array.from(
      { length: 21 },
      () => rawParagraph("a".repeat(1_000))
    );
    for (const paragraphs of [tooMany, tooMuchText]) {
      const provider = new GoogleVisionOcrProvider(
        tokenProvider,
        vi.fn(async () => jsonResponse(visionResponse(paragraphs)))
      );
      await expect(provider.recognize(input, new AbortController().signal))
        .rejects.toThrow("ocr-invalid-response");
    }
  });
});

describe("bounded Google response reading", () => {
  it("cancels an oversized response reader", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel,
    });
    await expect(readGoogleResponseBody(
      new Response(body),
      4,
      new AbortController().signal
    )).rejects.toThrow("ocr-response-too-large");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels the reader when aborted during body reading", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    const promise = readGoogleResponseBody(
      new Response(body),
      100,
      controller.signal
    );
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects an abort after the final chunk", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode("{}"));
        streamController.close();
        controller.abort();
      },
    });
    await expect(readGoogleResponseBody(
      new Response(body),
      100,
      controller.signal
    )).rejects.toMatchObject({ name: "AbortError" });
  });
});
