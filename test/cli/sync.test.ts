import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  buildManagedBlock,
  exportToTarget,
  resolveTargetPath,
  ensureClaudeBridge,
  claudeBridgePath,
  exportCommand,
  EXPORT_TARGETS,
  BEGIN_MARKER,
  type ExportTarget,
} from "../../src/cli/commands/export";
import { extractManagedBlock, detectSyncStatus, syncCommand } from "../../src/cli/commands/sync";

const tempDir = join(tmpdir(), `you-md-sync-test-${Date.now()}`);
const home = join(tempDir, "home");
const cwd = join(tempDir, "project");
const paths = { home, cwd };

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

describe("extractManagedBlock", () => {
  it("returns the managed block including markers", () => {
    const block = buildManagedBlock("# Prefs\n\nBe concise.");
    const file = "# Mine\n\n" + block + "\n\n# Also mine\n";
    expect(extractManagedBlock(file)).toBe(block);
  });

  it("returns null when there is no complete block", () => {
    expect(extractManagedBlock("no markers here")).toBeNull();
    expect(extractManagedBlock(BEGIN_MARKER + "\nunclosed")).toBeNull();
  });
});

describe("detectSyncStatus", () => {
  const fresh = buildManagedBlock("# Prefs\n\nversion two");

  it("reports missing when the file does not exist", () => {
    expect(detectSyncStatus(null, fresh, "managed-block")).toBe("missing");
  });

  it("reports unmanaged when the file has no markers", () => {
    expect(detectSyncStatus("# Someone else's file\n", fresh, "managed-block")).toBe("unmanaged");
  });

  it("reports in-sync when the managed block matches", () => {
    const file = "# Mine\n\n" + fresh + "\n";
    expect(detectSyncStatus(file, fresh, "managed-block")).toBe("in-sync");
  });

  it("reports stale when the managed block differs", () => {
    const old = buildManagedBlock("# Prefs\n\nversion one");
    const file = "# Mine\n\n" + old + "\n";
    expect(detectSyncStatus(file, fresh, "managed-block")).toBe("stale");
  });

  it("compares the whole file for own-file targets", () => {
    const rendered = "---\nfull file\n---\n";
    expect(detectSyncStatus(rendered, rendered, "own-file")).toBe("in-sync");
    expect(detectSyncStatus("something else", rendered, "own-file")).toBe("stale");
  });
});

describe("stale export round trip", () => {
  it("export refreshes a stale managed block detected by detectSyncStatus", async () => {
    const t = target("agents");
    await exportToTarget(t, "version one", paths);
    const path = resolveTargetPath(t, paths);

    const freshTwo = buildManagedBlock(t.render("version two"));
    expect(detectSyncStatus(readFileSync(path, "utf-8"), freshTwo, t.mode)).toBe("stale");

    await exportToTarget(t, "version two", paths);
    expect(detectSyncStatus(readFileSync(path, "utf-8"), freshTwo, t.mode)).toBe("in-sync");
    expect(readFileSync(path, "utf-8")).not.toContain("version one");
  });
});

describe("ensureClaudeBridge", () => {
  it("creates a project CLAUDE.md with the @AGENTS.md import", async () => {
    const result = await ensureClaudeBridge(paths);
    expect(result.action).toBe("created");
    expect(result.path).toBe(claudeBridgePath(paths));

    const content = readFileSync(result.path, "utf-8");
    expect(content).toContain("@AGENTS.md");
    expect(content).toContain(BEGIN_MARKER);
  });

  it("appends the bridge to an existing CLAUDE.md without touching user content", async () => {
    const path = claudeBridgePath(paths);
    writeFileSync(path, "# Project notes\n\nKeep these.\n");

    const result = await ensureClaudeBridge(paths);
    expect(result.action).toBe("updated");

    const content = readFileSync(path, "utf-8");
    expect(content).toContain("Keep these.");
    expect(content).toContain("@AGENTS.md");
    expect(existsSync(path + ".backup")).toBe(true);
  });

  it("is a no-op when CLAUDE.md already imports AGENTS.md", async () => {
    const path = claudeBridgePath(paths);
    writeFileSync(path, "# Notes\n\n@AGENTS.md\n");

    const result = await ensureClaudeBridge(paths);
    expect(result.action).toBe("none");
    expect(readFileSync(path, "utf-8")).toBe("# Notes\n\n@AGENTS.md\n");
    expect(existsSync(path + ".backup")).toBe(false);
  });

  it("is idempotent: a second run after creating changes nothing", async () => {
    await ensureClaudeBridge(paths);
    const first = readFileSync(claudeBridgePath(paths), "utf-8");

    const second = await ensureClaudeBridge(paths);
    expect(second.action).toBe("none");
    expect(readFileSync(claudeBridgePath(paths), "utf-8")).toBe(first);
  });
});

describe("syncCommand end to end", () => {
  const PROFILE_V1 =
    '---\nschema_version: "1.1"\n---\n\n# you.md\n\n## About Me\n\nVersion one of me.\n';
  const PROFILE_V2 =
    '---\nschema_version: "1.1"\n---\n\n# you.md\n\n## About Me\n\nVersion two of me.\n';

  it("detects drift with --check, repairs with sync, then passes --check", async () => {
    writeFileSync(join(cwd, ".you.md"), PROFILE_V1);

    const prevCwd = process.cwd();
    const prevHome = process.env.HOME;
    process.chdir(cwd);
    process.env.HOME = home;
    try {
      // Export the project AGENTS.md, which also bridges CLAUDE.md
      const code = await exportCommand(["agents"], { quiet: true }, paths);
      expect(code).toBe(0);
      expect(existsSync(join(cwd, "AGENTS.md"))).toBe(true);
      expect(readFileSync(join(cwd, "CLAUDE.md"), "utf-8")).toContain("@AGENTS.md");

      // Edit the profile: exported files are now stale
      writeFileSync(join(cwd, ".you.md"), PROFILE_V2);

      expect(await syncCommand([], { quiet: true, check: true }, paths)).toBe(1);
      expect(await syncCommand([], { quiet: true }, paths)).toBe(0);
      expect(readFileSync(join(cwd, "AGENTS.md"), "utf-8")).toContain("Version two");
      expect(await syncCommand([], { quiet: true, check: true }, paths)).toBe(0);
    } finally {
      process.chdir(prevCwd);
      process.env.HOME = prevHome;
    }
  });

  it("never creates files for targets that were not exported", async () => {
    writeFileSync(join(cwd, ".you.md"), PROFILE_V1);

    const prevCwd = process.cwd();
    const prevHome = process.env.HOME;
    process.chdir(cwd);
    process.env.HOME = home;
    try {
      const code = await syncCommand([], { quiet: true }, paths);
      expect(code).toBe(0);
      for (const target of EXPORT_TARGETS) {
        expect(existsSync(resolveTargetPath(target, paths))).toBe(false);
      }
    } finally {
      process.chdir(prevCwd);
      process.env.HOME = prevHome;
    }
  });
});
