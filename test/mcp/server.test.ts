import { describe, it, expect } from "vitest";
import { isPathSafe, createMcpServer } from "../../src/mcp/server.js";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";

describe("MCP path validation", () => {
  it("allows paths under home directory", () => {
    expect(isPathSafe(resolve(homedir(), ".you.md"))).toBe(true);
    expect(isPathSafe(resolve(homedir(), "projects", ".you.md"))).toBe(true);
  });

  it("allows paths equal to home directory", () => {
    expect(isPathSafe(homedir())).toBe(true);
  });

  it("allows paths under cwd", () => {
    expect(isPathSafe(resolve(process.cwd(), ".you.md"))).toBe(true);
  });

  it("allows paths equal to cwd", () => {
    expect(isPathSafe(process.cwd())).toBe(true);
  });

  it("rejects paths outside home and cwd", () => {
    expect(isPathSafe("/etc/passwd")).toBe(false);
    expect(isPathSafe("/tmp/evil.md")).toBe(false);
  });

  it("rejects directory traversal", () => {
    expect(isPathSafe(resolve(homedir(), "..", "etc", "passwd"))).toBe(false);
  });

  it("rejects symlink escapes outside safe roots", () => {
    const base = mkdtempSync(join(tmpdir(), "youmd-pathsafe-"));
    try {
      const outside = join(base, "outside");
      mkdirSync(outside);

      const linkPath = join(process.cwd(), "symlink-outside-test");
      rmSync(linkPath, { force: true, recursive: true });
      symlinkSync(outside, linkPath);

      expect(isPathSafe(join(linkPath, "you.md"))).toBe(false);
    } finally {
      rmSync(join(process.cwd(), "symlink-outside-test"), {
        force: true,
        recursive: true,
      });
      rmSync(base, { force: true, recursive: true });
    }
  });
});

describe("MCP server", () => {
  it("creates server without throwing", async () => {
    const server = await createMcpServer();
    expect(server).toBeDefined();
  });
});
