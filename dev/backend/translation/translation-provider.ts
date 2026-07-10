import type { TranslationBubble } from "../../../types/translation";

export type TranslationProviderExecution = "local" | "remote";
export type TranslationProviderStatus = "translated" | "unavailable";

export interface TranslationTextEntry {
  readonly id: string;
  readonly originalText: string;
}

export interface TranslationProvider {
  readonly id: string;
  readonly execution: TranslationProviderExecution;
  readonly enabled: boolean;
  translate(
    entries: readonly TranslationTextEntry[],
    sourceLanguage: string,
    targetLanguage: string,
    signal: AbortSignal
  ): Promise<unknown>;
}

/**
 * A local-only wiring provider, deliberately not a language model. Its output
 * makes the post-OCR translation stage visible while preserving source text for
 * deterministic tests and without any network or credentials.
 */
export class DeterministicLocalTranslationProvider implements TranslationProvider {
  readonly id = "deterministic-local-preview";
  readonly execution = "local" as const;
  readonly enabled = true;

  async translate(
    entries: readonly TranslationTextEntry[],
    _sourceLanguage: string,
    _targetLanguage: string,
    signal: AbortSignal
  ): Promise<unknown> {
    if (signal.aborted) throw new DOMException("Translation cancelled", "AbortError");
    return {
      entries: entries.map((entry) => ({
        id: entry.id,
        translatedText: `[translated preview] ${entry.originalText}`,
      })),
    };
  }
}

export function applyValidatedTranslation(
  bubbles: readonly TranslationBubble[],
  value: unknown
): TranslationBubble[] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["entries"]) || !Array.isArray(value.entries) ||
      value.entries.length !== bubbles.length) return null;
  const translatedById = new Map<string, string>();
  for (const entry of value.entries) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["id", "translatedText"]) ||
        !isNonEmptyString(entry.id) || !isNonEmptyString(entry.translatedText) ||
        translatedById.has(entry.id) || entry.translatedText.length > 4_000) return null;
    translatedById.set(entry.id, entry.translatedText.trim());
  }
  return bubbles.map((bubble) => {
    const translatedText = translatedById.get(bubble.id);
    return translatedText ? { ...bubble, translatedText } : null;
  }).every((bubble): bubble is TranslationBubble => bubble !== null)
    ? bubbles.map((bubble) => ({ ...bubble, translatedText: translatedById.get(bubble.id)! }))
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
