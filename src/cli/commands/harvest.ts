/**
 * you-md harvest: pull what Claude Code already learned about you into you.md.
 *
 * Usage:
 *   you-md harvest                    Add Claude Code's user and feedback memories to ~/.you.md
 *   you-md harvest --dry-run          Show what would be added, write nothing
 *   you-md harvest -o ./.you.md       Target a specific profile
 *   you-md harvest --types all        Include project, reference, and untyped memories too
 *   you-md harvest --memory-dir DIR   Scan a specific projects root or memory directory
 *
 * Why: Claude Code's auto memory is per repository and machine-local. Every
 * project relearns that you prefer pnpm, want short answers, and never want
 * a dependency added without asking; a new laptop starts from zero; Cursor,
 * Codex, and Gemini never hear any of it. you.md is the file those notes
 * belong in, because from there `you-md export --all` carries them to every
 * tool at once.
 */

import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"

import type { CliFlags } from "../args.js"
import {
  DEFAULT_MEMORY_TYPES,
  applyHarvest,
  findMemoryDirs,
  parseMemoryTypes,
  planHarvest,
  resolveMemoryRoots,
  scanMemoryDirs,
  type HarvestPaths,
  type PlannedEntry,
} from "../harvest.js"

export interface HarvestCommandPaths extends HarvestPaths {
  /** Overrides the default ~/.you.md output location (tests) */
  home?: string
}

/** Memory stores harvest knows how to read. More sources slot in here. */
const SOURCES = ["claude-code"]

function helpText(): string {
  return `you-md harvest: pull what Claude Code already learned about you into you.md

Usage:
  you-md harvest [claude-code]      Add Claude Code's memories about you to ~/.you.md
  you-md harvest --dry-run          Show what would be added, write nothing
  you-md harvest -o <path>          Write into a specific profile (created if missing)
  you-md harvest --types <list>     Memory types to include: user, feedback, project,
                                    reference, untyped, or all (default: user,feedback)
  you-md harvest --memory-dir <dir> Scan this directory instead of ~/.claude/projects

Claude Code keeps notes about you in ~/.claude/projects/<project>/memory/,
one markdown file per memory with its type in the frontmatter. harvest reads
the user and feedback notes from every project, files each under the matching
you.md section (How I Work, How I Communicate, What I Do, Boundaries), and
skips anything your profile already says. Re-running adds nothing new.

Afterwards, run 'you-md export --all' (or 'you-md sync' if you already export)
so every other tool gets what Claude Code learned.`
}

function shortPath(path: string, home: string): string {
  return path.startsWith(home) ? "~" + path.slice(home.length) : path
}

function projectsLabel(entry: PlannedEntry): string {
  const shown = entry.projects.slice(0, 3).join(", ")
  const more = entry.projects.length - 3
  return more > 0 ? `${shown} +${more}` : shown
}

export async function harvestCommand(
  args: string[],
  flags: CliFlags,
  paths?: HarvestCommandPaths
): Promise<number> {
  if (args[0] === "help" || flags.help) {
    console.log(helpText())
    return 0
  }

  const source = (args[0] ?? "claude-code").toLowerCase()
  if (!SOURCES.includes(source)) {
    console.error(`Unknown memory source: ${args[0]}`)
    console.error(`Supported: ${SOURCES.join(", ")}`)
    return 1
  }

  const types = parseMemoryTypes(flags.types)
  if (types === null) {
    console.error(`Unknown memory type in --types: ${flags.types}`)
    console.error("Supported: user, feedback, project, reference, untyped, all")
    return 1
  }

  const home = paths?.home ?? homedir()
  const quiet = flags.quiet === true
  const preview = flags.dryRun === true

  // Locate memory directories
  const roots = resolveMemoryRoots({ ...paths, home })
  const dirs = findMemoryDirs(roots)
  if (dirs.length === 0) {
    if (!quiet) {
      console.error("No Claude Code memory found.")
      for (const root of roots) console.error(`  looked in ${shortPath(root, home)}`)
      console.error("")
      console.error("Auto memory fills in as you use Claude Code (run /memory inside a")
      console.error("session to see it). If it lives somewhere else, pass --memory-dir.")
    }
    return 1
  }

  const { memories, files } = scanMemoryDirs(dirs, types)

  // Load the target profile. Memories about a person belong in the user-level
  // profile, so that is the default; -o targets a project profile instead.
  const outputPath = flags.output ? resolve(flags.output) : resolve(home, ".you.md")
  const exists = existsSync(outputPath)
  const existing = exists ? await readFile(outputPath, "utf-8") : null

  const plan = planHarvest(existing, memories)

  if (!quiet) {
    const typeList = types.join(", ")
    const projectWord = dirs.length === 1 ? "project" : "projects"
    const fileWord = files === 1 ? "memory file" : "memory files"
    console.log(
      `Scanned ${dirs.length} Claude Code ${projectWord} (${files} ${fileWord}, types: ${typeList})`
    )
    console.log("")

    if (plan.count === 0) {
      if (memories.length === 0) {
        console.log("Nothing to harvest yet: no memories of the requested types.")
        if (types === DEFAULT_MEMORY_TYPES) {
          console.log("Try --types all to include project, reference, and untyped notes.")
        }
      } else {
        console.log("Nothing new: your profile already has everything Claude Code learned.")
      }
    } else {
      for (const [section, entries] of plan.additions) {
        console.log(`  ${section} (${entries.length})`)
        for (const entry of entries) {
          const text = entry.text.length > 72 ? entry.text.slice(0, 69).trimEnd() + "..." : entry.text
          console.log(`    + ${text.padEnd(72)}  ${projectsLabel(entry)}`)
        }
      }
      console.log("")
    }

    const skipped: string[] = []
    if (plan.duplicates.length > 0) {
      skipped.push(`${plan.duplicates.length} already in your profile`)
    }
    if (plan.sensitive.length > 0) {
      skipped.push(`${plan.sensitive.length} looked like a credential`)
    }
    if (skipped.length > 0) {
      console.log(`  skipped ${skipped.join(", ")}`)
      console.log("")
    }
  }

  if (plan.count === 0) return 0

  if (preview) {
    if (!quiet) {
      const verb = exists ? "add to" : "create"
      console.log(`Dry run: would ${verb} ${shortPath(outputPath, home)}. Nothing written.`)
    }
    return 0
  }

  const next = applyHarvest(existing, plan)

  try {
    await mkdir(dirname(outputPath), { recursive: true })
    if (exists) await copyFile(outputPath, outputPath + ".backup")
    const tmp = outputPath + ".tmp"
    await writeFile(tmp, next, "utf-8")
    await rename(tmp, outputPath)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Error writing ${outputPath}: ${message}`)
    return 1
  }

  if (!quiet) {
    const noun = plan.count === 1 ? "memory" : "memories"
    const backup = exists ? ` (backup: ${shortPath(outputPath + ".backup", home)})` : ""
    const verb = exists ? "Added" : "Created the profile with"
    console.log(`✓ ${verb} ${plan.count} ${noun} in ${shortPath(outputPath, home)}${backup}`)
    console.log("")
    console.log("These are Claude Code's notes about you, in its words. Read them over,")
    console.log("then run 'you-md export --all' so every other tool gets them too.")
  }

  return 0
}
