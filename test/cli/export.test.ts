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
  renderPortable,
  renderPersonal,
  targetNotes,
  renderPrefsForTarget,
  withheldNote,
  exportCommand,
  type ExportTarget,
} from "../../src/cli/commands/export";
import { createParser } from "../../src/parser";

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

  it("writes openclaw context into the workspace USER.md with a personal title", async () => {
    const { path } = await exportToTarget(target("openclaw"), prefs, { home, cwd });
    expect(path).toBe(join(home, ".openclaw", "workspace", "USER.md"));
    const content = readFileSync(path, "utf-8");
    expect(content).toContain(BEGIN_MARKER);
    expect(content).toContain("# About me (from you.md)");
    expect(content).not.toContain("User Preferences (from you.md)");
    expect(content).toContain("Short sentences.");
  });

  it("appends to an existing Hermes SOUL.md without clobbering the persona", async () => {
    const path = join(home, ".hermes", "SOUL.md");
    mkdirSync(join(home, ".hermes"), { recursive: true });
    writeFileSync(path, "You are Hermes. Be direct.\n", "utf-8");

    await exportToTarget(target("hermes"), prefs, { home, cwd });

    const content = readFileSync(path, "utf-8");
    expect(content.startsWith("You are Hermes. Be direct.")).toBe(true);
    expect(content).toContain("# About the person you work for (from you.md)");
    expect(content).toContain("Short sentences.");
  });

  it.each(["muse", "instinct", "dots", "grok"])(
    "writes a portable copy for cloud agent %s",
    async id => {
      const t = target(id);
      const { path } = await exportToTarget(t, prefs, { home, cwd });
      expect(path.startsWith(join(home, ".you-md", "portable"))).toBe(true);
      expect(t.handoff).toBeTruthy();

      const content = readFileSync(path, "utf-8");
      expect(content.startsWith("# About me (from you.md)")).toBe(true);
      expect(content).not.toContain("User Preferences (from you.md)");
      expect(content).toContain("## Style");
      expect(content).toContain("Short sentences.");
    }
  );
});

describe("agent usage notes", () => {
  const prefs = "# User Preferences (from you.md)\n\n## Style\n\nShort.";

  it("puts usage notes ahead of the profile in portable copies", () => {
    const out = renderPortable(prefs);
    expect(out).toContain("## How to use this");
    expect(out).toContain("This is private.");
    expect(out).toContain("replaces this one");
    expect(out.indexOf("## How to use this")).toBeLessThan(out.indexOf("## Style"));
  });

  it("appends an agent-specific note when given", () => {
    expect(renderPortable(prefs, "Re-read it daily.")).toContain("- Re-read it daily.");
    expect(target("grok").render(prefs)).toContain("/workspace/you.md before every task");
    expect(target("instinct").render(prefs)).toContain("save all of this to your memory");
  });

  it("gives local personal agents the privacy note but not the save note", () => {
    for (const id of ["openclaw", "hermes"]) {
      const out = target(id).render(prefs);
      expect(out).toContain("This is private.");
      expect(out).not.toContain("replaces this one");
    }
    expect(renderPersonal(prefs, "About me").startsWith("# About me\n")).toBe(true);
  });

  it("doesn't add usage notes to coding tools", () => {
    expect(target("claude").render(prefs)).not.toContain("How to use this");
  });

  it("avoids override phrasing that injection scanners flag", () => {
    for (const id of ["muse", "instinct", "dots", "grok", "openclaw", "hermes"]) {
      expect(target(id).render(prefs)).not.toMatch(/ignore (all |any )?(previous|prior)|system prompt/i);
    }
  });
});

describe("renderPortable", () => {
  it("is stable, so sync sees an unchanged profile as in sync", () => {
    const prefs = "# User Preferences (from you.md)\n\n## Style\n\nShort.";
    expect(renderPortable(prefs)).toBe(renderPortable(prefs));
    expect(renderPortable(prefs).endsWith("Short.\n")).toBe(true);
  });
});

describe("targetNotes", () => {
  it("includes the handoff for cloud agents and nothing for local tools", () => {
    expect(targetNotes(target("muse"), 10)[0]).toMatch(/^→ /);
    expect(targetNotes(target("claude"), 10)).toEqual([]);
  });

  it("warns when content exceeds a tool's character limit", () => {
    const notes = targetNotes(target("openclaw"), 25_000);
    expect(notes.some(n => n.includes("truncates"))).toBe(true);
    expect(targetNotes(target("openclaw"), 5_000)).toEqual([]);
  });
});

describe("EXPORT_TARGETS", () => {
  it("covers the expected tools", () => {
    const ids = EXPORT_TARGETS.map(t => t.id).sort();
    expect(ids).toEqual([
      "agents",
      "claude",
      "codex",
      "cursor",
      "dots",
      "gemini",
      "grok",
      "hermes",
      "instinct",
      "muse",
      "openclaw",
      "windsurf",
    ]);
  });

  it("has unique ids and paths", () => {
    const ids = new Set(EXPORT_TARGETS.map(t => t.id));
    expect(ids.size).toBe(EXPORT_TARGETS.length);

    const paths = new Set(EXPORT_TARGETS.map(t => `${t.scope}:${t.relPath.join("/")}`));
    expect(paths.size).toBe(EXPORT_TARGETS.length);
  });
});

describe("audience scoping in export", () => {
  const PROFILE = [
    "---",
    'schema_version: "1.1"',
    "---",
    "",
    "# Me",
    "",
    "## What I Do",
    "",
    "Product manager.",
    "",
    "## Health",
    "<!-- you-md: private -->",
    "",
    "Nut allergy.",
    "",
    "## How I Work",
    "<!-- you-md: for coding -->",
    "",
    "Prefer TypeScript.",
    "",
  ].join("\n");

  function profile() {
    const result = createParser().parse(PROFILE);
    expect(result.success).toBe(true);
    return result.profile;
  }

  it("renders each target from the sections it may see", () => {
    const claude = renderPrefsForTarget(profile(), "claude");
    expect(claude.prefs).toContain("Nut allergy");
    expect(claude.prefs).toContain("Prefer TypeScript");
    expect(claude.withheld).toEqual([]);

    const hermes = renderPrefsForTarget(profile(), "hermes");
    expect(hermes.prefs).toContain("Nut allergy");
    expect(hermes.prefs).not.toContain("Prefer TypeScript");
    expect(hermes.withheld).toEqual([{ title: "How I Work", rule: "for coding" }]);

    const muse = renderPrefsForTarget(profile(), "muse");
    expect(muse.prefs).toContain("Product manager");
    expect(muse.prefs).not.toContain("Nut allergy");
    expect(muse.prefs).not.toContain("Prefer TypeScript");
    expect(muse.withheld.map(w => w.title)).toEqual(["Health", "How I Work"]);
  });

  it("never writes a directive line into any target file", async () => {
    for (const t of EXPORT_TARGETS) {
      const { prefs } = renderPrefsForTarget(profile(), t.id);
      const { path } = await exportToTarget(t, prefs, { home, cwd });
      const written = readFileSync(path, "utf-8");
      expect(written, `directive leaked into ${t.id}`).not.toMatch(/<!--\s*you-md:\s*(private|for|not)\b/);
    }
  });

  it("keeps private content out of every portable copy and inside every local file", async () => {
    for (const t of EXPORT_TARGETS) {
      const { prefs } = renderPrefsForTarget(profile(), t.id);
      const { path } = await exportToTarget(t, prefs, { home, cwd });
      const written = readFileSync(path, "utf-8");
      if (t.handoff) {
        expect(written, `${t.id} is a cloud agent and must not get private sections`).not.toContain("Nut allergy");
      } else {
        expect(written, `${t.id} is local and should keep private sections`).toContain("Nut allergy");
      }
    }
  });

  it("formats the withheld note for CLI output", () => {
    expect(withheldNote([])).toBeNull();
    expect(
      withheldNote([
        { title: "Health", rule: "private" },
        { title: "How I Work", rule: "for coding" },
      ])
    ).toBe("withheld: Health (private), How I Work (for coding)");
  });

  it("mentions scoping in the export help text", async () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      expect(await exportCommand([], {})).toBe(0);
    } finally {
      console.log = original;
    }
    expect(logs.join("\n")).toContain("you-md: private");
  });
});
