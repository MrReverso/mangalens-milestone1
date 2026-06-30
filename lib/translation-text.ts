export const MAX_TRANSLATION_TEXT_LENGTH = 1_000;

export function normalizeTranslationText(value: string): string | null {
  const normalized = value.trim();
  if (normalized.length === 0 ||
      normalized.length > MAX_TRANSLATION_TEXT_LENGTH) {
    return null;
  }
  return normalized;
}
