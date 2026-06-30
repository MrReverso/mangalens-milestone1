import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Extension Permissions", () => {
  it("enforces minimal required MV3 permissions and loopback host permission", () => {
    const configPath = path.resolve(__dirname, "../wxt.config.ts");
    const content = fs.readFileSync(configPath, "utf8");

    const permissionsMatch = content.match(/permissions:\s*\[([^\]]+)\]/);
    const hostPermissionsMatch = content.match(/host_permissions:\s*\[([^\]]+)\]/);

    expect(permissionsMatch).not.toBeNull();
    const permissions = permissionsMatch![1]
      .split(",")
      .map((p) => p.replace(/['"\s]/g, ""))
      .filter(Boolean);

    expect(permissions).toEqual(["storage", "activeTab", "scripting", "offscreen"]);

    expect(hostPermissionsMatch).not.toBeNull();
    const hostPermissions = hostPermissionsMatch![1]
      .split(",")
      .map((p) => p.replace(/['"\s]/g, ""))
      .filter(Boolean);

    expect(hostPermissions).toEqual(["http://127.0.0.1:8787/*"]);
  });

  it("verifies package.json contains dev:backend script pointing to server.ts without remote binding", () => {
    const pkgPath = path.resolve(__dirname, "../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts["dev:backend"]).toBeDefined();
    expect(pkg.scripts["dev:backend"]).toContain("dev/backend/server.ts");
    
    const scriptCmd = pkg.scripts["dev:backend"];
    expect(scriptCmd).not.toMatch(/(https?:|\b[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b)/);
  });

  it("keeps the Google endpoint and auth dependency backend-only", () => {
    const root = path.resolve(__dirname, "..");
    const endpoint = "https://vision.googleapis.com/v1/images:annotate";
    const productionExtensionPaths = [
      "entrypoints",
      "lib",
      "types",
      "components",
    ];
    for (const relativePath of productionExtensionPaths) {
      const content = readTree(path.join(root, relativePath));
      expect(content).not.toContain(endpoint);
      expect(content).not.toContain("google-auth-library");
    }
    const backendContent = readTree(path.join(root, "dev/backend"));
    expect(backendContent.match(new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")))
      .toHaveLength(1);
    expect(backendContent).toContain("google-auth-library");
  });

  it("declares google-auth-library as development-only", () => {
    const pkg = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, "../package.json"),
      "utf8"
    ));
    expect(pkg.dependencies?.["google-auth-library"]).toBeUndefined();
    expect(pkg.devDependencies?.["google-auth-library"]).toBeDefined();
  });

  it("binds the OCR backend only to the IPv4 loopback address", () => {
    const server = fs.readFileSync(
      path.resolve(__dirname, "../dev/backend/server.ts"),
      "utf8"
    );
    expect(server).toContain('const HOST = "127.0.0.1"');
    expect(server).not.toContain('"0.0.0.0"');
    expect(server).not.toContain('HOST = "::"');
  });
});

function readTree(directory: string): string {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? readTree(fullPath) : fs.readFileSync(fullPath, "utf8");
    })
    .join("\n");
}
