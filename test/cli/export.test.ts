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
  renderSkill,
  skillDescription,
  profileHeadings,
  targetNotes,
  SKILL_NAME,
  SKILL_DESCRIPTION_MAX,
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

describe("Agent Skills export", () => {
  const prefs = [
    "# User Preferences (from you.md)",
    "",
    "Author: Jane",
    "",
    "## How I Communicate",
    "",
    "Short sentences.",
    "",
    "## How I Work",
    "",
    "### Testing",
    "",
    "Behavior, not implementation.",
    "",
    "## Boundaries",
    "",
    "No secrets in examples.",
    "",
  ].join("\n");

  function frontmatter(out: string): Record<string, string> {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(out);
    if (!match) throw new Error("no frontmatter");
    const fields: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const kv = /^([a-z-]+): (.*)$/.exec(line);
      if (kv) fields[kv[1]] = kv[2];
    }
    return fields;
  }

  it("writes SKILL.md into a folder named after the skill, as the spec requires", async () => {
    for (const id of ["skill", "claude-skill"]) {
      const t = target(id);
      expect(t.kind).toBe("skill");
      expect(t.mode).toBe("own-file");
      const { path } = await exportToTarget(t, prefs, { home, cwd });
      expect(path.endsWith(join(SKILL_NAME, "SKILL.md"))).toBe(true);
      expect(frontmatter(readFileSync(path, "utf-8")).name).toBe(SKILL_NAME);
    }
    expect(target("skill").relPath.slice(0, 2)).toEqual([".agents", "skills"]);
    expect(target("claude-skill").relPath.slice(0, 2)).toEqual([".claude", "skills"]);
  });

  it("keeps the frontmatter to standard fields with a valid name and description", () => {
    const out = renderSkill(prefs);
    const fm = frontmatter(out);
    expect(Object.keys(fm).sort()).toEqual(["description", "name"]);
    expect(fm.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(fm.name.length).toBeLessThanOrEqual(64);
    expect(out).toContain("metadata:\n  managed-by: you-md\n---");

    const description = JSON.parse(fm.description) as string;
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(SKILL_DESCRIPTION_MAX);
    expect(description).toContain("How I Communicate");
    expect(description).toContain("Boundaries");
    expect(description).toMatch(/Use when/);
  });

  it("uses section and subsection titles as keywords, skipping file-title headings", () => {
    expect(profileHeadings(prefs)).toEqual(["How I Communicate", "How I Work", "Testing", "Boundaries"]);
    const nested = "# User Preferences (from you.md)\n\n## you.md\n\n### About Me\n\nx\n\n### About Me\n\ny\n";
    expect(profileHeadings(nested)).toEqual(["About Me"]);
  });

  it("never lets the description exceed the spec limit, however many sections", () => {
    const many = Array.from({ length: 60 }, (_, i) => `A fairly long section heading number ${i}`);
    const description = skillDescription(many);
    expect(description.length).toBeLessThanOrEqual(SKILL_DESCRIPTION_MAX);
    expect(description).toContain("number 0");
    expect(description).toMatch(/Use when/);
    expect(skillDescription([])).not.toContain("covers:");
  });

  it("escapes quotes in headings so the YAML stays valid", () => {
    const quoted = "# User Preferences (from you.md)\n\n## Don't \"quote\" me\n\nx\n";
    const fm = frontmatter(renderSkill(quoted));
    expect(JSON.parse(fm.description)).toContain("Don't \"quote\" me");
  });

  it("puts the managed note and usage notes ahead of the full profile", () => {
    const out = renderSkill(prefs);
    const body = out.slice(out.indexOf("\n---\n") + 5);
    expect(body.trimStart().startsWith("# About the person you are working for (from you.md)")).toBe(true);
    expect(body).toContain("Managed by you-md");
    expect(body).toContain("## How to use this");
    expect(body).toContain("This is private.");
    expect(body).toContain("project instruction files still govern the code");
    expect(body).not.toContain("replaces this one");
    expect(body.indexOf("## How to use this")).toBeLessThan(body.indexOf("## How I Communicate"));
    expect(body).toContain("Behavior, not implementation.");
    expect(body).toContain("Author: Jane");
  });

  it("is stable and injection-scanner friendly", () => {
    expect(renderSkill(prefs)).toBe(renderSkill(prefs));
    expect(renderSkill(prefs)).not.toMatch(/ignore (all |any )?(previous|prior)|system prompt/i);
  });

  it("prints the on-demand loading note and no handoff", () => {
    const notes = targetNotes(target("skill"), 500);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/on demand/);
    expect(target("skill").handoff).toBeUndefined();
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
      "claude-skill",
      "codex",
      "cursor",
      "dots",
      "gemini",
      "grok",
      "hermes",
      "instinct",
      "muse",
      "openclaw",
      "skill",
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
