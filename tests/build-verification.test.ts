import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("WXT Build Output Verification", () => {
  const outputDir = path.resolve(__dirname, "../.output/chrome-mv3");

  it("verifies the build artifacts and structure exists", () => {
    // Only run if the build output exists (e.g. after pnpm build)
    if (!fs.existsSync(outputDir)) {
      console.warn("Build output directory does not exist. Skipping verification tests. Run pnpm build first.");
      return;
    }

    const files = [
      "manifest.json",
      "offscreen.html",
      "background.js",
      "tesseract/tesseract.esm.min.js",
      "tesseract/worker.min.js",
      "tesseract/tesseract-core.wasm",
      "tesseract/tesseract-core.wasm.js",
      "tesseract/tesseract-core-simd.wasm",
      "tesseract/tesseract-core-simd.wasm.js",
      "tesseract/tesseract-core-lstm.wasm",
      "tesseract/tesseract-core-lstm.wasm.js",
      "tesseract/tesseract-core-simd-lstm.wasm",
      "tesseract/tesseract-core-simd-lstm.wasm.js",
      "tesseract/lang/eng.traineddata",
      "tesseract/lang/jpn.traineddata",
      "tesseract/lang/jpn_vert.traineddata",
      "tesseract/lang/kor.traineddata",
      "tesseract/lang/chi_sim.traineddata",
    ];

    for (const f of files) {
      const fullPath = path.join(outputDir, f);
      expect(fs.existsSync(fullPath)).toBe(true);
    }
  });

  it("verifies manifest.json parameters strictly", () => {
    const manifestPath = path.join(outputDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) return;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    // 1. Permissions must contain 'offscreen'
    expect(manifest.permissions).toContain("offscreen");

    // 2. Strict WASM-unsafe CSP
    expect(manifest.content_security_policy).toBeDefined();
    expect(manifest.content_security_policy.extension_pages).toBe(
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
    );

    // 3. No unexpected web accessible resources (must not leak files)
    expect(manifest.web_accessible_resources).toBeUndefined();

    // 4. No Google domain permissions
    if (manifest.host_permissions) {
      for (const host of manifest.host_permissions) {
        expect(host).not.toContain("google.com");
      }
    }
  });

});

