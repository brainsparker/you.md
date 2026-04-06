import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runCheck } from "../../src/cli/commands/check";

const tempDir = join(tmpdir(), `you-md-check-test-${Date.now()}`);

describe("runCheck", () => {
  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns profileFound: false when no profile exists", async () => {
    const logs: string[] = [];
    const result = await runCheck({
      searchPaths: [join(tempDir, ".you.md"), join(tempDir, "you.md")],
      log: (msg) => logs.push(msg),
    });

    expect(result.profileFound).toBe(false);
    expect(result.profilePath).toBeNull();
    expect(result.profileValid).toBe(false);
    expect(logs.some((l) => l.includes("not found"))).toBe(true);
    expect(logs.some((l) => l.includes("npx you-md init -i"))).toBe(true);
  });

  it("returns profileFound: true and profileValid: true for a valid profile", async () => {
    const profilePath = join(tempDir, ".you.md");
    writeFileSync(
      profilePath,
      `---
schema_version: "1.1"
---

# Me

I am a developer.

## How I Think

I think carefully.
`,
      "utf-8"
    );

    const logs: string[] = [];
    const result = await runCheck({
      searchPaths: [profilePath],
      log: (msg) => logs.push(msg),
    });

    expect(result.profileFound).toBe(true);
    expect(result.profilePath).toBe(profilePath);
    expect(result.profileValid).toBe(true);
    expect(result.validationErrors).toHaveLength(0);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections).toContain("Me");
    expect(result.sections).toContain("How I Think");
  });

  it("returns profileFound: true, profileValid: false for missing schema_version", async () => {
    const profilePath = join(tempDir, "you.md");
    writeFileSync(
      profilePath,
      `# Me

Just some markdown with no frontmatter.
`,
      "utf-8"
    );

    const logs: string[] = [];
    const result = await runCheck({
      searchPaths: [profilePath],
      log: (msg) => logs.push(msg),
    });

    expect(result.profileFound).toBe(true);
    expect(result.profilePath).toBe(profilePath);
    expect(result.profileValid).toBe(false);
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it("has toolsInstalled property in result", async () => {
    const profilePath = join(tempDir, ".you.md");
    writeFileSync(
      profilePath,
      `---
schema_version: "1.1"
---

# Me

Hello.
`,
      "utf-8"
    );

    const logs: string[] = [];
    const result = await runCheck({
      searchPaths: [profilePath],
      log: (msg) => logs.push(msg),
    });

    expect(result).toHaveProperty("toolsInstalled");
    expect(typeof result.toolsInstalled).toBe("object");
  });
});
