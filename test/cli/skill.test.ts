import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  readJsonConfig,
  writeJsonConfig,
  skillCommand,
  hasCodexEntry,
  upsertCodexEntry,
  removeCodexEntry,
  CODEX_TABLE,
} from "../../src/cli/commands/skill";

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

  it("throws when JSON root is not an object", async () => {
    const filePath = join(tempDir, "scalar.json");
    writeFileSync(filePath, JSON.stringify("not-an-object"), "utf-8");

    await expect(readJsonConfig(filePath)).rejects.toThrow(SyntaxError);
  });

  it("throws when JSON root is an array", async () => {
    const filePath = join(tempDir, "array.json");
    writeFileSync(filePath, JSON.stringify([{ mcpServers: {} }]), "utf-8");

    await expect(readJsonConfig(filePath)).rejects.toThrow(SyntaxError);
  });

  it("parses valid JSON correctly", async () => {
    const filePath = join(tempDir, "valid.json");
    const data = { mcpServers: { "some-tool": { command: "npx" } } };
    writeFileSync(filePath, JSON.stringify(data), "utf-8");

    const result = await readJsonConfig(filePath);
    expect(result).toEqual(data);
  });

  it("returns {} for empty files", async () => {
    const filePath = join(tempDir, "empty.json");
    writeFileSync(filePath, "   \n\t  ", "utf-8");

    const result = await readJsonConfig(filePath);
    expect(result).toEqual({});
  });

  it("parses valid JSON with a UTF-8 BOM", async () => {
    const filePath = join(tempDir, "bom.json");
    const data = { mcpServers: { "you-md": { command: "npx" } } };
    writeFileSync(filePath, "\uFEFF" + JSON.stringify(data), "utf-8");

    const result = await readJsonConfig(filePath);
    expect(result).toEqual(data);
  });
});

describe("skill uninstall target validation", () => {
  it("returns non-zero for unknown uninstall target", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await skillCommand(["uninstall", "unknown-tool"], {});

    expect(code).toBe(1);
    expect(errorSpy.mock.calls.map(c => String(c[0] ?? "")).join("\n")).toContain("Unknown tool: unknown-tool");

    errorSpy.mockRestore();
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

describe("MCP entry package spec", () => {
  it("references the published scoped package, not the unscoped name", async () => {
    const source = readFileSync(
      new URL("../../src/cli/commands/skill.ts", import.meta.url),
      "utf-8"
    );
    // The unscoped you-md package does not exist on npm (name blocked as
    // too similar to the unrelated youmd package). The injected MCP entry
    // must point npx at the published scoped package.
    expect(source).toContain('"-p", "@brainsparker/you-md"');
    expect(source).not.toMatch(/"-p",\s*"you-md"/);
  });
});

describe("Codex CLI TOML entry", () => {
  const other = [
    "# my codex config",
    'model = "gpt-5"',
    "",
    "[mcp_servers.context7]",
    'command = "npx"',
    'args = ["-y", "@upstash/context7-mcp"]',
    "",
    "[projects.\"/home/me/app\"]",
    'trust_level = "trusted"',
    "",
  ].join("\n");

  it("detects an absent table", () => {
    expect(hasCodexEntry("")).toBe(false);
    expect(hasCodexEntry(other)).toBe(false);
  });

  it("appends the table to an existing config without touching other content", () => {
    const next = upsertCodexEntry(other);
    expect(next.startsWith(other.trimEnd())).toBe(true);
    expect(next).toContain("[mcp_servers.you-md]");
    expect(next).toContain('args = ["-y", "-p", "@brainsparker/you-md", "you-md-mcp"]');
    expect(next).toContain("startup_timeout_sec = 30");
    expect(next.endsWith("\n")).toBe(true);
    expect(hasCodexEntry(next)).toBe(true);
  });

  it("writes a whole file when the config is empty", () => {
    const next = upsertCodexEntry("");
    expect(next).toBe(CODEX_TABLE + "\n");
  });

  it("replaces an existing table in place, including sub-tables, and keeps what follows", () => {
    const stale = [
      "[mcp_servers.you-md]",
      'command = "node"',
      'args = ["/old/path/you-md-mcp.js"]',
      "",
      "[mcp_servers.you-md.env]",
      'DEBUG = "1"',
      "",
      "[mcp_servers.after]",
      'url = "https://example.com/mcp"',
      "",
    ].join("\n");
    const next = upsertCodexEntry(other + "\n" + stale);
    expect(next.match(/\[mcp_servers\.you-md\]/g)).toHaveLength(1);
    expect(next).not.toContain("/old/path");
    expect(next).not.toContain('DEBUG = "1"');
    expect(next).toContain("[mcp_servers.context7]");
    expect(next).toContain("[mcp_servers.after]");
    expect(next).toContain('url = "https://example.com/mcp"');
    expect(next).toContain("startup_timeout_sec = 30");
  });

  it("recognises quoted table keys", () => {
    expect(hasCodexEntry('[mcp_servers."you-md"]\ncommand = "npx"\n')).toBe(true);
  });

  it("is idempotent", () => {
    const once = upsertCodexEntry(other);
    expect(upsertCodexEntry(once)).toBe(once);
  });

  it("removes only our table", () => {
    const withUs = upsertCodexEntry(other);
    const removed = removeCodexEntry(withUs);
    expect(removed).toBe(other);
    expect(removeCodexEntry(other)).toBe(other);
    expect(removeCodexEntry(upsertCodexEntry(""))).toBe("");
  });
});

describe("skill install into Codex CLI and Gemini CLI", () => {
  const originalEnv = { ...process.env };
  const fakeHome = join(tmpdir(), `you-md-skill-install-${Date.now()}`);

  beforeEach(() => {
    vi.resetModules();
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;
    delete process.env.CODEX_HOME;
    delete process.env.GEMINI_CLI_HOME;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(fakeHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("writes a [mcp_servers.you-md] table into ~/.codex/config.toml and removes it on uninstall", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const codexDir = join(fakeHome, ".codex");
    mkdirSync(codexDir, { recursive: true });
    const configPath = join(codexDir, "config.toml");
    writeFileSync(configPath, 'model = "gpt-5"\n', "utf-8");

    const { skillCommand: cmd } = await import("../../src/cli/commands/skill");
    expect(await cmd(["install", "codex"], {})).toBe(0);

    const written = readFileSync(configPath, "utf-8");
    expect(written.startsWith('model = "gpt-5"\n')).toBe(true);
    expect(written).toContain("[mcp_servers.you-md]");
    expect(existsSync(configPath + ".backup")).toBe(true);

    // Second install is a no-op
    expect(await cmd(["install", "codex"], {})).toBe(0);
    expect(readFileSync(configPath, "utf-8")).toBe(written);

    expect(await cmd(["uninstall", "codex"], {})).toBe(0);
    expect(readFileSync(configPath, "utf-8")).toBe('model = "gpt-5"\n');
  });

  it("honours CODEX_HOME", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const codexHome = join(fakeHome, "elsewhere", "codex");
    process.env.CODEX_HOME = codexHome;

    const { skillCommand: cmd } = await import("../../src/cli/commands/skill");
    expect(await cmd(["install", "codex"], {})).toBe(0);

    expect(existsSync(join(codexHome, "config.toml"))).toBe(true);
    expect(existsSync(join(fakeHome, ".codex", "config.toml"))).toBe(false);
  });

  it("adds a mcpServers entry to ~/.gemini/settings.json and preserves other settings", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const geminiDir = join(fakeHome, ".gemini");
    mkdirSync(geminiDir, { recursive: true });
    const settingsPath = join(geminiDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({ theme: "Default", mcpServers: { context7: { command: "npx" } } }),
      "utf-8"
    );

    const { skillCommand: cmd } = await import("../../src/cli/commands/skill");
    expect(await cmd(["install", "gemini"], {})).toBe(0);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.theme).toBe("Default");
    expect(settings.mcpServers.context7).toEqual({ command: "npx" });
    expect(settings.mcpServers["you-md"]).toEqual({
      command: "npx",
      args: ["-y", "-p", "@brainsparker/you-md", "you-md-mcp"],
    });
  });

  it("honours GEMINI_CLI_HOME", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const geminiHome = join(fakeHome, "gemini-home");
    process.env.GEMINI_CLI_HOME = geminiHome;

    const { skillCommand: cmd } = await import("../../src/cli/commands/skill");
    expect(await cmd(["install", "gemini"], {})).toBe(0);

    expect(existsSync(join(geminiHome, ".gemini", "settings.json"))).toBe(true);
  });

  it("reports Codex and Gemini in status once installed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mkdirSync(join(fakeHome, ".codex"), { recursive: true });
    mkdirSync(join(fakeHome, ".gemini"), { recursive: true });

    const { skillCommand: cmd } = await import("../../src/cli/commands/skill");
    await cmd(["install", "codex"], {});
    await cmd(["install", "gemini"], {});
    logSpy.mockClear();
    expect(await cmd(["status"], {})).toBe(0);

    const output = logSpy.mock.calls.map(c => String(c[0] ?? "")).join("\n");
    expect(output).toMatch(/✓\s+Codex CLI\s+skill active/);
    expect(output).toMatch(/✓\s+Gemini CLI\s+skill active/);
  });
});
