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

    expect(permissions).toEqual(["storage", "activeTab", "scripting"]);

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
});
