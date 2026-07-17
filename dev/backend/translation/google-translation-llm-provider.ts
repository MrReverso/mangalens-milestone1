import type { GoogleAccessTokenProvider } from "../ocr/google-access-token-provider";
import type {
  TranslationProvider,
  TranslationTextEntry,
} from "./translation-provider";

export const GOOGLE_TRANSLATION_ORIGIN = "https://translation.googleapis.com";
export const GOOGLE_TRANSLATION_LLM_MODEL = "general/translation-llm";
export const DEFAULT_GOOGLE_TRANSLATION_LOCATION = "us-central1";

const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const MAX_ENTRIES = 100;
const MAX_ENTRY_TEXT_CHARACTERS = 4_000;
const MAX_TOTAL_TEXT_CHARACTERS = 20_000;
const TRANSLATION_TIMEOUT_MS = 90_000;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const LOCATION_PATTERN = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;
const SUPPORTED_LANGUAGES = new Set([
  "auto", "ja", "ko", "zh", "en", "es", "pt", "fr", "it", "de",
]);

/**
 * Server-only Google Cloud Translation LLM adapter. Browser code never receives
 * the access token, project configuration, OCR bytes, or provider response.
 */
export class GoogleTranslationLlmProvider implements TranslationProvider {
  readonly id = "google-translation-llm";
  readonly execution = "remote" as const;
  readonly enabled = true;
  private readonly endpoint: string;
  private readonly modelResource: string;

  constructor(
    private readonly accessTokenProvider: GoogleAccessTokenProvider,
    private readonly projectId: string,
    location = DEFAULT_GOOGLE_TRANSLATION_LOCATION,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      throw new Error("Invalid Google Cloud project configuration");
    }
    if (!LOCATION_PATTERN.test(location)) {
      throw new Error("Invalid Google Cloud location configuration");
    }
    this.endpoint = `${GOOGLE_TRANSLATION_ORIGIN}/v3/projects/${projectId}:translateText`;
    this.modelResource = `projects/${projectId}/locations/${location}/models/${GOOGLE_TRANSLATION_LLM_MODEL}`;
    validateGoogleTranslationEndpoint(this.endpoint, projectId);
  }

  async health(signal: AbortSignal): Promise<boolean> {
    throwIfAborted(signal);
    try {
      const token = await this.accessTokenProvider.getAccessToken(signal);
      throwIfAborted(signal);
      return isNonEmptyString(token);
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) throw abortError();
      return false;
    }
  }

  async translate(
    entries: readonly TranslationTextEntry[],
    sourceLanguage: string,
    targetLanguage: string,
    signal: AbortSignal
  ): Promise<unknown> {
    validateTranslationInput(entries, sourceLanguage, targetLanguage);
    throwIfAborted(signal);
    validateGoogleTranslationEndpoint(this.endpoint, this.projectId);

    const requestController = new AbortController();
    const onAborted = () => requestController.abort();
    signal.addEventListener("abort", onAborted, { once: true });
    const timer = setTimeout(() => requestController.abort(), TRANSLATION_TIMEOUT_MS);
    try {
      const accessToken = await this.accessTokenProvider.getAccessToken(
        requestController.signal
      );
      if (!isNonEmptyString(accessToken)) {
        throw new Error("translation-provider-unavailable");
      }
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-goog-user-project": this.projectId,
        },
        body: JSON.stringify({
          contents: entries.map((entry) => entry.originalText),
          mimeType: "text/plain",
          targetLanguageCode: targetLanguage,
          model: this.modelResource,
          ...(sourceLanguage === "auto"
            ? {}
            : { sourceLanguageCode: sourceLanguage }),
        }),
        signal: requestController.signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      if (signal.aborted) throw abortError();
      if (response.redirected || !response.ok || !isJsonResponse(response)) {
        throw new Error("translation-provider-unavailable");
      }
      const value = await readBoundedJson(
        response,
        MAX_PROVIDER_RESPONSE_BYTES,
        requestController.signal
      );
      return mapTranslationResponse(value, entries);
    } catch (error: unknown) {
      if (signal.aborted) throw abortError();
      if (error instanceof Error &&
          (error.message === "translation-provider-unavailable" ||
           error.message === "translation-invalid-response")) throw error;
      throw new Error("translation-provider-unavailable");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAborted);
    }
  }
}

function mapTranslationResponse(
  value: unknown,
  entries: readonly TranslationTextEntry[]
): unknown {
  if (!isRecord(value) || !Array.isArray(value.translations) ||
      value.translations.length !== entries.length) {
    throw new Error("translation-invalid-response");
  }
  return {
    entries: value.translations.map((candidate, index) => {
      if (!isRecord(candidate) ||
          !isNonEmptyString(candidate.translatedText) ||
          candidate.translatedText.length > MAX_ENTRY_TEXT_CHARACTERS) {
        throw new Error("translation-invalid-response");
      }
      return {
        id: entries[index].id,
        translatedText: candidate.translatedText.trim(),
      };
    }),
  };
}

function validateTranslationInput(
  entries: readonly TranslationTextEntry[],
  sourceLanguage: string,
  targetLanguage: string
): void {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ENTRIES ||
      !SUPPORTED_LANGUAGES.has(sourceLanguage) ||
      !SUPPORTED_LANGUAGES.has(targetLanguage) || targetLanguage === "auto") {
    throw new Error("translation-invalid-response");
  }
  const ids = new Set<string>();
  let totalCharacters = 0;
  for (const entry of entries) {
    if (!isNonEmptyString(entry.id) || entry.id.length > 200 || ids.has(entry.id) ||
        !isNonEmptyString(entry.originalText) ||
        entry.originalText.length > MAX_ENTRY_TEXT_CHARACTERS) {
      throw new Error("translation-invalid-response");
    }
    ids.add(entry.id);
    totalCharacters += entry.originalText.length;
  }
  if (totalCharacters > MAX_TOTAL_TEXT_CHARACTERS) {
    throw new Error("translation-invalid-response");
  }
}

function validateGoogleTranslationEndpoint(endpoint: string, projectId: string): void {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.hostname !== "translation.googleapis.com" ||
      url.port !== "" ||
      url.pathname !== `/v3/projects/${projectId}:translateText` ||
      url.username !== "" || url.password !== "" || url.search !== "" ||
      url.hash !== "") {
    throw new Error("Invalid Google Translation endpoint");
  }
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type");
  return typeof contentType === "string" &&
    /^application\/json(?:\s*;.*)?$/i.test(contentType);
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<unknown> {
  if (!response.body) throw new Error("translation-invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("translation-invalid-response");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("translation-invalid-response");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortError(): DOMException {
  return new DOMException("Translation cancelled", "AbortError");
}
