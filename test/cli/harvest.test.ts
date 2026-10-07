import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  applyHarvest,
  classifyMemory,
  extractEntries,
  findMemoryDirs,
  normalizeForMatch,
  parseMemoryTypes,
  planHarvest,
  projectLabel,
  readMemoryFile,
  resolveMemoryRoots,
  scanMemoryDirs,
  SECTION_BOUNDARIES,
  SECTION_COMMUNICATE,
  SECTION_CONTEXT,
  SECTION_DO,
  SECTION_IMPORTED,
  SECTION_WORK,
  SECTION_WORKING_ON,
  type HarvestedMemory,
} from "../../src/cli/harvest";
import { harvestCommand } from "../../src/cli/commands/harvest";

const tempDir = join(tmpdir(), `you-md-harvest-test-${Date.now()}`);
const home = join(tempDir, "home");
const projects = join(home, ".claude", "projects");

beforeEach(() => {
  mkdirSync(projects, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Write one Claude Code memory topic file. */
function memoryFile(
  project: string,
  name: string,
  body: string,
  frontmatter: Record<string, string> | null = { type: "user" }
): string {
  const dir = join(projects, project, "memory");
  mkdirSync(dir, { recursive: true });
  const fm = frontmatter
    ? ["---", ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`), "---", ""].join("\n")
    : "";
  const path = join(dir, name);
  writeFileSync(path, fm + body, "utf-8");
  return path;
}

function mem(text: string, type: HarvestedMemory["type"] = "user", project = "frugal"): HarvestedMemory {
  return { text, type, project, file: `/fake/${project}/memory/x.md` };
}

const EXISTING_PROFILE = `---
schema_version: "1.1"
created: "2026-01-10"
last_updated: "2026-01-10"
privacy_level: "private"
---

# Me

## What I Do

Staff product manager at a developer platform company.

## How I Communicate

Verbosity: concise
Tone: direct

## How I Work

- Prefer TypeScript in strict mode

### Testing

- Test behavior, not implementation details

## Boundaries

- Do not add abstractions for hypothetical future needs
`;

describe("projectLabel", () => {
  it("strips the leading dash Claude Code puts on encoded paths", () => {
    expect(projectLabel("-Users-me-code-frugal")).toBe("Users-me-code-frugal");
  });

  it("leaves plain names alone", () => {
    expect(projectLabel("frugal")).toBe("frugal");
    expect(projectLabel("-")).toBe("-");
  });
});

describe("resolveMemoryRoots", () => {
  it("defaults to ~/.claude/projects", () => {
    expect(resolveMemoryRoots({ home, env: {} })).toEqual([join(home, ".claude", "projects")]);
  });

  it("checks CLAUDE_CONFIG_DIR/projects first when the variable is set", () => {
    const roots = resolveMemoryRoots({ home, env: { CLAUDE_CONFIG_DIR: "/cfg" } });
    expect(roots[0]).toBe(join("/cfg", "projects"));
    expect(roots[1]).toBe(join(home, ".claude", "projects"));
  });

  it("uses only the explicit memory dir when one is given", () => {
    const roots = resolveMemoryRoots({ home, env: { CLAUDE_CONFIG_DIR: "/cfg" }, memoryDir: "/mem" });
    expect(roots).toEqual(["/mem"]);
  });
});

describe("findMemoryDirs", () => {
  it("finds <project>/memory directories under a projects root", () => {
    memoryFile("-Users-me-frugal", "user_role.md", "Works on routing.");
    memoryFile("-Users-me-superpaste", "feedback_tests.md", "Run tests first.", { type: "feedback" });
    mkdirSync(join(projects, "-Users-me-empty"), { recursive: true }); // no memory dir

    const dirs = findMemoryDirs([projects]);
    expect(dirs.map(d => d.project).sort()).toEqual(["Users-me-frugal", "Users-me-superpaste"]);
    expect(dirs.every(d => d.path.endsWith("memory"))).toBe(true);
  });

  it("accepts a single memory directory as the root", () => {
    const file = memoryFile("-Users-me-frugal", "user_role.md", "Works on routing.");
    const memoryDir = join(file, "..");
    const dirs = findMemoryDirs([memoryDir]);
    expect(dirs).toHaveLength(1);
    expect(dirs[0].project).toBe("Users-me-frugal");
  });

  it("ignores roots that do not exist", () => {
    expect(findMemoryDirs([join(tempDir, "nope")])).toEqual([]);
  });
});

describe("extractEntries", () => {
  it("splits bullets into entries and folds indented continuations", () => {
    const body = [
      "# User preferences",
      "",
      "- Prefers pnpm over npm for every project",
      "  because the lockfile is deterministic",
      "- Wants commit messages in the imperative mood",
      "",
    ].join("\n");
    expect(extractEntries(body)).toEqual([
      "Prefers pnpm over npm for every project because the lockfile is deterministic",
      "Wants commit messages in the imperative mood",
    ]);
  });

  it("treats paragraphs as one entry each and skips code, tables, and comments", () => {
    const body = [
      "The user is a staff product manager",
      "who also ships code to production.",
      "",
      "```",
      "- not a memory, it is code",
      "```",
      "",
      "| col | col |",
      "<!-- note to self -->",
      "---",
      "Short.",
      "",
      "1. Numbered items count too",
    ].join("\n");
    expect(extractEntries(body)).toEqual([
      "The user is a staff product manager who also ships code to production.",
      "Numbered items count too",
    ]);
  });

  it("falls back to the frontmatter description when the body has nothing usable", () => {
    expect(extractEntries("# Heading only\n", "Prefers short answers with no preamble")).toEqual([
      "Prefers short answers with no preamble",
    ]);
    expect(extractEntries("# Heading only\n")).toEqual([]);
  });

  it("strips dated prefixes", () => {
    expect(extractEntries("- [2026-09-01] - Prefers tabs over spaces")).toEqual([
      "Prefers tabs over spaces",
    ]);
  });
});

describe("readMemoryFile and scanMemoryDirs", () => {
  it("reads type and modified from the frontmatter", () => {
    const file = memoryFile("-Users-me-frugal", "feedback_deps.md", "- Never add a dependency without asking first", {
      name: "feedback_deps",
      description: "How the user wants dependency changes handled",
      type: "feedback",
      modified: "2026-09-30T12:00:00Z",
    });
    const memories = readMemoryFile(file, "frugal");
    expect(memories).toEqual([
      {
        text: "Never add a dependency without asking first",
        type: "feedback",
        project: "frugal",
        file,
        modified: "2026-09-30T12:00:00Z",
      },
    ]);
  });

  it("marks files without a type as untyped", () => {
    const file = memoryFile("-Users-me-frugal", "notes.md", "- Likes espresso in the afternoon", null);
    expect(readMemoryFile(file, "frugal")[0].type).toBe("untyped");
  });

  it("filters by type, skips MEMORY.md, and reads every project", () => {
    memoryFile("-Users-me-frugal", "MEMORY.md", "- [user_role](user_role.md) - the user's role", null);
    memoryFile("-Users-me-frugal", "user_role.md", "- Works as a staff product manager");
    memoryFile("-Users-me-frugal", "project_launch.md", "- Launch is planned for October", { type: "project" });
    memoryFile("-Users-me-superpaste", "feedback_tone.md", "- Wants answers without preamble", { type: "feedback" });
    memoryFile("-Users-me-superpaste", "reference_tracker.md", "- Issues live in Linear project SP", { type: "reference" });

    const dirs = findMemoryDirs([projects]);
    const { memories, files } = scanMemoryDirs(dirs);

    expect(files).toBe(4);
    expect(memories.map(m => m.text).sort()).toEqual([
      "Wants answers without preamble",
      "Works as a staff product manager",
    ]);

    const all = scanMemoryDirs(dirs, ["user", "feedback", "project", "reference", "untyped"]);
    expect(all.memories).toHaveLength(4);
  });
});

describe("classifyMemory", () => {
  it("files prohibitions under Boundaries regardless of type", () => {
    expect(classifyMemory(mem("Never add a dependency without asking", "feedback"))).toBe(SECTION_BOUNDARIES);
    expect(classifyMemory(mem("Do not use em dashes in anything that ships", "user"))).toBe(SECTION_BOUNDARIES);
    expect(classifyMemory(mem("Dislikes hedging language in summaries", "user"))).toBe(SECTION_BOUNDARIES);
  });

  it("files communication preferences under How I Communicate", () => {
    expect(classifyMemory(mem("Prefers concise answers with no preamble", "feedback"))).toBe(SECTION_COMMUNICATE);
    expect(classifyMemory(mem("Likes a casual tone in chat", "user"))).toBe(SECTION_COMMUNICATE);
  });

  it("files role and expertise under What I Do, but only for user memories", () => {
    expect(classifyMemory(mem("Works as a staff product manager at a developer platform", "user"))).toBe(SECTION_DO);
    expect(classifyMemory(mem("Has ten years of experience with search infrastructure", "user"))).toBe(SECTION_DO);
    expect(classifyMemory(mem("Confirmed the team runs integration tests before merging", "feedback"))).toBe(SECTION_WORK);
  });

  it("defaults working preferences to How I Work", () => {
    expect(classifyMemory(mem("Prefers pnpm over npm", "user"))).toBe(SECTION_WORK);
    expect(classifyMemory(mem("Approved the pattern of small, single-purpose commits", "feedback"))).toBe(SECTION_WORK);
  });

  it("keeps project and reference memories in their own sections", () => {
    expect(classifyMemory(mem("Launch is planned for October", "project"))).toBe(SECTION_WORKING_ON);
    expect(classifyMemory(mem("Issues live in Linear project SP", "reference"))).toBe(SECTION_CONTEXT);
    expect(classifyMemory(mem("Likes espresso in the afternoon", "untyped"))).toBe(SECTION_IMPORTED);
  });
});

describe("normalizeForMatch", () => {
  it("collapses case, emphasis, bullets, and trailing punctuation", () => {
    expect(normalizeForMatch("- **Prefers pnpm** over `npm`.")).toBe("prefers pnpm over npm");
    expect(normalizeForMatch("  Prefers   PNPM over npm  ")).toBe("prefers pnpm over npm");
  });
});

describe("planHarvest", () => {
  it("merges the same memory learned in several projects into one entry", () => {
    const plan = planHarvest(null, [
      mem("Prefers pnpm over npm", "user", "frugal"),
      mem("Prefers **pnpm** over npm.", "user", "you.md"),
      mem("prefers pnpm over npm", "feedback", "superpaste"),
    ]);
    expect(plan.count).toBe(1);
    const [entry] = plan.additions.get(SECTION_WORK)!;
    expect(entry.projects).toEqual(["frugal", "superpaste", "you.md"]);
  });

  it("skips memories the profile already contains", () => {
    const plan = planHarvest(EXISTING_PROFILE, [
      mem("Prefer TypeScript in strict mode", "user"),
      mem("Do not add abstractions for hypothetical future needs.", "feedback"),
      mem("Prefers pnpm over npm", "user"),
    ]);
    expect(plan.count).toBe(1);
    expect(plan.duplicates.map(d => d.text)).toEqual([
      "Prefer TypeScript in strict mode",
      "Do not add abstractions for hypothetical future needs.",
    ]);
  });

  it("drops anything that looks like a credential", () => {
    const plan = planHarvest(null, [
      mem("The deploy token: ghp_abcdefghijklmnopqrstuvwxyz is in the shared vault", "user"),
      mem("api_key=sk-live-1234567890 for the staging account", "reference"),
      mem("Prefers pnpm over npm", "user"),
    ]);
    expect(plan.count).toBe(1);
    expect(plan.sensitive).toHaveLength(2);
  });

  it("orders sections consistently", () => {
    const plan = planHarvest(null, [
      mem("Never add a dependency without asking", "feedback"),
      mem("Prefers pnpm over npm", "user"),
      mem("Works as a staff product manager", "user"),
    ]);
    expect([...plan.additions.keys()]).toEqual([SECTION_DO, SECTION_WORK, SECTION_BOUNDARIES]);
  });
});

describe("applyHarvest", () => {
  const today = "2026-10-07";

  it("appends bullets to an existing section above its first ### subsection", () => {
    const plan = planHarvest(EXISTING_PROFILE, [mem("Prefers pnpm over npm", "user")]);
    const next = applyHarvest(EXISTING_PROFILE, plan, today);

    const work = next.indexOf("## How I Work");
    const testing = next.indexOf("### Testing");
    const added = next.indexOf("- Prefers pnpm over npm");
    expect(added).toBeGreaterThan(work);
    expect(added).toBeLessThan(testing);
    // Sits directly under the existing bullet, no blank line in between
    expect(next).toContain("- Prefer TypeScript in strict mode\n- Prefers pnpm over npm\n\n### Testing");
  });

  it("adds a blank line when the section ends in prose rather than a bullet", () => {
    const plan = planHarvest(EXISTING_PROFILE, [mem("Prefers concise answers with no preamble", "feedback")]);
    const next = applyHarvest(EXISTING_PROFILE, plan, today);
    expect(next).toContain("Tone: direct\n\n- Prefers concise answers with no preamble\n\n## How I Work");
  });

  it("creates a missing section at the end of the profile", () => {
    const plan = planHarvest(EXISTING_PROFILE, [mem("Launch is planned for October", "project")]);
    const next = applyHarvest(EXISTING_PROFILE, plan, today);
    expect(next.trimEnd().endsWith("## What I'm Working On\n\n- Launch is planned for October")).toBe(true);
    expect(next.endsWith("\n")).toBe(true);
  });

  it("bumps last_updated and leaves every other byte alone", () => {
    const plan = planHarvest(EXISTING_PROFILE, [mem("Prefers pnpm over npm", "user")]);
    const next = applyHarvest(EXISTING_PROFILE, plan, today);
    expect(next).toContain(`last_updated: "${today}"`);
    expect(next).toContain('created: "2026-01-10"');

    const expected = EXISTING_PROFILE.replace('last_updated: "2026-01-10"', `last_updated: "${today}"`).replace(
      "- Prefer TypeScript in strict mode\n",
      "- Prefer TypeScript in strict mode\n- Prefers pnpm over npm\n"
    );
    expect(next).toBe(expected);
  });

  it("uses an alias heading when the canonical one is absent", () => {
    const profile = "# Me\n\n## Coding Preferences\n\n- Two-space indentation\n";
    const plan = planHarvest(profile, [mem("Prefers pnpm over npm", "user")]);
    const next = applyHarvest(profile, plan, today);
    expect(next).toBe("# Me\n\n## Coding Preferences\n\n- Two-space indentation\n- Prefers pnpm over npm\n");
    expect(next).not.toContain("## How I Work");
  });

  it("creates a new profile with frontmatter when none exists", () => {
    const plan = planHarvest(null, [
      mem("Works as a staff product manager", "user"),
      mem("Never add a dependency without asking", "feedback"),
    ]);
    const next = applyHarvest(null, plan, today);
    expect(next.startsWith(`---\nschema_version: "1.1"\ncreated: "${today}"\nlast_updated: "${today}"\nprivacy_level: "private"\n---\n\n# Me\n`)).toBe(true);
    expect(next).toContain("## What I Do\n\n- Works as a staff product manager");
    expect(next).toContain("## Boundaries\n\n- Never add a dependency without asking");
  });

  it("returns the input untouched when there is nothing to add", () => {
    const plan = planHarvest(EXISTING_PROFILE, [mem("Prefer TypeScript in strict mode", "user")]);
    expect(applyHarvest(EXISTING_PROFILE, plan, today)).toBe(EXISTING_PROFILE);
  });

  it("is a no-op when applied twice", () => {
    const memories = [mem("Prefers pnpm over npm", "user"), mem("Never add a dependency without asking", "feedback")];
    const once = applyHarvest(EXISTING_PROFILE, planHarvest(EXISTING_PROFILE, memories), today);
    const twice = applyHarvest(once, planHarvest(once, memories), today);
    expect(twice).toBe(once);
  });
});

describe("parseMemoryTypes", () => {
  it("defaults to user and feedback", () => {
    expect(parseMemoryTypes(undefined)).toEqual(["user", "feedback"]);
    expect(parseMemoryTypes("")).toEqual(["user", "feedback"]);
  });

  it("parses comma lists and the all shorthand", () => {
    expect(parseMemoryTypes("feedback, project")).toEqual(["feedback", "project"]);
    expect(parseMemoryTypes("ALL")).toEqual(["user", "feedback", "project", "reference", "untyped"]);
  });

  it("rejects unknown names", () => {
    expect(parseMemoryTypes("user,secrets")).toBeNull();
  });
});

describe("harvestCommand", () => {
  const profilePath = join(home, ".you.md");

  function seedMemories() {
    memoryFile("-Users-me-frugal", "user_role.md", "- Works as a staff product manager");
    memoryFile("-Users-me-frugal", "feedback_deps.md", "- Never add a dependency without asking", { type: "feedback" });
    memoryFile("-Users-me-you-md", "user_tools.md", "- Prefers pnpm over npm");
    memoryFile("-Users-me-superpaste", "user_tools.md", "- Prefers pnpm over npm");
    memoryFile("-Users-me-superpaste", "project_release.md", "- Release 1.2 ships in October", { type: "project" });
  }

  it("creates ~/.you.md from Claude Code memories and reports what it did", async () => {
    seedMemories();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));

    const code = await harvestCommand([], {}, { home, env: {} });
    expect(code).toBe(0);

    const content = readFileSync(profilePath, "utf-8");
    expect(content).toContain("## What I Do\n\n- Works as a staff product manager");
    expect(content).toContain("## How I Work\n\n- Prefers pnpm over npm");
    expect(content).toContain("## Boundaries\n\n- Never add a dependency without asking");
    expect(content).not.toContain("Release 1.2");

    const output = logs.join("\n");
    expect(output).toContain("Scanned 3 Claude Code projects (5 memory files, types: user, feedback)");
    expect(output).toContain("Users-me-superpaste, Users-me-you-md");
    expect(output).toContain("Created the profile with 3 memories in ~/.you.md");
  });

  it("appends to an existing profile, backs it up, and is a no-op on the second run", async () => {
    seedMemories();
    writeFileSync(profilePath, EXISTING_PROFILE, "utf-8");
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await harvestCommand([], {}, { home, env: {} })).toBe(0);
    const once = readFileSync(profilePath, "utf-8");
    expect(once).toContain("Staff product manager at a developer platform company.");
    expect(once).toContain("- Prefer TypeScript in strict mode\n- Prefers pnpm over npm\n\n### Testing");
    expect(readFileSync(profilePath + ".backup", "utf-8")).toBe(EXISTING_PROFILE);

    expect(await harvestCommand([], {}, { home, env: {} })).toBe(0);
    expect(readFileSync(profilePath, "utf-8")).toBe(once);
  });

  it("writes nothing with --dry-run", async () => {
    seedMemories();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));

    expect(await harvestCommand([], { dryRun: true }, { home, env: {} })).toBe(0);
    expect(existsSync(profilePath)).toBe(false);
    expect(logs.join("\n")).toContain("Dry run: would create ~/.you.md. Nothing written.");
  });

  it("honors -o, --types, and --memory-dir", async () => {
    seedMemories();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const target = join(tempDir, "project", ".you.md");

    const code = await harvestCommand([], { output: target, types: "project" }, { home, env: {}, memoryDir: projects });
    expect(code).toBe(0);
    const content = readFileSync(target, "utf-8");
    expect(content).toContain("## What I'm Working On\n\n- Release 1.2 ships in October");
    expect(content).not.toContain("pnpm");
  });

  it("exits 1 with guidance when no memory directory exists", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
    rmSync(projects, { recursive: true, force: true });

    expect(await harvestCommand([], {}, { home, env: {} })).toBe(1);
    expect(errors.join("\n")).toContain("No Claude Code memory found.");
    expect(errors.join("\n")).toContain("--memory-dir");
  });

  it("rejects unknown sources and types", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await harvestCommand(["cursor"], {}, { home, env: {} })).toBe(1);
    expect(await harvestCommand([], { types: "nope" }, { home, env: {} })).toBe(1);
  });

  it("prints help", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
    expect(await harvestCommand(["help"], {}, { home, env: {} })).toBe(0);
    expect(logs.join("\n")).toContain("you-md harvest");
  });
});
