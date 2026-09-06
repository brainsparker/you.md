import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  IMPORT_SOURCES,
  IMPORT_SECTIONS,
  classifyHeading,
  classifyItem,
  normalizeKey,
  stripManagedBlocks,
  extractItems,
  parseSourceFile,
  collectItems,
  discoverImportFiles,
  renderProfile,
  mergeIntoProfile,
  existingProfileKeys,
  displayPath,
  importCommand,
} from "../../src/cli/commands/import";
import { convertCommand } from "../../src/cli/commands/convert";
import { buildManagedBlock, exportToTarget, EXPORT_TARGETS } from "../../src/cli/commands/export";
import { createParser } from "../../src/parser/index";
import { validateProfile } from "../../src/core/validator";
import { CURRENT_SCHEMA_VERSION } from "../../src/utils/constants";

const tempDir = join(tmpdir(), `you-md-import-test-${Date.now()}`);
const home = join(tempDir, "home");
const cwd = join(tempDir, "project");
const paths = { home, cwd };

function write(path: string, content: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf-8");
  return path;
}

beforeEach(() => {
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const CLAUDE_MD = `# My Claude setup

## Communication
- Be concise
- Skip the preamble

## Coding conventions
- Prefer TypeScript strict mode
- Never use \`any\`

## Don't
- Add dependencies without asking
`;

describe("IMPORT_SOURCES", () => {
  it("has unique ids and user-level sources for the personal tools", () => {
    const ids = IMPORT_SOURCES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const userIds = IMPORT_SOURCES.filter(s => s.scope === "user").map(s => s.id);
    for (const id of ["claude", "codex", "gemini", "copilot", "junie", "zed", "opencode", "kiro"]) {
      expect(userIds).toContain(id);
    }
  });

  it("reads back every user-level path that export writes", () => {
    for (const target of EXPORT_TARGETS.filter(t => t.scope === "user")) {
      const match = IMPORT_SOURCES.find(
        s => s.scope === "user" && s.relPath.join("/") === target.relPath.join("/")
      );
      expect(match, `no import source for export target ${target.id}`).toBeDefined();
    }
  });
});

describe("classifyHeading", () => {
  it("maps common instruction-file headings to you.md sections", () => {
    expect(classifyHeading("Communication style")).toBe("How I Communicate");
    expect(classifyHeading("Response format")).toBe("How I Communicate");
    expect(classifyHeading("Don't")).toBe("Boundaries");
    expect(classifyHeading("Things to avoid")).toBe("Boundaries");
    expect(classifyHeading("Trusted sources")).toBe("What I Trust");
    expect(classifyHeading("About me")).toBe("What I Do");
    expect(classifyHeading("Environment")).toBe("Context");
    expect(classifyHeading("Coding conventions")).toBe("How I Work");
    expect(classifyHeading("Rules")).toBe("How I Work");
    expect(classifyHeading(null)).toBe("How I Work");
  });

  it("checks boundaries before broader categories", () => {
    expect(classifyHeading("Communication: never do this")).toBe("Boundaries");
  });
});

describe("classifyItem", () => {
  it("moves prohibitions from generic sections into Boundaries", () => {
    expect(classifyItem("- Never commit secrets", "How I Work")).toBe("Boundaries");
    expect(classifyItem("- Don't add comments everywhere", "How I Work")).toBe("Boundaries");
    expect(classifyItem("1. Do not use var", "How I Work")).toBe("Boundaries");
    expect(classifyItem("- Prefer small functions", "How I Work")).toBe("How I Work");
  });

  it("respects an explicit heading choice", () => {
    expect(classifyItem("- Never hedge", "How I Communicate")).toBe("How I Communicate");
  });
});

describe("normalizeKey", () => {
  it("ignores markers, emphasis, case, and trailing punctuation", () => {
    expect(normalizeKey("- **Be concise.**")).toBe("be concise");
    expect(normalizeKey("* be   Concise")).toBe("be concise");
    expect(normalizeKey("1. Be concise;")).toBe("be concise");
  });
});

describe("stripManagedBlocks", () => {
  it("removes every managed block and keeps the rest", () => {
    const block = buildManagedBlock("# User Preferences (from you.md)\n\n## How I Work\n\n- exported line");
    const file = `# Mine\n\n- keep me\n\n${block}\n\n- and me\n\n${block}\n`;
    const stripped = stripManagedBlocks(file);
    expect(stripped).toContain("- keep me");
    expect(stripped).toContain("- and me");
    expect(stripped).not.toContain("exported line");
    expect(stripped).not.toContain("you-md:begin");
  });

  it("drops an unterminated block to the end of the file", () => {
    const stripped = stripManagedBlocks("- keep\n<!-- you-md:begin -->\n- lost");
    expect(stripped.trim()).toBe("- keep");
  });
});

describe("extractItems", () => {
  it("splits list items and paragraphs and assigns sections by heading", () => {
    const items = extractItems(CLAUDE_MD, "~/.claude/CLAUDE.md");
    const byText = Object.fromEntries(items.map(i => [i.text, i.section]));
    expect(byText["- Be concise"]).toBe("How I Communicate");
    expect(byText["- Skip the preamble"]).toBe("How I Communicate");
    expect(byText["- Prefer TypeScript strict mode"]).toBe("How I Work");
    expect(byText["- Never use `any`"]).toBe("Boundaries");
    expect(byText["- Add dependencies without asking"]).toBe("Boundaries");
    expect(items.every(i => i.origin === "~/.claude/CLAUDE.md")).toBe(true);
  });

  it("does not import heading text or Claude Code @import lines", () => {
    const items = extractItems("# Title\n\n@AGENTS.md\n@~/.claude/extra.md\n\n- real line\n", "x");
    expect(items.map(i => i.text)).toEqual(["- real line"]);
  });

  it("keeps list continuations and fenced code with their item", () => {
    const body = "- Use this pattern:\n  continued here\n\n```ts\n# not a heading\nconst x = 1\n```\n";
    const items = extractItems(body, "x");
    expect(items).toHaveLength(2);
    expect(items[0].text).toBe("- Use this pattern:\n  continued here");
    expect(items[1].text).toContain("# not a heading");
    expect(items[1].section).toBe("How I Work");
  });

  it("treats a paragraph as one item", () => {
    const items = extractItems("I am a backend engineer.\nI work on payments.\n\nSecond paragraph.", "x");
    expect(items.map(i => i.text)).toEqual([
      "I am a backend engineer.\nI work on payments.",
      "Second paragraph.",
    ]);
  });
});

describe("parseSourceFile", () => {
  it("strips Cursor .mdc frontmatter and HTML comments", async () => {
    const file = write(
      join(cwd, ".cursor", "rules", "style.mdc"),
      "---\ndescription: Style rules\nglobs: **/*.ts\nalwaysApply: true\n---\n<!-- private note -->\n- Use named exports\n"
    );
    const parsed = await parseSourceFile(file, paths);
    expect(parsed.report.status).toBe("imported");
    expect(parsed.items.map(i => i.text)).toEqual(["- Use named exports"]);
  });

  it("skips files that are already you.md profiles", async () => {
    const file = write(join(home, ".you.md"), `---\nschema_version: "1.1"\n---\n\n# Me\n\n- x\n`);
    const parsed = await parseSourceFile(file, paths);
    expect(parsed.report.status).toBe("skipped");
    expect(parsed.report.reason).toBe("already a you.md profile");
  });

  it("skips files that you-md export owns outright", async () => {
    const cursor = EXPORT_TARGETS.find(t => t.id === "cursor")!;
    const { path } = await exportToTarget(cursor, "# User Preferences (from you.md)\n\n- exported", paths);
    const parsed = await parseSourceFile(path, paths);
    expect(parsed.report.status).toBe("skipped");
    expect(parsed.report.reason).toBe("written by you-md export");
  });

  it("keeps the user's own notes around a managed block", async () => {
    const block = buildManagedBlock("# User Preferences (from you.md)\n\n- exported line");
    const file = write(join(home, ".claude", "CLAUDE.md"), `- my own note\n\n${block}\n`);
    const parsed = await parseSourceFile(file, paths);
    expect(parsed.report.status).toBe("imported");
    expect(parsed.items.map(i => i.text)).toEqual(["- my own note"]);
  });

  it("skips a file that is nothing but a managed block", async () => {
    const block = buildManagedBlock("# User Preferences (from you.md)\n\n- exported line");
    const file = write(join(home, ".gemini", "GEMINI.md"), block + "\n");
    const parsed = await parseSourceFile(file, paths);
    expect(parsed.report.status).toBe("skipped");
  });
});

describe("discoverImportFiles", () => {
  it("finds user-level files by default and project files with includeProject", async () => {
    write(join(home, ".claude", "CLAUDE.md"), "- a");
    write(join(home, ".kiro", "steering", "tone.md"), "- b");
    write(join(home, ".kiro", "steering", "ignored.json"), "{}");
    write(join(cwd, "AGENTS.md"), "- c");
    write(join(cwd, ".clinerules", "one.md"), "- d");

    const user = await discoverImportFiles({}, paths);
    expect(user.map(f => f.source.id).sort()).toEqual(["claude", "kiro"]);

    const all = await discoverImportFiles({ includeProject: true }, paths);
    expect(all.map(f => f.source.id).sort()).toEqual(["agents", "claude", "clinerules", "kiro"]);
    expect(all.find(f => f.source.id === "clinerules")!.file.endsWith("one.md")).toBe(true);
  });

  it("returns nothing when no files exist", async () => {
    expect(await discoverImportFiles({ includeProject: true }, paths)).toEqual([]);
  });
});

describe("collectItems", () => {
  it("drops duplicates across files, earlier files win", async () => {
    const a = write(join(home, ".claude", "CLAUDE.md"), "- Be concise\n- Use pnpm\n");
    const b = write(join(home, ".gemini", "GEMINI.md"), "- **Be concise.**\n- Prefer tabs\n");
    const result = await collectItems([a, b], paths);
    expect(result.items.map(i => i.text)).toEqual(["- Be concise", "- Use pnpm", "- Prefer tabs"]);
    expect(result.items[0].origin).toBe("~/.claude/CLAUDE.md");
    expect(result.duplicates).toBe(1);
    expect(result.reports.map(r => r.items)).toEqual([2, 1]);
  });

  it("marks a file skipped when everything in it was already imported", async () => {
    const a = write(join(home, ".claude", "CLAUDE.md"), "- Be concise\n");
    const b = write(join(home, ".gemini", "GEMINI.md"), "- Be concise\n");
    const result = await collectItems([a, b], paths);
    expect(result.reports[1].status).toBe("skipped");
  });

  it("skips lines already present in an existing profile", async () => {
    const a = write(join(home, ".claude", "CLAUDE.md"), "- Be concise\n- Use pnpm\n");
    const existing = existingProfileKeys(`---\nschema_version: "1.1"\n---\n\n# Me\n\n## How I Work\n\n- Use pnpm\n`);
    const result = await collectItems([a], paths, existing);
    expect(result.items.map(i => i.text)).toEqual(["- Be concise"]);
  });
});

describe("renderProfile", () => {
  it("produces a valid profile on the current schema with provenance notes", async () => {
    const items = extractItems(CLAUDE_MD, "~/.claude/CLAUDE.md");
    const profile = renderProfile(items, "2026-09-06");

    expect(profile).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
    expect(profile).toContain('created: "2026-09-06"');
    expect(profile).toContain("# Me");
    expect(profile).toContain("<!-- imported from ~/.claude/CLAUDE.md -->");

    const order = IMPORT_SECTIONS.map(s => profile.indexOf(`## ${s}`)).filter(i => i !== -1);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(profile).not.toContain("## What I Trust");

    const parsed = createParser().parse(profile);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const validation = validateProfile(parsed.profile);
      expect(validation.valid).toBe(true);
      expect(validation.warnings.filter(w => w.code === "UNKNOWN_SECTION")).toEqual([]);
      expect(parsed.profile.sections.get("boundaries")?.content).toContain("Never use `any`");
    }
  });
});

describe("mergeIntoProfile", () => {
  const existing = `---
schema_version: "1.1"
created: "2026-01-01"
last_updated: "2026-01-01"
privacy_level: "private"
---

# Me

## How I Work

- Existing line

## Boundaries

- Existing boundary
`;

  it("appends to matching sections and adds missing ones at the end", () => {
    const items = extractItems("## Communication\n- Be concise\n\n## Coding\n- Use pnpm\n", "~/.claude/CLAUDE.md");
    const merged = mergeIntoProfile(existing, items, "2026-09-06");

    expect(merged).toContain('last_updated: "2026-09-06"');
    expect(merged).toContain("## How I Work\n\n- Existing line\n\n<!-- imported from ~/.claude/CLAUDE.md -->\n- Use pnpm\n\n## Boundaries");
    expect(merged.indexOf("## How I Communicate")).toBeGreaterThan(merged.indexOf("## Boundaries"));
    expect(merged).toContain("- Existing boundary");
    expect(merged.match(/^## /gm)).toHaveLength(3);
  });

  it("returns the profile unchanged when there is nothing to add", () => {
    expect(mergeIntoProfile(existing, [], "2026-09-06")).toBe(existing);
  });
});

describe("displayPath", () => {
  it("shortens paths under the home directory", () => {
    expect(displayPath("/Users/me/.claude/CLAUDE.md", "/Users/me")).toBe("~/.claude/CLAUDE.md");
    expect(displayPath("/srv/app/AGENTS.md", "/Users/me")).toBe("/srv/app/AGENTS.md");
    expect(displayPath("/Users/meow/x.md", "/Users/me")).toBe("/Users/meow/x.md");
  });
});

describe("importCommand", () => {
  it("writes a profile from discovered files and reports per file", async () => {
    write(join(home, ".claude", "CLAUDE.md"), CLAUDE_MD);
    write(join(home, ".codex", "AGENTS.md"), "- Be concise\n- Run tests before committing\n");
    const out = join(home, ".you.md");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await importCommand([], { output: out }, paths);

    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const profile = readFileSync(out, "utf-8");
    expect(profile).toContain("- Run tests before committing");
    expect(profile.match(/Be concise/g)).toHaveLength(1);
    const printed = log.mock.calls.map(c => c.join(" ")).join("\n");
    expect(printed).toContain("~/.claude/CLAUDE.md");
    expect(printed).toContain("1 duplicate(s) dropped");
  });

  it("prints to stdout when no output path is given", async () => {
    write(join(home, ".claude", "CLAUDE.md"), CLAUDE_MD);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await importCommand([], {}, paths);
    expect(code).toBe(0);
    expect(log.mock.calls[0][0]).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  });

  it("dry run writes nothing", async () => {
    write(join(home, ".claude", "CLAUDE.md"), CLAUDE_MD);
    const out = join(home, ".you.md");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await importCommand([], { output: out, dryRun: true }, paths);
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses to overwrite an existing profile without --force or --merge", async () => {
    write(join(home, ".claude", "CLAUDE.md"), CLAUDE_MD);
    const out = write(join(home, ".you.md"), `---\nschema_version: "1.1"\n---\n\n# Me\n\n## How I Work\n\n- Mine\n`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await importCommand([], { output: out }, paths);
    expect(code).toBe(1);
    expect(readFileSync(out, "utf-8")).toContain("- Mine");
  });

  it("merges into an existing profile, backs it up, and never reads it as a source", async () => {
    write(join(home, ".claude", "CLAUDE.md"), "- Be concise\n- New idea\n");
    const original = `---\nschema_version: "1.1"\nlast_updated: "2026-01-01"\n---\n\n# Me\n\n## How I Work\n\n- Be concise\n`;
    const out = write(join(home, ".you.md"), original);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await importCommand([], { output: out, merge: true }, paths);

    expect(code).toBe(0);
    const merged = readFileSync(out, "utf-8");
    expect(merged).toContain("- New idea");
    expect(merged.match(/Be concise/g)).toHaveLength(1);
    expect(merged).toContain('last_updated: "20');
    expect(readFileSync(out + ".backup", "utf-8")).toBe(original);
  });

  it("returns 0 with a message when a merge has nothing new", async () => {
    write(join(home, ".claude", "CLAUDE.md"), "- Be concise\n");
    const out = write(join(home, ".you.md"), `---\nschema_version: "1.1"\n---\n\n# Me\n\n## How I Work\n\n- Be concise\n`);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await importCommand([], { output: out, merge: true }, paths);
    expect(code).toBe(0);
    expect(err.mock.calls[0][0]).toContain("Nothing new to import");
  });

  it("imports explicit files and directories", async () => {
    write(join(cwd, ".cursor", "rules", "a.mdc"), "---\nalwaysApply: true\n---\n- From a\n");
    write(join(cwd, ".cursor", "rules", "b.mdc"), "- From b\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await importCommand([join(cwd, ".cursor", "rules")], {}, paths);
    expect(code).toBe(0);
    const printed = log.mock.calls[0][0] as string;
    expect(printed).toContain("- From a");
    expect(printed).toContain("- From b");
  });

  it("fails clearly on a missing file", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await importCommand(["nope.md"], {}, paths);
    expect(code).toBe(1);
    expect(err.mock.calls[0][0]).toContain("File not found");
  });

  it("exits 1 when nothing is found", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await importCommand([], {}, paths)).toBe(1);
  });

  it("emits a machine-readable report with --json", async () => {
    write(join(home, ".claude", "CLAUDE.md"), CLAUDE_MD);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await importCommand([], { json: true, dryRun: true }, paths);
    expect(code).toBe(0);
    const report = JSON.parse(log.mock.calls[0][0] as string);
    expect(report.files[0].origin).toBe("~/.claude/CLAUDE.md");
    expect(report.items).toBe(5);
    expect(report.sections["Boundaries"]).toBe(2);
    expect(report.dryRun).toBe(true);
  });
});

describe("convertCommand", () => {
  it("converts a single .cursorrules file through the import pipeline", async () => {
    const file = write(join(cwd, ".cursorrules"), "You are helping a Go developer.\n\n- Prefer table-driven tests\n- Never ignore errors\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await convertCommand([file], {}, paths);
    expect(code).toBe(0);
    const out = log.mock.calls[0][0] as string;
    expect(out).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
    expect(out).toContain("## How I Work");
    expect(out).toContain("- Prefer table-driven tests");
    expect(out).toContain("## Boundaries");
    expect(out).toContain("- Never ignore errors");
  });

  it("still errors without an input file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await convertCommand([], {}, paths)).toBe(1);
  });
});
