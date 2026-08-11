import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  runExport,
  renderProfileBody,
  getExportTarget,
  EXPORT_TARGETS,
} from "../../src/cli/commands/export";
import { createParser } from "../../src/parser";

const tempDir = join(tmpdir(), `you-md-export-test-${Date.now()}`);

const VALID_PROFILE = `---
schema_version: "1.1"
author: "Test Dev"
---

# Me

I am a TypeScript developer who prefers small, well-tested changes.

## Technical Preferences

- TypeScript strict mode
- Vitest for tests

### Naming

Use camelCase for variables.

## Communication Style

Concise. No hype.
`;

const PRIVATE_PROFILE = `---
schema_version: "1.1"
privacy_level: "private"
---

# Me

Private details here.
`;

describe("runExport", () => {
  let profilePath: string;

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
    profilePath = join(tempDir, ".you.md");
    writeFileSync(profilePath, VALID_PROFILE, "utf-8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("defaults to the agents target and returns content for stdout", async () => {
    const result = await runExport({ profilePath });

    expect(result.ok).toBe(true);
    expect(result.target).toBe("agents");
    expect(result.writtenPath).toBeNull();
    expect(result.content).toContain("Generated from you.md by `you-md export agents`");
    expect(result.content).toContain("# Working with this developer");
    expect(result.content).toContain("## Technical Preferences");
    expect(result.content).toContain("### Naming");
    expect(result.content).toContain("Developer: Test Dev");
  });

  it("renders every export target with its own header", async () => {
    for (const target of EXPORT_TARGETS) {
      const result = await runExport({ profilePath, target: target.id });
      expect(result.ok).toBe(true);
      expect(result.content).toContain(`you-md export ${target.id}`);
    }
  });

  it("includes the AGENTS.md drift tip for the claude target", async () => {
    const result = await runExport({ profilePath, target: "claude" });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("@AGENTS.md");
  });

  it("rejects unknown targets with the supported list", async () => {
    const result = await runExport({ profilePath, target: "nonsense" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown export target: nonsense");
    expect(result.error).toContain("agents");
  });

  it("errors when no profile can be found", async () => {
    const result = await runExport({
      profilePath: join(tempDir, "does-not-exist.md"),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No you.md profile found");
  });

  it("writes the file when outputPath is given", async () => {
    const outPath = join(tempDir, "AGENTS.md");
    const logs: string[] = [];
    const result = await runExport({
      profilePath,
      outputPath: outPath,
      log: (msg) => logs.push(msg),
    });

    expect(result.ok).toBe(true);
    expect(result.writtenPath).toBe(outPath);
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, "utf-8")).toContain("## Communication Style");
    expect(logs.some((l) => l.includes("Exported"))).toBe(true);
  });

  it("creates parent directories for nested outputs like .github", async () => {
    const outPath = join(tempDir, ".github", "copilot-instructions.md");
    const result = await runExport({
      profilePath,
      target: "copilot",
      outputPath: outPath,
    });

    expect(result.ok).toBe(true);
    expect(existsSync(outPath)).toBe(true);
  });

  it("refuses to overwrite an existing file without force", async () => {
    const outPath = join(tempDir, "AGENTS.md");
    writeFileSync(outPath, "existing content", "utf-8");

    const result = await runExport({ profilePath, outputPath: outPath });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("already exists");
    expect(readFileSync(outPath, "utf-8")).toBe("existing content");
  });

  it("overwrites an existing file with force", async () => {
    const outPath = join(tempDir, "AGENTS.md");
    writeFileSync(outPath, "existing content", "utf-8");

    const result = await runExport({ profilePath, outputPath: outPath, force: true });

    expect(result.ok).toBe(true);
    expect(readFileSync(outPath, "utf-8")).toContain("# Working with this developer");
  });

  it("warns when writing a file from a private profile", async () => {
    writeFileSync(profilePath, PRIVATE_PROFILE, "utf-8");
    const warnings: string[] = [];
    const outPath = join(tempDir, "AGENTS.md");

    const result = await runExport({
      profilePath,
      outputPath: outPath,
      warn: (msg) => warnings.push(msg),
    });

    expect(result.ok).toBe(true);
    expect(warnings.some((w) => w.includes("privacy_level: private"))).toBe(true);
  });

  it("does not warn about privacy when printing to stdout", async () => {
    writeFileSync(profilePath, PRIVATE_PROFILE, "utf-8");
    const warnings: string[] = [];

    const result = await runExport({
      profilePath,
      warn: (msg) => warnings.push(msg),
    });

    expect(result.ok).toBe(true);
    expect(warnings).toHaveLength(0);
  });
});

describe("renderProfileBody", () => {
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("preserves section order and subsections", async () => {
    mkdirSync(tempDir, { recursive: true });
    const profilePath = join(tempDir, ".you.md");
    writeFileSync(profilePath, VALID_PROFILE, "utf-8");

    const parser = createParser();
    const result = await parser.loadFromPath(profilePath);
    expect(result.success).toBe(true);

    const body = renderProfileBody(result.profile);
    const techIndex = body.indexOf("## Technical Preferences");
    const namingIndex = body.indexOf("### Naming");
    const commIndex = body.indexOf("## Communication Style");

    expect(techIndex).toBeGreaterThan(-1);
    expect(namingIndex).toBeGreaterThan(techIndex);
    expect(commIndex).toBeGreaterThan(namingIndex);
  });
});

describe("getExportTarget", () => {
  it("resolves known targets and rejects unknown ones", () => {
    expect(getExportTarget("agents")?.defaultFilename).toBe("AGENTS.md");
    expect(getExportTarget("claude")?.defaultFilename).toBe("CLAUDE.md");
    expect(getExportTarget("gemini")?.defaultFilename).toBe("GEMINI.md");
    expect(getExportTarget("copilot")?.defaultFilename).toBe(
      ".github/copilot-instructions.md"
    );
    expect(getExportTarget("unknown")).toBeUndefined();
  });
});
