import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  auditInstructionFiles,
  projectDirectories,
  renderInstructionAudit,
  displayPath,
  formatBytes,
  CODEX_DEFAULT_DOC_MAX_BYTES,
  CLAUDE_RECOMMENDED_MAX_LINES,
  type InstructionAudit,
} from "../../src/cli/commands/instructions";
import { buildManagedBlock, ensureClaudeBridge, exportToTarget, EXPORT_TARGETS } from "../../src/cli/commands/export";
import { runCheck } from "../../src/cli/commands/check";

const tempDir = join(tmpdir(), `you-md-instructions-test-${Date.now()}`);
const home = join(tempDir, "home");
const root = join(tempDir, "project");
const paths = { home, cwd: root };

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function codes(audit: InstructionAudit): string[] {
  return audit.findings.map(f => f.code);
}

beforeEach(() => {
  mkdirSync(home, { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("projectDirectories", () => {
  it("walks from cwd up to the directory holding .git, inclusive", () => {
    const nested = join(root, "packages", "api");
    mkdirSync(nested, { recursive: true });
    expect(projectDirectories(nested, home)).toEqual([nested, join(root, "packages"), root]);
  });

  it("stops before the home directory when there is no .git", () => {
    const loose = join(home, "scratch");
    mkdirSync(loose, { recursive: true });
    expect(projectDirectories(loose, home)).toEqual([loose]);
  });
});

describe("auditInstructionFiles: discovery", () => {
  it("reports no files and no findings for an empty project", async () => {
    const audit = await auditInstructionFiles(paths);
    expect(audit.projectRoot).toBe(root);
    expect(audit.files).toEqual([]);
    expect(audit.findings).toEqual([]);
    expect(audit.claudeMode).toBe("claude-md-or-agents-md");
    expect(audit.codexDocMaxBytes).toBe(CODEX_DEFAULT_DOC_MAX_BYTES);
  });

  it("describes project and user files, including managed blocks and imports", async () => {
    write(join(root, "AGENTS.md"), buildManagedBlock("# Prefs\n\nBe concise.") + "\n");
    write(join(root, "CLAUDE.md"), "@AGENTS.md\n\n# Claude only\n");
    write(join(home, ".codex", "AGENTS.md"), "global codex rules\n");

    const audit = await auditInstructionFiles(paths);
    const byPath = new Map(audit.files.map(f => [f.path, f]));

    const agents = byPath.get(join(root, "AGENTS.md"));
    expect(agents?.kind).toBe("agents");
    expect(agents?.scope).toBe("project");
    expect(agents?.managedBlock).not.toBeNull();

    const claude = byPath.get(join(root, "CLAUDE.md"));
    expect(claude?.kind).toBe("claude");
    expect(claude?.importsAgents).toBe(true);
    expect(claude?.lines).toBe(3);

    const codex = byPath.get(join(home, ".codex", "AGENTS.md"));
    expect(codex?.scope).toBe("user");
  });

  it("sees a CLAUDE.md in a parent directory of a nested cwd", async () => {
    const nested = join(root, "services", "billing");
    mkdirSync(nested, { recursive: true });
    write(join(root, "CLAUDE.md"), "# Root rules\n");
    write(join(nested, "AGENTS.md"), "# Billing agent rules\n");

    const audit = await auditInstructionFiles({ home, cwd: nested });
    expect(audit.projectRoot).toBe(root);
    expect(codes(audit)).toContain("claude-shadows-agents");
  });
});

describe("auditInstructionFiles: Claude Code shadowing", () => {
  it("warns when CLAUDE.md exists next to AGENTS.md without an import", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(join(root, "CLAUDE.md"), "# Claude rules\n");

    const audit = await auditInstructionFiles(paths);
    const finding = audit.findings.find(f => f.code === "claude-shadows-agents");
    expect(finding).toBeDefined();
    expect(finding?.level).toBe("warn");
    expect(finding?.tool).toBe("Claude Code");
    expect(finding?.fix).toContain("you-md export agents");
    expect(finding?.paths).toContain(join(root, "CLAUDE.md"));
    expect(finding?.paths).toContain(join(root, "AGENTS.md"));
  });

  it("treats CLAUDE.local.md and .claude/CLAUDE.md as shadowing files too", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(join(root, "CLAUDE.local.md"), "# Mine\n");
    expect(codes(await auditInstructionFiles(paths))).toContain("claude-shadows-agents");

    rmSync(join(root, "CLAUDE.local.md"));
    write(join(root, ".claude", "CLAUDE.md"), "# Team\n");
    expect(codes(await auditInstructionFiles(paths))).toContain("claude-shadows-agents");
  });

  it("does not warn when CLAUDE.md imports AGENTS.md", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(join(root, "CLAUDE.md"), "Some notes\n\n@AGENTS.md\n");

    const audit = await auditInstructionFiles(paths);
    expect(codes(audit)).not.toContain("claude-shadows-agents");
    expect(codes(audit)).not.toContain("claude-mentions-agents-without-import");
  });

  it("accepts relative import forms like @./AGENTS.md", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(join(root, "CLAUDE.md"), "@./AGENTS.md\n");
    expect(codes(await auditInstructionFiles(paths))).not.toContain("claude-shadows-agents");
  });

  it("does not count an email-style @ inside a word as an import", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(join(root, "CLAUDE.md"), "Contact ops@AGENTS.md for help\n");
    expect(codes(await auditInstructionFiles(paths))).toContain("claude-mentions-agents-without-import");
  });

  it("flags prose that names AGENTS.md without importing it", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(join(root, "CLAUDE.md"), "Please read AGENTS.md before working.\n");

    const audit = await auditInstructionFiles(paths);
    expect(codes(audit)).toContain("claude-mentions-agents-without-import");
    expect(codes(audit)).not.toContain("claude-shadows-agents");
  });

  it("does not warn when Project instructions is claude-md-and-agents-md", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(join(root, "CLAUDE.md"), "# Claude rules\n");
    write(
      join(home, ".claude", "settings.json"),
      JSON.stringify({
        pluginConfigs: { "agents-md@builtin": { options: { instructionFiles: "claude-md-and-agents-md" } } },
      })
    );

    const audit = await auditInstructionFiles(paths);
    expect(audit.claudeMode).toBe("claude-md-and-agents-md");
    expect(codes(audit)).not.toContain("claude-shadows-agents");
  });

  it("warns when the mode is claude-md and only AGENTS.md exists", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ pluginConfigs: { "agents-md@builtin": { options: { instructionFiles: "claude-md" } } } })
    );

    const audit = await auditInstructionFiles(paths);
    expect(codes(audit)).toContain("claude-mode-skips-agents");
    expect(codes(audit)).not.toContain("agents-read-directly");
  });

  it("notes that AGENTS.md is read directly when no CLAUDE.md is present", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");

    const audit = await auditInstructionFiles(paths);
    const finding = audit.findings.find(f => f.code === "agents-read-directly");
    expect(finding?.level).toBe("info");
    expect(finding?.message).toContain("2.1.277");
  });

  it("ignores an unknown mode value and falls back to the default", async () => {
    write(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ pluginConfigs: { "agents-md@builtin": { options: { instructionFiles: "nonsense" } } } })
    );
    expect((await auditInstructionFiles(paths)).claudeMode).toBe("claude-md-or-agents-md");
  });

  it("points out a mode set in project settings, which Claude Code ignores", async () => {
    write(
      join(root, ".claude", "settings.json"),
      JSON.stringify({
        pluginConfigs: { "agents-md@builtin": { options: { instructionFiles: "claude-md-and-agents-md" } } },
      })
    );

    const audit = await auditInstructionFiles(paths);
    expect(audit.claudeMode).toBe("claude-md-or-agents-md");
    expect(codes(audit)).toContain("claude-mode-ignored-in-project-settings");
  });

  it("warns about a SessionStart hook that prints AGENTS.md", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(
      join(root, ".claude", "settings.json"),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: "cat AGENTS.md" }] }] },
      })
    );

    expect(codes(await auditInstructionFiles(paths))).toContain("session-start-hook-duplicates-agents");
  });

  it("survives malformed settings files", async () => {
    write(join(home, ".claude", "settings.json"), "{ not json");
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    const audit = await auditInstructionFiles(paths);
    expect(audit.claudeMode).toBe("claude-md-or-agents-md");
    expect(codes(audit)).toContain("agents-read-directly");
  });
});

describe("auditInstructionFiles: managed blocks", () => {
  const block = buildManagedBlock("# Prefs\n\nBe concise.");

  it("warns when the you-md block is in two project files", async () => {
    write(join(root, "AGENTS.md"), block + "\n");
    write(join(root, "CLAUDE.md"), "@AGENTS.md\n\n" + block + "\n");

    const audit = await auditInstructionFiles(paths);
    const finding = audit.findings.find(f => f.code === "duplicate-managed-blocks");
    expect(finding?.level).toBe("warn");
    expect(finding?.paths).toHaveLength(2);
    expect(codes(audit)).not.toContain("managed-block-drift");
  });

  it("reports drift when managed blocks differ between files", async () => {
    write(join(root, "AGENTS.md"), block + "\n");
    write(join(root, "GEMINI.md"), buildManagedBlock("# Prefs\n\nOld version.") + "\n");

    const audit = await auditInstructionFiles(paths);
    const finding = audit.findings.find(f => f.code === "managed-block-drift");
    expect(finding?.level).toBe("warn");
    expect(finding?.fix).toContain("you-md sync");
  });

  it("notes when the user-level CLAUDE.md and a project file both carry the block", async () => {
    write(join(home, ".claude", "CLAUDE.md"), block + "\n");
    write(join(root, "AGENTS.md"), block + "\n");

    const audit = await auditInstructionFiles(paths);
    const finding = audit.findings.find(f => f.code === "user-and-project-managed-blocks");
    expect(finding?.level).toBe("info");
    expect(codes(audit)).not.toContain("duplicate-managed-blocks");
  });

  it("does not count the CLAUDE.md bridge written by export agents as a duplicate", async () => {
    write(join(root, "CLAUDE.md"), "# Claude rules\n");
    const agents = EXPORT_TARGETS.find(t => t.id === "agents")!;
    await exportToTarget(agents, "# Prefs\n\nBe concise.", paths);
    await ensureClaudeBridge(paths);

    const audit = await auditInstructionFiles(paths);
    const claude = audit.files.find(f => f.path === join(root, "CLAUDE.md"));
    expect(claude?.bridge).toBe(true);
    expect(claude?.importsAgents).toBe(true);
    expect(codes(audit)).not.toContain("duplicate-managed-blocks");
    expect(codes(audit)).not.toContain("managed-block-drift");
    expect(codes(audit)).not.toContain("claude-shadows-agents");
    expect(renderInstructionAudit(audit).join("\n")).toContain("you-md bridge");
  });

  it("is quiet when a single project file carries the block", async () => {
    write(join(root, "AGENTS.md"), block + "\n");
    const audit = await auditInstructionFiles(paths);
    expect(codes(audit)).not.toContain("duplicate-managed-blocks");
    expect(codes(audit)).not.toContain("managed-block-drift");
  });
});

describe("auditInstructionFiles: size and length", () => {
  it("flags instruction files over the recommended line count", async () => {
    const long = Array.from({ length: CLAUDE_RECOMMENDED_MAX_LINES + 5 }, (_, i) => `- rule ${i}`).join("\n");
    write(join(root, "CLAUDE.md"), long + "\n");

    const audit = await auditInstructionFiles(paths);
    const finding = audit.findings.find(f => f.code === "long-instruction-file");
    expect(finding?.level).toBe("info");
    expect(finding?.message).toContain(`${CLAUDE_RECOMMENDED_MAX_LINES + 5} lines`);
  });

  it("warns when the Codex AGENTS.md chain exceeds project_doc_max_bytes", async () => {
    write(join(home, ".codex", "AGENTS.md"), "x".repeat(20 * 1024) + "\n");
    write(join(root, "AGENTS.md"), "y".repeat(13 * 1024) + "\n");

    const audit = await auditInstructionFiles(paths);
    expect(audit.codexChainBytes).toBeGreaterThan(CODEX_DEFAULT_DOC_MAX_BYTES);
    const finding = audit.findings.find(f => f.code === "codex-size-cap");
    expect(finding?.level).toBe("warn");
    expect(finding?.message).toContain("32 KiB");
  });

  it("prefers AGENTS.override.md over AGENTS.md per directory, as Codex does", async () => {
    write(join(root, "AGENTS.md"), "y".repeat(40 * 1024));
    write(join(root, "AGENTS.override.md"), "small override\n");

    const audit = await auditInstructionFiles(paths);
    expect(audit.codexChainBytes).toBe(Buffer.byteLength("small override\n"));
    expect(codes(audit)).not.toContain("codex-size-cap");
  });

  it("honors project_doc_max_bytes from ~/.codex/config.toml", async () => {
    write(join(home, ".codex", "config.toml"), 'model = "gpt-5"\nproject_doc_max_bytes = 65536\n');
    write(join(root, "AGENTS.md"), "y".repeat(40 * 1024));

    const audit = await auditInstructionFiles(paths);
    expect(audit.codexDocMaxBytes).toBe(65536);
    expect(codes(audit)).not.toContain("codex-size-cap");
  });
});

describe("auditInstructionFiles: Gemini CLI", () => {
  it("notes that Gemini does not read AGENTS.md when no GEMINI.md exists", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    const audit = await auditInstructionFiles(paths);
    const finding = audit.findings.find(f => f.code === "gemini-skips-agents");
    expect(finding?.level).toBe("info");
    expect(finding?.fix).toContain("you-md export gemini");
  });

  it("is quiet when the project has a GEMINI.md", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(join(root, "GEMINI.md"), "# Gemini rules\n");
    expect(codes(await auditInstructionFiles(paths))).not.toContain("gemini-skips-agents");
  });

  it("is quiet when context.fileName includes AGENTS.md", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(join(home, ".gemini", "settings.json"), JSON.stringify({ context: { fileName: ["GEMINI.md", "AGENTS.md"] } }));
    expect(codes(await auditInstructionFiles(paths))).not.toContain("gemini-skips-agents");
  });
});

describe("renderInstructionAudit", () => {
  it("lists files with line counts and notes, then the findings with fixes", async () => {
    write(join(root, "AGENTS.md"), buildManagedBlock("# Prefs") + "\n");
    write(join(root, "CLAUDE.md"), "# Claude rules\n");

    const audit = await auditInstructionFiles(paths);
    const lines = renderInstructionAudit(audit);
    const text = lines.join("\n");

    expect(lines[0]).toContain(`project root: ${root}`);
    expect(text).toContain("./AGENTS.md");
    expect(text).toContain("you-md block");
    expect(text).toContain("./CLAUDE.md");
    expect(text).toContain("claude-md-or-agents-md (default)");
    expect(text).toContain("⚠ Claude Code");
    expect(text).toContain("fix: Run `you-md export agents`");
  });

  it("prints a clean bill when nothing is wrong", async () => {
    const lines = renderInstructionAudit(await auditInstructionFiles(paths));
    expect(lines.join("\n")).toContain("✓ No shadowing, duplication, or truncation found");
  });
});

describe("display helpers", () => {
  it("renders project paths relative to the root and user paths relative to home", () => {
    expect(displayPath(join(root, "AGENTS.md"), root, home)).toBe("./AGENTS.md");
    expect(displayPath(join(root, ".claude", "CLAUDE.md"), root, home)).toBe("./.claude/CLAUDE.md");
    expect(displayPath(join(home, ".codex", "AGENTS.md"), root, home)).toBe("~/.codex/AGENTS.md");
    expect(displayPath("/elsewhere/file.md", root, home)).toBe("/elsewhere/file.md");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(32 * 1024)).toBe("32 KiB");
    expect(formatBytes(33 * 1024 + 512)).toBe("33.5 KiB");
    expect(formatBytes(150 * 1024)).toBe("150 KiB");
  });
});

describe("runCheck integration", () => {
  it("includes the instruction audit in the check result and output", async () => {
    write(join(root, ".you.md"), '---\nschema_version: "1.1"\n---\n\n# Me\n\nHello.\n');
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    write(join(root, "CLAUDE.md"), "# Claude rules\n");

    const logs: string[] = [];
    const result = await runCheck({ searchPaths: [join(root, ".you.md")], log: m => logs.push(m), paths });

    expect(result.profileValid).toBe(true);
    expect(result.instructionFiles.findings.map(f => f.code)).toContain("claude-shadows-agents");
    expect(logs.some(l => l.startsWith("Instruction files"))).toBe(true);
    expect(logs.some(l => l.includes("shadows ./AGENTS.md"))).toBe(true);
  });

  it("still runs the audit when no profile is found", async () => {
    write(join(root, "AGENTS.md"), "# Shared rules\n");
    const logs: string[] = [];
    const result = await runCheck({ searchPaths: [join(root, "missing.md")], log: m => logs.push(m), paths });

    expect(result.profileFound).toBe(false);
    expect(result.instructionFiles.files).toHaveLength(1);
    expect(logs.some(l => l.startsWith("Instruction files"))).toBe(true);
  });
});
