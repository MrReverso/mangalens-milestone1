import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { translationPipelineErrorMessage } from "@/lib/translation/translation-pipeline-status";

describe("OCR extension UX and privacy boundary", () => {
  it("maps every OCR error to the required friendly status", () => {
    expect(translationPipelineErrorMessage("ocr-provider-disabled"))
      .toBe("The selected OCR provider is disabled");
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

  it("keeps local OCR explicit inside the advanced reader controls", () => {
    const popup = fs.readFileSync(
      path.resolve(__dirname, "../entrypoints/popup/App.tsx"),
      "utf8"
    );
    expect(popup).toContain("Local AI processing");
    expect(popup).toContain("Translate visible page locally");
    expect(popup).toContain("requires Docker, Ollama, and a capable computer");
    expect(popup).toContain("Running Local OCR + Translation");
    expect(popup).toContain("Applying Text Overlays");
    expect(popup).toContain("Translation not enabled");
    expect(popup).toContain("Local translation preview applied");
    expect(popup).toContain("Local translation applied");
    expect(popup).toContain('rawResponse.resultKind === "ocr-preview"');
  });

  it("describes loopback transport failures as local OCR failures", () => {
    expect(translationPipelineErrorMessage("backend-unavailable"))
      .toBe("Local OCR backend is not running");
    expect(translationPipelineErrorMessage("backend-timeout"))
      .toBe("Local OCR processing timed out");
    expect(translationPipelineErrorMessage("backend-invalid-response"))
      .toBe("Local OCR backend returned an invalid result");
    expect(translationPipelineErrorMessage("backend-request-failed"))
      .toBe("Local OCR request failed");
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
