import { describe, expect, it, vi } from "vitest";
import {
  GoogleTranslationLlmProvider,
} from "@/dev/backend/translation/google-translation-llm-provider";
import type { GoogleAccessTokenProvider } from
  "@/dev/backend/ocr/google-access-token-provider";

function tokenProvider(token = "server-only-token"): GoogleAccessTokenProvider {
  return { getAccessToken: vi.fn(async () => token) };
}

describe("Google Translation LLM provider", () => {
  it("sends bounded text-only requests to the exact allowlisted endpoint", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        translations: [
          { translatedText: "Hello" },
          { translatedText: "Goodbye" },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }));
    const provider = new GoogleTranslationLlmProvider(
      tokenProvider(), "mangalens-test1", "us-central1", fetchImpl as typeof fetch
    );

    await expect(provider.translate([
      { id: "bubble-1", originalText: "こんにちは" },
      { id: "bubble-2", originalText: "さようなら" },
    ], "ja", "en", new AbortController().signal)).resolves.toEqual({
      entries: [
        { id: "bubble-1", translatedText: "Hello" },
        { id: "bubble-2", translatedText: "Goodbye" },
      ],
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://translation.googleapis.com/v3/projects/mangalens-test1:translateText"
    );
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(init?.headers).toMatchObject({
      "Authorization": "Bearer server-only-token",
      "Content-Type": "application/json",
      "x-goog-user-project": "mangalens-test1",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      contents: ["こんにちは", "さようなら"],
      mimeType: "text/plain",
      targetLanguageCode: "en",
      sourceLanguageCode: "ja",
      model: "projects/mangalens-test1/locations/us-central1/models/general/translation-llm",
    });
  });

  it("omits source language for provider-side detection", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
      translations: [{ translatedText: "Hello" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new GoogleTranslationLlmProvider(
      tokenProvider(), "mangalens-test1", "us-central1", fetchImpl as typeof fetch
    );

    await provider.translate(
      [{ id: "bubble-1", originalText: "こんにちは" }],
      "auto", "en", new AbortController().signal
    );

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty("sourceLanguageCode");
  });

  it("treats credentials, redirects, errors, and malformed output as unavailable", async () => {
    const authFailure: GoogleAccessTokenProvider = {
      getAccessToken: vi.fn(async () => { throw new Error("credential details"); }),
    };
    const provider = new GoogleTranslationLlmProvider(
      authFailure, "mangalens-test1", "us-central1", vi.fn()
    );
    await expect(provider.translate(
      [{ id: "bubble-1", originalText: "text" }],
      "ja", "en", new AbortController().signal
    )).rejects.toThrow("translation-provider-unavailable");

    for (const response of [
      new Response("{}", { status: 403, headers: { "Content-Type": "application/json" } }),
      new Response(JSON.stringify({ translations: [] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
      new Response(JSON.stringify({ translations: [{ translatedText: "" }] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    ]) {
      const candidate = new GoogleTranslationLlmProvider(
        tokenProvider(), "mangalens-test1", "us-central1",
        vi.fn(async () => response) as typeof fetch
      );
      await expect(candidate.translate(
        [{ id: "bubble-1", originalText: "text" }],
        "ja", "en", new AbortController().signal
      )).rejects.toThrow(/translation-(provider-unavailable|invalid-response)/);
    }
  });

  it("reports health without making a paid translation request", async () => {
    const fetchImpl = vi.fn();
    const healthy = new GoogleTranslationLlmProvider(
      tokenProvider(), "mangalens-test1", "us-central1", fetchImpl as typeof fetch
    );
    await expect(healthy.health(new AbortController().signal)).resolves.toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();

    const unavailable = new GoogleTranslationLlmProvider({
      getAccessToken: vi.fn(async () => { throw new Error("not configured"); }),
    }, "mangalens-test1", "us-central1", fetchImpl as typeof fetch);
    await expect(unavailable.health(new AbortController().signal)).resolves.toBe(false);
  });

  it("rejects untrusted project, location, language, and duplicate input", async () => {
    expect(() => new GoogleTranslationLlmProvider(
      tokenProvider(), "../project", "us-central1", vi.fn()
    )).toThrow("Invalid Google Cloud project configuration");
    expect(() => new GoogleTranslationLlmProvider(
      tokenProvider(), "mangalens-test1", "https://evil.example", vi.fn()
    )).toThrow("Invalid Google Cloud location configuration");

    const provider = new GoogleTranslationLlmProvider(
      tokenProvider(), "mangalens-test1", "us-central1", vi.fn()
    );
    await expect(provider.translate(
      [{ id: "same", originalText: "one" }, { id: "same", originalText: "two" }],
      "ja", "en", new AbortController().signal
    )).rejects.toThrow("translation-invalid-response");
    await expect(provider.translate(
      [{ id: "one", originalText: "text" }],
      "xx", "en", new AbortController().signal
    )).rejects.toThrow("translation-invalid-response");
  });
});
