import { afterEach, describe, expect, it, vi } from "vitest";
import { MockTranslationProvider } from "@/lib/mock-translation-provider";
import { validateNormalizedRect } from "@/types/translation";
import type { TargetLanguage } from "@/types/extension";

const baseInput = {
  pageId: "page-1",
  pageNumber: 1,
  sourceLanguage: "auto" as const,
  targetLanguage: "en" as TargetLanguage,
};

describe("MockTranslationProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns exactly two deterministic bubbles", async () => {
    vi.useFakeTimers();
    const provider = new MockTranslationProvider(400);
    const first = provider.translatePage(baseInput, new AbortController().signal);
    const second = provider.translatePage(baseInput, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(400);

    expect(await first).toEqual(await second);
    expect((await first).bubbles).toHaveLength(2);
  });

  it.each([
    ["en", "Where are we going?"],
    ["es", "¿A dónde vamos?"],
    ["pt", "Para onde estamos indo?"],
    ["fr", "Où allons-nous ?"],
    ["it", "Dove stiamo andando?"],
    ["de", "Wohin gehen wir?"],
  ] as const)("uses the correct %s mock text", async (language, expected) => {
    const provider = new MockTranslationProvider(0);
    const result = await provider.translatePage(
      { ...baseInput, targetLanguage: language },
      new AbortController().signal
    );
    expect(result.bubbles[0].translatedText).toBe(expected);
  });

  it("rejects promptly when aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = new MockTranslationProvider(400)
      .translatePage(baseInput, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects invalid or non-finite normalized coordinates", () => {
    expect(() => validateNormalizedRect({
      x: Number.NaN, y: 0, width: 0.2, height: 0.2,
    })).toThrow();
    expect(() => validateNormalizedRect({
      x: 0.9, y: 0, width: 0.2, height: 0.2,
    })).toThrow();
  });
});
