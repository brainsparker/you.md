/**
 * you-md import: harvest the preferences you already wrote into other tools'
 * instruction files and consolidate them into one you.md profile.
 *
 * Usage:
 *   you-md import                       Scan the user-level files of every known tool
 *   you-md import --all                 Also scan project-level files in the current directory
 *   you-md import <file...>             Import specific files (CLAUDE.md, .cursorrules, .mdc, ...)
 *   you-md import -o ~/.you.md          Write the profile instead of printing it
 *   you-md import -o ~/.you.md --merge  Add only what the existing profile is missing
 *   you-md import --dry-run             Show what would be imported, write nothing
 *
 * Why: most people arrive at you.md with preferences already spread across
 * ~/.claude/CLAUDE.md, ~/.gemini/GEMINI.md, .cursor/rules, Copilot
 * instructions, and friends, each saying slightly different things. import is
 * the on-ramp: read them all, strip tool-specific framing, group the content
 * into you.md sections, drop duplicates, and keep a note of where each line
 * came from. Managed blocks written by `you-md export` are skipped so a
 * round trip never re-imports its own output.
 */

import { readFile, writeFile, mkdir, copyFile, rename, readdir } from "node:fs/promises"
import { existsSync, statSync } from "node:fs"
import { resolve, join, dirname, extname } from "node:path"
import { homedir } from "node:os"

import { CURRENT_SCHEMA_VERSION } from "../../utils/constants.js"
import { extractFrontmatter } from "../../parser/frontmatter.js"
import type { CliFlags } from "../args.js"
import { BEGIN_MARKER, END_MARKER } from "./export.js"

// ---------------------------------------------------------------------------
// Import sources
// ---------------------------------------------------------------------------

/**
 * Where each tool keeps the instruction file it reads at session start.
 *
 * "user" sources hold personal preferences and are scanned by default.
 * "project" sources describe one repository and are scanned only with --all
 * (or when passed explicitly), since a you.md is about the person first.
 *
 * Paths follow each tool's published documentation; see docs links in the
 * pull request that introduced this command.
 */
export interface ImportSource {
  id: string
  name: string
  scope: "user" | "project"
  /** Path segments relative to the scope root */
  relPath: string[]
  /** When true, relPath is a directory and every .md/.mdc inside is a source */
  directory?: boolean
}

export const IMPORT_SOURCES: ImportSource[] = [
  // User-level (personal) files
  { id: "claude", name: "Claude Code", scope: "user", relPath: [".claude", "CLAUDE.md"] },
  { id: "codex", name: "Codex CLI", scope: "user", relPath: [".codex", "AGENTS.md"] },
  { id: "gemini", name: "Gemini CLI", scope: "user", relPath: [".gemini", "GEMINI.md"] },
  {
    id: "windsurf",
    name: "Windsurf",
    scope: "user",
    relPath: [".codeium", "windsurf", "memories", "global_rules.md"],
  },
  { id: "copilot", name: "GitHub Copilot", scope: "user", relPath: [".copilot", "copilot-instructions.md"] },
  { id: "junie", name: "JetBrains Junie", scope: "user", relPath: [".junie", "AGENTS.md"] },
  { id: "zed", name: "Zed", scope: "user", relPath: [".config", "zed", "AGENTS.md"] },
  { id: "opencode", name: "OpenCode", scope: "user", relPath: [".config", "opencode", "AGENTS.md"] },
  { id: "kiro", name: "Kiro", scope: "user", relPath: [".kiro", "steering"], directory: true },

  // Project-level files (current directory)
  { id: "claude-project", name: "Claude Code (project)", scope: "project", relPath: ["CLAUDE.md"] },
  { id: "agents", name: "AGENTS.md", scope: "project", relPath: ["AGENTS.md"] },
  { id: "gemini-project", name: "Gemini CLI (project)", scope: "project", relPath: ["GEMINI.md"] },
  { id: "cursorrules", name: "Cursor (.cursorrules)", scope: "project", relPath: [".cursorrules"] },
  { id: "cursor-rules", name: "Cursor rules", scope: "project", relPath: [".cursor", "rules"], directory: true },
  { id: "windsurfrules", name: "Windsurf (project)", scope: "project", relPath: [".windsurfrules"] },
  { id: "clinerules", name: "Cline", scope: "project", relPath: [".clinerules"] },
  { id: "roo", name: "Roo Code", scope: "project", relPath: [".roo", "rules"], directory: true },
  {
    id: "copilot-project",
    name: "GitHub Copilot (repo)",
    scope: "project",
    relPath: [".github", "copilot-instructions.md"],
  },
  { id: "kiro-project", name: "Kiro (workspace)", scope: "project", relPath: [".kiro", "steering"], directory: true },
  { id: "junie-project", name: "JetBrains Junie (project)", scope: "project", relPath: [".junie", "guidelines.md"] },
]

/**
 * Base directories used to resolve source paths. Injectable for tests.
 */
export interface ImportPaths {
  home?: string
  cwd?: string
}

const IMPORTABLE_EXTENSIONS = new Set([".md", ".mdc", ".markdown", ".txt", ""])
const MAX_SOURCE_BYTES = 1024 * 1024

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

async function listImportableFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && IMPORTABLE_EXTENSIONS.has(extname(e.name).toLowerCase()))
    .map(e => join(dir, e.name))
    .sort()
}

/**
 * Resolve every file a source points at. A directory source expands to the
 * importable files inside it; a missing path resolves to nothing.
 */
export async function resolveSourceFiles(source: ImportSource, paths?: ImportPaths): Promise<string[]> {
  const base = source.scope === "user" ? (paths?.home ?? homedir()) : (paths?.cwd ?? process.cwd())
  const path = resolve(base, ...source.relPath)

  if (source.directory) {
    return isDirectory(path) ? listImportableFiles(path) : []
  }
  // .clinerules can be a single file or a directory of .md files
  if (isDirectory(path)) {
    return listImportableFiles(path)
  }
  return isFile(path) ? [path] : []
}

/**
 * Discover every instruction file present on this machine.
 */
export async function discoverImportFiles(
  options: { includeProject?: boolean },
  paths?: ImportPaths
): Promise<{ source: ImportSource; file: string }[]> {
  const found: { source: ImportSource; file: string }[] = []
  const seen = new Set<string>()
  for (const source of IMPORT_SOURCES) {
    if (source.scope === "project" && !options.includeProject) continue
    for (const file of await resolveSourceFiles(source, paths)) {
      if (seen.has(file)) continue
      seen.add(file)
      found.push({ source, file })
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// Section classification
// ---------------------------------------------------------------------------

/**
 * The you.md v1.1 sections imported content is sorted into, in output order.
 */
export const IMPORT_SECTIONS = [
  "What I Do",
  "How I Work",
  "How I Communicate",
  "What I Trust",
  "Context",
  "Boundaries",
] as const

export type ImportSection = (typeof IMPORT_SECTIONS)[number]

const DEFAULT_SECTION: ImportSection = "How I Work"

interface HeadingRule {
  section: ImportSection
  pattern: RegExp
}

/**
 * Heading keywords, checked in order. The first match wins, so the most
 * specific signals (boundaries, communication) come before the broad ones.
 */
const HEADING_RULES: HeadingRule[] = [
  {
    section: "Boundaries",
    pattern: /\b(don'?t|do not|never|avoid|boundar\w*|forbidden|prohibited|not allowed|anti-?patterns?|restrictions?|limits)\b/i,
  },
  {
    section: "How I Communicate",
    pattern: /\b(communicat\w*|tone|verbosity|verbose|respons\w*|answers?|explanations?|explain\w*|writing style|voice|talk\w*|chat\w*|output style|how to reply)\b/i,
  },
  {
    section: "What I Trust",
    pattern: /\b(trust\w*|sources?|references?|citations?|documentation to use|fact[- ]?check\w*)\b/i,
  },
  {
    section: "Context",
    pattern: /\b(environment|setup|machine|operating system|os|shell|hardware|timezone|locale|devices?|context)\b/i,
  },
  {
    section: "What I Do",
    pattern: /\b(about me|who i am|background|my role|role|bio|profile|expertise|experience|what i do)\b/i,
  },
]

/**
 * Map an instruction-file heading to a you.md section.
 */
export function classifyHeading(heading: string | null): ImportSection {
  if (!heading) return DEFAULT_SECTION
  for (const rule of HEADING_RULES) {
    if (rule.pattern.test(heading)) return rule.section
  }
  return DEFAULT_SECTION
}

const NEGATIVE_ITEM = /^(?:[-*+]|\d+[.)])\s+(?:\*\*)?(?:never|don'?t|do not|avoid|no |not |stop )/i

/**
 * Bullets that read as prohibitions belong in Boundaries even when the
 * heading above them was generic ("Guidelines", "Rules").
 */
export function classifyItem(item: string, headingSection: ImportSection): ImportSection {
  if (headingSection === DEFAULT_SECTION && NEGATIVE_ITEM.test(item)) return "Boundaries"
  return headingSection
}

// ---------------------------------------------------------------------------
// Source file parsing
// ---------------------------------------------------------------------------

export interface ImportedItem {
  section: ImportSection
  /** The item text as it appeared (bullet marker preserved for list items) */
  text: string
  /** Normalized form used for duplicate detection */
  key: string
  /** Display path of the file it came from */
  origin: string
}

export interface SourceReport {
  file: string
  origin: string
  status: "imported" | "skipped"
  reason?: string
  items: number
}

export interface ParsedSource {
  items: ImportedItem[]
  report: SourceReport
}

/**
 * Remove every you-md managed block so we never re-import our own exports.
 */
export function stripManagedBlocks(content: string): string {
  let out = content
  for (;;) {
    const begin = out.indexOf(BEGIN_MARKER)
    if (begin === -1) break
    const end = out.indexOf(END_MARKER, begin)
    if (end === -1) {
      out = out.slice(0, begin)
      break
    }
    out = out.slice(0, begin) + out.slice(end + END_MARKER.length)
  }
  return out
}

const YOU_MD_OWNED = /Managed by you-md\./
const CLAUDE_IMPORT_LINE = /^@\S+\s*$/
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+/
const FENCE = /^\s*(```|~~~)/

/**
 * Normalize an item for duplicate detection: case, whitespace, list markers,
 * emphasis, and trailing punctuation all collapse.
 */
export function normalizeKey(text: string): string {
  return text
    .replace(LIST_ITEM, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.;:,]+$/g, "")
    .trim()
    .toLowerCase()
}

/**
 * Turn a source file's body into items grouped by heading.
 *
 * An item is a list entry (with its indented continuation lines) or a
 * paragraph. Fenced code blocks travel with the item that precedes them.
 * Headings decide the target section; the text of the heading itself is not
 * imported, since you.md supplies its own section names.
 */
export function extractItems(body: string, origin: string): ImportedItem[] {
  const items: ImportedItem[] = []
  const lines = body.split(/\r?\n/)

  let headingSection: ImportSection = DEFAULT_SECTION
  let buffer: string[] = []
  let inFence = false

  const flush = (): void => {
    const text = buffer.join("\n").trimEnd()
    buffer = []
    if (!text.trim()) return
    const key = normalizeKey(text)
    if (!key) return
    items.push({ section: classifyItem(text, headingSection), text, key, origin })
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "")

    if (FENCE.test(line)) {
      inFence = !inFence
      buffer.push(line)
      continue
    }
    if (inFence) {
      buffer.push(line)
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      flush()
      headingSection = classifyHeading(heading[2])
      continue
    }

    if (line.trim() === "") {
      flush()
      continue
    }

    if (CLAUDE_IMPORT_LINE.test(line)) {
      // Claude Code `@path` imports pull in other files; the content lives there, not here.
      flush()
      continue
    }

    if (LIST_ITEM.test(line)) {
      flush()
      buffer.push(line)
      continue
    }

    if (/^\s+/.test(rawLine) && buffer.length > 0 && LIST_ITEM.test(buffer[0])) {
      // Indented continuation of the current list item
      buffer.push(line)
      continue
    }

    buffer.push(line)
  }
  flush()

  return items
}

/**
 * Shorten a path for display, replacing the home directory with ~.
 */
export function displayPath(file: string, home: string): string {
  const normalizedHome = home.replace(/[\\/]+$/, "")
  if (normalizedHome && file.startsWith(normalizedHome + "/")) {
    return "~" + file.slice(normalizedHome.length)
  }
  return file
}

/**
 * Read and parse one instruction file into you.md items.
 */
export async function parseSourceFile(file: string, paths?: ImportPaths): Promise<ParsedSource> {
  const home = paths?.home ?? homedir()
  const origin = displayPath(file, home)
  const skip = (reason: string): ParsedSource => ({
    items: [],
    report: { file, origin, status: "skipped", reason, items: 0 },
  })

  let size = 0
  try {
    size = statSync(file).size
  } catch {
    return skip("not readable")
  }
  if (size > MAX_SOURCE_BYTES) return skip("larger than 1 MB")

  let raw: string
  try {
    raw = await readFile(file, "utf-8")
  } catch {
    return skip("not readable")
  }

  const { frontmatter, content } = extractFrontmatter(raw)
  if (frontmatter && /^\s*schema_version\s*:/m.test(frontmatter)) {
    return skip("already a you.md profile")
  }

  // Frontmatter from Cursor .mdc (description, globs, alwaysApply) and
  // Copilot .instructions.md (applyTo) is tool routing, not preference text.
  // Managed blocks are our own exports; whatever remains is the user's.
  const body = stripManagedBlocks(content)
  if (YOU_MD_OWNED.test(body)) return skip("written by you-md export")
  const cleaned = body.replace(HTML_COMMENT, "")

  const items = extractItems(cleaned, origin)

  if (items.length === 0) return skip("nothing left after removing you-md managed content")

  return {
    items,
    report: { file, origin, status: "imported", reason: undefined, items: items.length },
  }
}

// ---------------------------------------------------------------------------
// Profile assembly
// ---------------------------------------------------------------------------

export interface ImportResult {
  /** Items kept, in output order, duplicates removed */
  items: ImportedItem[]
  /** Items dropped because an earlier source already said the same thing */
  duplicates: number
  reports: SourceReport[]
}

/**
 * Parse every file and drop duplicates across them. Earlier files win, so
 * order the inputs from most to least authoritative.
 */
export async function collectItems(
  files: string[],
  paths?: ImportPaths,
  existingKeys?: Set<string>
): Promise<ImportResult> {
  const seen = new Set<string>(existingKeys ?? [])
  const items: ImportedItem[] = []
  const reports: SourceReport[] = []
  let duplicates = 0

  for (const file of files) {
    const parsed = await parseSourceFile(file, paths)
    let kept = 0
    for (const item of parsed.items) {
      if (seen.has(item.key)) {
        duplicates++
        continue
      }
      seen.add(item.key)
      items.push(item)
      kept++
    }
    if (parsed.report.status === "imported") {
      parsed.report.items = kept
      if (kept === 0) {
        parsed.report.status = "skipped"
        parsed.report.reason = "nothing new: already in the profile or an earlier file"
      }
    }
    reports.push(parsed.report)
  }

  return { items, duplicates, reports }
}

/**
 * Render items grouped by section, with a provenance note per source file.
 */
export function renderSections(items: ImportedItem[]): Map<ImportSection, string> {
  const out = new Map<ImportSection, string>()
  for (const section of IMPORT_SECTIONS) {
    const inSection = items.filter(i => i.section === section)
    if (inSection.length === 0) continue
    const lines: string[] = []
    let lastOrigin: string | null = null
    for (const item of inSection) {
      if (item.origin !== lastOrigin) {
        if (lines.length > 0) lines.push("")
        lines.push(`<!-- imported from ${item.origin} -->`)
        lastOrigin = item.origin
      }
      lines.push(item.text)
    }
    out.set(section, lines.join("\n"))
  }
  return out
}

/**
 * Build a complete profile on the current schema version from imported items.
 */
export function renderProfile(items: ImportedItem[], today: string = new Date().toISOString().split("T")[0]): string {
  const sections = renderSections(items)
  const lines: string[] = [
    "---",
    `schema_version: "${CURRENT_SCHEMA_VERSION}"`,
    `created: "${today}"`,
    `last_updated: "${today}"`,
    'privacy_level: "private"',
    "---",
    "",
    "# Me",
    "",
    "<!-- Imported by you-md import. Review, trim, and reword: this is your profile now. -->",
    "",
  ]
  for (const section of IMPORT_SECTIONS) {
    const content = sections.get(section)
    if (!content) continue
    lines.push(`## ${section}`, "", content, "")
  }
  return lines.join("\n")
}

/**
 * Collect normalized keys for every content line already in a profile, so
 * --merge only adds what is missing.
 */
export function existingProfileKeys(profile: string): Set<string> {
  const { content } = extractFrontmatter(profile)
  const keys = new Set<string>()
  for (const item of extractItems(content.replace(HTML_COMMENT, ""), "")) {
    keys.add(item.key)
  }
  return keys
}

/**
 * Append new items to an existing profile. Sections that already exist get
 * the new lines at their end; missing sections are added before any trailing
 * whitespace. The frontmatter last_updated field is refreshed when present.
 */
export function mergeIntoProfile(
  existing: string,
  items: ImportedItem[],
  today: string = new Date().toISOString().split("T")[0]
): string {
  const sections = renderSections(items)
  if (sections.size === 0) return existing

  const lines = existing.replace(/\r\n/g, "\n").split("\n")

  // Locate level-2 headings outside frontmatter and code fences
  const { contentStartLine } = extractFrontmatter(existing)
  const headingIndex: { title: string; line: number }[] = []
  let inFence = false
  for (let i = contentStartLine - 1; i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = !inFence
    if (inFence) continue
    const m = lines[i].match(/^##\s+(.+?)\s*$/)
    if (m) headingIndex.push({ title: m[1].trim().toLowerCase(), line: i })
  }

  // Apply in reverse line order so earlier indices stay valid
  const appends: { line: number; text: string }[] = []
  const missing: ImportSection[] = []
  for (const section of IMPORT_SECTIONS) {
    const content = sections.get(section)
    if (!content) continue
    const idx = headingIndex.findIndex(h => h.title === section.toLowerCase())
    if (idx === -1) {
      missing.push(section)
      continue
    }
    const next = headingIndex[idx + 1]
    // Insert before the next level-2 heading, or at end of file
    let insertAt = next ? next.line : lines.length
    while (insertAt > headingIndex[idx].line + 1 && lines[insertAt - 1].trim() === "") insertAt--
    appends.push({ line: insertAt, text: content })
  }
  appends.sort((a, b) => b.line - a.line)
  for (const a of appends) {
    lines.splice(a.line, 0, "", a.text)
  }

  let result = lines.join("\n").trimEnd() + "\n"
  for (const section of missing) {
    result += `\n## ${section}\n\n${sections.get(section)}\n`
  }

  if (/^last_updated\s*:/m.test(result)) {
    result = result.replace(/^last_updated\s*:.*$/m, `last_updated: "${today}"`)
  }
  return result
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

function helpText(): string {
  return `you-md import: gather preferences from the instruction files you already have.

  you-md import                       Scan user-level files: ${IMPORT_SOURCES.filter(s => s.scope === "user")
    .map(s => s.name)
    .join(", ")}
  you-md import --all                 Also scan project-level files in the current directory
  you-md import <file...>             Import specific files
  you-md import -o ~/.you.md          Write the profile (refuses to overwrite without --force)
  you-md import -o ~/.you.md --merge  Add only lines the existing profile does not have yet
  you-md import --dry-run             Show what would be imported, write nothing
  you-md import --json                Machine-readable report

Content written by you-md export is skipped, so importing and exporting never loop.`
}

async function writeProfile(path: string, content: string): Promise<"created" | "updated"> {
  const exists = existsSync(path)
  await mkdir(dirname(path), { recursive: true })
  if (exists) {
    await copyFile(path, path + ".backup")
  }
  const tmp = path + ".tmp"
  await writeFile(tmp, content, "utf-8")
  await rename(tmp, path)
  return exists ? "updated" : "created"
}

export async function importCommand(args: string[], flags: CliFlags, paths?: ImportPaths): Promise<number> {
  if (flags.help) {
    console.log(helpText())
    return 0
  }

  const home = paths?.home ?? homedir()
  const cwd = paths?.cwd ?? process.cwd()

  // Resolve the file list
  let files: string[] = []
  if (args.length > 0) {
    for (const arg of args) {
      const path = resolve(cwd, arg)
      if (isDirectory(path)) {
        files.push(...(await listImportableFiles(path)))
      } else if (isFile(path)) {
        files.push(path)
      } else {
        console.error(`File not found: ${path}`)
        return 1
      }
    }
  } else {
    const found = await discoverImportFiles({ includeProject: Boolean(flags.all) }, paths)
    files = found.map(f => f.file)
  }
  files = [...new Set(files)]

  if (files.length === 0) {
    if (!flags.quiet) {
      console.error("No instruction files found.")
      console.error(
        flags.all
          ? "Pass a file explicitly: you-md import path/to/CLAUDE.md"
          : "Try --all to include project files in this directory, or pass a file explicitly."
      )
      if (flags.verbose) {
        console.error("\nLocations checked:")
        for (const source of IMPORT_SOURCES) {
          if (source.scope === "project" && !flags.all) continue
          const base = source.scope === "user" ? home : cwd
          console.error(`  ${resolve(base, ...source.relPath)}`)
        }
      }
    }
    return 1
  }

  // When merging, skip anything the target profile already says
  const outputPath = flags.output ? resolve(cwd, flags.output) : null
  let existing: string | null = null
  if (flags.merge) {
    if (!outputPath) {
      console.error("--merge needs --output <path> pointing at the profile to merge into.")
      return 1
    }
    if (isFile(outputPath)) {
      existing = await readFile(outputPath, "utf-8")
    }
  } else if (outputPath && isFile(outputPath) && !flags.force && !flags.dryRun) {
    console.error(`Refusing to overwrite ${outputPath}.`)
    console.error("Use --merge to add to it, or --force to replace it.")
    return 1
  }

  // Never read the output file as a source
  if (outputPath) files = files.filter(f => f !== outputPath)

  const result = await collectItems(files, paths, existing ? existingProfileKeys(existing) : undefined)

  const imported = result.reports.filter(r => r.status === "imported")
  const bySection = new Map<ImportSection, number>()
  for (const item of result.items) bySection.set(item.section, (bySection.get(item.section) ?? 0) + 1)

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          files: result.reports,
          items: result.items.length,
          duplicates: result.duplicates,
          sections: Object.fromEntries(bySection),
          output: outputPath,
          dryRun: Boolean(flags.dryRun),
          merge: Boolean(flags.merge),
        },
        null,
        2
      )
    )
    if (flags.dryRun || !outputPath) return result.items.length > 0 ? 0 : 1
  }

  if (result.items.length === 0) {
    if (!flags.quiet && !flags.json) {
      console.error(existing ? "Nothing new to import; the profile already has all of it." : "Nothing to import.")
      for (const r of result.reports) console.error(`  skipped  ${r.origin}  (${r.reason})`)
    }
    return existing ? 0 : 1
  }

  const rendered = existing ? mergeIntoProfile(existing, result.items) : renderProfile(result.items)

  // Dry run: report the plan and stop
  if (flags.dryRun) {
    if (!flags.json) {
      console.log("Dry run. No files will be written.\n")
      for (const r of result.reports) {
        const state = r.status === "imported" ? `${String(r.items).padStart(3)} item(s)` : `skipped (${r.reason})`
        console.log(`  ${r.origin.padEnd(44)} ${state}`)
      }
      console.log("")
      for (const section of IMPORT_SECTIONS) {
        const n = bySection.get(section)
        if (n) console.log(`  ${section.padEnd(20)} ${n}`)
      }
      if (result.duplicates > 0) console.log(`\n  ${result.duplicates} duplicate line(s) dropped`)
      if (outputPath) console.log(`\n  would ${existing ? "update" : "write"}  ${outputPath}`)
      if (flags.verbose) console.log("\n" + rendered)
    }
    return 0
  }

  if (!outputPath) {
    console.log(rendered)
    return 0
  }

  try {
    const action = await writeProfile(outputPath, rendered)
    if (!flags.quiet && !flags.json) {
      for (const r of result.reports) {
        if (r.status === "imported") console.log(`✓ ${r.origin.padEnd(44)} ${String(r.items).padStart(3)} item(s)`)
        else if (flags.verbose) console.log(`  ${r.origin.padEnd(44)} skipped (${r.reason})`)
      }
      console.log("")
      console.log(
        `${action === "created" ? "Created" : "Updated"} ${outputPath}: ${result.items.length} line(s) from ${imported.length} file(s)` +
          (result.duplicates > 0 ? `, ${result.duplicates} duplicate(s) dropped` : "") +
          "."
      )
      console.log("Next: open it, trim what does not describe you, then run: you-md export --all")
    }
    return 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Failed to write ${outputPath}: ${message}`)
    return 1
  }
}
