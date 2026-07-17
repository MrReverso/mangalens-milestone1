import {
  DeterministicLocalTranslationProvider,
  type TranslationProvider,
} from "./translation-provider";
import {
  ALLOWED_OLLAMA_TRANSLATION_MODELS,
  DEFAULT_OLLAMA_TRANSLATION_MODEL,
  OllamaTranslationProvider,
} from "./ollama-translation-provider";
import type { GoogleAccessTokenProvider } from "../ocr/google-access-token-provider";
import { AdcGoogleAccessTokenProvider } from "../ocr/google-access-token-provider";
import {
  DEFAULT_GOOGLE_TRANSLATION_LOCATION,
  GoogleTranslationLlmProvider,
} from "./google-translation-llm-provider";

export interface TranslationProviderEnvironment {
  readonly MANGALENS_TRANSLATION_PROVIDER?: string;
  readonly MANGALENS_OLLAMA_MODEL?: string;
  readonly MANGALENS_GOOGLE_CLOUD_PROJECT?: string;
  readonly MANGALENS_GOOGLE_CLOUD_LOCATION?: string;
}

export function createConfiguredTranslationProvider(
  environment: TranslationProviderEnvironment,
  fetchImpl: typeof fetch = fetch,
  googleAccessTokenProvider: GoogleAccessTokenProvider =
    new AdcGoogleAccessTokenProvider()
): TranslationProvider {
  const provider = environment.MANGALENS_TRANSLATION_PROVIDER ?? "preview";
  if (provider === "preview") return new DeterministicLocalTranslationProvider();
  if (provider === "google-cloud") {
    const projectId = environment.MANGALENS_GOOGLE_CLOUD_PROJECT;
    if (!projectId) throw new Error("Google Cloud project configuration is required");
    return new GoogleTranslationLlmProvider(
      googleAccessTokenProvider,
      projectId,
      environment.MANGALENS_GOOGLE_CLOUD_LOCATION ??
        DEFAULT_GOOGLE_TRANSLATION_LOCATION,
      fetchImpl
    );
  }
  if (provider !== "ollama") throw new Error("Unsupported translation provider configuration");

  const model = environment.MANGALENS_OLLAMA_MODEL ?? DEFAULT_OLLAMA_TRANSLATION_MODEL;
  if (!ALLOWED_OLLAMA_TRANSLATION_MODELS.has(model)) {
    throw new Error("Unsupported local translation model configuration");
  }
  return new OllamaTranslationProvider(fetchImpl, model);
}
