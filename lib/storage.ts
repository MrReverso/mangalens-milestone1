import type { UserSettings, SourceLanguage, TargetLanguage } from "@/types/extension";
import { DEFAULT_SETTINGS } from "@/types/extension";

const STORAGE_KEY = "mangalens-settings";

const VALID_SOURCE_LANGUAGES = new Set<string>(["auto", "ja", "ko", "zh"]);
const VALID_TARGET_LANGUAGES = new Set<string>(["en", "es", "pt", "fr", "it", "de"]);

function isValidSourceLanguage(value: string): value is SourceLanguage {
  return VALID_SOURCE_LANGUAGES.has(value);
}

function isValidTargetLanguage(value: string): value is TargetLanguage {
  return VALID_TARGET_LANGUAGES.has(value);
}

/**
 * Read user settings from chrome.storage.local, validating each value.
 * Falls back to defaults for any invalid or missing entry.
 */
export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY] as Partial<UserSettings> | undefined;

  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS };
  }

  const src = raw.sourceLanguage;
  const tgt = raw.targetLanguage;
  const visible = raw.translationsVisible;
  const localAiEnabled = raw.localAiEnabled;

  return {
    sourceLanguage: typeof src === "string" && isValidSourceLanguage(src)
      ? src
      : DEFAULT_SETTINGS.sourceLanguage,
    targetLanguage: typeof tgt === "string" && isValidTargetLanguage(tgt)
      ? tgt
      : DEFAULT_SETTINGS.targetLanguage,
    translationsVisible: typeof visible === "boolean"
      ? visible
      : DEFAULT_SETTINGS.translationsVisible,
    localAiEnabled: typeof localAiEnabled === "boolean"
      ? localAiEnabled
      : DEFAULT_SETTINGS.localAiEnabled,
  };
}

/**
 * Persist user settings to chrome.storage.local.
 */
export async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

/**
 * Set default settings only when none exist yet.
 * Called by the background script on install.
 */
export async function initializeDefaultSettings(): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (result[STORAGE_KEY] === undefined) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
  }
}
