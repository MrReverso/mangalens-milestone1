import { GoogleAuth } from "google-auth-library";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { OcrFailure } from "./ocr-errors";

const GOOGLE_AUTH_NO_ADC_MESSAGE =
  "Could not load the default credentials. Browse to " +
  "https://cloud.google.com/docs/authentication/getting-started " +
  "for more information.";

export interface GoogleAccessTokenProvider {
  getAccessToken(signal: AbortSignal): Promise<string>;
}

interface AuthClientLike {
  getAccessToken(): Promise<string | null | {
    readonly token?: string | null;
  }>;
}

interface GoogleAuthLike {
  getClient(): Promise<AuthClientLike>;
}

export class AdcGoogleAccessTokenProvider
implements GoogleAccessTokenProvider {
  constructor(
    private readonly createAuth: () => GoogleAuthLike = () =>
      new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      }),
    private readonly hasAdcConfiguration: () => Promise<boolean> =
      hasLocalAdcConfiguration
  ) {}

  async getAccessToken(signal: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    let configured: boolean;
    try {
      configured = await this.hasAdcConfiguration();
    } catch {
      configured = false;
    }
    throwIfAborted(signal);
    if (!configured) throw new OcrFailure("ocr-not-configured");

    let authClient: AuthClientLike;
    try {
      authClient = await this.createAuth().getClient();
    } catch (error: unknown) {
      throwIfAborted(signal);
      throw classifyAuthenticationError(error);
    }
    throwIfAborted(signal);

    let rawToken: Awaited<ReturnType<AuthClientLike["getAccessToken"]>>;
    try {
      rawToken = await authClient.getAccessToken();
    } catch (error: unknown) {
      throwIfAborted(signal);
      throw classifyAuthenticationError(error);
    }
    throwIfAborted(signal);
    const token = typeof rawToken === "string"
      ? rawToken
      : rawToken?.token;
    if (typeof token !== "string" || token.trim().length === 0) {
      throw new OcrFailure("ocr-auth-failed");
    }
    throwIfAborted(signal);
    return token;
  }
}

async function hasLocalAdcConfiguration(): Promise<boolean> {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicit) return fileExists(explicit);
  const configRoot = process.env.CLOUDSDK_CONFIG ||
    (process.platform === "win32"
      ? process.env.APPDATA
      : join(homedir(), ".config", "gcloud"));
  if (!configRoot) return false;
  return fileExists(join(configRoot, "application_default_credentials.json"));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function classifyAuthenticationError(error: unknown): OcrFailure {
  if (isRecord(error) &&
      (error.code === "ENOENT" ||
       error.code === "ADC_NOT_FOUND" ||
       error.code === "GOOGLE_APPLICATION_CREDENTIALS_NOT_FOUND")) {
    return new OcrFailure("ocr-not-configured");
  }
  if (error instanceof Error &&
      error.message === GOOGLE_AUTH_NO_ADC_MESSAGE) {
    return new OcrFailure("ocr-not-configured");
  }
  return new OcrFailure("ocr-auth-failed");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("OCR cancelled", "AbortError");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
