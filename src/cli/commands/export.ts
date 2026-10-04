/**
 * you-md export: carry your you.md context into every AI tool and agent,
 * local or cloud, so the ones that don't speak MCP still know you.
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
 *   cursor     Cursor project rule (mdc)        ./.cursor/rules/you-md.mdc
 *   agents     Project AGENTS.md                ./AGENTS.md
 *   openclaw   OpenClaw workspace user file     ~/.openclaw/workspace/USER.md
 *   hermes     Hermes Agent global identity     ~/.hermes/SOUL.md
 *
 * Cloud personal agents have no local instruction file, so they get a
 * portable copy of your context to hand over (paste, upload, or text):
 *   muse       Muse (Meta)                      ~/.you-md/portable/muse.md
 *   instinct   Instinct                         ~/.you-md/portable/instinct.md
 *   dots       ChatGPT dots                     ~/.you-md/portable/chatgpt-dots.md
 *   grok       Grok Bot                         ~/.you-md/portable/grok-bot.md
 *
 * Claude's memory (claude.ai and Claude Desktop) has a built-in import that
 * takes pasted text, one memory per line. `claude-memory` renders the profile
 * in that shape so you.md can seed Claude's memory in one paste:
 *   claude-memory  Claude memory import          ~/.you-md/portable/claude-memory.txt
 *
 * The reverse direction (another assistant's memory of you, into you.md) is
 * `you-md import`.
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
// Personal-agent rendering
// ---------------------------------------------------------------------------

const DEV_TITLE = /^# User Preferences \(from you.md\)\n*/m

/**
 * Swap the developer-flavored title for a personal one. Personal agents
 * (Muse, OpenClaw, dots, ...) read this as context about a person, not a
 * list of coding preferences.
 */
export function retitle(prefs: string, title: string): string {
  return `# ${title}\n\n` + prefs.replace(DEV_TITLE, "").trimStart()
}

const PORTABLE_PREAMBLE = [
  "This is my personal context, written and kept by me in my you.md.",
  "Use it to tailor how you help me.",
].join("\n")

/**
 * Usage notes addressed to the agent. Phrased as first-person requests, not
 * overrides: agents that screen context for prompt injection (Hermes, dots)
 * should read these as the user's preferences.
 */
const CONFLICT_NOTE =
  "If something here conflicts with what you've inferred about me, go with this " +
  "file and ask me before changing your mind."
const PRIVACY_NOTE =
  "This is private. Don't share or quote it in group chats, with other people, " +
  "or with other people's agents unless I ask you to."
const SAVE_NOTE =
  "Save this as long-term context about me. When I send a new version, it " +
  "replaces this one."

function usageSection(notes: string[]): string {
  return ["## How to use this", "", ...notes.map(n => `- ${n}`)].join("\n")
}

/** Insert text right after the first (title) line of a rendered body. */
function afterTitle(body: string, ...blocks: string[]): string {
  const [title, ...rest] = body.split("\n")
  return [title, "", ...blocks.flatMap(b => [b, ""]), rest.join("\n").trim(), ""].join("\n")
}

/**
 * Render context for a local personal agent (OpenClaw, Hermes). These load
 * the file every session, so they only need the conflict and privacy notes.
 */
export function renderPersonal(prefs: string, title: string): string {
  return afterTitle(retitle(prefs, title), usageSection([CONFLICT_NOTE, PRIVACY_NOTE]))
}

/**
 * Render the portable copy handed to a cloud agent. you-md owns the whole
 * file, so it carries the managed note, a short preamble, and usage notes
 * (plus an optional agent-specific one) for whichever agent receives it.
 */
export function renderPortable(prefs: string, agentNote?: string): string {
  const notes = [SAVE_NOTE, CONFLICT_NOTE, PRIVACY_NOTE]
  if (agentNote) notes.push(agentNote)
  return afterTitle(
    retitle(prefs, "About me (from you.md)"),
    MANAGED_NOTE,
    PORTABLE_PREAMBLE,
    usageSection(notes)
  )
}

// ---------------------------------------------------------------------------
// Memory-import rendering (Claude: Settings > Memory > Start import)
// ---------------------------------------------------------------------------

const HEADER_LINE = /^(#{1,6})\s+(.+?)\s*#*$/
const BULLET_LINE = /^(?:[-*+]|\d+[.)])\s+(.*)$/
const KEY_VALUE_LINE = /^([A-Za-z][\w\s/'()-]{0,48}?):\s*(.*)$/
/** Sections whose entries are things to avoid, not things to do */
const NEGATIVE_SECTION = /\b(boundar|avoid|never|don'?t|do not|dislike|pet peeve)/i

/**
 * Flatten rendered preferences into one memory entry per line: the shape
 * Claude's memory import reads (it extracts individual memories from pasted
 * text; its own export prompt asks for one entry per line).
 *
 * Each entry carries its section as context ("How I Communicate: Tone: direct")
 * so the fact survives being read on its own. Entries under a boundaries-style
 * section are prefixed "Do not:", because a bare "Boundaries: use excessive
 * caveats" reads as the opposite of what the user meant.
 *
 * No "[date saved]" prefix: the import prompt marks it optional, and leaving
 * it off keeps the file identical across exports so `sync` sees real drift
 * rather than a new day.
 *
 * Formatted preferences list a profile's root section (usually "# Me") with
 * its children as subsections, and then the same children again as sections.
 * The same fact is therefore seen twice; each is emitted once, with the
 * shortest context ("How I Work: ..." rather than "Me / How I Work: ...").
 */
export function renderMemoryEntries(prefs: string): string {
  const entries: { context: string; text: string }[] = []
  const byText = new Map<string, number>()
  const add = (context: string, text: string) => {
    const existing = byText.get(text)
    if (existing === undefined) {
      byText.set(text, entries.length)
      entries.push({ context, text })
    } else if (context.length < entries[existing].context.length) {
      entries[existing].context = context
    }
  }
  const negative = (context: string) => NEGATIVE_SECTION.test(context)

  let section = ""
  let subsection = ""
  let inFence = false
  let inComment = false

  for (const raw of prefs.split("\n")) {
    const line = raw.trim()

    if (inComment) {
      if (line.includes("-->")) inComment = false
      continue
    }
    if (line.startsWith("<!--")) {
      if (!line.includes("-->")) inComment = true
      continue
    }
    if (line.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence || line.length === 0) continue

    const header = line.match(HEADER_LINE)
    if (header) {
      const level = header[1].length
      if (level === 1) continue // "# User Preferences (from you.md)"
      if (level === 2) {
        section = header[2]
        subsection = ""
      } else {
        subsection = header[2]
      }
      continue
    }

    const context = subsection ? `${section} / ${subsection}` : section

    // "Author: Name" precedes the first section in formatted output
    if (!section) {
      const kv = line.match(KEY_VALUE_LINE)
      if (kv && kv[1].toLowerCase() === "author" && kv[2]) add("Name", kv[2].trim())
      continue
    }

    const bullet = line.match(BULLET_LINE)
    if (bullet) {
      const text = bullet[1].trim()
      if (text) add(negative(context) ? "Do not" : context, text)
      continue
    }

    const kv = line.match(KEY_VALUE_LINE)
    if (kv) {
      if (!kv[2].trim()) continue // template placeholder like "Timezone:"
      add(context, `${kv[1].trim()}: ${kv[2].trim()}`)
      continue
    }

    add(negative(context) ? "Do not" : context, line)
  }

  return entries.length === 0 ? "" : entries.map(e => `${e.context}: ${e.text}`).join("\n") + "\n"
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
  /**
   * Cloud agents can't read local files. For these, the export is a portable
   * copy and `handoff` tells the user how to get it into the agent.
   */
  handoff?: string
  /** Warn (never truncate) when the rendered content exceeds the tool's limit */
  maxChars?: number
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
    id: "openclaw",
    name: "OpenClaw",
    scope: "user",
    relPath: [".openclaw", "workspace", "USER.md"],
    mode: "managed-block",
    render: prefs => renderPersonal(prefs, "About me (from you.md)"),
    maxChars: 20_000,
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    scope: "user",
    relPath: [".hermes", "SOUL.md"],
    mode: "managed-block",
    render: prefs => renderPersonal(prefs, "About the person you work for (from you.md)"),
    maxChars: 20_000,
  },
  {
    id: "muse",
    name: "Muse (Meta)",
    scope: "user",
    relPath: [".you-md", "portable", "muse.md"],
    mode: "own-file",
    render: prefs => renderPortable(prefs),
    handoff: "In Muse, tap the avatar, open Memory, and paste this file in.",
  },
  {
    id: "instinct",
    name: "Instinct",
    scope: "user",
    relPath: [".you-md", "portable", "instinct.md"],
    mode: "own-file",
    render: prefs =>
      renderPortable(prefs, "Please save all of this to your memory so it carries into future conversations."),
    handoff: "Text this file to Instinct (iMessage or WhatsApp) and ask it to remember it.",
  },
  {
    id: "dots",
    name: "ChatGPT dots",
    scope: "user",
    relPath: [".you-md", "portable", "chatgpt-dots.md"],
    mode: "own-file",
    render: prefs => renderPortable(prefs),
    handoff: "In your dot's conversation, attach this file with + and ask it to keep it as standing context.",
  },
  {
    id: "grok",
    name: "Grok Bot",
    scope: "user",
    relPath: [".you-md", "portable", "grok-bot.md"],
    mode: "own-file",
    render: prefs =>
      renderPortable(prefs, "Re-read /workspace/you.md before every task. It's where I keep this current."),
    handoff:
      "Upload this to your Bots' cloud computer as /workspace/you.md, then add " +
      "\"Read /workspace/you.md before every task\" to each Bot's profile.",
  },
  {
    id: "claude-memory",
    name: "Claude memory",
    scope: "user",
    relPath: [".you-md", "portable", "claude-memory.txt"],
    mode: "own-file",
    render: prefs => renderMemoryEntries(prefs),
    handoff:
      "In Claude (web or Desktop), open Settings > Memory, choose Start import, paste this " +
      "file, and click Add to memory. Claude keeps work-related context best.",
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
): Promise<{ path: string; action: ExportAction; chars: number }> {
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

  return { path, action: exists ? "updated" : "created", chars: rendered.length }
}

/**
 * One-line notes printed after a target is written: how to hand a portable
 * copy to a cloud agent, and whether the content risks truncation.
 */
export function targetNotes(target: ExportTarget, chars: number): string[] {
  const notes: string[] = []
  if (target.handoff) notes.push(`→ ${target.handoff}`)
  if (target.maxChars && chars > target.maxChars) {
    notes.push(
      `! ${chars.toLocaleString("en-US")} chars; ${target.name} truncates past ` +
        `${target.maxChars.toLocaleString("en-US")}. Consider trimming your you.md.`
    )
  }
  return notes
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
  const row = (t: ExportTarget) => {
    const loc = (t.scope === "user" ? "~/" : "./") + t.relPath.join("/")
    return `  ${t.id.padEnd(14)} ${t.name.padEnd(22)} ${loc}`
  }
  const local = EXPORT_TARGETS.filter(t => !t.handoff).map(row).join("\n")
  const cloud = EXPORT_TARGETS.filter(t => t.handoff).map(row).join("\n")

  return `you-md export: carry your personal context into every tool and agent you use

Usage:
  you-md export <target...>         Export to one or more targets
  you-md export --all               Export to all supported targets
  you-md export --all --dry-run     Preview without writing
  you-md export <target> -o <path>  Override output path (single target only)

Tools and agents that read a local file:
${local}

Cloud personal agents (you get a portable copy to hand over):
${cloud}

Exports are idempotent. Managed content lives between you-md markers,
so your own notes in the same file are preserved on re-export. Your
context is yours: every target gets the same profile, and 'you-md sync'
keeps all of them current.`
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
      if (target.handoff) console.log(`  ${"".padEnd(22)} → ${target.handoff}`)
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
      const { path, action, chars } = await exportToTarget(target, prefs, paths, flags.output)
      if (!flags.quiet) {
        console.log(`✓ ${target.name.padEnd(22)} ${action}  ${path}`)
        for (const note of targetNotes(target, chars)) {
          console.log(`  ${"".padEnd(22)} ${note}`)
        }
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
    console.log("Context exported. Local tools read these files at session start;")
    console.log("cloud agents get the portable copy once you hand it over (see → notes).")
    console.log("Re-run 'you-md sync' whenever you update your you.md.")
  }

  return failures > 0 ? 1 : 0
}
