import type { TranslationApiRequestMetadata } from "@/types/translation-api";

export interface LocalTranslationInput {
  readonly image: Blob;
  readonly metadata: TranslationApiRequestMetadata;
}

export interface TranslationService {
  translate(input: LocalTranslationInput, signal: AbortSignal): Promise<unknown>;
}
