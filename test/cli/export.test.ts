import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  BEGIN_MARKER,
  END_MARKER,
  buildManagedBlock,
  applyManagedBlock,
  resolveTargetPath,
  exportToTarget,
  EXPORT_TARGETS,
  type ExportTarget,
} from "../../src/cli/commands/export";

const tempDir = join(tmpdir(), `you-md-export-test-${Date.now()}`);
const home = join(tempDir, "home");
const cwd = join(tempDir, "project");

beforeEach(() => {
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function target(id: string): ExportTarget {
  const found = EXPORT_TARGETS.find(t => t.id === id);
  if (!found) throw new Error(`No such target: ${id}`);
  return found;
}

describe("buildManagedBlock", () => {
  it("wraps content in begin/end markers", () => {
    const block = buildManagedBlock("# Prefs\n\nBe concise.");
    expect(block.startsWith(BEGIN_MARKER)).toBe(true);
    expect(block.endsWith(END_MARKER)).toBe(true);
    expect(block).toContain("Be concise.");
  });

  it("trims trailing whitespace from content", () => {
    const block = buildManagedBlock("content\n\n\n");
    expect(block).toContain("content\n\n" + END_MARKER);
  });
});

describe("applyManagedBlock", () => {
  const block = buildManagedBlock("# Prefs\n\nversion two");

  it("uses the block as the whole file when there is no existing content", () => {
    expect(applyManagedBlock(null, block)).toBe(block + "\n");
    expect(applyManagedBlock("", block)).toBe(block + "\n");
    expect(applyManagedBlock("   \n\t", block)).toBe(block + "\n");
  });

  it("appends the block when the file has content but no markers", () => {
    const existing = "# My own notes\n\nDo not touch these.\n";
    const result = applyManagedBlock(existing, block);
    expect(result.startsWith("# My own notes")).toBe(true);
    expect(result).toContain("Do not touch these.");
    expect(result).toContain(BEGIN_MARKER);
    expect(result).toContain("version two");
  });

  it("replaces an existing managed block in place, preserving surrounding content", () => {
    const oldBlock = buildManagedBlock("# Prefs\n\nversion one");
    const existing = "# Above\n\n" + oldBlock + "\n\n# Below\n";
    const result = applyManagedBlock(existing, block);

    expect(result).toContain("# Above");
    expect(result).toContain("# Below");
    expect(result).toContain("version two");
    expect(result).not.toContain("version one");
    // Only one managed block should remain
    expect(result.split(BEGIN_MARKER).length).toBe(2);
    expect(result.split(END_MARKER).length).toBe(2);
  });

  it("is idempotent across repeated applies", () => {
    const once = applyManagedBlock("user content\n", block);
    const twice = applyManagedBlock(once, block);
    expect(twice).toBe(once);
  });
});

describe("resolveTargetPath", () => {
  it("resolves user-scope targets under the home dir", () => {
    const path = resolveTargetPath(target("claude"), { home, cwd });
    expect(path).toBe(join(home, ".claude", "CLAUDE.md"));
  });

  it("resolves project-scope targets under the cwd", () => {
    const path = resolveTargetPath(target("agents"), { home, cwd });
    expect(path).toBe(join(cwd, "AGENTS.md"));
  });
});

describe("exportToTarget", () => {
  const prefs = "# User Preferences (from you.md)\n\n## Style\n\nShort sentences.";

  it("creates a new file with the managed block", async () => {
    const { path, action } = await exportToTarget(target("claude"), prefs, { home, cwd });

    expect(action).toBe("created");
    expect(existsSync(path)).toBe(true);

    const content = readFileSync(path, "utf-8");
    expect(content).toContain(BEGIN_MARKER);
    expect(content).toContain("Short sentences.");
    expect(content).toContain(END_MARKER);
  });

  it("updates the managed block without clobbering user content", async () => {
    const path = join(home, ".claude", "CLAUDE.md");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(path, "# Hand-written memory\n\nKeep me.\n", "utf-8");

    const first = await exportToTarget(target("claude"), prefs, { home, cwd });
    expect(first.action).toBe("updated");

    const updatedPrefs = prefs + "\n\nNew preference line.";
    await exportToTarget(target("claude"), updatedPrefs, { home, cwd });

    const content = readFileSync(path, "utf-8");
    expect(content).toContain("Keep me.");
    expect(content).toContain("New preference line.");
    expect(content.split(BEGIN_MARKER).length).toBe(2);
  });

  it("backs up an existing file before modifying it", async () => {
    const path = join(home, ".claude", "CLAUDE.md");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(path, "original content\n", "utf-8");

    await exportToTarget(target("claude"), prefs, { home, cwd });

    expect(existsSync(path + ".backup")).toBe(true);
    expect(readFileSync(path + ".backup", "utf-8")).toBe("original content\n");
  });

  it("writes cursor exports as a whole owned .mdc file with frontmatter", async () => {
    const { path } = await exportToTarget(target("cursor"), prefs, { home, cwd });

    expect(path).toBe(join(cwd, ".cursor", "rules", "you-md.mdc"));
    const content = readFileSync(path, "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("alwaysApply: true");
    expect(content).toContain("Short sentences.");
  });

  it("overwrites the owned cursor file entirely on re-export", async () => {
    await exportToTarget(target("cursor"), "old prefs", { home, cwd });
    const { path } = await exportToTarget(target("cursor"), "new prefs", { home, cwd });

    const content = readFileSync(path, "utf-8");
    expect(content).toContain("new prefs");
    expect(content).not.toContain("old prefs");
  });

  it("respects an output path override", async () => {
    const override = join(tempDir, "custom", "out.md");
    const { path } = await exportToTarget(target("gemini"), prefs, { home, cwd }, override);

    expect(path).toBe(override);
    expect(readFileSync(path, "utf-8")).toContain("Short sentences.");
  });
});

describe("EXPORT_TARGETS", () => {
  it("covers the expected tools", () => {
    const ids = EXPORT_TARGETS.map(t => t.id).sort();
    expect(ids).toEqual(["agents", "claude", "codex", "cursor", "gemini", "windsurf"]);
  });

  it("has unique ids and paths", () => {
    const ids = new Set(EXPORT_TARGETS.map(t => t.id));
    expect(ids.size).toBe(EXPORT_TARGETS.length);

    const paths = new Set(EXPORT_TARGETS.map(t => `${t.scope}:${t.relPath.join("/")}`));
    expect(paths.size).toBe(EXPORT_TARGETS.length);
  });
});
