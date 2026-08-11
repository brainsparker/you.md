/**
 * you-md export: generate agent context files from your you.md profile
 *
 * AGENTS.md is the open, tool-agnostic context file read natively by
 * OpenAI Codex, Cursor, GitHub Copilot, Gemini CLI, Windsurf, Aider, Zed,
 * and 20+ other coding agents. This command renders your you.md profile
 * into that format (and the common tool-specific variants), so the tools
 * that do not speak MCP still know who you are.
 *
 * Usage:
 *   you-md export                      Print AGENTS.md content to stdout
 *   you-md export agents -o AGENTS.md  Write AGENTS.md in the current repo
 *   you-md export claude -o CLAUDE.md  Write a CLAUDE.md for Claude Code
 *   you-md export gemini               Print GEMINI.md content
 *   you-md export copilot              Print .github/copilot-instructions.md content
 */

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

import type { CliFlags } from "../args.js";
import { createParser } from "../../parser/index.js";
import type { YouMdProfile } from "../../types/profile.js";

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export interface ExportTarget {
  id: string;
  name: string;
  defaultFilename: string;
  /** Render the final file content from the shared profile body */
  render: (body: string) => string;
}

const REGENERATE_HINT = "Regenerate with: npx you-md export";

function generatedHeader(target: string): string {
  return [
    `<!-- Generated from you.md by \`you-md export ${target}\`.`,
    `     Edit your you.md profile, not this file. ${REGENERATE_HINT} ${target} -->`,
  ].join("\n");
}

export const EXPORT_TARGETS: ExportTarget[] = [
  {
    id: "agents",
    name: "AGENTS.md (open standard: Codex, Cursor, Copilot, Gemini CLI, and more)",
    defaultFilename: "AGENTS.md",
    render: (body) =>
      [
        generatedHeader("agents"),
        "",
        "# Working with this developer",
        "",
        "The preferences below come from the developer's you.md profile.",
        "Apply them when building, reviewing, or explaining code in this repository.",
        "",
        body,
      ].join("\n"),
  },
  {
    id: "claude",
    name: "CLAUDE.md (Claude Code)",
    defaultFilename: "CLAUDE.md",
    render: (body) =>
      [
        generatedHeader("claude"),
        "<!-- Tip: if this repo also has an AGENTS.md, a one-line `@AGENTS.md`",
        "     import keeps the two files from drifting apart. -->",
        "",
        "# Working with this developer",
        "",
        "The preferences below come from the developer's you.md profile.",
        "Apply them throughout this session.",
        "",
        body,
      ].join("\n"),
  },
  {
    id: "gemini",
    name: "GEMINI.md (Gemini CLI)",
    defaultFilename: "GEMINI.md",
    render: (body) =>
      [
        generatedHeader("gemini"),
        "",
        "# Working with this developer",
        "",
        "The preferences below come from the developer's you.md profile.",
        "",
        body,
      ].join("\n"),
  },
  {
    id: "copilot",
    name: "GitHub Copilot instructions",
    defaultFilename: ".github/copilot-instructions.md",
    render: (body) =>
      [
        generatedHeader("copilot"),
        "",
        "The preferences below come from the developer's you.md profile.",
        "Apply them when generating code and reviews in this repository.",
        "",
        body,
      ].join("\n"),
  },
];

export function getExportTarget(id: string): ExportTarget | undefined {
  return EXPORT_TARGETS.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render the shared body: every profile section as markdown, preserving
 * the section order from the source file.
 */
export function renderProfileBody(profile: YouMdProfile): string {
  const lines: string[] = [];

  if (profile.metadata.author) {
    lines.push(`Developer: ${profile.metadata.author}`);
    lines.push("");
  }

  for (const [, section] of profile.sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    if (section.content?.trim()) {
      lines.push(section.content.trim());
      lines.push("");
    }
    for (const sub of section.subsections) {
      lines.push(`### ${sub.title}`);
      lines.push("");
      if (sub.content?.trim()) {
        lines.push(sub.content.trim());
        lines.push("");
      }
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// Core (testable, dependency-injected like check.ts)
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /** Export target id (default: "agents") */
  target?: string;
  /** Explicit profile path (skips discovery) */
  profilePath?: string;
  /** Custom profile search paths for discovery */
  searchPaths?: string[];
  /** Output file path; when null/undefined the content is returned for stdout */
  outputPath?: string | null;
  /** Overwrite an existing output file */
  force?: boolean;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export interface ExportResult {
  ok: boolean;
  target: string;
  content: string | null;
  writtenPath: string | null;
  error: string | null;
}

export async function runExport(options: ExportOptions = {}): Promise<ExportResult> {
  const targetId = options.target ?? "agents";
  const log = options.log ?? (() => {});
  const warn = options.warn ?? (() => {});

  const target = getExportTarget(targetId);
  if (!target) {
    return {
      ok: false,
      target: targetId,
      content: null,
      writtenPath: null,
      error: `Unknown export target: ${targetId}. Supported: ${EXPORT_TARGETS.map((t) => t.id).join(", ")}`,
    };
  }

  const parser = createParser();
  const result = options.profilePath
    ? await parser.discover({ path: options.profilePath })
    : await parser.discover(
        options.searchPaths ? { searchPaths: options.searchPaths } : undefined
      );

  if (!result || !result.success) {
    return {
      ok: false,
      target: target.id,
      content: null,
      writtenPath: null,
      error:
        "No you.md profile found. Create one with: you-md init -i",
    };
  }

  const content = target.render(renderProfileBody(result.profile));

  if (!options.outputPath) {
    return { ok: true, target: target.id, content, writtenPath: null, error: null };
  }

  const outPath = resolve(options.outputPath);

  if (existsSync(outPath) && !options.force) {
    return {
      ok: false,
      target: target.id,
      content,
      writtenPath: null,
      error: `File already exists: ${outPath}. Use --force to overwrite.`,
    };
  }

  if (result.profile.metadata.privacyLevel === "private") {
    warn(
      "Warning: your profile is marked privacy_level: private. " +
        `${target.defaultFilename} files are usually committed to repositories. ` +
        "Review the output before committing."
    );
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, content, "utf-8");
  log(`Exported ${target.defaultFilename} → ${outPath}`);

  return { ok: true, target: target.id, content, writtenPath: outPath, error: null };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export async function exportCommand(args: string[], flags: CliFlags): Promise<number> {
  const targetId = args[0];

  if (targetId === "list") {
    console.log("Available export targets:\n");
    for (const t of EXPORT_TARGETS) {
      console.log(`  ${t.id.padEnd(10)} ${t.defaultFilename.padEnd(38)} ${t.name}`);
    }
    console.log("");
    console.log("Usage: you-md export [target] [-o <path>] [--force]");
    return 0;
  }

  const result = await runExport({
    target: targetId,
    outputPath: flags.output ?? null,
    force: flags.force,
    log: (msg) => {
      if (!flags.quiet) console.log(msg);
    },
    warn: (msg) => {
      if (!flags.quiet) console.error(msg);
    },
  });

  if (!result.ok) {
    if (!flags.quiet && result.error) {
      console.error(`Error: ${result.error}`);
      if (result.error.startsWith("Unknown export target")) {
        console.error("Run 'you-md export list' to see available targets.");
      }
    }
    return 1;
  }

  // No output path: print to stdout (same convention as `you-md convert`)
  if (!result.writtenPath && result.content) {
    console.log(result.content);
  }

  return 0;
}
