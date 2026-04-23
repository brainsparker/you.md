import { describe, it, expect } from "vitest";
import { isPathSafe, createMcpServer } from "../../src/mcp/server.js";
import { homedir } from "node:os";
import { resolve } from "node:path";

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

  it("rejects invalid path input safely", () => {
    expect(isPathSafe("bad\u0000path")).toBe(false);
  });
});

describe("MCP server", () => {
  it("creates server without throwing", async () => {
    const server = await createMcpServer();
    expect(server).toBeDefined();
  });
});
