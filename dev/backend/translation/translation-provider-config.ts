import {
  DeterministicLocalTranslationProvider,
  type TranslationProvider,
} from "./translation-provider";
import {
  ALLOWED_OLLAMA_TRANSLATION_MODELS,
  DEFAULT_OLLAMA_TRANSLATION_MODEL,
  OllamaTranslationProvider,
} from "./ollama-translation-provider";

export interface TranslationProviderEnvironment {
  readonly MANGALENS_TRANSLATION_PROVIDER?: string;
  readonly MANGALENS_OLLAMA_MODEL?: string;
}

export function createConfiguredTranslationProvider(
  environment: TranslationProviderEnvironment,
  fetchImpl: typeof fetch = fetch
): TranslationProvider {
  const provider = environment.MANGALENS_TRANSLATION_PROVIDER ?? "preview";
  if (provider === "preview") return new DeterministicLocalTranslationProvider();
  if (provider !== "ollama") throw new Error("Unsupported translation provider configuration");

  const model = environment.MANGALENS_OLLAMA_MODEL ?? DEFAULT_OLLAMA_TRANSLATION_MODEL;
  if (!ALLOWED_OLLAMA_TRANSLATION_MODELS.has(model)) {
    throw new Error("Unsupported local translation model configuration");
  }
  return new OllamaTranslationProvider(fetchImpl, model);
}
