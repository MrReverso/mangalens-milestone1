import { describe, expect, it, vi } from "vitest";
import { createConfiguredTranslationProvider } from
  "@/dev/backend/translation/translation-provider-config";

describe("translation provider configuration", () => {
  it("keeps the deterministic preview as the no-network default", () => {
    expect(createConfiguredTranslationProvider({}, vi.fn())).toMatchObject({
      id: "deterministic-local-preview",
      execution: "local",
      enabled: true,
    });
  });

  it("requires an exact opt-in and allowlisted model for real local translation", () => {
    expect(createConfiguredTranslationProvider({
      MANGALENS_TRANSLATION_PROVIDER: "ollama",
      MANGALENS_OLLAMA_MODEL: "translategemma:12b",
    }, vi.fn())).toMatchObject({
      id: "ollama-translategemma-12b",
      execution: "local",
      enabled: true,
    });
    expect(() => createConfiguredTranslationProvider({
      MANGALENS_TRANSLATION_PROVIDER: "remote",
    }, vi.fn())).toThrow("Unsupported translation provider configuration");
    expect(() => createConfiguredTranslationProvider({
      MANGALENS_TRANSLATION_PROVIDER: "ollama",
      MANGALENS_OLLAMA_MODEL: "unreviewed-model",
    }, vi.fn())).toThrow("Unsupported local translation model configuration");
  });
});
