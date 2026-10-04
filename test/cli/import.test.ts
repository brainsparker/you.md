import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  extractDumpBody,
  parseMemoryDump,
  classifyMemory,
  groupMemories,
  looksSensitive,
  renderImportedProfile,
  mergeIntoProfile,
  importCommand,
  IMPORT_SECTIONS,
  UNSORTED_SECTION,
} from "../../src/cli/commands/import";
import { createParser } from "../../src/parser/index";

const tempDir = join(tmpdir(), `you-md-import-test-${Date.now()}`);
const home = join(tempDir, "home");

beforeEach(() => {
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** What ChatGPT produces for Claude's published export prompt */
const CHATGPT_DUMP = `Here is everything I have stored about you, formatted as requested:

\`\`\`
[2026-03-02] - Prefers concise answers without preamble
[2026-03-02] - Never use em dashes in anything they will send to another person
[2026-04-11] - Works as a Staff Product Manager at a developer platform company
[2026-04-11] - Uses TypeScript in strict mode and prefers pnpm over npm
[2026-05-20] - Lives in Cleveland, Ohio (Eastern time)
[2026-06-01] - Building an open-source clipboard manager for macOS as a side project
[2026-06-15] - Trusts official documentation over blog posts; wants claims cited
[date unknown] - Enjoys long-distance cycling and jazz
[2026-07-02] - Has a dog named Pixel
[2026-07-02] - Prefers concise answers without preamble.
\`\`\`

That is the complete set. Let me know if you need anything else!`;

describe("extractDumpBody", () => {
  it("keeps only the fenced block when the dump has one", () => {
    const body = extractDumpBody("intro\n```\nline one\nline two\n```\noutro");
    expect(body).toBe("line one\nline two");
  });

  it("concatenates several fenced blocks", () => {
    const body = extractDumpBody("```\na\n```\ntext\n```text\nb\n```");
    expect(body).toBe("a\nb");
  });

  it("falls back to the whole text when there are no fences", () => {
    expect(extractDumpBody("- a\n- b")).toBe("- a\n- b");
  });

  it("ignores an empty fence and uses the whole text instead", () => {
    expect(extractDumpBody("```\n\n```\n- a")).toBe("```\n\n```\n- a");
  });
});

describe("parseMemoryDump", () => {
  it("strips date prefixes and keeps the date", () => {
    const [entry] = parseMemoryDump("[2026-03-02] - Prefers concise answers");
    expect(entry).toEqual({ text: "Prefers concise answers", date: "2026-03-02" });
  });

  it("drops a placeholder date like [date unknown]", () => {
    const [entry] = parseMemoryDump("[date unknown] - Enjoys cycling");
    expect(entry.text).toBe("Enjoys cycling");
    expect(entry.date).toBeUndefined();
  });

  it("handles bare dates, bullets, numbering, and wrapping quotes", () => {
    const entries = parseMemoryDump(
      [
        "- 2026-01-05 - Uses Neovim",
        "* \"Prefers dark mode\"",
        "1. March 3, 2026 - Has two kids",
        "• Likes jazz",
        "2) Speaks Spanish",
      ].join("\n")
    );
    expect(entries.map(e => e.text)).toEqual([
      "Uses Neovim",
      "Prefers dark mode",
      "Has two kids",
      "Likes jazz",
      "Speaks Spanish",
    ]);
    expect(entries[0].date).toBe("2026-01-05");
    expect(entries[2].date).toBe("March 3, 2026");
  });

  it("skips assistant chatter and blank lines", () => {
    const entries = parseMemoryDump(
      "Sure! Here is what I remember:\n\n- Prefers tabs\n\nThat is the complete set.\nLet me know if anything is missing."
    );
    expect(entries.map(e => e.text)).toEqual(["Prefers tabs"]);
  });

  it("uses headings as hints without treating them as entries", () => {
    const entries = parseMemoryDump("## Tools\n- Uses Rust\n**Personal details**\n- Based in Lisbon\nHobbies:\n- Plays chess");
    expect(entries).toEqual([
      { text: "Uses Rust", hint: "Tools" },
      { text: "Based in Lisbon", hint: "Personal details" },
      { text: "Plays chess", hint: "Hobbies" },
    ]);
  });

  it("drops exact and near-duplicate entries", () => {
    const entries = parseMemoryDump("- Prefers concise answers\n- prefers  concise answers.\n- Prefers concise answers");
    expect(entries).toHaveLength(1);
  });

  it("parses a realistic ChatGPT export end to end", () => {
    const entries = parseMemoryDump(CHATGPT_DUMP);
    expect(entries).toHaveLength(9);
    expect(entries[0]).toEqual({
      text: "Prefers concise answers without preamble",
      date: "2026-03-02",
    });
    expect(entries.some(e => /complete set/i.test(e.text))).toBe(false);
  });
});

describe("classifyMemory", () => {
  it("files prohibitions as boundaries before anything else", () => {
    expect(classifyMemory("Never use em dashes in replies")).toBe("Boundaries");
    expect(classifyMemory("Do not suggest Python libraries")).toBe("Boundaries");
    expect(classifyMemory("User asked me to avoid emoji")).toBe("Boundaries");
  });

  it("recognizes communication, tools, trust, goals, work, context, and interests", () => {
    expect(classifyMemory("Prefers concise answers without preamble")).toBe("How I Communicate");
    expect(classifyMemory("Uses TypeScript in strict mode")).toBe("How I Work");
    expect(classifyMemory("Wants claims cited from official documentation")).toBe("What I Trust");
    expect(classifyMemory("Building a clipboard manager as a side project")).toBe("What I'm Working On");
    expect(classifyMemory("Staff Product Manager at a developer platform company")).toBe("What I Do");
    expect(classifyMemory("Lives in Cleveland, Ohio")).toBe("Context");
    expect(classifyMemory("Enjoys long-distance cycling and jazz")).toBe("What I'm Into");
  });

  it("falls back to the dump heading, then to the unsorted section", () => {
    expect(classifyMemory("Pixel", "Pets")).toBe("Context");
    expect(classifyMemory("Pixel")).toBe(UNSORTED_SECTION);
    expect(classifyMemory("Something unclassifiable", "Also unclassifiable")).toBe(UNSORTED_SECTION);
  });

  it("only ever returns a known section", () => {
    const known = new Set<string>(IMPORT_SECTIONS);
    for (const text of ["Uses Go", "Hates mornings", "Reads a lot", "Based in Oslo", ""]) {
      expect(known.has(classifyMemory(text))).toBe(true);
    }
  });
});

describe("looksSensitive and groupMemories", () => {
  it("flags credentials and drops them from the groups", () => {
    expect(looksSensitive("API_KEY: abc123")).toBe(true);
    expect(looksSensitive("Token sk-live-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(looksSensitive("Prefers concise answers")).toBe(false);

    const { groups, sensitive } = groupMemories([
      { text: "Prefers concise answers" },
      { text: "password: hunter2" },
    ]);
    expect(sensitive).toBe(1);
    expect([...groups.keys()]).toEqual(["How I Communicate"]);
  });

  it("returns sections in canonical order regardless of input order", () => {
    const { groups } = groupMemories([
      { text: "Enjoys jazz" },
      { text: "Never use emoji" },
      { text: "Uses Rust" },
    ]);
    expect([...groups.keys()]).toEqual(["How I Work", "What I'm Into", "Boundaries"]);
  });
});

describe("renderImportedProfile", () => {
  it("writes a valid you.md with frontmatter and one bullet per memory", () => {
    const { groups } = groupMemories(parseMemoryDump(CHATGPT_DUMP));
    const content = renderImportedProfile(groups, { source: "memories.txt", today: "2026-10-04" });

    expect(content.startsWith('---\nschema_version: "1.1"\ncreated: "2026-10-04"')).toBe(true);
    expect(content).toContain("# Me");
    expect(content).toContain("## How I Communicate\n\n- Prefers concise answers without preamble");
    expect(content).toContain("## Boundaries\n\n- Never use em dashes");
    expect(content).toContain("## Context\n\n- Lives in Cleveland, Ohio (Eastern time)");
    expect(content).not.toContain("[2026-03-02]");

    const result = createParser().parse(content);
    expect(result.success).toBe(true);
    expect(result.profile.sections.get("how i communicate")).toBeDefined();
    expect(result.profile.sections.get("boundaries")?.content).toContain("em dashes");
  });

  it("marks the unsorted section so the user knows to file it", () => {
    const { groups } = groupMemories([{ text: "Pixel" }]);
    const content = renderImportedProfile(groups, { source: "x", today: "2026-10-04" });
    expect(content).toContain(`## ${UNSORTED_SECTION}`);
    expect(content).toContain("could not tell where these belong");
  });
});

describe("mergeIntoProfile", () => {
  const EXISTING = `---
schema_version: "1.1"
created: "2026-01-01"
last_updated: "2026-01-01"
privacy_level: "private"
---

# Me

## How I Communicate

Verbosity: concise
Tone: direct

## How I Work

- Prefer TypeScript in strict mode

### Editor

Neovim, always.

## Boundaries

- Do not add abstractions for hypothetical future needs
`;

  it("appends to matching sections, adds missing ones, bumps last_updated, leaves the rest alone", () => {
    const { groups } = groupMemories([
      { text: "Prefers answers without preamble" },
      { text: "Uses pnpm over npm" },
      { text: "Lives in Cleveland" },
    ]);
    const { content, added, duplicates } = mergeIntoProfile(EXISTING, groups, "2026-10-04");

    expect(duplicates).toBe(0);
    expect(added.size).toBe(3);
    expect(content).toContain('last_updated: "2026-10-04"');
    expect(content).toContain("Verbosity: concise\nTone: direct\n\n- Prefers answers without preamble\n");
    // New tool bullet joins the existing list, above the ### Editor subsection
    expect(content).toContain("- Prefer TypeScript in strict mode\n- Uses pnpm over npm\n\n### Editor\n\nNeovim, always.");
    // Missing section appended at the end
    expect(content.trimEnd().endsWith("## Context\n\n- Lives in Cleveland")).toBe(true);
    // Untouched content survives byte for byte
    expect(content).toContain("- Do not add abstractions for hypothetical future needs");
    expect(content).toContain('created: "2026-01-01"');

    expect(createParser().parse(content).success).toBe(true);
  });

  it("skips entries already present anywhere in the file and returns the file unchanged if nothing is new", () => {
    const { groups } = groupMemories([{ text: "Prefer TypeScript in strict mode." }]);
    const { content, added, duplicates } = mergeIntoProfile(EXISTING, groups, "2026-10-04");
    expect(duplicates).toBe(1);
    expect(added.size).toBe(0);
    expect(content).toBe(EXISTING);
  });

  it("is idempotent", () => {
    const { groups } = groupMemories([{ text: "Uses pnpm over npm" }, { text: "Enjoys jazz" }]);
    const once = mergeIntoProfile(EXISTING, groups, "2026-10-04").content;
    const twice = mergeIntoProfile(once, groups, "2026-10-05").content;
    expect(twice).toBe(once);
  });

  it("handles a file with no sections at all", () => {
    const { groups } = groupMemories([{ text: "Uses Rust" }]);
    const { content } = mergeIntoProfile("# Me\n", groups, "2026-10-04");
    expect(content).toBe("# Me\n\n## How I Work\n\n- Uses Rust\n");
  });
});

describe("importCommand", () => {
  const dumpPath = () => join(tempDir, "memories.txt");

  it("creates ~/.you.md from a dump file", async () => {
    writeFileSync(dumpPath(), CHATGPT_DUMP);
    const code = await importCommand([dumpPath()], { quiet: true }, { home });
    expect(code).toBe(0);

    const out = join(home, ".you.md");
    expect(existsSync(out)).toBe(true);
    const content = readFileSync(out, "utf-8");
    expect(content).toContain("Imported from memories.txt by you-md import");
    expect(content).toContain("- Has a dog named Pixel");
    expect(existsSync(out + ".backup")).toBe(false);
  });

  it("merges into an existing file at -o and backs it up", async () => {
    const target = join(tempDir, "project", ".you.md");
    mkdirSync(join(tempDir, "project"), { recursive: true });
    writeFileSync(target, "---\nschema_version: \"1.1\"\n---\n\n# Me\n\n## How I Work\n\n- Uses Rust\n");
    writeFileSync(dumpPath(), "- Uses Rust\n- Uses Docker\n");

    const code = await importCommand([dumpPath()], { quiet: true, output: target }, { home });
    expect(code).toBe(0);

    const content = readFileSync(target, "utf-8");
    expect(content).toContain("- Uses Rust\n- Uses Docker\n");
    expect(content.match(/Uses Rust/g)).toHaveLength(1);
    expect(existsSync(target + ".backup")).toBe(true);
  });

  it("reads the dump from stdin when the path is -", async () => {
    const code = await importCommand(["-"], { quiet: true }, {
      home,
      readStdin: async () => "- Prefers concise answers\n",
    });
    expect(code).toBe(0);
    expect(readFileSync(join(home, ".you.md"), "utf-8")).toContain("- Prefers concise answers");
  });

  it("writes nothing on --dry-run", async () => {
    writeFileSync(dumpPath(), "- Prefers concise answers\n");
    const code = await importCommand([dumpPath()], { dryRun: true, quiet: true }, { home });
    expect(code).toBe(0);
    expect(existsSync(join(home, ".you.md"))).toBe(false);
  });

  it("fails clearly on a missing file or an empty dump", async () => {
    expect(await importCommand([join(tempDir, "nope.txt")], { quiet: true }, { home })).toBe(1);
    writeFileSync(dumpPath(), "Sure! Here is what I remember:\n\nThat is the complete set.\n");
    expect(await importCommand([dumpPath()], { quiet: true }, { home })).toBe(1);
    expect(existsSync(join(home, ".you.md"))).toBe(false);
  });

  it("shows help and exits 1 when called without a dump", async () => {
    expect(await importCommand([], {}, { home })).toBe(1);
    expect(await importCommand(["help"], {}, { home })).toBe(0);
  });
});
