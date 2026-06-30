import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AdcGoogleAccessTokenProvider } from "@/dev/backend/ocr/google-access-token-provider";

describe("ADC Google access token provider", () => {
  it("uses only the Cloud Platform OAuth scope and no API key", () => {
    const source = fs.readFileSync(path.resolve(
      __dirname,
      "../dev/backend/ocr/google-access-token-provider.ts"
    ), "utf8");
    expect(source).toContain(
      "https://www.googleapis.com/auth/cloud-platform"
    );
    expect(source).not.toMatch(/apiKey|key=/);
  });

  it("returns a token from GoogleAuth without persisting or exposing it", async () => {
    const getAccessToken = vi.fn(async () => ({ token: "access-token" }));
    const provider = new AdcGoogleAccessTokenProvider(() => ({
      getClient: vi.fn(async () => ({ getAccessToken })),
    }), async () => true);
    await expect(provider.getAccessToken(new AbortController().signal))
      .resolves.toBe("access-token");
    expect(getAccessToken).toHaveBeenCalledOnce();
  });

  it("rejects missing local ADC before constructing GoogleAuth", async () => {
    const createAuth = vi.fn();
    const provider = new AdcGoogleAccessTokenProvider(
      createAuth,
      async () => false
    );
    await expect(provider.getAccessToken(new AbortController().signal))
      .rejects.toThrow("ocr-not-configured");
    expect(createAuth).not.toHaveBeenCalled();
  });

  it.each([
    { code: "ENOENT" },
    { code: "ADC_NOT_FOUND" },
    {
      message:
        "Could not load the default credentials. Browse to " +
        "https://cloud.google.com/docs/authentication/getting-started " +
        "for more information.",
    },
  ])("maps missing ADC safely", async (detail) => {
    const provider = new AdcGoogleAccessTokenProvider(() => ({
      getClient: vi.fn(async () => {
        const error = new Error("message" in detail ? detail.message : "private");
        if ("code" in detail) {
          Object.assign(error, { code: detail.code });
        }
        throw error;
      }),
    }), async () => true);
    await expect(provider.getAccessToken(new AbortController().signal))
      .rejects.toThrow("ocr-not-configured");
  });

  it("maps rejected and empty credentials to ocr-auth-failed", async () => {
    const rejected = new AdcGoogleAccessTokenProvider(() => ({
      getClient: vi.fn(async () => ({
        getAccessToken: vi.fn(async () => {
          throw new Error("private credential detail");
        }),
      })),
    }), async () => true);
    await expect(rejected.getAccessToken(new AbortController().signal))
      .rejects.toThrow("ocr-auth-failed");

    const empty = new AdcGoogleAccessTokenProvider(() => ({
      getClient: vi.fn(async () => ({
        getAccessToken: vi.fn(async () => ({ token: null })),
      })),
    }), async () => true);
    await expect(empty.getAccessToken(new AbortController().signal))
      .rejects.toThrow("ocr-auth-failed");
  });

  it("checks cancellation before and after each authentication step", async () => {
    const initiallyAborted = new AbortController();
    initiallyAborted.abort();
    const getClient = vi.fn();
    const provider = new AdcGoogleAccessTokenProvider(
      () => ({ getClient }),
      async () => true
    );
    await expect(provider.getAccessToken(initiallyAborted.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(getClient).not.toHaveBeenCalled();

    const afterClient = new AbortController();
    const providerAfterClient = new AdcGoogleAccessTokenProvider(() => ({
      getClient: vi.fn(async () => {
        afterClient.abort();
        return { getAccessToken: vi.fn() };
      }),
    }), async () => true);
    await expect(providerAfterClient.getAccessToken(afterClient.signal))
      .rejects.toMatchObject({ name: "AbortError" });

    const afterToken = new AbortController();
    const providerAfterToken = new AdcGoogleAccessTokenProvider(() => ({
      getClient: vi.fn(async () => ({
        getAccessToken: vi.fn(async () => {
          afterToken.abort();
          return { token: "discarded-token" };
        }),
      })),
    }), async () => true);
    await expect(providerAfterToken.getAccessToken(afterToken.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
