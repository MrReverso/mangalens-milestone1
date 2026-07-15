import { describe, expect, it, vi } from "vitest";
import {
  OLLAMA_GENERATE_ENDPOINT,
  OLLAMA_TAGS_ENDPOINT,
  OllamaTranslationProvider,
} from "@/dev/backend/translation/ollama-translation-provider";

describe("OllamaTranslationProvider", () => {
  it("reports ready only when the exact local model is installed", async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe(OLLAMA_TAGS_ENDPOINT);
      expect(init).toMatchObject({
        method: "GET",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      return new Response(JSON.stringify({
        models: [{ name: "translategemma:4b", model: "translategemma:4b" }],
      }), { headers: { "content-type": "application/json" } });
    });
    await expect(new OllamaTranslationProvider(fetchImpl).health(
      new AbortController().signal
    )).resolves.toBe(true);
  });

  it("sends bounded OCR text to the exact loopback endpoint and returns structured output", async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe(OLLAMA_GENERATE_ENDPOINT);
      expect(init).toMatchObject({
        method: "POST",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "translategemma:4b",
        stream: false,
        think: false,
        options: { temperature: 0 },
      });
      expect(body.prompt).toContain("Japanese (ja)");
      expect(body.prompt).toContain("English (en)");
      expect(body.prompt).toContain("おはよう");
      expect(body.format).toMatchObject({ type: "object", additionalProperties: false });
      return new Response(JSON.stringify({
        model: "translategemma:4b",
        done: true,
        response: JSON.stringify({
          entries: [{ id: "bubble-1", translatedText: "Good morning" }],
        }),
      }), { headers: { "content-type": "application/json; charset=utf-8" } });
    });
    const provider = new OllamaTranslationProvider(fetchImpl);
    await expect(provider.translate(
      [{ id: "bubble-1", originalText: "おはよう" }],
      "ja",
      "en",
      new AbortController().signal
    )).resolves.toEqual({
      entries: [{ id: "bubble-1", translatedText: "Good morning" }],
    });
    expect(provider).toMatchObject({
      id: "ollama-translategemma-4b",
      execution: "local",
      enabled: true,
    });
  });

  it("rejects malformed output and honors cancellation without dispatching", async () => {
    const malformedFetch: typeof fetch = vi.fn(async () => new Response(
      JSON.stringify({ done: true, response: "not json" }),
      { headers: { "content-type": "application/json" } }
    ));
    await expect(new OllamaTranslationProvider(malformedFetch).translate(
      [{ id: "bubble-1", originalText: "source" }],
      "auto",
      "en",
      new AbortController().signal
    )).rejects.toThrow("translation-invalid-response");

    const neverFetch: typeof fetch = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(new OllamaTranslationProvider(neverFetch).translate(
      [{ id: "bubble-1", originalText: "source" }],
      "auto",
      "en",
      controller.signal
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(neverFetch).not.toHaveBeenCalled();
  });
});
