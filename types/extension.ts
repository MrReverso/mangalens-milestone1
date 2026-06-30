// ── Language Codes ──────────────────────────────────────────────

export type SourceLanguage = "auto" | "ja" | "ko" | "zh";

export type TargetLanguage = "en" | "es" | "pt" | "fr" | "it" | "de";

export const SOURCE_LANGUAGE_OPTIONS: ReadonlyArray<{
  value: SourceLanguage;
  label: string;
}> = [
  { value: "auto", label: "Auto Detect" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
] as const;

export const TARGET_LANGUAGE_OPTIONS: ReadonlyArray<{
  value: TargetLanguage;
  label: string;
}> = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "pt", label: "Portuguese" },
  { value: "fr", label: "French" },
  { value: "it", label: "Italian" },
  { value: "de", label: "German" },
] as const;

// ── User Settings ──────────────────────────────────────────────

export interface UserSettings {
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLanguage;
  translationsVisible: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  sourceLanguage: "auto",
  targetLanguage: "en",
  translationsVisible: true,
};

// ── Detected Image ─────────────────────────────────────────────

export interface DetectedImage {
  readonly element: HTMLImageElement;
  readonly pageNumber: number;
}
