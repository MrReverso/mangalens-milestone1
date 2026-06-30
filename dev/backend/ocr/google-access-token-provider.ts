import { GoogleAuth } from "google-auth-library";
import { OcrFailure } from "./ocr-errors";

const GOOGLE_AUTH_NO_ADC_MESSAGE =
  "Could not load the default credentials. Browse to " +
  "https://cloud.google.com/docs/authentication/getting-started " +
  "for more information.";

export interface GoogleAccessTokenProvider {
  getAccessToken(signal: AbortSignal): Promise<string>;
}

let warningFilterInstalled = false;

export function installSafeGoogleAuthWarningFilter(): void {
  if (warningFilterInstalled) return;
  warningFilterInstalled = true;
  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((
    warning: string | Error,
    ...args: unknown[]
  ): void => {
    const firstOption = args[0];
    const warningType = typeof firstOption === "string"
      ? firstOption
      : isRecord(firstOption) && typeof firstOption.type === "string"
        ? firstOption.type
        : undefined;
    if (warningType === "MetadataLookupWarning") return;
    Reflect.apply(originalEmitWarning, process, [warning, ...args]);
  }) as typeof process.emitWarning;
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
      })
  ) {}

  async getAccessToken(signal: AbortSignal): Promise<string> {
    throwIfAborted(signal);
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
