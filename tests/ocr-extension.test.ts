import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { translationPipelineErrorMessage } from "@/lib/translation/translation-pipeline-status";

describe("OCR extension UX and privacy boundary", () => {
  it("maps every OCR error to the required friendly status", () => {
    expect(translationPipelineErrorMessage("ocr-not-configured"))
      .toBe("Google Vision OCR is not configured");
    expect(translationPipelineErrorMessage("ocr-auth-failed"))
      .toBe("Google Vision authentication failed");
    expect(translationPipelineErrorMessage("ocr-unavailable"))
      .toBe("OCR service is unavailable");
    expect(translationPipelineErrorMessage("ocr-rate-limited"))
      .toBe("OCR rate limit reached. Try again later");
    expect(translationPipelineErrorMessage("ocr-timeout"))
      .toBe("OCR timed out");
    expect(translationPipelineErrorMessage("ocr-response-too-large"))
      .toBe("OCR response was too large");
    expect(translationPipelineErrorMessage("ocr-invalid-response"))
      .toBe("OCR returned an invalid result");
    expect(translationPipelineErrorMessage("ocr-no-text"))
      .toBe("No readable text was detected");
  });

  it("uses OCR-specific button, progress, and non-translation success copy", () => {
    const popup = fs.readFileSync(
      path.resolve(__dirname, "../entrypoints/popup/App.tsx"),
      "utf8"
    );
    expect(popup).toContain("OCR via Dev API");
    expect(popup).toContain("Processing OCR");
    expect(popup).toContain("Applying OCR Preview");
    expect(popup).toContain("Translation not enabled");
  });

  it("keeps Google requests out of extension code and messages", () => {
    const extension = [
      "../entrypoints/background.ts",
      "../lib/messages.ts",
      "../types/translation-pipeline.ts",
    ].map((file) => fs.readFileSync(path.resolve(__dirname, file), "utf8"))
      .join("\n");
    expect(extension).not.toContain("vision.googleapis.com");
    expect(extension).not.toContain("Authorization");
    expect(extension).not.toContain("access-token");
    expect(extension).not.toContain("GoogleAuth");
  });

  it("keeps local deterministic mode free from network access", () => {
    const localService = fs.readFileSync(path.resolve(
      __dirname,
      "../lib/translation/local-deterministic-translation-service.ts"
    ), "utf8");
    expect(localService).not.toMatch(/\bfetch\s*\(/);
    expect(localService).not.toMatch(/vision\.googleapis\.com/);
  });
});
