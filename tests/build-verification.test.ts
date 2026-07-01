import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function scanDirectory(dir: string, bannedDomains: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      scanDirectory(fullPath, bannedDomains);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      // Only scan text-like files (js, html, json, css)
      if ([".js", ".html", ".json", ".css"].includes(ext)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        for (const domain of bannedDomains) {
          if (content.includes(domain)) {
            throw new Error(`Production file references remote Tesseract CDN/resource: ${fullPath} contains ${domain}`);
          }
        }
      }
    }
  }
}

describe("WXT Build Output Verification", () => {
  const outputDir = path.resolve(__dirname, "../.output/chrome-mv3");

  it("verifies the build artifacts and structure exists", () => {
    // Ensure the build output directory exists. If not, this must fail.
    expect(fs.existsSync(outputDir)).toBe(true);

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

  it("parses offscreen.html and verifies its referenced compiled script exists and is configured locally", () => {
    const htmlPath = path.join(outputDir, "offscreen.html");
    expect(fs.existsSync(htmlPath)).toBe(true);

    const htmlContent = fs.readFileSync(htmlPath, "utf-8");
    const scriptSrcMatch = htmlContent.match(/<script[^>]+src=["']([^"']+)["']/);
    expect(scriptSrcMatch).not.toBeNull();

    const scriptSrc = scriptSrcMatch![1];
    // Resolve relative to output directory
    const scriptPath = path.resolve(outputDir, scriptSrc.startsWith("/") ? scriptSrc.slice(1) : scriptSrc);
    expect(fs.existsSync(scriptPath)).toBe(true);

    // Verify that this compiled offscreen script contains local asset configurations
    const scriptContent = fs.readFileSync(scriptPath, "utf-8");
    expect(scriptContent).toContain("workerPath");
    expect(scriptContent).toContain("corePath");
    expect(scriptContent).toContain("langPath");

    // Do not allow local development backend URL to appear in the local OCR worker/offscreen bundle
    expect(scriptContent).not.toContain("127.0.0.1:8787");
  });

  it("verifies manifest.json parameters strictly", () => {
    const manifestPath = path.join(outputDir, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

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

  it("recursively verifies that no production files contain remote Tesseract CDN or resource domains", () => {
    const bannedDomains = [
      "cdn.jsdelivr.net",
      "unpkg.com",
      "tessdata.projectnaptha.com",
      "raw.githubusercontent.com",
      "naptha.github.io"
    ];

    scanDirectory(outputDir, bannedDomains);
  });
});
