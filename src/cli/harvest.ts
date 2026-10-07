/**
 * Harvest engine for `you-md harvest`: pull what a coding assistant has
 * already learned about you out of its own memory store and into you.md.
 *
 * First source: Claude Code auto memory. Claude Code writes notes about the
 * user into ~/.claude/projects/<project>/memory/ as one markdown topic file
 * per memory, each with a `type` in its frontmatter (user, feedback, project,
 * reference). Those notes are machine-local and per repository, so the same
 * preference gets relearned in every project and is lost on a new machine.
 * This module reads them, keeps the ones that are about the person rather
 * than the project, files each under the matching you.md section, and skips
 * anything the profile already says.
 *
 * Pure heuristics, no AI, no network, Node builtins only. Everything that
 * touches the filesystem takes explicit paths so tests never read a real
 * home directory.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"

import { extractFrontmatter } from "../parser/frontmatter.js"
import { CURRENT_SCHEMA_VERSION, SENSITIVE_PATTERNS } from "../utils/constants.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The `type` Claude Code records in a memory file's frontmatter. */
export type MemoryType = "user" | "feedback" | "project" | "reference" | "untyped"

export const DEFAULT_MEMORY_TYPES: MemoryType[] = ["user", "feedback"]
export const ALL_MEMORY_TYPES: MemoryType[] = ["user", "feedback", "project", "reference", "untyped"]

export interface HarvestedMemory {
  /** One memory, as a single line of text */
  text: string
  type: MemoryType
  /** Human label for the project the memory came from */
  project: string
  /** Absolute path of the memory file */
  file: string
  /** ISO timestamp from the `modified` frontmatter field, when present */
  modified?: string
}

export interface MemoryDir {
  /** Absolute path to the memory directory */
  path: string
  /** Project label derived from the directory name */
  project: string
}

export interface HarvestPaths {
  home?: string
  env?: NodeJS.ProcessEnv
  /** Explicit root to scan instead of the Claude Code defaults */
  memoryDir?: string
}

export interface PlannedEntry {
  text: string
  type: MemoryType
  /** Every project that recorded this memory (deduped, sorted) */
  projects: string[]
}

export interface HarvestPlan {
  /** Section title to the entries that will be added under it */
  additions: Map<string, PlannedEntry[]>
  /** Memories the profile already contained (by normalized text) */
  duplicates: PlannedEntry[]
  /** Memories that looked like a credential and were dropped */
  sensitive: PlannedEntry[]
  /** Total new entries across all sections */
  count: number
}

// ---------------------------------------------------------------------------
// Locating memory directories
// ---------------------------------------------------------------------------

/**
 * Claude Code encodes the project path into the directory name, so
 * /Users/me/code/frugal becomes -Users-me-code-frugal. The encoding is
 * lossy (hyphens in names collide with separators), so we only strip the
 * leading dash rather than pretend to decode it.
 */
export function projectLabel(dirName: string): string {
  const stripped = dirName.replace(/^-+/, "")
  return stripped.length > 0 ? stripped : dirName
}

/**
 * Where Claude Code keeps auto memory on this machine.
 *
 * Order: an explicit --memory-dir, then <CLAUDE_CONFIG_DIR>/projects when
 * that variable is set, then ~/.claude/projects. A memory dir passed
 * explicitly may be either a projects root or a single memory directory.
 */
export function resolveMemoryRoots(paths?: HarvestPaths): string[] {
  const home = paths?.home ?? homedir()
  const env = paths?.env ?? process.env

  if (paths?.memoryDir) return [resolve(paths.memoryDir)]

  const roots: string[] = []
  if (env.CLAUDE_CONFIG_DIR) roots.push(join(env.CLAUDE_CONFIG_DIR, "projects"))
  roots.push(join(home, ".claude", "projects"))
  return roots
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Find every memory directory under the given roots.
 *
 * A root is either a projects directory (containing <project>/memory/) or,
 * when it holds markdown files directly, a single memory directory.
 */
export function findMemoryDirs(roots: string[]): MemoryDir[] {
  const found: MemoryDir[] = []
  const seen = new Set<string>()

  const add = (path: string, project: string) => {
    const abs = resolve(path)
    if (seen.has(abs)) return
    seen.add(abs)
    found.push({ path: abs, project })
  }

  for (const root of roots) {
    if (!isDir(root)) continue

    // A memory directory itself (MEMORY.md or topic files at the top level)
    const topLevel = readdirSync(root)
    if (topLevel.some(f => f.toLowerCase().endsWith(".md"))) {
      add(root, projectLabel(basename(root) === "memory" ? basename(join(root, "..")) : basename(root)))
      continue
    }

    for (const entry of topLevel) {
      const memoryPath = join(root, entry, "memory")
      if (isDir(memoryPath)) add(memoryPath, projectLabel(entry))
    }
  }

  return found
}

// ---------------------------------------------------------------------------
// Reading memory files
// ---------------------------------------------------------------------------

const MIN_ENTRY_CHARS = 12
const MAX_ENTRY_CHARS = 400

function parseSimpleFrontmatter(frontmatter: string | null): Record<string, string> {
  const fields: Record<string, string> = {}
  if (!frontmatter) return fields
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!match) continue
    fields[match[1].toLowerCase()] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2")
  }
  return fields
}

function normalizeType(raw: string | undefined): MemoryType {
  switch ((raw ?? "").toLowerCase()) {
    case "user":
      return "user"
    case "feedback":
      return "feedback"
    case "project":
      return "project"
    case "reference":
      return "reference"
    default:
      return "untyped"
  }
}

/**
 * Turn a memory file's markdown body into one-line entries.
 *
 * Bullets become one entry each (with indented continuation lines folded in),
 * paragraphs become one entry each, and headings, code fences, tables,
 * comments, and rules are ignored. When the body yields nothing, the
 * frontmatter `description` stands in for it.
 */
export function extractEntries(body: string, description?: string): string[] {
  const entries: string[] = []
  let current: string[] = []
  let inFence = false

  const flush = () => {
    const text = current.join(" ").replace(/\s+/g, " ").trim()
    if (text) entries.push(text)
    current = []
  }

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "")
    const trimmed = line.trim()

    if (/^(```|~~~)/.test(trimmed)) {
      flush()
      inFence = !inFence
      continue
    }
    if (inFence) continue

    if (trimmed === "") {
      flush()
      continue
    }
    if (
      /^#{1,6}\s/.test(trimmed) ||
      /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
      /^<!--/.test(trimmed) ||
      /^\|/.test(trimmed)
    ) {
      flush()
      continue
    }

    const bullet = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (bullet) {
      flush()
      current.push(bullet[1])
      continue
    }

    // Indented text under a bullet continues that bullet
    if (/^\s+/.test(line) && current.length > 0) {
      current.push(trimmed)
      continue
    }

    current.push(trimmed)
  }
  flush()

  const cleaned = entries
    .map(cleanEntry)
    .filter(e => e.length >= MIN_ENTRY_CHARS && e.length <= MAX_ENTRY_CHARS)

  if (cleaned.length === 0 && description) {
    const d = cleanEntry(description)
    if (d.length >= MIN_ENTRY_CHARS && d.length <= MAX_ENTRY_CHARS) return [d]
  }
  return cleaned
}

function cleanEntry(text: string): string {
  return text
    .replace(/^\[[^\]]*\]\s*[-:]\s*/, "") // "[2026-09-01] - " style prefixes
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Read one memory topic file into harvested memories.
 */
export function readMemoryFile(file: string, project: string): HarvestedMemory[] {
  let raw: string
  try {
    raw = readFileSync(file, "utf-8")
  } catch {
    return []
  }
  const { frontmatter, content } = extractFrontmatter(raw)
  const fields = parseSimpleFrontmatter(frontmatter)
  const type = normalizeType(fields.type)
  const modified = fields.modified || undefined

  return extractEntries(content, fields.description).map(text => ({
    text,
    type,
    project,
    file,
    modified,
  }))
}

/**
 * Scan memory directories for topic files of the requested types.
 *
 * MEMORY.md is Claude Code's index of the directory, not a memory, so it is
 * skipped. Subdirectories are searched one level down in case Claude groups
 * topic files.
 */
export function scanMemoryDirs(
  dirs: MemoryDir[],
  types: MemoryType[] = DEFAULT_MEMORY_TYPES
): { memories: HarvestedMemory[]; files: number } {
  const wanted = new Set(types)
  const memories: HarvestedMemory[] = []
  let files = 0

  for (const dir of dirs) {
    for (const file of listMarkdownFiles(dir.path)) {
      if (basename(file).toUpperCase() === "MEMORY.MD") continue
      files++
      for (const memory of readMemoryFile(file, dir.project)) {
        if (wanted.has(memory.type)) memories.push(memory)
      }
    }
  }

  return { memories, files }
}

function listMarkdownFiles(dir: string, depth = 0): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries.sort()) {
    const path = join(dir, entry)
    if (isDir(path)) {
      if (depth < 1) out.push(...listMarkdownFiles(path, depth + 1))
    } else if (entry.toLowerCase().endsWith(".md")) {
      out.push(path)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Filing entries under you.md sections
// ---------------------------------------------------------------------------

export const SECTION_BOUNDARIES = "Boundaries"
export const SECTION_COMMUNICATE = "How I Communicate"
export const SECTION_DO = "What I Do"
export const SECTION_WORK = "How I Work"
export const SECTION_WORKING_ON = "What I'm Working On"
export const SECTION_CONTEXT = "Context"
export const SECTION_IMPORTED = "Imported memories"

const PROHIBITION = /\b(never|do not|don'?t|avoid|stop|hates?|dislikes?|refuses?)\b/i
const COMMUNICATION =
  /\b(tone|concise|verbos|brief|terse|wordy|explain|explanation|jargon|emoji|formal|casual|wording|phrasing|respond|response|answer|summar|bullet|markdown|plain (english|language)|communicat|writing style|caveat|hedg|preamble|sign-?off|greeting|humou?r|apolog)/i
const ROLE =
  /\b(role|title|works? (at|as|on|for)|job|engineer|developer|programmer|manager|designer|founder|researcher|scientist|student|teacher|analyst|consultant|architect|lead|director|cto|ceo|vp|pm|product manager|background|expert|expertise|experience (in|with)|years|industry|company|employer|team)\b/i

/**
 * Choose the you.md section a memory belongs under.
 *
 * Prohibitions go to Boundaries whatever their type, because a bare
 * "Boundaries: use caveats" reads as the opposite of a "never use caveats"
 * correction filed anywhere else. Project and reference memories only get
 * here when explicitly requested, and keep their own sections.
 */
export function classifyMemory(memory: Pick<HarvestedMemory, "text" | "type">): string {
  const text = memory.text
  if (memory.type === "untyped") return SECTION_IMPORTED
  if (PROHIBITION.test(text)) return SECTION_BOUNDARIES
  if (memory.type === "project") return SECTION_WORKING_ON
  if (memory.type === "reference") return SECTION_CONTEXT
  if (COMMUNICATION.test(text)) return SECTION_COMMUNICATE
  if (memory.type === "user" && ROLE.test(text)) return SECTION_DO
  return SECTION_WORK
}

/** Order sections appear in the report and in a freshly created profile. */
const SECTION_ORDER = [
  SECTION_DO,
  SECTION_COMMUNICATE,
  SECTION_WORK,
  SECTION_WORKING_ON,
  SECTION_CONTEXT,
  SECTION_BOUNDARIES,
  SECTION_IMPORTED,
]

/** Existing headings that should receive entries aimed at a canonical section. */
const SECTION_ALIASES: Record<string, string[]> = {
  [SECTION_BOUNDARIES]: ["don't", "do not"],
  [SECTION_COMMUNICATE]: ["communication style", "ai response preferences", "ai preferences"],
  [SECTION_DO]: ["about me", "about", "me"],
  [SECTION_WORK]: ["technical preferences", "coding preferences", "coding", "preferences"],
  [SECTION_WORKING_ON]: ["current projects", "projects"],
  [SECTION_CONTEXT]: ["development environment"],
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Normalize a line for duplicate detection: case, emphasis, bullets,
 * trailing punctuation, and spacing all collapse.
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/[*_`~]/g, "")
    .replace(/[.!;:,]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some(p => p.test(text))
}

/**
 * Decide what to add to a profile: dedupe memories across projects, drop
 * anything the profile already says or that looks like a secret, and file
 * the rest under sections.
 */
export function planHarvest(profileContent: string | null, memories: HarvestedMemory[]): HarvestPlan {
  const existing = new Set<string>()
  if (profileContent) {
    for (const line of profileContent.split(/\r?\n/)) {
      const key = normalizeForMatch(line)
      if (key) existing.add(key)
    }
  }

  // Merge the same memory learned in several projects into one entry
  const byKey = new Map<string, PlannedEntry>()
  for (const memory of memories) {
    const key = normalizeForMatch(memory.text)
    if (!key) continue
    const entry = byKey.get(key)
    if (entry) {
      if (!entry.projects.includes(memory.project)) entry.projects.push(memory.project)
      // A typed memory outranks an untyped copy of the same line
      if (entry.type === "untyped" && memory.type !== "untyped") entry.type = memory.type
    } else {
      byKey.set(key, { text: memory.text, type: memory.type, projects: [memory.project] })
    }
  }

  const additions = new Map<string, PlannedEntry[]>()
  const duplicates: PlannedEntry[] = []
  const sensitive: PlannedEntry[] = []
  let count = 0

  for (const [key, entry] of byKey) {
    entry.projects.sort()
    if (isSensitive(entry.text)) {
      sensitive.push(entry)
      continue
    }
    if (existing.has(key)) {
      duplicates.push(entry)
      continue
    }
    const section = classifyMemory(entry)
    const list = additions.get(section) ?? []
    list.push(entry)
    additions.set(section, list)
    count++
  }

  // Stable section order for output
  const ordered = new Map<string, PlannedEntry[]>()
  for (const section of SECTION_ORDER) {
    const list = additions.get(section)
    if (list) ordered.set(section, list)
  }
  for (const [section, list] of additions) {
    if (!ordered.has(section)) ordered.set(section, list)
  }

  return { additions: ordered, duplicates, sensitive, count }
}

// ---------------------------------------------------------------------------
// Writing entries into a profile
// ---------------------------------------------------------------------------

interface SectionSpan {
  /** Index of the heading line */
  heading: number
  /** Index one past the last line of the section body */
  end: number
}

function findSection(lines: string[], title: string): SectionSpan | null {
  const wanted = new Set([normalizeTitle(title), ...(SECTION_ALIASES[title] ?? [])])
  // Exact title first, aliases only when the canonical heading is absent
  const candidates: Array<{ span: SectionSpan; exact: boolean }> = []

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^##\s+(.+?)\s*$/)
    if (!match) continue
    const normalized = normalizeTitle(match[1])
    if (!wanted.has(normalized)) continue

    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,2}\s/.test(lines[j])) {
        end = j
        break
      }
    }
    candidates.push({ span: { heading: i, end }, exact: normalized === normalizeTitle(title) })
  }

  if (candidates.length === 0) return null
  return (candidates.find(c => c.exact) ?? candidates[0]).span
}

function renderBullets(entries: PlannedEntry[]): string[] {
  return entries.map(e => `- ${e.text}`)
}

/**
 * Insert bullets into a section, above its first `###` subsection, after
 * whatever content is already there. Returns the new line array.
 */
function insertIntoSection(lines: string[], span: SectionSpan, bullets: string[]): string[] {
  // Insertion point: before the first ### inside the section, else the end
  let insertAt = span.end
  for (let i = span.heading + 1; i < span.end; i++) {
    if (/^###\s/.test(lines[i])) {
      insertAt = i
      break
    }
  }

  // Back over trailing blank lines so the bullets sit against the content
  let contentEnd = insertAt
  while (contentEnd > span.heading + 1 && lines[contentEnd - 1].trim() === "") contentEnd--

  const lastContent = contentEnd > span.heading + 1 ? lines[contentEnd - 1] : null
  const lastIsBullet = lastContent !== null && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lastContent)

  const block: string[] = []
  if (lastContent !== null && !lastIsBullet) block.push("")
  block.push(...bullets)
  // Keep one blank line between the bullets and whatever follows
  const followedByContent = insertAt < lines.length
  if (followedByContent) block.push("")

  return [...lines.slice(0, contentEnd), ...block, ...lines.slice(insertAt)]
}

function appendSection(lines: string[], title: string, bullets: string[]): string[] {
  const out = [...lines]
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop()
  if (out.length > 0) out.push("")
  out.push(`## ${title}`, "", ...bullets)
  return out
}

function bumpLastUpdated(lines: string[], today: string): string[] {
  const { hasFrontmatter, contentStartLine } = extractFrontmatter(lines.join("\n"))
  if (!hasFrontmatter) return lines
  const out = [...lines]
  for (let i = 0; i < Math.min(contentStartLine, out.length); i++) {
    const match = out[i].match(/^(last_updated\s*:\s*)(["']?)(.*?)\2\s*$/)
    if (match) {
      out[i] = `${match[1]}${match[2]}${today}${match[2]}`
      break
    }
  }
  return out
}

function newProfile(today: string): string[] {
  return [
    "---",
    `schema_version: "${CURRENT_SCHEMA_VERSION}"`,
    `created: "${today}"`,
    `last_updated: "${today}"`,
    `privacy_level: "private"`,
    "---",
    "",
    "# Me",
  ]
}

/**
 * Apply a harvest plan to profile content. Returns the new content; when the
 * plan adds nothing, the input is returned unchanged (byte for byte).
 */
export function applyHarvest(
  profileContent: string | null,
  plan: HarvestPlan,
  today: string = new Date().toISOString().slice(0, 10)
): string {
  if (plan.count === 0 && profileContent !== null) return profileContent

  let lines = profileContent !== null ? profileContent.split(/\r?\n/) : newProfile(today)
  const trailingNewline = profileContent === null || profileContent.endsWith("\n")

  for (const [section, entries] of plan.additions) {
    const bullets = renderBullets(entries)
    const span = findSection(lines, section)
    lines = span ? insertIntoSection(lines, span, bullets) : appendSection(lines, section, bullets)
  }

  if (profileContent !== null) lines = bumpLastUpdated(lines, today)

  let out = lines.join("\n")
  if (trailingNewline && !out.endsWith("\n")) out += "\n"
  return out
}

// ---------------------------------------------------------------------------
// Type list parsing
// ---------------------------------------------------------------------------

/**
 * Parse a --types value such as "user,feedback" or "all".
 * Returns null when a name is not a memory type.
 */
export function parseMemoryTypes(raw: string | undefined): MemoryType[] | null {
  if (!raw || raw.trim() === "") return DEFAULT_MEMORY_TYPES
  if (raw.trim().toLowerCase() === "all") return ALL_MEMORY_TYPES
  const types: MemoryType[] = []
  for (const part of raw.split(",")) {
    const name = part.trim().toLowerCase()
    if (name === "") continue
    if (!(ALL_MEMORY_TYPES as string[]).includes(name)) return null
    if (!types.includes(name as MemoryType)) types.push(name as MemoryType)
  }
  return types.length > 0 ? types : DEFAULT_MEMORY_TYPES
}
