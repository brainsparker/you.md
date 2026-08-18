/**
 * you-md sync: detect and repair drift between your you.md and every
 * instruction file you've exported it into.
 *
 * Usage:
 *   you-md sync              Re-render and update every previously exported file
 *   you-md sync --check      Report drift without writing (exit 1 if any), CI-friendly
 *   you-md sync --dry-run    Alias behavior: preview what would change, exit 0
 *
 * Why: teams end up with CLAUDE.md, AGENTS.md, and .cursor/rules saying
 * slightly different things ("config drift"). sync makes you.md the single
 * source of truth: it only touches files that already carry you-md managed
 * markers (or you-md owned files), refreshes stale ones, and never creates
 * new export targets on its own. Use `you-md export` to add a target first.
 *
 * sync also maintains the CLAUDE.md -> AGENTS.md bridge: when a project
 * AGENTS.md is managed by you-md, the project CLAUDE.md gets an `@AGENTS.md`
 * import line (inside a managed block), so Claude Code reads the same
 * content every other tool reads from AGENTS.md.
 */

import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"

import { createParser } from "../../parser/index.js"
import { formatProfileForContext, type FormattableProfile } from "../../core/formatter.js"
import type { CliFlags } from "../args.js"
import {
  BEGIN_MARKER,
  END_MARKER,
  EXPORT_TARGETS,
  buildManagedBlock,
  exportToTarget,
  resolveTargetPath,
  ensureClaudeBridge,
  claudeBridgePath,
  type ExportPaths,
} from "./export.js"

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

export type SyncStatus = "in-sync" | "stale" | "unmanaged" | "missing"

/**
 * Extract the managed block (markers included) from file content.
 * Returns null when no complete managed block is present.
 */
export function extractManagedBlock(content: string): string | null {
  const beginIdx = content.indexOf(BEGIN_MARKER)
  const endIdx = content.indexOf(END_MARKER)
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) return null
  return content.slice(beginIdx, endIdx + END_MARKER.length)
}

/**
 * Compare a file's current content against the freshly rendered output.
 *
 * - managed-block targets compare only the managed block, so the user's own
 *   notes around it never count as drift.
 * - own-file targets (e.g. Cursor's .mdc rule) compare the whole file.
 */
export function detectSyncStatus(
  existing: string | null,
  freshBlock: string,
  mode: "managed-block" | "own-file"
): SyncStatus {
  if (existing === null) return "missing"

  if (mode === "own-file") {
    return existing.trimEnd() === freshBlock.trimEnd() ? "in-sync" : "stale"
  }

  const current = extractManagedBlock(existing)
  if (current === null) return "unmanaged"
  return current.trimEnd() === freshBlock.trimEnd() ? "in-sync" : "stale"
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

interface TargetReport {
  name: string
  path: string
  status: SyncStatus
  action: "updated" | "would-update" | "none"
}

function statusLabel(report: TargetReport): string {
  switch (report.status) {
    case "in-sync":
      return "in sync"
    case "stale":
      return report.action === "updated" ? "updated" : "stale"
    case "unmanaged":
      return "unmanaged (no you-md markers, skipped)"
    case "missing":
      return "not exported (skipped)"
  }
}

function helpText(): string {
  return `you-md sync: detect and repair drift between you.md and exported files

Usage:
  you-md sync              Refresh every previously exported instruction file
  you-md sync --check      Report drift, write nothing, exit 1 if anything is stale
  you-md sync --dry-run    Preview what would change, always exit 0

sync only touches files that already carry you-md managed markers (or files
you-md owns outright, like Cursor's .mdc rule). It never creates new export
targets: run 'you-md export <target>' first to add one.

When a project AGENTS.md is managed by you-md, sync also keeps the project
CLAUDE.md bridged to it with an '@AGENTS.md' import line, so Claude Code
reads the same instructions every AGENTS.md-native tool reads.`
}

export async function syncCommand(
  args: string[],
  flags: CliFlags,
  paths?: ExportPaths
): Promise<number> {
  if (args.length > 0 && (args[0] === "help" || flags.help)) {
    console.log(helpText())
    return 0
  }

  const checkOnly = flags.check === true
  const preview = flags.dryRun === true
  const writing = !checkOnly && !preview

  // Load the profile (project overrides global, same as export)
  const parser = createParser()
  const result = await parser.discover()

  if (!result || !result.success) {
    console.error("No you.md file found.")
    console.error("Create one with: you-md init -i")
    return 1
  }

  const prefs = formatProfileForContext(result.profile as FormattableProfile)

  const reports: TargetReport[] = []
  let failures = 0

  for (const target of EXPORT_TARGETS) {
    const path = resolveTargetPath(target, paths)
    const existing = existsSync(path) ? await readFile(path, "utf-8") : null
    const fresh =
      target.mode === "own-file"
        ? target.render(prefs)
        : buildManagedBlock(target.render(prefs))
    const status = detectSyncStatus(existing, fresh, target.mode)

    let action: TargetReport["action"] = "none"
    if (status === "stale") {
      if (writing) {
        try {
          await exportToTarget(target, prefs, paths)
          action = "updated"
        } catch (err) {
          failures++
          const message = err instanceof Error ? err.message : String(err)
          console.error(`✗ ${target.name.padEnd(22)} failed  ${message}`)
          continue
        }
      } else {
        action = "would-update"
      }
    }

    reports.push({ name: target.name, path, status, action })
  }

  // CLAUDE.md -> AGENTS.md bridge: only when the project AGENTS.md is managed
  const agentsTarget = EXPORT_TARGETS.find(t => t.id === "agents")
  let bridgeDrift = false
  if (agentsTarget) {
    const agentsPath = resolveTargetPath(agentsTarget, paths)
    const agentsManaged =
      existsSync(agentsPath) &&
      extractManagedBlock(await readFile(agentsPath, "utf-8")) !== null

    if (agentsManaged) {
      const bridgeFile = claudeBridgePath(paths)
      if (writing) {
        const bridge = await ensureClaudeBridge(paths)
        if (!flags.quiet) {
          const label =
            bridge.action === "none" ? "in sync" : `bridged (@AGENTS.md ${bridge.action})`
          console.log(`  ${"CLAUDE.md bridge".padEnd(22)} ${label.padEnd(12)} ${bridge.path}`)
        }
      } else {
        const existing = existsSync(bridgeFile) ? await readFile(bridgeFile, "utf-8") : null
        const bridged = existing !== null && existing.includes("@AGENTS.md")
        if (!bridged) bridgeDrift = true
        if (!flags.quiet) {
          const label = bridged ? "in sync" : "missing @AGENTS.md import"
          console.log(`  ${"CLAUDE.md bridge".padEnd(22)} ${label.padEnd(12)} ${bridgeFile}`)
        }
      }
    }
  }

  const stale = reports.filter(r => r.status === "stale")

  if (!flags.quiet) {
    for (const report of reports) {
      console.log(`  ${report.name.padEnd(22)} ${statusLabel(report).padEnd(12)} ${report.path}`)
    }
    console.log("")
    if (checkOnly || preview) {
      if (stale.length === 0 && !bridgeDrift) {
        console.log("Everything is in sync with your you.md.")
      } else {
        const parts: string[] = []
        if (stale.length > 0) {
          parts.push(`${stale.length} file${stale.length === 1 ? " is" : "s are"} stale`)
        }
        if (bridgeDrift) parts.push("the CLAUDE.md bridge is missing")
        console.log(`Drift detected: ${parts.join(" and ")}. Run 'you-md sync' to repair.`)
      }
    } else if (stale.length === 0) {
      console.log("Everything is in sync with your you.md.")
    } else {
      console.log(`Refreshed ${stale.length} file${stale.length === 1 ? "" : "s"} from your you.md.`)
    }
  }

  if (failures > 0) return 1
  if (checkOnly && (stale.length > 0 || bridgeDrift)) return 1
  return 0
}
