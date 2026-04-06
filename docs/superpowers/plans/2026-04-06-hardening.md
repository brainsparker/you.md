# Product Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the you.md product across 10 dimensions: safe config writes, proof-of-value check command, unified output format, consistent schema versions, parse timeout enforcement, MCP path validation, merge deduplication fix, CLI/MCP test coverage, profile migration, and section renaming.

**Architecture:** Each task is independent and can be worked in parallel. Tasks are ordered by risk: data-safety fixes first, then product gaps, then polish.

**Tech Stack:** TypeScript, Node.js 18+, Vitest, MCP SDK

---

## File Structure

### New files:
- `src/cli/commands/check.ts` — the `you-md check` command
- `test/cli/skill.test.ts` — tests for skill install/uninstall safety
- `test/cli/check.test.ts` — tests for the check command
- `test/cli/init.test.ts` — tests for init command
- `test/mcp/server.test.ts` — tests for MCP server tool handlers
- `test/core/merger.test.ts` — tests for merge deduplication

### Modified files:
- `src/cli/commands/skill.ts` — safe config reads/writes with backup
- `src/cli/args.ts` — add `check` command
- `src/cli/index.ts` — wire up check command
- `src/cli/wizard.ts` — output identity format instead of signal format
- `src/cli/templates/default.ts` — all templates use CURRENT_SCHEMA_VERSION
- `src/utils/constants.ts` — add "how i work", "where i'm headed", "boundaries" to KNOWN_SECTIONS
- `src/parser/index.ts` — enforce maxParseTime
- `src/mcp/server.ts` — validate paths in youmd_init
- `src/core/merger.ts` — fix subsection deduplication

---

### Task 1: Safe config reads in skill.ts

**Files:**
- Modify: `src/cli/commands/skill.ts:102-115`
- Test: `test/cli/skill.test.ts`

- [ ] **Step 1: Write failing test for corrupt JSON handling**

```typescript
// test/cli/skill.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We'll test the internal helpers by importing them
// First, we need to export them. For now, test via the public skillCommand.
// Actually, let's refactor skill.ts to export helpers for testability.

describe("skill installation safety", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `you-md-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true });
    }
  });

  describe("readJsonConfig", () => {
    it("returns empty object for non-existent file", async () => {
      const { readJsonConfig } = await import("../../src/cli/commands/skill.js");
      const result = await readJsonConfig(join(tempDir, "nope.json"));
      expect(result).toEqual({});
    });

    it("throws on corrupt JSON instead of returning empty object", async () => {
      const { readJsonConfig } = await import("../../src/cli/commands/skill.js");
      const path = join(tempDir, "bad.json");
      await writeFile(path, "{ this is not json }", "utf-8");
      await expect(readJsonConfig(path)).rejects.toThrow();
    });

    it("parses valid JSON correctly", async () => {
      const { readJsonConfig } = await import("../../src/cli/commands/skill.js");
      const path = join(tempDir, "good.json");
      await writeFile(path, JSON.stringify({ mcpServers: { foo: {} } }), "utf-8");
      const result = await readJsonConfig(path);
      expect(result).toEqual({ mcpServers: { foo: {} } });
    });
  });

  describe("writeJsonConfig", () => {
    it("creates backup before writing", async () => {
      const { writeJsonConfig } = await import("../../src/cli/commands/skill.js");
      const path = join(tempDir, "config.json");
      const original = { existing: "data" };
      await writeFile(path, JSON.stringify(original), "utf-8");

      await writeJsonConfig(path, { new: "data" });

      // Backup should exist
      expect(existsSync(path + ".backup")).toBe(true);
      const backup = JSON.parse(await readFile(path + ".backup", "utf-8"));
      expect(backup).toEqual(original);

      // New data should be written
      const written = JSON.parse(await readFile(path, "utf-8"));
      expect(written).toEqual({ new: "data" });
    });

    it("writes atomically via temp file", async () => {
      const { writeJsonConfig } = await import("../../src/cli/commands/skill.js");
      const path = join(tempDir, "atomic.json");
      await writeJsonConfig(path, { safe: true });
      const result = JSON.parse(await readFile(path, "utf-8"));
      expect(result).toEqual({ safe: true });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/skill.test.ts`
Expected: FAIL — `readJsonConfig` and `writeJsonConfig` are not exported, and behavior doesn't match

- [ ] **Step 3: Fix readJsonConfig to throw on corrupt JSON**

In `src/cli/commands/skill.ts`, replace lines 102-115:

```typescript
export async function readJsonConfig(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
  // No try-catch: corrupt JSON should throw, not silently return {}
}

export async function writeJsonConfig(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  
  // Backup existing file before overwriting
  if (existsSync(path)) {
    const existing = await readFile(path, "utf-8");
    await writeFile(path + ".backup", existing, "utf-8");
  }

  // Write to temp file first, then rename (atomic)
  const tmpPath = path + ".tmp";
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  const { rename } = await import("node:fs/promises");
  await rename(tmpPath, path);
}
```

Add `rename` to the imports at the top of the file:

```typescript
import { readFile, writeFile, mkdir, rename } from "node:fs/promises"
```

- [ ] **Step 4: Update installIntoTool to handle errors properly**

Replace lines 139-158 in `src/cli/commands/skill.ts`:

```typescript
async function installIntoTool(tool: ToolDef): Promise<"installed" | "already" | "error"> {
  try {
    const config = await readJsonConfig(tool.configPath);
    if (hasYouMdInstalled(config, tool)) return "already";

    // Navigate/create the nested key path and inject
    let cur: Record<string, unknown> = config;
    for (const k of tool.mcpKey.slice(0, -1)) {
      if (!(k in cur) || typeof cur[k] !== "object" || cur[k] === null) {
        cur[k] = {};
      }
      cur = cur[k] as Record<string, unknown>;
    }
    const finalKey = tool.mcpKey[tool.mcpKey.length - 1];
    if (!(finalKey in cur) || typeof cur[finalKey] !== "object" || cur[finalKey] === null) {
      cur[finalKey] = {};
    }
    (cur[finalKey] as Record<string, unknown>)["you-md"] = MCP_ENTRY;

    await writeJsonConfig(tool.configPath, config);
    return "installed";
  } catch (err) {
    // Log the actual error so users can debug
    if (err instanceof SyntaxError) {
      console.error(`  ⚠ ${tool.name}: config file contains invalid JSON: ${tool.configPath}`);
      console.error(`    Fix the JSON manually, or delete it and retry.`);
    }
    return "error";
  }
}
```

- [ ] **Step 5: Same fix for uninstallFromTool**

Replace lines 161-178:

```typescript
async function uninstallFromTool(tool: ToolDef): Promise<"removed" | "not-found" | "error"> {
  try {
    if (!existsSync(tool.configPath)) return "not-found";
    const config = await readJsonConfig(tool.configPath);
    if (!hasYouMdInstalled(config, tool)) return "not-found";

    let cur: Record<string, unknown> = config;
    for (const k of tool.mcpKey.slice(0, -1)) {
      if (typeof cur[k] !== "object" || cur[k] === null) return "not-found";
      cur = cur[k] as Record<string, unknown>;
    }
    const finalKey = tool.mcpKey[tool.mcpKey.length - 1];
    delete (cur[finalKey] as Record<string, unknown>)["you-md"];
    await writeJsonConfig(tool.configPath, config);
    return "removed";
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`  ⚠ ${tool.name}: config file contains invalid JSON: ${tool.configPath}`);
    }
    return "error";
  }
}
```

- [ ] **Step 6: Fix hasYouMdInstalled signature**

The function at line 129 takes `(config, tool.mcpKey)` but should take `(config, tool)`. It currently works because the second param is only used for `.mcpKey`, but let's fix the call sites to pass the full tool:

Line 142: change `hasYouMdInstalled(config, tool.mcpKey)` to `hasYouMdInstalled(config, tool)`
Line 165: same change

The function signature at line 129 already accepts `tool: ToolDef`, so no change needed there.

Wait — looking again at line 129, the signature IS `(config, tool: ToolDef)` but line 142 passes `tool.mcpKey`. Fix:

```typescript
// Line 142
if (hasYouMdInstalled(config, tool)) return "already"

// Line 165
if (!hasYouMdInstalled(config, tool)) return "not-found"
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run test/cli/skill.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/skill.ts test/cli/skill.test.ts
git commit -m "fix: make skill config reads/writes safe — backup, atomic write, no silent data loss"
```

---

### Task 2: Add `you-md check` command

**Files:**
- Create: `src/cli/commands/check.ts`
- Modify: `src/cli/args.ts:6-13, 64-125, 130-134, 139-179`
- Modify: `src/cli/index.ts:1-7, 16-45`
- Test: `test/cli/check.test.ts`

- [ ] **Step 1: Write failing test for check command**

```typescript
// test/cli/check.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("check command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `you-md-check-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true });
    }
  });

  it("reports no profile found when none exists", async () => {
    const { runCheck } = await import("../../src/cli/commands/check.js");
    const output: string[] = [];
    const result = await runCheck({
      searchPaths: [join(tempDir, ".you.md")],
      log: (msg: string) => output.push(msg),
    });
    expect(result.profileFound).toBe(false);
    expect(output.some(l => l.includes("No you.md"))).toBe(true);
  });

  it("reports profile found and valid", async () => {
    const { runCheck } = await import("../../src/cli/commands/check.js");
    const profilePath = join(tempDir, ".you.md");
    await writeFile(profilePath, `---\nschema_version: "1.1"\n---\n\n# Me\n\n## How I Think\nExpertise: expert\n`, "utf-8");

    const output: string[] = [];
    const result = await runCheck({
      searchPaths: [profilePath],
      log: (msg: string) => output.push(msg),
    });
    expect(result.profileFound).toBe(true);
    expect(result.profileValid).toBe(true);
  });

  it("reports validation errors for invalid profile", async () => {
    const { runCheck } = await import("../../src/cli/commands/check.js");
    const profilePath = join(tempDir, ".you.md");
    await writeFile(profilePath, `---\nauthor: "Test"\n---\n\n# Me\n`, "utf-8");

    const output: string[] = [];
    const result = await runCheck({
      searchPaths: [profilePath],
      log: (msg: string) => output.push(msg),
    });
    expect(result.profileFound).toBe(true);
    expect(result.profileValid).toBe(false);
  });

  it("checks which tools have the skill installed", async () => {
    const { runCheck } = await import("../../src/cli/commands/check.js");
    const profilePath = join(tempDir, ".you.md");
    await writeFile(profilePath, `---\nschema_version: "1.1"\n---\n\n# Me\n`, "utf-8");

    const output: string[] = [];
    const result = await runCheck({
      searchPaths: [profilePath],
      log: (msg: string) => output.push(msg),
    });
    expect(result).toHaveProperty("toolsInstalled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/check.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the check command**

```typescript
// src/cli/commands/check.ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { createParser } from "../../parser/index.js";
import type { CliFlags } from "../args.js";

interface CheckOptions {
  searchPaths?: string[];
  log?: (msg: string) => void;
}

interface CheckResult {
  profileFound: boolean;
  profilePath: string | null;
  profileValid: boolean;
  validationErrors: string[];
  validationWarnings: string[];
  sections: string[];
  toolsInstalled: Record<string, boolean>;
}

export async function runCheck(options?: CheckOptions): Promise<CheckResult> {
  const log = options?.log ?? console.log;
  const parser = createParser();

  const result: CheckResult = {
    profileFound: false,
    profilePath: null,
    profileValid: false,
    validationErrors: [],
    validationWarnings: [],
    sections: [],
    toolsInstalled: {},
  };

  // 1. Find profile
  const searchPaths = options?.searchPaths ?? [
    resolve(".you.md"),
    resolve("you.md"),
    resolve(homedir(), ".you.md"),
    resolve(homedir(), ".config", "you.md"),
  ];

  let foundPath: string | null = null;
  for (const p of searchPaths) {
    if (existsSync(p)) {
      foundPath = p;
      break;
    }
  }

  if (!foundPath) {
    log("");
    log("you.md check");
    log("─".repeat(40));
    log("");
    log("✗ No you.md file found");
    log("");
    log("  Checked:");
    for (const p of searchPaths) {
      log(`    ${p}`);
    }
    log("");
    log("  Create one: npx you-md init -i");
    return result;
  }

  result.profileFound = true;
  result.profilePath = foundPath;

  // 2. Parse and validate
  const parseResult = await parser.loadFromPath(foundPath);

  log("");
  log("you.md check");
  log("─".repeat(40));
  log("");
  log(`✓ Profile found: ${foundPath}`);

  if (!parseResult.success) {
    log(`✗ Parse errors:`);
    for (const err of parseResult.errors) {
      log(`    ${err.code}: ${err.message}`);
      result.validationErrors.push(`${err.code}: ${err.message}`);
    }
    return result;
  }

  const validation = parser.validate(parseResult.profile);

  if (validation.valid) {
    result.profileValid = true;
    log(`✓ Profile is valid (schema v${parseResult.profile.schemaVersion})`);
  } else {
    log(`✗ Validation errors:`);
    for (const err of validation.errors) {
      log(`    ${err.code}: ${err.message}`);
      result.validationErrors.push(`${err.code}: ${err.message}`);
    }
  }

  if (validation.warnings.length > 0) {
    for (const w of validation.warnings) {
      log(`  ⚠ ${w.code}: ${w.message}`);
      result.validationWarnings.push(`${w.code}: ${w.message}`);
    }
  }

  // 3. Summarize sections
  const sectionNames: string[] = [];
  for (const [, section] of parseResult.profile.sections) {
    sectionNames.push(section.title);
    for (const sub of section.subsections) {
      sectionNames.push(`  ${sub.title}`);
    }
  }
  result.sections = sectionNames;

  if (sectionNames.length > 0) {
    log("");
    log("Sections defined:");
    for (const name of sectionNames) {
      const indent = name.startsWith("  ") ? "      " : "    ";
      log(`${indent}${name.trim()}`);
    }
  }

  // 4. Check tool installations
  log("");
  log("Tool status:");

  const HOME = homedir();
  const IS_MAC = process.platform === "darwin";

  const tools = [
    {
      id: "claude-code",
      name: "Claude Code",
      configPath: resolve(HOME, ".claude", "claude_desktop_config.json"),
    },
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      configPath: IS_MAC
        ? resolve(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json")
        : resolve(HOME, ".config", "Claude", "claude_desktop_config.json"),
    },
    {
      id: "cursor",
      name: "Cursor",
      configPath: resolve(HOME, ".cursor", "mcp.json"),
    },
    {
      id: "windsurf",
      name: "Windsurf",
      configPath: resolve(HOME, ".codeium", "windsurf", "mcp_config.json"),
    },
  ];

  for (const tool of tools) {
    let installed = false;
    if (existsSync(tool.configPath)) {
      try {
        const { readFile } = await import("node:fs/promises");
        const raw = await readFile(tool.configPath, "utf-8");
        const config = JSON.parse(raw);
        installed = !!config?.mcpServers?.["you-md"];
      } catch {
        // corrupt config, treat as not installed
      }
    }
    result.toolsInstalled[tool.id] = installed;
    const icon = installed ? "✓" : "○";
    const label = installed ? "skill active" : "not installed";
    log(`    ${icon} ${tool.name.padEnd(18)} ${label}`);
  }

  const anyInstalled = Object.values(result.toolsInstalled).some(Boolean);
  if (!anyInstalled) {
    log("");
    log("  No tools have the skill installed.");
    log("  Run: npx you-md skill install");
  }

  log("");
  return result;
}

export async function checkCommand(_args: string[], _flags: CliFlags): Promise<number> {
  const result = await runCheck();
  return result.profileFound && result.profileValid ? 0 : 1;
}
```

- [ ] **Step 4: Wire up the check command in args.ts**

In `src/cli/args.ts`, add `"check"` to the Command type (line 6-13):

```typescript
export type Command =
  | "init"
  | "validate"
  | "merge"
  | "convert"
  | "skill"
  | "check"
  | "help"
  | "version";
```

Add `"check"` to the `isValidCommand` function (line 130-134):

```typescript
function isValidCommand(cmd: string): cmd is Command {
  return ["init", "validate", "merge", "convert", "skill", "check", "help", "version"].includes(cmd);
}
```

Add check to help text (line 139-179), after the `skill` line:

```
  check                    Verify your profile and tool installations
```

- [ ] **Step 5: Wire up in cli/index.ts**

Add import at top of `src/cli/index.ts`:

```typescript
import { checkCommand } from "./commands/check";
```

Add case in the switch (after `skill` case):

```typescript
    case "check":
      exitCode = await checkCommand(args.args, args.flags);
      break;
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run test/cli/check.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/check.ts src/cli/args.ts src/cli/index.ts test/cli/check.test.ts
git commit -m "feat: add 'you-md check' command — verify profile, validation, and tool installations"
```

---

### Task 3: Unify wizard output to identity format

**Files:**
- Modify: `src/cli/wizard.ts:139-211`
- Test: `test/cli/wizard.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/cli/wizard.test.ts
import { describe, it, expect } from "vitest";
import { generateFromAnswers, WizardAnswers } from "../../src/cli/wizard.js";

const sampleAnswers: WizardAnswers = {
  topics: ["distributed systems", "machine learning"],
  expertise: "expert",
  searchDepth: "deep",
  preferredSources: ["official_docs", "academic"],
  freshnessVsAuthority: "authoritative",
  visualPreference: "low",
  factChecking: "strict",
  verbosity: "concise",
};

describe("generateFromAnswers", () => {
  it("produces identity format with # Me heading", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain("# Me");
  });

  it("includes How I Think section with expertise", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain("## How I Think");
    expect(output).toContain("Expertise: expert");
  });

  it("includes How I Communicate section with verbosity", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain("## How I Communicate");
    expect(output).toContain("Verbosity: concise");
  });

  it("includes What I Trust section", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain("## What I Trust");
    expect(output).toContain("official documentation");
  });

  it("includes What I'm Into section with topics", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain("## What I'm Into");
    expect(output).toContain("distributed systems");
  });

  it("does NOT produce signal-style snake_case fields", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).not.toContain("search_depth:");
    expect(output).not.toContain("expertise_level:");
    expect(output).not.toContain("freshness_weight:");
    expect(output).not.toContain("visual_preference:");
    expect(output).not.toContain("long_form_preference:");
    expect(output).not.toContain("preferred_sources:");
  });

  it("uses schema version 1.1", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain('schema_version: "1.1"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/wizard.test.ts`
Expected: FAIL — current output uses snake_case signal format

- [ ] **Step 3: Rewrite generateFromAnswers to produce identity format**

Replace `generateFromAnswers` in `src/cli/wizard.ts` (lines 139-211):

```typescript
export function generateFromAnswers(answers: WizardAnswers): string {
  const today = new Date().toISOString().split("T")[0];

  // Map source values to readable names
  const sourceLabels: Record<string, string> = {
    official_docs: "official documentation",
    academic: "academic papers",
    blogs: "blog posts",
    forums: "Stack Overflow, forums",
    news: "news articles",
    video: "video content",
  };

  const sources = answers.preferredSources
    .map(s => sourceLabels[s] || s)
    .join(", ");

  const topics = answers.topics
    .map(t => t.trim())
    .filter(Boolean)
    .join(", ");

  // Map depth preference
  const depthLabels: Record<string, string> = {
    quick: "quick answers",
    moderate: "balanced",
    deep: "long-form analysis",
  };

  // Map visual preference
  const visualLabels: Record<string, string> = {
    low: "minimal",
    moderate: "some, when helpful",
    high: "yes, prefer visual content",
  };

  // Map freshness
  const freshnessLabels: Record<string, string> = {
    fresh: "prefer recent over established",
    balanced: "mix of new and established",
    authoritative: "prefer established, authoritative",
  };

  return `---
schema_version: "${CURRENT_SCHEMA_VERSION}"
created: "${today}"
last_updated: "${today}"
privacy_level: "private"
---

# Me

## How I Think

Expertise: ${answers.expertise}
Depth preference: ${depthLabels[answers.searchDepth] || "balanced"}
Freshness preference: ${freshnessLabels[answers.freshnessVsAuthority] || "balanced"}

## How I Communicate

Verbosity: ${answers.verbosity}
Tone: direct
Explanations: ${answers.expertise === "expert" ? "only when asked" : "when helpful"}

## What I Trust

Trusted sources: ${sources || "official documentation"}
Fact-checking: ${answers.factChecking}

## What I'm Into

Topics: ${topics || ""}
Content depth: ${depthLabels[answers.searchDepth] || "balanced"}
Visual content: ${visualLabels[answers.visualPreference] || "minimal"}

## Don't

- Over-explain things I already know
- Use excessive caveats or hedging
`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/cli/wizard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/wizard.ts test/cli/wizard.test.ts
git commit -m "fix: wizard now outputs identity format instead of signal format"
```

---

### Task 4: Consistent schema versions across all templates

**Files:**
- Modify: `src/cli/templates/default.ts:77-78, 160-161, 187-188`
- Test: `test/cli/templates.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/cli/templates.test.ts
import { describe, it, expect } from "vitest";
import {
  getIdentityTemplate,
  getDeveloperTemplate,
  getMinimalTemplate,
  getPersonalizationTemplate,
} from "../../src/cli/templates/default.js";
import { CURRENT_SCHEMA_VERSION } from "../../src/utils/constants.js";

describe("templates use current schema version", () => {
  it("identity template uses CURRENT_SCHEMA_VERSION", () => {
    const t = getIdentityTemplate();
    expect(t).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  });

  it("developer template uses CURRENT_SCHEMA_VERSION", () => {
    const t = getDeveloperTemplate();
    expect(t).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  });

  it("minimal template uses CURRENT_SCHEMA_VERSION", () => {
    const t = getMinimalTemplate();
    expect(t).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  });

  it("personalization template uses CURRENT_SCHEMA_VERSION", () => {
    const t = getPersonalizationTemplate();
    expect(t).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/templates.test.ts`
Expected: FAIL — developer, minimal, personalization use "1.0"

- [ ] **Step 3: Update templates to import and use CURRENT_SCHEMA_VERSION**

Add import at top of `src/cli/templates/default.ts`:

```typescript
import { CURRENT_SCHEMA_VERSION } from "../../utils/constants.js";
```

Replace hardcoded `"1.0"` in all three templates:

Line 78: `schema_version: "1.0"` → `schema_version: "${CURRENT_SCHEMA_VERSION}"`
Line 161: `schema_version: "1.0"` → `schema_version: "${CURRENT_SCHEMA_VERSION}"`
Line 188: `schema_version: "1.0"` → `schema_version: "${CURRENT_SCHEMA_VERSION}"`

Also update the identity template line 9 to use the variable (it's currently hardcoded to "1.1" which happens to match but should use the constant):

Line 9: `schema_version: "1.1"` → `schema_version: "${CURRENT_SCHEMA_VERSION}"`

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/cli/templates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/templates/default.ts test/cli/templates.test.ts
git commit -m "fix: all templates use CURRENT_SCHEMA_VERSION instead of hardcoded values"
```

---

### Task 5: Enforce parse timeout

**Files:**
- Modify: `src/parser/index.ts:40-59`
- Test: `test/parser/timeout.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/parser/timeout.test.ts
import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser/index.js";

describe("parse timeout enforcement", () => {
  it("accepts maxParseTime option", () => {
    const parser = createParser();
    // A normal parse should succeed within any reasonable timeout
    const result = parser.parse(`---\nschema_version: "1.1"\n---\n\n# Me\n`, {
      maxParseTime: 5000,
    });
    expect(result.success).toBe(true);
  });

  it("returns error when parse exceeds maxParseTime", () => {
    const parser = createParser();
    // Generate a large-ish content that takes time
    // We'll use a very small timeout to force the failure
    const bigContent = `---\nschema_version: "1.1"\n---\n\n` +
      Array.from({ length: 5000 }, (_, i) => `## Section ${i}\nfield_${i}: value_${i}`).join("\n\n");

    const result = parser.parse(bigContent, { maxParseTime: 0 });
    // With a 0ms timeout, it should fail
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.code === "PARSE_TIMEOUT")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/parser/timeout.test.ts`
Expected: FAIL — `PARSE_TIMEOUT` error code never produced

- [ ] **Step 3: Add timeout enforcement to parse method**

In `src/parser/index.ts`, modify the `parse` method. After the size check (line 59), add:

```typescript
    // Check parse timeout
    const maxParseTime = options?.maxParseTime ?? undefined;
    const parseStart = maxParseTime !== undefined ? Date.now() : 0;
```

Then after frontmatter extraction (after line 70), add a check:

```typescript
    if (maxParseTime !== undefined && Date.now() - parseStart > maxParseTime) {
      errors.push({
        code: "PARSE_TIMEOUT",
        message: `Parse exceeded timeout of ${maxParseTime}ms`,
      });
      return { profile: createEmptyProfile(), success: false, errors, warnings };
    }
```

And after YAML parsing (after line 96), add the same check:

```typescript
    if (maxParseTime !== undefined && Date.now() - parseStart > maxParseTime) {
      errors.push({
        code: "PARSE_TIMEOUT",
        message: `Parse exceeded timeout of ${maxParseTime}ms`,
      });
      return { profile: createEmptyProfile(), success: false, errors, warnings };
    }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/parser/timeout.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing tests to ensure no regressions**

Run: `npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/parser/index.ts test/parser/timeout.test.ts
git commit -m "fix: enforce maxParseTime option in parser — prevents hanging on malicious input"
```

---

### Task 6: Validate paths in MCP server youmd_init

**Files:**
- Modify: `src/mcp/server.ts:248-274`
- Test: `test/mcp/server.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/mcp/server.test.ts
import { describe, it, expect } from "vitest";
import { isPathSafe } from "../../src/mcp/server.js";
import { homedir } from "node:os";
import { resolve } from "node:path";

describe("MCP path validation", () => {
  it("allows paths under home directory", () => {
    expect(isPathSafe(resolve(homedir(), ".you.md"))).toBe(true);
    expect(isPathSafe(resolve(homedir(), "projects", ".you.md"))).toBe(true);
  });

  it("allows paths under cwd", () => {
    expect(isPathSafe(resolve(process.cwd(), ".you.md"))).toBe(true);
    expect(isPathSafe(resolve(process.cwd(), "sub", ".you.md"))).toBe(true);
  });

  it("rejects paths outside home and cwd", () => {
    expect(isPathSafe("/etc/passwd")).toBe(false);
    expect(isPathSafe("/tmp/evil.md")).toBe(false);
    expect(isPathSafe("/usr/local/bin/something")).toBe(false);
  });

  it("rejects paths with directory traversal", () => {
    expect(isPathSafe(resolve(homedir(), "..", "etc", "passwd"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp/server.test.ts`
Expected: FAIL — `isPathSafe` not exported

- [ ] **Step 3: Add path validation and apply to youmd_init**

Add this function to `src/mcp/server.ts`, before the `createMcpServer` function:

```typescript
/**
 * Check if a path is safe for writing — must be under home dir or cwd
 */
export function isPathSafe(targetPath: string): boolean {
  const resolved = resolve(targetPath);
  const home = homedir();
  const cwd = process.cwd();
  return resolved.startsWith(home + "/") || resolved === home ||
         resolved.startsWith(cwd + "/") || resolved === cwd;
}
```

Then modify the `youmd_init` handler (around line 248-274) to validate the path:

```typescript
    if (name === "youmd_init") {
      const path = (args?.path as string) || resolve(homedir(), ".you.md");
      const force = args?.force as boolean;

      // Validate path is safe
      if (!isPathSafe(path)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Refused: path "${path}" is outside your home directory and current working directory. Provide a path under ~ or the project root.`,
            },
          ],
        };
      }

      if (existsSync(path) && !force) {
```

(rest of handler unchanged)

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/mcp/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts test/mcp/server.test.ts
git commit -m "fix: validate paths in MCP youmd_init — reject writes outside home/cwd"
```

---

### Task 7: Fix merge subsection deduplication

**Files:**
- Modify: `src/core/merger.ts:172-209`
- Test: `test/core/merger.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/core/merger.test.ts
import { describe, it, expect } from "vitest";
import { mergeProfiles } from "../../src/core/merger.js";
import type { YouMdProfile, YouMdSection } from "../../src/types/profile.js";

function makeSection(title: string, content: string, subsections: YouMdSection[] = []): YouMdSection {
  return {
    title,
    normalizedTitle: title.toLowerCase(),
    level: 2,
    content,
    fields: new Map(),
    subsections,
  };
}

function makeProfile(sections: [string, YouMdSection][]): YouMdProfile {
  return {
    schemaVersion: "1.1",
    metadata: { schemaVersion: "1.1" },
    sections: new Map(sections),
    rawContent: "",
  };
}

describe("mergeProfiles subsection deduplication", () => {
  it("does not produce duplicate subsections after merge", () => {
    const baseSub = makeSection("Testing", "unit tests preferred");
    const overrideSub = makeSection("Testing", "integration tests required");

    const base = makeProfile([
      ["how i work", makeSection("How I Work", "", [
        baseSub,
        makeSection("Docs", "write docs"),
      ])],
    ]);

    const override = makeProfile([
      ["how i work", makeSection("How I Work", "", [
        overrideSub,
      ])],
    ]);

    const merged = mergeProfiles([base, override]);
    const howIWork = merged.sections.get("how i work");
    expect(howIWork).toBeDefined();

    const subTitles = howIWork!.subsections.map(s => s.normalizedTitle);
    // "testing" should appear exactly once (merged), "docs" once (from base only)
    const testingCount = subTitles.filter(t => t === "testing").length;
    expect(testingCount).toBe(1);
    expect(subTitles).toContain("docs");
  });

  it("override subsection content wins", () => {
    const base = makeProfile([
      ["me", makeSection("Me", "", [
        makeSection("Style", "base style"),
      ])],
    ]);
    const override = makeProfile([
      ["me", makeSection("Me", "", [
        makeSection("Style", "override style"),
      ])],
    ]);

    const merged = mergeProfiles([base, override]);
    const me = merged.sections.get("me");
    const style = me!.subsections.find(s => s.normalizedTitle === "style");
    expect(style!.content).toBe("override style");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/merger.test.ts`
Expected: FAIL — duplicate "testing" subsection (count is 2, not 1)

Wait — looking at the code again at lines 172-209, the logic actually looks correct. Let me re-read:

1. Creates `baseMap` from base subsections (line 178-181)
2. Iterates override subsections, checks if base has a match (line 187-199)
3. Adds unprocessed base sections (line 202-206)

The `processed` set tracks which normalized titles were in the override. Base sections NOT in override get appended. This should work correctly.

Let me re-check... Actually, the issue I originally identified was wrong. The code is correct. The `processed` set prevents duplicates. Let me revise this task to just be a test that confirms the existing behavior is correct (regression test).

- [ ] **Step 2 (revised): Run test to verify it passes**

Run: `npx vitest run test/core/merger.test.ts`
Expected: PASS — the merger logic is actually correct upon closer inspection

- [ ] **Step 3: Commit the regression test**

```bash
git add test/core/merger.test.ts
git commit -m "test: add regression tests for merge subsection deduplication"
```

---

### Task 8: Add "How I Work", "Where I'm Headed", "Boundaries" to known sections

**Files:**
- Modify: `src/utils/constants.ts:59-108`
- Test: `test/core/validator.test.ts` (extend)

- [ ] **Step 1: Write failing test**

```typescript
// Append to test/core/validator.test.ts — or create a new focused test

// test/core/known-sections.test.ts
import { describe, it, expect } from "vitest";
import { KNOWN_SECTIONS } from "../../src/utils/constants.js";

describe("known sections include new section names", () => {
  it("recognizes 'how i work'", () => {
    expect(KNOWN_SECTIONS).toContain("how i work");
  });

  it("recognizes 'where i'm headed'", () => {
    expect(KNOWN_SECTIONS).toContain("where i'm headed");
  });

  it("recognizes 'where im headed'", () => {
    expect(KNOWN_SECTIONS).toContain("where im headed");
  });

  it("recognizes 'boundaries'", () => {
    expect(KNOWN_SECTIONS).toContain("boundaries");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/known-sections.test.ts`
Expected: FAIL

- [ ] **Step 3: Add the new sections to KNOWN_SECTIONS**

In `src/utils/constants.ts`, add after line 67 (`"context",`):

```typescript
  "how i work",
  "where i'm headed",
  "where im headed",
  "boundaries",
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/core/known-sections.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests for regressions**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/constants.ts test/core/known-sections.test.ts
git commit -m "feat: add 'How I Work', 'Where I'm Headed', 'Boundaries' to known sections"
```

---

### Task 9: Rename "Don't" to "Boundaries" in templates

**Files:**
- Modify: `src/cli/templates/default.ts` — all template functions
- Modify: `src/cli/wizard.ts` — wizard output
- Test: `test/cli/templates.test.ts` (extend)

- [ ] **Step 1: Write failing test**

Add to `test/cli/templates.test.ts`:

```typescript
describe("templates use Boundaries instead of Don't", () => {
  it("identity template uses Boundaries", () => {
    const t = getIdentityTemplate();
    expect(t).toContain("## Boundaries");
    expect(t).not.toContain("## Don't");
  });

  it("developer template uses Boundaries", () => {
    const t = getDeveloperTemplate();
    expect(t).toContain("## Boundaries");
    expect(t).not.toContain("## Don't");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/templates.test.ts`
Expected: FAIL

- [ ] **Step 3: Replace "Don't" with "Boundaries" in templates**

In `src/cli/templates/default.ts`:

Line 55-60 (identity template):
```typescript
## Boundaries

<!-- Things you want AI to avoid -->
- Over-explain things I already know
- Use excessive caveats or hedging
- Assume I need hand-holding
```

Line 143-150 (developer template):
```typescript
## Boundaries

<!-- Things you don't want AI assistants to do -->
- Add verbose explanations unless asked
- Suggest obvious refactors
- Create god objects or deep inheritance
- Ignore error cases
```

In `src/cli/wizard.ts`, in the updated `generateFromAnswers` function, change the last section:

```typescript
## Boundaries

- Over-explain things I already know
- Use excessive caveats or hedging
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/cli/templates.test.ts test/cli/wizard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/templates/default.ts src/cli/wizard.ts test/cli/templates.test.ts
git commit -m "refactor: rename 'Don't' section to 'Boundaries' — frames preferences positively"
```

---

### Task 10: Add MCP server tool handler tests

**Files:**
- Extend: `test/mcp/server.test.ts`

- [ ] **Step 1: Add tests for MCP tool handlers**

Append to `test/mcp/server.test.ts`:

```typescript
import { createMcpServer } from "../../src/mcp/server.js";

describe("MCP server tools", () => {
  it("creates server with expected tools", async () => {
    const server = await createMcpServer();
    expect(server).toBeDefined();
    // Server was created without throwing
  });
});
```

Note: Full MCP handler testing requires mocking the transport layer, which is complex. For now we test the path validation (Task 6) and server creation. Deeper integration tests can be added later with a mock transport.

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/mcp/server.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/mcp/server.test.ts
git commit -m "test: add MCP server creation and path validation tests"
```

---

### Task 11: Final integration test and cleanup

**Files:**
- No new files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No type errors

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final cleanup after hardening pass"
```
