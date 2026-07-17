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

  it("requires an exact opt-in and validated server project for Google Cloud", () => {
    const accessTokenProvider = { getAccessToken: vi.fn(async () => "token") };
    expect(createConfiguredTranslationProvider({
      MANGALENS_TRANSLATION_PROVIDER: "google-cloud",
      MANGALENS_GOOGLE_CLOUD_PROJECT: "mangalens-test1",
    }, vi.fn(), accessTokenProvider)).toMatchObject({
      id: "google-translation-llm",
      execution: "remote",
      enabled: true,
    });
    expect(() => createConfiguredTranslationProvider({
      MANGALENS_TRANSLATION_PROVIDER: "google-cloud",
    }, vi.fn(), accessTokenProvider)).toThrow(
      "Google Cloud project configuration is required"
    );
    expect(() => createConfiguredTranslationProvider({
      MANGALENS_TRANSLATION_PROVIDER: "google-cloud",
      MANGALENS_GOOGLE_CLOUD_PROJECT: "../untrusted",
    }, vi.fn(), accessTokenProvider)).toThrow(
      "Invalid Google Cloud project configuration"
    );
  });
});
