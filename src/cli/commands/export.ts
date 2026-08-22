/**
 * you-md export: write your you.md preferences into each AI tool's
 * native instruction file, so tools that don't speak MCP still know you.
 *
 * Usage:
 *   you-md export claude              Export to Claude Code (~/.claude/CLAUDE.md)
 *   you-md export claude gemini      Export to several tools at once
 *   you-md export --all              Export to every supported tool
 *   you-md export --all --dry-run    Preview paths and actions without writing
 *   you-md export claude -o path     Override the output path (single target only)
 *
 * Exports are idempotent: content is wrapped in you-md managed markers,
 * so re-running export updates the managed block in place and never
 * clobbers anything else in the file.
 *
 * Supported targets:
 *   claude     Claude Code global memory        ~/.claude/CLAUDE.md
 *   codex      Codex CLI global guidance        ~/.codex/AGENTS.md
 *   gemini     Gemini CLI global context        ~/.gemini/GEMINI.md
 *   windsurf   Windsurf global rules            ~/.codeium/windsurf/memories/global_rules.md
 *   copilot    Copilot CLI personal file        ~/.copilot/copilot-instructions.md
 *   cursor     Cursor project rule (mdc)        ./.cursor/rules/you-md.mdc
 *   agents     Project AGENTS.md                ./AGENTS.md
 *   copilot-repo  Copilot repo instructions     ./.github/copilot-instructions.md
 *
 * Exporting `agents` also bridges the project CLAUDE.md to AGENTS.md with an
 * `@AGENTS.md` import line, since Claude Code doesn't read AGENTS.md natively.
 * See `you-md sync` for detecting and repairing drift after you.md edits.
 */

import { readFile, writeFile, mkdir, copyFile, rename } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { homedir } from "node:os"

import { createParser } from "../../parser/index.js"
import { formatProfileForContext, type FormattableProfile } from "../../core/formatter.js"
import type { CliFlags } from "../args.js"

// ---------------------------------------------------------------------------
// Managed block markers
// ---------------------------------------------------------------------------

export const BEGIN_MARKER = "<!-- you-md:begin -->"
export const END_MARKER = "<!-- you-md:end -->"

const MANAGED_NOTE =
  "<!-- Managed by you-md. Edit your you.md and re-run: you-md export -->"

/**
 * Wrap rendered preferences in managed block markers.
 */
export function buildManagedBlock(content: string): string {
  return [BEGIN_MARKER, MANAGED_NOTE, "", content.trimEnd(), "", END_MARKER].join("\n")
}

/**
 * Merge a managed block into existing file content.
 *
 * - No existing content: the block becomes the whole file.
 * - Existing markers: content between (and including) the markers is replaced.
 * - No markers: the block is appended after the existing content.
 */
export function applyManagedBlock(existing: string | null, block: string): string {
  if (!existing || existing.trim().length === 0) {
    return block + "\n"
  }

  const beginIdx = existing.indexOf(BEGIN_MARKER)
  const endIdx = existing.indexOf(END_MARKER)

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx)
    const after = existing.slice(endIdx + END_MARKER.length)
    return before + block + after
  }

  return existing.trimEnd() + "\n\n" + block + "\n"
}

// ---------------------------------------------------------------------------
// Export targets
// ---------------------------------------------------------------------------

export interface ExportTarget {
  id: string
  name: string
  /** "user" resolves relative to the home dir, "project" relative to cwd */
  scope: "user" | "project"
  /** Path segments relative to the scope root */
  relPath: string[]
  /**
   * "managed-block": merge into the file via markers (file is shared with
   * the user and other tools). "own-file": you-md owns the whole file and
   * overwrites it on every export.
   */
  mode: "managed-block" | "own-file"
  /** Render the final file (own-file) or block content (managed-block) */
  render: (prefs: string) => string
}

export const EXPORT_TARGETS: ExportTarget[] = [
  {
    id: "claude",
    name: "Claude Code",
    scope: "user",
    relPath: [".claude", "CLAUDE.md"],
    mode: "managed-block",
    render: prefs => prefs,
  },
  {
    id: "codex",
    name: "Codex CLI",
    scope: "user",
    relPath: [".codex", "AGENTS.md"],
    mode: "managed-block",
    render: prefs => prefs,
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    scope: "user",
    relPath: [".gemini", "GEMINI.md"],
    mode: "managed-block",
    render: prefs => prefs,
  },
  {
    id: "windsurf",
    name: "Windsurf",
    scope: "user",
    relPath: [".codeium", "windsurf", "memories", "global_rules.md"],
    mode: "managed-block",
    render: prefs => prefs,
  },
  {
    // Personal instructions for GitHub Copilot CLI. Copilot CLI reads
    // ~/.copilot/copilot-instructions.md across every repository, and it is
    // the one Copilot surface that does not read AGENTS.md, so the generic
    // `agents` target cannot reach it.
    id: "copilot",
    name: "Copilot CLI",
    scope: "user",
    relPath: [".copilot", "copilot-instructions.md"],
    mode: "managed-block",
    render: prefs => prefs,
  },
  {
    id: "cursor",
    name: "Cursor",
    scope: "project",
    relPath: [".cursor", "rules", "you-md.mdc"],
    mode: "own-file",
    render: prefs =>
      [
        "---",
        "description: User preferences from you.md",
        "alwaysApply: true",
        "---",
        "",
        MANAGED_NOTE,
        "",
        prefs.trimEnd(),
        "",
      ].join("\n"),
  },
  {
    id: "agents",
    name: "Project AGENTS.md",
    scope: "project",
    relPath: ["AGENTS.md"],
    mode: "managed-block",
    render: prefs => prefs,
  },
  {
    // Repository-wide instructions for GitHub Copilot. This file is read by
    // Copilot Chat (VS Code and GitHub.com), Copilot code review, the Copilot
    // coding agent, and Copilot CLI, and it is the highest-adherence Copilot
    // instruction file. GitHub.com Copilot Chat does not read AGENTS.md, so
    // this target covers surfaces the `agents` target cannot.
    id: "copilot-repo",
    name: "Copilot (repo-wide)",
    scope: "project",
    relPath: [".github", "copilot-instructions.md"],
    mode: "managed-block",
    render: prefs => prefs,
  },
]

/**
 * Base directories used to resolve target paths. Injectable for tests.
 */
export interface ExportPaths {
  home?: string
  cwd?: string
}

export function resolveTargetPath(target: ExportTarget, paths?: ExportPaths): string {
  const base = target.scope === "user" ? (paths?.home ?? homedir()) : (paths?.cwd ?? process.cwd())
  return resolve(base, ...target.relPath)
}

// ---------------------------------------------------------------------------
// Write logic
// ---------------------------------------------------------------------------

export type ExportAction = "created" | "updated"

/**
 * Export rendered preferences to a single target file.
 * Backs up any existing file to <path>.backup before modifying it.
 */
export async function exportToTarget(
  target: ExportTarget,
  prefs: string,
  paths?: ExportPaths,
  outputOverride?: string
): Promise<{ path: string; action: ExportAction }> {
  const path = outputOverride ? resolve(outputOverride) : resolveTargetPath(target, paths)
  const rendered = target.render(prefs)
  const exists = existsSync(path)

  let next: string
  if (target.mode === "own-file") {
    next = rendered
  } else {
    const existing = exists ? await readFile(path, "utf-8") : null
    next = applyManagedBlock(existing, buildManagedBlock(rendered))
  }

  await mkdir(dirname(path), { recursive: true })
  if (exists) {
    await copyFile(path, path + ".backup")
  }
  const tmp = path + ".tmp"
  await writeFile(tmp, next, "utf-8")
  await rename(tmp, path)

  return { path, action: exists ? "updated" : "created" }
}

// ---------------------------------------------------------------------------
// CLAUDE.md -> AGENTS.md bridge
// ---------------------------------------------------------------------------

/**
 * Claude Code reads CLAUDE.md, not AGENTS.md. The community fix is a symlink
 * or an `@AGENTS.md` import line. We write the import line inside a managed
 * block: it survives user edits around it, works on every platform, and
 * keeps the project's AGENTS.md as the single source of truth.
 */
const BRIDGE_CONTENT = [
  "@AGENTS.md",
  "",
  "<!-- The line above imports AGENTS.md so Claude Code reads the same",
  "     instructions as every AGENTS.md-native tool. One source, no drift. -->",
].join("\n")

export interface BridgeResult {
  path: string
  action: "created" | "updated" | "none"
}

export function claudeBridgePath(paths?: ExportPaths): string {
  return resolve(paths?.cwd ?? process.cwd(), "CLAUDE.md")
}

/**
 * Ensure the project CLAUDE.md imports AGENTS.md.
 *
 * - CLAUDE.md already mentions @AGENTS.md anywhere (hand-rolled or ours): no-op.
 * - CLAUDE.md exists without it: append/refresh a managed block with the import.
 * - CLAUDE.md missing: create it with just the managed bridge block.
 */
export async function ensureClaudeBridge(paths?: ExportPaths): Promise<BridgeResult> {
  const path = claudeBridgePath(paths)
  const exists = existsSync(path)
  const existing = exists ? await readFile(path, "utf-8") : null

  if (existing !== null && existing.includes("@AGENTS.md")) {
    return { path, action: "none" }
  }

  const next = applyManagedBlock(existing, buildManagedBlock(BRIDGE_CONTENT))

  await mkdir(dirname(path), { recursive: true })
  if (exists) {
    await copyFile(path, path + ".backup")
  }
  const tmp = path + ".tmp"
  await writeFile(tmp, next, "utf-8")
  await rename(tmp, path)

  return { path, action: exists ? "updated" : "created" }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

function helpText(): string {
  const idWidth = Math.max(...EXPORT_TARGETS.map(t => t.id.length)) + 2
  const rows = EXPORT_TARGETS.map(t => {
    const loc = (t.scope === "user" ? "~/" : "./") + t.relPath.join("/")
    return `  ${t.id.padEnd(idWidth)} ${t.name.padEnd(22)} ${loc}`
  }).join("\n")

  return `you-md export: write your preferences into each tool's native instruction file

Usage:
  you-md export <target...>         Export to one or more targets
  you-md export --all               Export to all supported targets
  you-md export --all --dry-run     Preview without writing
  you-md export <target> -o <path>  Override output path (single target only)

Targets:
${rows}

Exports are idempotent. Managed content lives between you-md markers,
so your own notes in the same file are preserved on re-export.`
}

export async function exportCommand(
  args: string[],
  flags: CliFlags,
  paths?: ExportPaths
): Promise<number> {
  // Resolve target list
  let targets: ExportTarget[]
  if (flags.all) {
    targets = EXPORT_TARGETS
  } else if (args.length > 0) {
    targets = []
    for (const id of args) {
      const target = EXPORT_TARGETS.find(t => t.id === id.toLowerCase())
      if (!target) {
        console.error(`Unknown export target: ${id}`)
        console.error(`Supported: ${EXPORT_TARGETS.map(t => t.id).join(", ")}`)
        return 1
      }
      targets.push(target)
    }
  } else {
    console.log(helpText())
    return 0
  }

  if (flags.output && targets.length > 1) {
    console.error("--output can only be used with a single target.")
    return 1
  }

  // Load the profile (project overrides global, same as the MCP server)
  const parser = createParser()
  const result = await parser.discover()

  if (!result || !result.success) {
    console.error("No you.md file found.")
    console.error("Create one with: you-md init -i")
    return 1
  }

  const prefs = formatProfileForContext(result.profile as FormattableProfile)

  // Dry run: report what would happen, write nothing
  if (flags.dryRun) {
    console.log("Dry run. No files will be written.\n")
    for (const target of targets) {
      const path = flags.output ? resolve(flags.output) : resolveTargetPath(target, paths)
      const action = existsSync(path) ? "update" : "create"
      console.log(`  ${target.name.padEnd(22)} would ${action}  ${path}`)
    }
    if (flags.verbose) {
      console.log("\nContent that would be exported:\n")
      console.log(buildManagedBlock(prefs))
    }
    return 0
  }

  // Export
  let failures = 0
  for (const target of targets) {
    try {
      const { path, action } = await exportToTarget(target, prefs, paths, flags.output)
      if (!flags.quiet) {
        console.log(`✓ ${target.name.padEnd(22)} ${action}  ${path}`)
      }
      // Exporting a project AGENTS.md also bridges the project CLAUDE.md to
      // it (via an @AGENTS.md import), so Claude Code reads the same content.
      if (target.id === "agents" && !flags.output) {
        const bridge = await ensureClaudeBridge(paths)
        if (!flags.quiet && bridge.action !== "none") {
          console.log(`✓ ${"CLAUDE.md bridge".padEnd(22)} ${bridge.action}  ${bridge.path}`)
        }
      }
    } catch (err) {
      failures++
      const message = err instanceof Error ? err.message : String(err)
      console.error(`✗ ${target.name.padEnd(22)} failed  ${message}`)
    }
  }

  if (!flags.quiet && failures === 0) {
    console.log("")
    console.log("Preferences exported. Tools read these files at session start.")
    console.log("Re-run 'you-md export' whenever you update your you.md.")
  }

  return failures > 0 ? 1 : 0
}
