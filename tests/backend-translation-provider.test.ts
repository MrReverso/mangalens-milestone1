import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DeterministicLocalTranslationProvider,
  applyValidatedTranslation,
} from "@/dev/backend/translation/translation-provider";

describe("DeterministicLocalTranslationProvider", () => {
  it("transforms each OCR entry deterministically without network credentials", async () => {
    const provider = new DeterministicLocalTranslationProvider();
    const output = await provider.translate([
      { id: "bubble-1", originalText: "認識済み" },
    ], "ja", "en", new AbortController().signal);
    expect(provider).toMatchObject({
      id: "deterministic-local-preview", execution: "local", enabled: true,
    });
    expect(output).toEqual({
      entries: [{ id: "bubble-1", translatedText: "[translated preview] 認識済み" }],
    });
  });

  it("honors cancellation and rejects malformed or foreign provider output", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new DeterministicLocalTranslationProvider().translate(
      [{ id: "bubble-1", originalText: "source" }], "auto", "en", controller.signal
    )).rejects.toMatchObject({ name: "AbortError" });
    const bubbles = [{
      id: "bubble-1", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      originalText: "source", translatedText: "source",
    }];
    expect(applyValidatedTranslation(bubbles, { entries: [{ id: "other", translatedText: "value" }] }))
      .toBeNull();
  });

  it("does not contain network or credential access", () => {
    const source = fs.readFileSync(path.resolve(
      __dirname, "../dev/backend/translation/translation-provider.ts"
    ), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain("process.env");
    expect(source).not.toMatch(/api[_-]?key|authorization/i);
  });
});
