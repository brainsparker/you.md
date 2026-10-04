/**
 * you-md import: bring the memories another assistant holds about you into
 * your you.md, so the file you own becomes the canonical copy.
 *
 * Usage:
 *   you-md import memories.txt               Import into ~/.you.md (created if missing)
 *   you-md import memories.txt -o ./.you.md  Import into a specific you.md
 *   pbpaste | you-md import -                Read the dump from stdin
 *   you-md import memories.txt --dry-run     Preview the result without writing
 *
 * Where the dump comes from: ask your current assistant to list everything it
 * remembers about you. Claude's memory import flow publishes a prompt for
 * exactly this (Settings > Memory > Start import); it works in ChatGPT, Gemini,
 * Grok, or any assistant with memory, and Claude itself answers "Write out your
 * memories of me verbatim". Save the answer to a file (or pipe it) and import.
 *
 * What import does with it:
 *   - reads entries from the code block(s) in the dump, or every line when
 *     there are none; strips bullets, numbering, quotes, and "[date] -" prefixes
 *   - files each entry under a you.md section by what it says (communication
 *     style, tools, boundaries, personal context, ...). Headings in the dump
 *     are used as a hint; anything it cannot place lands in "Imported memories"
 *     for you to sort by hand
 *   - skips duplicates, assistant chatter, and anything that looks like a credential
 *   - creates a new you.md, or appends to the matching sections of an existing
 *     one (backing it up first) without rewriting anything else in the file
 *
 * The result is a starting point you review, not a finished profile: it is one
 * assistant's notes about you, in its words.
 */

import { readFile, writeFile, mkdir, copyFile, rename } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve, dirname, basename } from "node:path"
import { homedir } from "node:os"

import type { CliFlags } from "../args.js"
import { CURRENT_SCHEMA_VERSION, SENSITIVE_PATTERNS } from "../../utils/constants.js"

// ---------------------------------------------------------------------------
// Parsing the dump
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  /** The memory itself, cleaned of list and date decoration */
  text: string
  /** Date the source assistant saved it, when the dump carried one */
  date?: string
  /** Nearest heading above the entry in the dump, used as a filing hint */
  hint?: string
}

const FENCE = /^```/
const MARKDOWN_HEADING = /^#{1,6}\s+(.+?)\s*#*$/
const BOLD_HEADING = /^\*\*([^*]{2,80})\*\*:?$/
/** A short label line ending in a colon ("Tools and frameworks:") */
const LABEL_HEADING = /^[A-Za-z][^.!?]{1,70}:$/
const LIST_PREFIX = /^(?:[-*+•▪◦]|\d+[.)])\s+/
/** Separators assistants put between a date and the memory: hyphen, en dash, em dash, colon */
const DATE_SEPARATOR = "[-\\u2013\\u2014:]"
const BRACKET_DATE = new RegExp(`^\\[([^\\]]*)\\]\\s*(?:${DATE_SEPARATOR}\\s*)?`)
const BARE_DATE = new RegExp(
  `^\\(?(\\d{4}-\\d{2}-\\d{2}(?:T[\\d:.Z+-]+)?|[A-Z][a-z]{2,8}\\.? \\d{1,2},? \\d{4}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})\\)?\\s*${DATE_SEPARATOR}\\s+`
)
const WRAPPING_QUOTES = /^["'“”‘’](.*)["'“”‘’]$/

/** Lines an assistant writes around the list rather than as part of it */
const CHATTER = new RegExp(
  "^(" +
    [
      "here(?:'s| is| are)\\b",
      "below (?:is|are)\\b",
      "that(?:'s| is) (?:the complete|everything|all)",
      "this (?:is|was) (?:the complete|everything|all)",
      "these are all\\b",
      "that covers\\b",
      "let me know\\b",
      "i (?:don't|do not) have\\b",
      "i hope\\b",
      "if you(?:'d| would) like\\b",
      "is that (?:everything|all)",
      "no (?:other|additional|further|more) (?:memories|entries|items|context)\\b",
      "(?:the )?complete set\\b",
      "nothing (?:else|more|further)\\b",
      "sure[,!.]",
      "of course[,!.]",
      "certainly[,!.]",
    ].join("|") +
    ")",
  "i"
)

/**
 * The part of the dump that holds the memories: the fenced code block(s) when
 * there are any (Claude's export prompt asks for a single code block), else the
 * whole text.
 */
export function extractDumpBody(text: string): string {
  const lines = text.split(/\r?\n/)
  const fenced: string[] = []
  let inFence = false
  let sawFence = false
  for (const line of lines) {
    if (FENCE.test(line.trim())) {
      inFence = !inFence
      sawFence = true
      continue
    }
    if (inFence) fenced.push(line)
  }
  return sawFence && fenced.some(l => l.trim()) ? fenced.join("\n") : text
}

function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "")
    .trim()
}

/**
 * Parse a memory dump into entries. Tolerates the shapes assistants actually
 * produce: "[date] - memory", "- memory", "1. memory", bare lines, Markdown or
 * bold headings between groups, and a sentence or two of chatter around it.
 */
export function parseMemoryDump(text: string): MemoryEntry[] {
  const entries: MemoryEntry[] = []
  const seen = new Set<string>()
  let hint: string | undefined

  for (const raw of extractDumpBody(text).split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue

    const heading = line.match(MARKDOWN_HEADING) ?? line.match(BOLD_HEADING)
    if (heading) {
      hint = heading[1].trim()
      continue
    }

    line = line.replace(LIST_PREFIX, "").trim()
    if (!line) continue

    if (LABEL_HEADING.test(line)) {
      hint = line.slice(0, -1).trim()
      continue
    }

    let date: string | undefined
    const bracket = line.match(BRACKET_DATE)
    if (bracket) {
      const inner = bracket[1].trim()
      if (/\d/.test(inner)) date = inner
      line = line.slice(bracket[0].length).trim()
    } else {
      const bare = line.match(BARE_DATE)
      if (bare) {
        date = bare[1]
        line = line.slice(bare[0].length).trim()
      }
    }

    const quoted = line.match(WRAPPING_QUOTES)
    if (quoted) line = quoted[1].trim()

    if (line.length < 3 || CHATTER.test(line)) continue

    const key = normalizeForDedupe(line)
    if (seen.has(key)) continue
    seen.add(key)

    entries.push(date ? { text: line, date, hint } : { text: line, hint })
  }

  return entries
}

// ---------------------------------------------------------------------------
// Filing entries into you.md sections
// ---------------------------------------------------------------------------

/** Where an entry can land, in the order sections appear in a new file */
export const IMPORT_SECTIONS = [
  "What I Do",
  "How I Communicate",
  "How I Work",
  "What I Trust",
  "What I'm Into",
  "What I'm Working On",
  "Context",
  "Boundaries",
  "Imported memories",
] as const

export type ImportSection = (typeof IMPORT_SECTIONS)[number]

export const UNSORTED_SECTION: ImportSection = "Imported memories"

interface Classifier {
  section: ImportSection
  pattern: RegExp
}

/**
 * Ordered: the first match wins. Instructions phrased as a prohibition are
 * boundaries whatever they are about; after that, how the assistant should
 * talk beats what the person is working toward beats what tools they use
 * beats who they are, since "prefers concise answers about TypeScript" is
 * about communication first and "building a Mac app" is a goal before it is
 * a platform.
 */
const CLASSIFIERS: Classifier[] = [
  {
    section: "Boundaries",
    pattern:
      /^(?:(?:please|the user|they|user|i)\s+)?(?:(?:asked|wants?|prefers?|told) (?:me |you )?(?:to )?)?(?:never|do not|don'?t|avoid|stop|no longer|refrain|not to|should not|shouldn'?t|must not)\b/i,
  },
  {
    section: "How I Communicate",
    pattern:
      /\b(?:tone|concise|verbose|verbosity|brief|terse|format(?:ting)?|bullet|markdown|emoji|explain|explanations?|respond|responses?|reply|replies|answers?|writing style|style|formal|casual|plain (?:english|language)|jargon|headings?|headers?|word count|detailed|direct|blunt|summar|sign.?off|greet|humou?r|caveats?|hedg|preamble|em.?dash|addressed? (?:as|by)|call (?:me|them))\b/i,
  },
  {
    section: "What I'm Working On",
    pattern:
      /\b(?:projects?|goals?|building|launch|working on|plans? to|planning|wants? to|aims? to|aiming to|deadline|milestone|roadmap|side project|startup|writing an?|learning|studying|preparing for|training for|saving for|job search|interview)\b/i,
  },
  {
    section: "How I Work",
    pattern:
      /\b(?:tools?|stack|frameworks?|programming languages?|typescript|javascript|python|rust|golang|java|kotlin|swift|c\+\+|c#|ruby|php|react|vue|svelte|next\.?js|node(?:\.js)?|editor|vs ?code|vim|neovim|emacs|ide|git|github|gitlab|terminal|shell|zsh|bash|npm|pnpm|yarn|bun|pip|poetry|uv|cargo|homebrew|brew|make|cmake|docker|kubernetes|aws|gcp|azure|linux|ubuntu|macos|windows|workflow|tests?|testing|lint(?:er|ing)?|strict mode|dependenc(?:y|ies)|librar(?:y|ies)|database|postgres|sql|apis?|sdk|cli|codebase|repo(?:sitory)?|deploy|ci\/cd|pull requests?|code review|coding|tabs|spaces|indent)\b/i,
  },
  {
    section: "What I Trust",
    pattern:
      /\b(?:trusts?|sources?|citations?|cite[sd]?|fact.?check|verif(?:y|ied|ication)|evidence|peer.?review|documentation|official docs|reliab|accura|hallucinat|speculat|guess)\b/i,
  },
  {
    section: "What I Do",
    pattern:
      /\b(?:works? (?:as|at|for|in|on)|working (?:as|at|for|in)|job|role|title|engineer|developer|designer|manager|founder|ceo|cto|cfo|vp|director|product manager|student|teacher|professor|researcher|scientist|lawyer|attorney|doctor|physician|nurse|consultant|freelanc|company|employer|employed|profession|career|industry|team|i am an?|i'm an?|my (?:job|role|work|company|team)|mba|phd|degree|background in|years of experience)\b/i,
  },
  {
    section: "Context",
    pattern:
      /\b(?:name|lives?|living|located|location|based in|city|country|timezone|time zone|languages?|speaks?|bilingual|family|married|wife|husband|spouse|partner|kids?|child|children|son|daughter|dog|cat|pets?|age|years old|born|birthday|pronouns?|accessib|disabil|dyslexi|screen reader|colou?r.?blind|adhd|autis|vegetarian|vegan|allerg|diet)\b/i,
  },
  {
    section: "What I'm Into",
    pattern:
      /\b(?:interests?|interested|hobby|hobbies|enjoys?|likes?|loves?|fan of|passion|follows?|reads?|reading|listens?|music|sports?|games?|gaming|cook(?:ing)?|travel|photograph|movies?|films?|books?|podcasts?|topics?|favou?rite|collects?|garden|hik(?:e|ing)|running|cycling|climb|yoga|chess)\b/i,
  },
]

function classifyText(text: string): ImportSection | undefined {
  for (const { section, pattern } of CLASSIFIERS) {
    if (pattern.test(text)) return section
  }
  return undefined
}

/**
 * Pick the you.md section for a memory. The entry's own wording decides; a
 * heading from the dump breaks ties; otherwise it goes to the unsorted section.
 */
export function classifyMemory(text: string, hint?: string): ImportSection {
  return classifyText(text) ?? (hint ? classifyText(hint) : undefined) ?? UNSORTED_SECTION
}

/** Credentials have no business in a profile that gets exported everywhere */
const SECRET_SHAPES = [
  ...SENSITIVE_PATTERNS,
  /\b(?:sk|ghp|gho|xox[abp]|AKIA|ya29)[-_.][A-Za-z0-9_-]{12,}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
]

export function looksSensitive(text: string): boolean {
  return SECRET_SHAPES.some(p => p.test(text))
}

export type GroupedMemories = Map<ImportSection, string[]>

/** File entries by section, in canonical section order, dropping secrets */
export function groupMemories(entries: MemoryEntry[]): { groups: GroupedMemories; sensitive: number } {
  const groups: GroupedMemories = new Map()
  let sensitive = 0
  for (const entry of entries) {
    if (looksSensitive(entry.text)) {
      sensitive++
      continue
    }
    const section = classifyMemory(entry.text, entry.hint)
    const list = groups.get(section) ?? []
    list.push(entry.text)
    groups.set(section, list)
  }
  const ordered: GroupedMemories = new Map()
  for (const section of IMPORT_SECTIONS) {
    const list = groups.get(section)
    if (list && list.length > 0) ordered.set(section, list)
  }
  return { groups: ordered, sensitive }
}

// ---------------------------------------------------------------------------
// Writing: a new you.md, or additions to an existing one
// ---------------------------------------------------------------------------

const UNSORTED_NOTE =
  "<!-- you-md could not tell where these belong. Move them into the sections above, or delete them. -->"

function bulletLines(items: string[]): string[] {
  return items.map(item => `- ${item}`)
}

/**
 * Render a fresh you.md from grouped memories. Same frontmatter the templates
 * use, so `you-md validate` and every export target treat it like any profile.
 */
export function renderImportedProfile(
  groups: GroupedMemories,
  options: { source: string; today: string }
): string {
  const lines = [
    "---",
    `schema_version: "${CURRENT_SCHEMA_VERSION}"`,
    `created: "${options.today}"`,
    `last_updated: "${options.today}"`,
    'privacy_level: "private"',
    "---",
    "",
    `<!-- Imported from ${options.source} by you-md import on ${options.today}.`,
    "     These are another assistant's notes about you, in its words: review, trim, and keep what is true. -->",
    "",
    "# Me",
  ]
  for (const [section, items] of groups) {
    lines.push("", `## ${section}`, "")
    if (section === UNSORTED_SECTION) lines.push(UNSORTED_NOTE)
    lines.push(...bulletLines(items))
  }
  lines.push("")
  return lines.join("\n")
}

interface SectionBlock {
  heading: string
  normalized: string
  body: string[]
}

/** Split a you.md into the text before the first h2 and its h2 sections */
function splitSections(content: string): { preamble: string[]; sections: SectionBlock[] } {
  const lines = content.split(/\r?\n/)
  const preamble: string[] = []
  const sections: SectionBlock[] = []
  let current: SectionBlock | undefined
  let inFrontmatter = false

  lines.forEach((line, i) => {
    if (i === 0 && line.trim() === "---") inFrontmatter = true
    else if (inFrontmatter && (line.trim() === "---" || line.trim() === "...")) inFrontmatter = false
    else if (!inFrontmatter) {
      const h2 = line.match(/^##\s+(.+?)\s*#*$/)
      if (h2) {
        current = { heading: line, normalized: h2[1].trim().toLowerCase(), body: [] }
        sections.push(current)
        return
      }
      if (current && /^#\s/.test(line)) {
        // a new h1 closes the section list; keep everything after it as-is
        current = { heading: line, normalized: "", body: [] }
        sections.push(current)
        return
      }
    }
    if (current) current.body.push(line)
    else preamble.push(line)
  })

  return { preamble, sections }
}

/** Insert bullets at the end of a section's own content, before any h3 subsection */
function appendToBody(body: string[], bullets: string[]): string[] {
  let insertAt = body.findIndex(l => /^###\s/.test(l))
  if (insertAt === -1) insertAt = body.length
  while (insertAt > 0 && body[insertAt - 1].trim() === "") insertAt--

  const before = body.slice(0, insertAt)
  const after = body.slice(insertAt)
  const lastBefore = before.length > 0 ? before[before.length - 1] : ""
  const needsGap = before.length > 0 && lastBefore.trim() !== "" && !LIST_PREFIX.test(lastBefore.trim())

  const next = [...before]
  if (needsGap) next.push("")
  next.push(...bullets)
  if (after.length > 0 && after[0].trim() !== "") next.push("")
  return next.concat(after)
}

function touchLastUpdated(preamble: string[], today: string): string[] {
  if (preamble[0]?.trim() !== "---") return preamble
  const out = [...preamble]
  for (let i = 1; i < out.length; i++) {
    const t = out[i].trim()
    if (t === "---" || t === "...") break
    if (/^last_updated\s*:/.test(t)) {
      out[i] = `last_updated: "${today}"`
      break
    }
  }
  return out
}

/**
 * Add grouped memories to an existing you.md without rewriting it: entries
 * already present anywhere in the file are skipped, matching sections get the
 * new bullets at the end of their own content, missing sections are appended,
 * and `last_updated` is bumped. Everything else in the file is left byte for byte.
 */
export function mergeIntoProfile(
  existing: string,
  groups: GroupedMemories,
  today: string
): { content: string; added: GroupedMemories; duplicates: number } {
  const haystack = normalizeForDedupe(existing)
  const added: GroupedMemories = new Map()
  let duplicates = 0

  const { preamble, sections } = splitSections(existing)
  const newSections: SectionBlock[] = []

  for (const [section, items] of groups) {
    const fresh = items.filter(item => {
      const present = haystack.includes(normalizeForDedupe(item))
      if (present) duplicates++
      return !present
    })
    if (fresh.length === 0) continue
    added.set(section, fresh)

    const bullets = bulletLines(fresh)
    const match = sections.find(s => s.normalized === section.toLowerCase())
    if (match) {
      match.body = appendToBody(match.body, bullets)
    } else {
      const body = section === UNSORTED_SECTION ? ["", UNSORTED_NOTE, ...bullets] : ["", ...bullets]
      newSections.push({ heading: `## ${section}`, normalized: section.toLowerCase(), body })
    }
  }

  if (added.size === 0) return { content: existing, added, duplicates }

  const out = touchLastUpdated(preamble, today)
  const all = [...sections, ...newSections]
  for (const block of all) {
    while (out.length > 0 && out[out.length - 1].trim() === "") out.pop()
    if (out.length > 0) out.push("")
    out.push(block.heading, ...block.body)
  }
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop()
  out.push("")
  return { content: out.join("\n"), added, duplicates }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export interface ImportPaths {
  home?: string
  /** Injectable stdin reader for tests */
  readStdin?: () => Promise<string>
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString("utf-8")
}

function helpText(): string {
  return `you-md import: bring another assistant's memory of you into your you.md

Usage:
  you-md import <dump>                Import into ~/.you.md (created if missing)
  you-md import <dump> -o <you.md>    Import into a specific you.md
  you-md import - < dump.txt          Read the dump from stdin
  you-md import <dump> --dry-run      Show what would be written, write nothing

Getting the dump: ask the assistant you are leaving to list every memory it
has about you, one per line (Claude's Settings > Memory > Start import shows a
prompt that works in any assistant; in Claude itself ask it to write out its
memories of you verbatim). Save the answer to a file, or pipe it in.

import files each memory under a you.md section by what it says (how to talk
to you, your tools, boundaries, personal context, ...) and puts the rest under
"Imported memories" for you to sort. Duplicates, chatter around the list, and
anything that looks like a credential are skipped. An existing you.md is
backed up and only gains bullets; nothing already in it is rewritten.

Then carry it everywhere: you-md export --all`
}

function summarize(groups: GroupedMemories): string {
  return [...groups].map(([section, items]) => `${section} (${items.length})`).join(", ")
}

export async function importCommand(
  args: string[],
  flags: CliFlags,
  paths?: ImportPaths
): Promise<number> {
  if (args.length === 0 || args[0] === "help" || flags.help) {
    console.log(helpText())
    return args.length === 0 && !flags.help ? 1 : 0
  }

  const source = args[0]
  let dump: string
  try {
    dump = source === "-" ? await (paths?.readStdin ?? readStdin)() : await readFile(resolve(source), "utf-8")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Could not read ${source}: ${message}`)
    return 1
  }

  const entries = parseMemoryDump(dump)
  if (entries.length === 0) {
    console.error(`No memory entries found in ${source === "-" ? "stdin" : source}.`)
    console.error("Expected one memory per line, for example: [2026-03-01] - Prefers concise answers")
    return 1
  }

  const { groups, sensitive } = groupMemories(entries)
  const today = new Date().toISOString().split("T")[0]
  const outputPath = flags.output ? resolve(flags.output) : resolve(paths?.home ?? homedir(), ".you.md")
  const exists = existsSync(outputPath)
  const sourceLabel = source === "-" ? "stdin" : basename(source)

  let content: string
  let written: GroupedMemories
  let duplicates = 0
  if (exists) {
    const existing = await readFile(outputPath, "utf-8")
    const merged = mergeIntoProfile(existing, groups, today)
    content = merged.content
    written = merged.added
    duplicates = merged.duplicates
  } else {
    content = renderImportedProfile(groups, { source: sourceLabel, today })
    written = groups
  }

  const count = [...written.values()].reduce((n, items) => n + items.length, 0)
  const skipped: string[] = []
  if (duplicates > 0) skipped.push(`${duplicates} already in the file`)
  if (sensitive > 0) skipped.push(`${sensitive} that looked like a credential`)

  if (flags.dryRun) {
    console.log(`Dry run. Nothing will be written.\n`)
    console.log(
      `Would ${exists ? "update" : "create"} ${outputPath} with ${count} memor${count === 1 ? "y" : "ies"}` +
        (count > 0 ? `: ${summarize(written)}` : "")
    )
    if (skipped.length > 0) console.log(`Skipped ${skipped.join(" and ")}.`)
    if (count > 0) {
      console.log("")
      console.log(content)
    }
    return 0
  }

  if (count === 0) {
    if (!flags.quiet) {
      console.log(`Nothing new to import into ${outputPath}.`)
      if (skipped.length > 0) console.log(`Skipped ${skipped.join(" and ")}.`)
    }
    return 0
  }

  try {
    await mkdir(dirname(outputPath), { recursive: true })
    if (exists) await copyFile(outputPath, outputPath + ".backup")
    const tmp = outputPath + ".tmp"
    await writeFile(tmp, content, "utf-8")
    await rename(tmp, outputPath)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Could not write ${outputPath}: ${message}`)
    return 1
  }

  if (!flags.quiet) {
    console.log(
      `✓ Imported ${count} memor${count === 1 ? "y" : "ies"} into ${outputPath} (${exists ? "updated" : "created"})`
    )
    console.log(`  ${summarize(written)}`)
    if (skipped.length > 0) console.log(`  Skipped ${skipped.join(" and ")}.`)
    if (exists) console.log(`  Previous version saved to ${outputPath}.backup`)
    console.log("")
    console.log("These are another assistant's notes about you, in its words. Review the file,")
    if (written.has(UNSORTED_SECTION)) {
      console.log(`sort the "${UNSORTED_SECTION}" section, and then carry it everywhere:`)
    } else {
      console.log("then carry it everywhere:")
    }
    console.log("  you-md export --all")
  }

  return 0
}
