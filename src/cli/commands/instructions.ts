/**
 * Instruction-file precedence audit: which of CLAUDE.md, AGENTS.md, GEMINI.md
 * and friends each coding agent will actually load from this project, and
 * where they silently shadow, duplicate, or truncate each other.
 *
 * Why this exists: since Claude Code 2.1.277 (September 18, 2026) Claude reads
 * a project's AGENTS.md directly, but only when no CLAUDE.md, .claude/CLAUDE.md
 * or CLAUDE.local.md sits in the working directory or any directory above it.
 * A single stray CLAUDE.md therefore hides AGENTS.md from Claude unless it
 * imports it with an `@AGENTS.md` line or the user sets Project instructions
 * to `claude-md-and-agents-md`. Codex caps its AGENTS.md chain at 32 KiB by
 * default, Gemini CLI only reads the names listed in `context.fileName`, and
 * tools that read several files at once (Claude Code in the "both" mode,
 * Copilot CLI) load a you-md managed block twice when it lives in more than
 * one file.
 *
 * Sources:
 *   https://code.claude.com/docs/en/memory#agents-md
 *   https://developers.openai.com/codex/guides/agents-md
 *   https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md
 *
 * Everything here is read-only. `you-md check` prints the result; nothing is
 * written. Fixes point at `you-md export agents` (writes the bridge),
 * `you-md sync`, or the relevant tool setting.
 */

import { readFile } from "node:fs/promises"
import { existsSync, statSync } from "node:fs"
import { resolve, dirname, join, relative, sep } from "node:path"
import { homedir } from "node:os"

import { extractManagedBlock } from "./sync.js"
import { readJsonConfig } from "./skill.js"
import type { ExportPaths } from "./export.js"

// ---------------------------------------------------------------------------
// Constants (documented tool behavior, kept in one place)
// ---------------------------------------------------------------------------

/** Codex `project_doc_max_bytes` default: the AGENTS.md chain is cut here. */
export const CODEX_DEFAULT_DOC_MAX_BYTES = 32 * 1024

/** Anthropic's guidance: files over this many lines reduce adherence. */
export const CLAUDE_RECOMMENDED_MAX_LINES = 200

/** First Claude Code version that reads AGENTS.md without a CLAUDE.md. */
export const CLAUDE_AGENTS_MD_MIN_VERSION = "2.1.277"

/** Values of the Claude Code "Project instructions" setting. */
export type ClaudeInstructionMode =
  | "claude-md-or-agents-md"
  | "claude-md-and-agents-md"
  | "claude-md"
  | "managed-only"

export const CLAUDE_DEFAULT_INSTRUCTION_MODE: ClaudeInstructionMode = "claude-md-or-agents-md"

const CLAUDE_INSTRUCTION_MODES: ClaudeInstructionMode[] = [
  "claude-md-or-agents-md",
  "claude-md-and-agents-md",
  "claude-md",
  "managed-only",
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InstructionFileKind =
  /** CLAUDE.md or .claude/CLAUDE.md: counts as Claude project instructions */
  | "claude"
  /** CLAUDE.local.md: uncommitted, but still counts for Claude */
  | "claude-local"
  /** AGENTS.md or .claude/AGENTS.md */
  | "agents"
  /** AGENTS.override.md (Codex only) */
  | "agents-override"
  /** GEMINI.md */
  | "gemini"
  /** .github/copilot-instructions.md */
  | "copilot"

export interface InstructionFile {
  path: string
  kind: InstructionFileKind
  /** "project": found on the cwd-to-root walk. "user": under the home dir. */
  scope: "project" | "user"
  bytes: number
  lines: number
  /** The you-md managed block (markers included), or null when absent */
  managedBlock: string | null
  /**
   * True when the managed block is the CLAUDE.md -> AGENTS.md bridge written
   * by `you-md export agents` (an `@AGENTS.md` import, not preferences).
   */
  bridge: boolean
  /** True when the file has an `@AGENTS.md` style import line */
  importsAgents: boolean
  /** True when the file mentions AGENTS.md at all (import or prose) */
  mentionsAgents: boolean
}

export type FindingLevel = "warn" | "info"

export interface InstructionFinding {
  /** Stable machine-readable id, e.g. "claude-shadows-agents" */
  code: string
  level: FindingLevel
  /** Which tool's behavior this is about */
  tool: string
  message: string
  fix: string
  paths: string[]
}

export interface InstructionAudit {
  cwd: string
  home: string
  /** Top of the project walk: the first ancestor with a .git dir, else cwd */
  projectRoot: string
  files: InstructionFile[]
  claudeMode: ClaudeInstructionMode
  /** Codex `project_doc_max_bytes` in effect (config.toml or the default) */
  codexDocMaxBytes: number
  /** Bytes Codex would concatenate for this cwd (global + project chain) */
  codexChainBytes: number
  findings: InstructionFinding[]
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const PROJECT_CANDIDATES: { rel: string[]; kind: InstructionFileKind }[] = [
  { rel: ["CLAUDE.md"], kind: "claude" },
  { rel: [".claude", "CLAUDE.md"], kind: "claude" },
  { rel: ["CLAUDE.local.md"], kind: "claude-local" },
  { rel: ["AGENTS.md"], kind: "agents" },
  { rel: [".claude", "AGENTS.md"], kind: "agents" },
  { rel: ["AGENTS.override.md"], kind: "agents-override" },
  { rel: ["GEMINI.md"], kind: "gemini" },
  { rel: [".github", "copilot-instructions.md"], kind: "copilot" },
]

const USER_CANDIDATES: { rel: string[]; kind: InstructionFileKind }[] = [
  { rel: [".claude", "CLAUDE.md"], kind: "claude" },
  { rel: [".codex", "AGENTS.md"], kind: "agents" },
  { rel: [".codex", "AGENTS.override.md"], kind: "agents-override" },
  { rel: [".gemini", "GEMINI.md"], kind: "gemini" },
]

/**
 * `@AGENTS.md`, `@./AGENTS.md`, `@../AGENTS.md`, `@docs/AGENTS.md`: an import
 * token at the start of a line or after whitespace. Prose like "read
 * AGENTS.md" does not match, which is the point: Claude only follows the
 * `@path` form.
 */
const AGENTS_IMPORT_RE = /(^|\s)@(?:\.{1,2}\/)*(?:[\w.-]+\/)*AGENTS\.md(?=\s|$)/m

/**
 * Directories Claude, Codex and Gemini consider for this working directory:
 * cwd and every ancestor up to and including the project root (first
 * directory holding a .git entry). The walk also stops at the home directory
 * and the filesystem root so a stray file above the project is not counted.
 */
export function projectDirectories(cwd: string, home: string): string[] {
  const dirs: string[] = []
  let dir = resolve(cwd)
  const homeDir = resolve(home)
  for (;;) {
    dirs.push(dir)
    if (existsSync(join(dir, ".git"))) break
    const parent = dirname(dir)
    if (parent === dir) break
    if (parent === homeDir || parent === dirname(homeDir)) break
    dir = parent
  }
  return dirs
}

async function describeFile(
  path: string,
  kind: InstructionFileKind,
  scope: "project" | "user"
): Promise<InstructionFile | null> {
  if (!existsSync(path)) return null
  let content: string
  try {
    if (!statSync(path).isFile()) return null
    content = await readFile(path, "utf-8")
  } catch {
    return null
  }
  const trimmed = content.trim()
  const managedBlock = extractManagedBlock(content)
  return {
    path,
    kind,
    scope,
    bytes: Buffer.byteLength(content, "utf-8"),
    lines: trimmed.length === 0 ? 0 : trimmed.split("\n").length,
    managedBlock,
    bridge: managedBlock !== null && AGENTS_IMPORT_RE.test(managedBlock),
    importsAgents: AGENTS_IMPORT_RE.test(content),
    mentionsAgents: /AGENTS\.md/.test(content),
  }
}

async function discoverFiles(cwd: string, home: string): Promise<InstructionFile[]> {
  const files: InstructionFile[] = []
  for (const dir of projectDirectories(cwd, home)) {
    for (const c of PROJECT_CANDIDATES) {
      const f = await describeFile(join(dir, ...c.rel), c.kind, "project")
      if (f) files.push(f)
    }
  }
  for (const c of USER_CANDIDATES) {
    const f = await describeFile(join(home, ...c.rel), c.kind, "user")
    if (f) files.push(f)
  }
  return files
}

// ---------------------------------------------------------------------------
// Tool settings
// ---------------------------------------------------------------------------

async function safeJson(path: string): Promise<Record<string, unknown>> {
  try {
    return await readJsonConfig(path)
  } catch {
    return {}
  }
}

function pluck(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj
  for (const k of keys) {
    if (typeof cur !== "object" || cur === null || !(k in (cur as Record<string, unknown>))) {
      return undefined
    }
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

function readClaudeMode(settings: Record<string, unknown>): ClaudeInstructionMode | null {
  const value = pluck(settings, "pluginConfigs", "agents-md@builtin", "options", "instructionFiles")
  return typeof value === "string" && (CLAUDE_INSTRUCTION_MODES as string[]).includes(value)
    ? (value as ClaudeInstructionMode)
    : null
}

/** True when a SessionStart hook command mentions AGENTS.md (old workaround). */
function sessionStartPrintsAgents(settings: Record<string, unknown>): boolean {
  const hooks = pluck(settings, "hooks", "SessionStart")
  if (hooks === undefined) return false
  try {
    return /AGENTS\.md/.test(JSON.stringify(hooks))
  } catch {
    return false
  }
}

async function readCodexDocMaxBytes(home: string): Promise<number> {
  const configPath = join(home, ".codex", "config.toml")
  if (!existsSync(configPath)) return CODEX_DEFAULT_DOC_MAX_BYTES
  try {
    const toml = await readFile(configPath, "utf-8")
    const match = /^\s*project_doc_max_bytes\s*=\s*(\d+)/m.exec(toml)
    if (match) {
      const n = Number.parseInt(match[1], 10)
      if (Number.isFinite(n) && n > 0) return n
    }
  } catch {
    // unreadable config: fall through to the default
  }
  return CODEX_DEFAULT_DOC_MAX_BYTES
}

/**
 * Bytes Codex concatenates: the global file (AGENTS.override.md, else
 * AGENTS.md, under ~/.codex), then one file per directory from the project
 * root down to cwd (AGENTS.override.md wins over AGENTS.md). Empty files are
 * skipped, as Codex does.
 */
function codexChainBytes(files: InstructionFile[], dirs: string[]): number {
  const byPath = new Map(files.map(f => [f.path, f]))
  let total = 0

  const pick = (dir: string, ...names: string[]): InstructionFile | undefined => {
    for (const name of names) {
      const f = byPath.get(join(dir, name))
      if (f && f.bytes > 0) return f
    }
    return undefined
  }

  const userFile = files.find(
    f => f.scope === "user" && f.kind === "agents-override" && f.bytes > 0
  ) ?? files.find(f => f.scope === "user" && f.kind === "agents" && f.bytes > 0)
  if (userFile) total += userFile.bytes

  for (const dir of [...dirs].reverse()) {
    const f = pick(dir, "AGENTS.override.md", "AGENTS.md")
    if (f) total += f.bytes
  }
  return total
}

function geminiContextNames(settings: Record<string, unknown>): string[] {
  const value = pluck(settings, "context", "fileName")
  if (typeof value === "string" && value.trim()) return [value.trim()]
  if (Array.isArray(value)) {
    const names = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    if (names.length > 0) return names.map(n => n.trim())
  }
  return ["GEMINI.md"]
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function auditInstructionFiles(paths?: ExportPaths): Promise<InstructionAudit> {
  const cwd = resolve(paths?.cwd ?? process.cwd())
  const home = resolve(paths?.home ?? homedir())
  const dirs = projectDirectories(cwd, home)
  const projectRoot = dirs[dirs.length - 1]

  const files = await discoverFiles(cwd, home)
  const findings: InstructionFinding[] = []

  const userClaudeSettings = await safeJson(join(home, ".claude", "settings.json"))
  const projectClaudeSettings = await safeJson(join(projectRoot, ".claude", "settings.json"))
  const projectClaudeLocalSettings = await safeJson(join(projectRoot, ".claude", "settings.local.json"))
  const geminiSettings = await safeJson(join(home, ".gemini", "settings.json"))

  const claudeMode = readClaudeMode(userClaudeSettings) ?? CLAUDE_DEFAULT_INSTRUCTION_MODE

  const project = files.filter(f => f.scope === "project")
  const countingClaude = project.filter(f => f.kind === "claude" || f.kind === "claude-local")
  const agentsFiles = project.filter(f => f.kind === "agents")
  const rel = (f: InstructionFile): string => displayPath(f.path, projectRoot, home)

  // -- Claude Code: does AGENTS.md reach Claude at all? ----------------------
  if (agentsFiles.length > 0) {
    const bridged = countingClaude.some(f => f.importsAgents)

    if (countingClaude.length > 0 && !bridged && claudeMode !== "claude-md-and-agents-md") {
      const mentions = countingClaude.filter(f => f.mentionsAgents)
      const shadowers = countingClaude.map(rel).join(", ")
      if (mentions.length > 0) {
        findings.push({
          code: "claude-mentions-agents-without-import",
          level: "warn",
          tool: "Claude Code",
          message:
            `${mentions.map(rel).join(", ")} talks about AGENTS.md in prose, but only an ` +
            `\`@AGENTS.md\` import line makes Claude load it. With a CLAUDE.md on the path, ` +
            `Claude Code (${CLAUDE_AGENTS_MD_MIN_VERSION}+) reads CLAUDE.md only and skips AGENTS.md.`,
          fix: "Replace the sentence with an `@AGENTS.md` line, or run `you-md export agents` to add a managed import.",
          paths: [...mentions.map(f => f.path), ...agentsFiles.map(f => f.path)],
        })
      } else {
        findings.push({
          code: "claude-shadows-agents",
          level: "warn",
          tool: "Claude Code",
          message:
            `${shadowers} shadows ${agentsFiles.map(rel).join(", ")}. By default Claude Code ` +
            `(${CLAUDE_AGENTS_MD_MIN_VERSION}+) reads AGENTS.md only when no CLAUDE.md, .claude/CLAUDE.md ` +
            `or CLAUDE.local.md exists in the working directory or above it.`,
          fix:
            "Run `you-md export agents` to add an `@AGENTS.md` import to CLAUDE.md, or set Project " +
            "instructions to `claude-md-and-agents-md` in Claude Code's /config.",
          paths: [...countingClaude.map(f => f.path), ...agentsFiles.map(f => f.path)],
        })
      }
    }

    if (countingClaude.length === 0 && (claudeMode === "claude-md" || claudeMode === "managed-only")) {
      findings.push({
        code: "claude-mode-skips-agents",
        level: "warn",
        tool: "Claude Code",
        message:
          `Project instructions is set to \`${claudeMode}\` in ~/.claude/settings.json, so Claude Code ` +
          `does not read ${agentsFiles.map(rel).join(", ")}.`,
        fix:
          "Run `you-md export agents` to add a CLAUDE.md that imports AGENTS.md, or switch the setting " +
          "back to `claude-md-or-agents-md`.",
        paths: agentsFiles.map(f => f.path),
      })
    }

    if (countingClaude.length === 0 && claudeMode !== "claude-md" && claudeMode !== "managed-only") {
      findings.push({
        code: "agents-read-directly",
        level: "info",
        tool: "Claude Code",
        message:
          `No CLAUDE.md on the path: Claude Code ${CLAUDE_AGENTS_MD_MIN_VERSION}+ reads ` +
          `${agentsFiles.map(rel).join(", ")} directly. Older versions, and sessions where the built-in ` +
          `agents-md plugin is disabled, still need a CLAUDE.md that imports it.`,
        fix: "Optional: `you-md export agents` writes a one-line CLAUDE.md bridge for those sessions.",
        paths: agentsFiles.map(f => f.path),
      })
    }
  }

  // Claude Code ignores the mode in project settings; people set it there anyway.
  for (const [settings, file] of [
    [projectClaudeSettings, join(projectRoot, ".claude", "settings.json")],
    [projectClaudeLocalSettings, join(projectRoot, ".claude", "settings.local.json")],
  ] as const) {
    const mode = readClaudeMode(settings)
    if (mode) {
      findings.push({
        code: "claude-mode-ignored-in-project-settings",
        level: "info",
        tool: "Claude Code",
        message:
          `${displayPath(file, projectRoot, home)} sets Project instructions to \`${mode}\`, but Claude Code ` +
          `only honors that option in ~/.claude/settings.json, a --settings file, or managed settings.`,
        fix: "Move the `agents-md@builtin` pluginConfigs entry to ~/.claude/settings.json.",
        paths: [file],
      })
    }
  }

  // Old workaround: a SessionStart hook that cats AGENTS.md now doubles it.
  for (const [settings, file] of [
    [userClaudeSettings, join(home, ".claude", "settings.json")],
    [projectClaudeSettings, join(projectRoot, ".claude", "settings.json")],
    [projectClaudeLocalSettings, join(projectRoot, ".claude", "settings.local.json")],
  ] as const) {
    if (sessionStartPrintsAgents(settings)) {
      findings.push({
        code: "session-start-hook-duplicates-agents",
        level: "warn",
        tool: "Claude Code",
        message:
          `A SessionStart hook in ${displayPath(file, projectRoot, home)} mentions AGENTS.md. Now that ` +
          `Claude Code reads AGENTS.md itself, the hook adds a second copy to every session's context.`,
        fix: "Remove the hook. Keep an `@AGENTS.md` import in CLAUDE.md if some sessions cannot load AGENTS.md directly.",
        paths: [file],
      })
    }
  }

  // -- Managed blocks: duplicates and drift ----------------------------------
  // The CLAUDE.md bridge is a managed block too, but it holds an import, not
  // preferences, so it is neither a duplicate nor a drifted copy.
  const managed = files.filter(f => f.managedBlock !== null && !f.bridge && f.kind !== "agents-override")
  const projectManaged = managed.filter(f => f.scope === "project")
  const userClaude = managed.find(f => f.scope === "user" && f.kind === "claude")

  if (projectManaged.length > 1) {
    const names = projectManaged.map(rel).join(", ")
    findings.push({
      code: "duplicate-managed-blocks",
      level: "warn",
      tool: "Multiple tools",
      message:
        `Your you.md block is in ${projectManaged.length} project files (${names}). Copilot CLI reads ` +
        `all of them, and Claude Code loads both CLAUDE.md and AGENTS.md when one imports the other ` +
        `or Project instructions is \`claude-md-and-agents-md\`, so the same preferences are sent twice.`,
      fix: "Keep the block in AGENTS.md only: remove the you-md markers from the other files and let CLAUDE.md import AGENTS.md.",
      paths: projectManaged.map(f => f.path),
    })
  }

  if (userClaude && projectManaged.some(f => f.kind === "agents" || f.kind === "claude" || f.kind === "claude-local")) {
    const projectNames = projectManaged
      .filter(f => f.kind === "agents" || f.kind === "claude" || f.kind === "claude-local")
      .map(rel)
      .join(", ")
    findings.push({
      code: "user-and-project-managed-blocks",
      level: "info",
      tool: "Claude Code",
      message:
        `Claude Code loads ~/.claude/CLAUDE.md in every session and ${projectNames} in this project, ` +
        `and both carry your you.md block, so your preferences appear twice here.`,
      fix: "Fine for a personal machine. On a shared repo, keep only the project block or only the user-level export.",
      paths: [userClaude.path, ...projectManaged.map(f => f.path)],
    })
  }

  const distinctBlocks = new Set(managed.map(f => (f.managedBlock ?? "").trimEnd()))
  if (managed.length > 1 && distinctBlocks.size > 1) {
    findings.push({
      code: "managed-block-drift",
      level: "warn",
      tool: "Multiple tools",
      message:
        `The you-md managed blocks in ${managed.map(rel).join(", ")} differ from each other, so tools ` +
        `are reading different versions of your preferences.`,
      fix: "Run `you-md sync` to refresh every exported file from your you.md.",
      paths: managed.map(f => f.path),
    })
  }

  // -- Length guidance (Claude reads these) -----------------------------------
  const claudeReads = project.filter(f => f.kind === "claude" || f.kind === "claude-local" || f.kind === "agents")
  for (const f of claudeReads) {
    if (f.lines > CLAUDE_RECOMMENDED_MAX_LINES) {
      findings.push({
        code: "long-instruction-file",
        level: "info",
        tool: "Claude Code",
        message:
          `${rel(f)} is ${f.lines} lines. Anthropic recommends under ${CLAUDE_RECOMMENDED_MAX_LINES} ` +
          `lines per instruction file; longer files consume more context and reduce adherence.`,
        fix: "Move path-specific rules into .claude/rules/ or trim content that is not needed in every session.",
        paths: [f.path],
      })
    }
  }

  // -- Codex: 32 KiB chain cap -------------------------------------------------
  const codexDocMaxBytes = await readCodexDocMaxBytes(home)
  const chainBytes = codexChainBytes(files, dirs)
  if (chainBytes > codexDocMaxBytes) {
    findings.push({
      code: "codex-size-cap",
      level: "warn",
      tool: "Codex CLI",
      message:
        `Codex concatenates ~/.codex/AGENTS.md and every AGENTS.md from the project root down to here: ` +
        `${formatBytes(chainBytes)} total, over its ${formatBytes(codexDocMaxBytes)} project_doc_max_bytes ` +
        `limit. Files past the limit are dropped, starting with the ones closest to your working directory.`,
      fix: "Trim the files, or raise `project_doc_max_bytes` in ~/.codex/config.toml.",
      paths: files.filter(f => f.kind === "agents" || f.kind === "agents-override").map(f => f.path),
    })
  }

  // -- Gemini CLI: only reads the configured context file names --------------
  if (agentsFiles.length > 0) {
    const names = geminiContextNames(geminiSettings)
    const readsAgents = names.includes("AGENTS.md")
    const hasGeminiFile = project.some(f => f.kind === "gemini") || names.some(n => project.some(f => f.path.endsWith(sep + n)))
    if (!readsAgents && !hasGeminiFile) {
      findings.push({
        code: "gemini-skips-agents",
        level: "info",
        tool: "Gemini CLI",
        message:
          `Gemini CLI loads only ${names.map(n => `\`${n}\``).join(", ")} (its context.fileName setting), so it ` +
          `does not see ${agentsFiles.map(rel).join(", ")} and this project has no GEMINI.md.`,
        fix: "Run `you-md export gemini`, or add \"AGENTS.md\" to `context.fileName` in ~/.gemini/settings.json.",
        paths: agentsFiles.map(f => f.path),
      })
    }
  }

  return { cwd, home, projectRoot, files, claudeMode, codexDocMaxBytes, codexChainBytes: chainBytes, findings }
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export function displayPath(path: string, projectRoot: string, home: string): string {
  const fromRoot = relative(projectRoot, path)
  if (fromRoot && !fromRoot.startsWith("..") && !fromRoot.startsWith(sep)) {
    return "./" + fromRoot.split(sep).join("/")
  }
  const fromHome = relative(home, path)
  if (fromHome && !fromHome.startsWith("..") && !fromHome.startsWith(sep)) {
    return "~/" + fromHome.split(sep).join("/")
  }
  return path
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  if (Number.isInteger(kib) || kib >= 100) return `${Math.round(kib)} KiB`
  return `${kib.toFixed(1)} KiB`
}

function fileNote(f: InstructionFile): string {
  const notes: string[] = []
  if (f.managedBlock !== null) notes.push(f.bridge ? "you-md bridge" : "you-md block")
  if (f.importsAgents) notes.push("imports @AGENTS.md")
  else if (f.mentionsAgents && (f.kind === "claude" || f.kind === "claude-local")) {
    notes.push("mentions AGENTS.md, no import")
  }
  return notes.join(", ")
}

/**
 * Render the audit the way `you-md check` prints it. Exported so tests can
 * assert on the lines without capturing stdout.
 */
export function renderInstructionAudit(audit: InstructionAudit): string[] {
  const out: string[] = []
  const show = (p: string): string => displayPath(p, audit.projectRoot, audit.home)

  out.push(`Instruction files (project root: ${audit.projectRoot}):`)
  if (audit.files.length === 0) {
    out.push("    (none found in this project or your home directory)")
  } else {
    const width = Math.max(...audit.files.map(f => show(f.path).length))
    for (const f of audit.files) {
      const label = show(f.path).padEnd(width)
      const lines = `${f.lines} line${f.lines === 1 ? "" : "s"}`.padStart(10)
      const note = fileNote(f)
      out.push(`    ${label}  ${lines}${note ? "   " + note : ""}`)
    }
  }
  out.push(
    `    Claude Code project instructions: ${audit.claudeMode}` +
      (audit.claudeMode === CLAUDE_DEFAULT_INSTRUCTION_MODE ? " (default)" : "")
  )
  out.push("")
  out.push("Precedence:")
  if (audit.findings.length === 0) {
    out.push("    ✓ No shadowing, duplication, or truncation found")
  } else {
    for (const finding of audit.findings) {
      const icon = finding.level === "warn" ? "⚠" : "ℹ"
      out.push(`    ${icon} ${finding.tool.padEnd(14)} ${finding.message}`)
      out.push(`      ${"".padEnd(14)} fix: ${finding.fix}`)
    }
  }
  return out
}
