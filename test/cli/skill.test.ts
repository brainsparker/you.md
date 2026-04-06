import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { readJsonConfig, writeJsonConfig } from "../../src/cli/commands/skill";

const tempDir = join(tmpdir(), `you-md-skill-test-${Date.now()}`);

describe("readJsonConfig", () => {
  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns {} for non-existent files", async () => {
    const result = await readJsonConfig(join(tempDir, "does-not-exist.json"));
    expect(result).toEqual({});
  });

  it("throws on corrupt JSON (not silently returns {})", async () => {
    const filePath = join(tempDir, "corrupt.json");
    writeFileSync(filePath, "{ this is not valid json !!!", "utf-8");

    await expect(readJsonConfig(filePath)).rejects.toThrow(SyntaxError);
  });

  it("parses valid JSON correctly", async () => {
    const filePath = join(tempDir, "valid.json");
    const data = { mcpServers: { "some-tool": { command: "npx" } } };
    writeFileSync(filePath, JSON.stringify(data), "utf-8");

    const result = await readJsonConfig(filePath);
    expect(result).toEqual(data);
  });
});

describe("writeJsonConfig", () => {
  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a .backup file before overwriting an existing file", async () => {
    const filePath = join(tempDir, "config.json");
    const original = { existing: "data" };
    writeFileSync(filePath, JSON.stringify(original), "utf-8");

    const updated = { existing: "data", newKey: "newValue" };
    await writeJsonConfig(filePath, updated);

    // Backup should contain the original content
    const backupPath = filePath + ".backup";
    expect(existsSync(backupPath)).toBe(true);
    const backupContent = readFileSync(backupPath, "utf-8");
    expect(JSON.parse(backupContent)).toEqual(original);

    // Written file should contain the updated content
    const writtenContent = readFileSync(filePath, "utf-8");
    expect(JSON.parse(writtenContent)).toEqual(updated);
  });

  it("writes data correctly to a new file (no backup needed)", async () => {
    const filePath = join(tempDir, "subdir", "new-config.json");
    const data = { mcpServers: { "you-md": { command: "npx" } } };

    await writeJsonConfig(filePath, data);

    const content = readFileSync(filePath, "utf-8");
    expect(JSON.parse(content)).toEqual(data);
    // Should end with newline
    expect(content.endsWith("\n")).toBe(true);
    // No backup should exist for a new file
    expect(existsSync(filePath + ".backup")).toBe(false);
  });

  it("writes pretty-printed JSON with 2-space indent", async () => {
    const filePath = join(tempDir, "pretty.json");
    const data = { key: "value" };

    await writeJsonConfig(filePath, data);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe(JSON.stringify(data, null, 2) + "\n");
  });
});
