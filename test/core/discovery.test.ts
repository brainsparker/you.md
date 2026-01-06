import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve, join } from "node:path";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { discoverProfilePath, getDefaultSearchPaths } from "../../src/core/discovery";

const testDir = resolve(__dirname, "../.test-discovery");

describe("discoverProfilePath", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.YOU_MD_PATH;
  });

  it("returns explicit path if provided and exists", async () => {
    const testFile = join(testDir, ".you.md");
    writeFileSync(testFile, "---\nschema_version: '1.0'\n---\n");

    const result = await discoverProfilePath({ path: testFile });

    expect(result).toBe(testFile);
  });

  it("returns null if explicit path doesn't exist", async () => {
    const result = await discoverProfilePath({
      path: "/non/existent/path.md",
    });

    expect(result).toBeNull();
  });

  it("checks environment variable", async () => {
    const testFile = join(testDir, ".you.md");
    writeFileSync(testFile, "---\nschema_version: '1.0'\n---\n");

    process.env.YOU_MD_PATH = testFile;

    const result = await discoverProfilePath();

    expect(result).toBe(testFile);
  });

  it("checks project-local .you.md", async () => {
    const testFile = join(testDir, ".you.md");
    writeFileSync(testFile, "---\nschema_version: '1.0'\n---\n");

    const result = await discoverProfilePath({ cwd: testDir });

    expect(result).toBe(testFile);
  });

  it("returns null when skipDiscovery is true", async () => {
    const testFile = join(testDir, ".you.md");
    writeFileSync(testFile, "---\nschema_version: '1.0'\n---\n");

    const result = await discoverProfilePath({
      cwd: testDir,
      skipDiscovery: true,
    });

    expect(result).toBeNull();
  });

  it("supports custom env var name", async () => {
    const testFile = join(testDir, ".you.md");
    writeFileSync(testFile, "---\nschema_version: '1.0'\n---\n");

    process.env.CUSTOM_MD_PATH = testFile;

    const result = await discoverProfilePath({ envVar: "CUSTOM_MD_PATH" });

    expect(result).toBe(testFile);

    delete process.env.CUSTOM_MD_PATH;
  });

  it("checks custom search paths", async () => {
    const testFile = join(testDir, "custom.md");
    writeFileSync(testFile, "---\nschema_version: '1.0'\n---\n");

    const result = await discoverProfilePath({
      searchPaths: [testFile],
    });

    expect(result).toBe(testFile);
  });

  it("returns remote URL if enabled", async () => {
    const remoteUrl = "https://example.com/you.md";

    const result = await discoverProfilePath({
      enableRemote: true,
      remoteUrl,
      skipDiscovery: false,
    });

    expect(result).toBe(remoteUrl);
  });
});

describe("getDefaultSearchPaths", () => {
  it("returns array of paths", () => {
    const paths = getDefaultSearchPaths();

    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
  });

  it("includes .you.md variants", () => {
    const paths = getDefaultSearchPaths();

    expect(paths.some((p) => p.endsWith(".you.md"))).toBe(true);
  });

  it("uses provided cwd", () => {
    const paths = getDefaultSearchPaths("/custom/path");

    expect(paths.some((p) => p.startsWith("/custom/path"))).toBe(true);
  });
});
