import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  OptionalOcrProvider,
  isGoogleVisionExplicitlyEnabled,
} from "@/dev/backend/ocr/optional-ocr-provider";
import type { OcrProvider } from "@/dev/backend/ocr/ocr-provider";
import { GoogleVisionOcrProvider } from "@/dev/backend/ocr/google-vision-ocr-provider";

const input = {
  image: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  mimeType: "image/png" as const,
  pixelWidth: 100,
  pixelHeight: 100,
  sourceLanguage: "auto" as const,
};

function remoteProvider(recognize = vi.fn(async () => ({ regions: [] }))):
OcrProvider {
  return {
    id: "google-vision",
    execution: "remote",
    enabled: true,
    recognize,
  };
}

describe("optional Google Vision provider", () => {
  it("is disabled by default and enables only the exact value true", () => {
    expect(isGoogleVisionExplicitlyEnabled(undefined)).toBe(false);
    expect(isGoogleVisionExplicitlyEnabled("true")).toBe(true);
    for (const value of [
      "", "false", "1", "yes", "TRUE", " true", "true ", "unexpected",
    ]) {
      expect(isGoogleVisionExplicitlyEnabled(value)).toBe(false);
    }
  });

  it("reports safe provider identity and execution metadata", () => {
    const provider = new OptionalOcrProvider(remoteProvider(), false);
    expect({
      id: provider.id,
      execution: provider.execution,
      enabled: provider.enabled,
    }).toEqual({
      id: "google-vision",
      execution: "remote",
      enabled: false,
    });
  });

  it("returns one safe error without invoking disabled provider work", async () => {
    const recognize = vi.fn();
    const provider = new OptionalOcrProvider(
      remoteProvider(recognize),
      false
    );
    await expect(provider.recognize(input, new AbortController().signal))
      .rejects.toThrow("ocr-provider-disabled");
    expect(recognize).not.toHaveBeenCalled();
  });

  it("performs no authentication, base64 request construction, or fetch while disabled", async () => {
    const getAccessToken = vi.fn();
    const fetchImpl = vi.fn();
    const google = new GoogleVisionOcrProvider(
      { getAccessToken },
      fetchImpl
    );
    const provider = new OptionalOcrProvider(google, false);
    await expect(provider.recognize(input, new AbortController().signal))
      .rejects.toThrow("ocr-provider-disabled");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("delegates exactly once when explicitly enabled", async () => {
    const recognize = vi.fn(async () => ({ regions: [] }));
    const provider = new OptionalOcrProvider(
      remoteProvider(recognize),
      true
    );
    await provider.recognize(input, new AbortController().signal);
    expect(recognize).toHaveBeenCalledOnce();
  });
});
