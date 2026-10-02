/**
 * Audience scoping: decide which sections of a you.md reach which tool.
 *
 * A profile is one file, but not every line in it belongs in every tool.
 * Health context has no business in a coding assistant's rules file, and a
 * cloud personal agent that stores whatever it is handed as long-term memory
 * should not receive the parts you consider private. Scoping lets a section
 * declare its audience with an HTML comment on the line right under its
 * heading:
 *
 *   ## Health
 *   <!-- you-md: private -->
 *   Nut allergy. Ask before suggesting restaurants.
 *
 *   ## How I Work
 *   <!-- you-md: for coding -->
 *   Prefer TypeScript in strict mode.
 *
 *   ## What I'm Into
 *   <!-- you-md: not dots, grok -->
 *   Long-distance cycling, modular synths.
 *
 * Three forms:
 *   private            Stays on this machine: local tools and local agents
 *                      get it, cloud agents (muse, instinct, dots, grok) do not.
 *                      Shorthand for "for local".
 *   for <audiences>    Only the listed targets or groups receive the section.
 *   not <audiences>    Everyone except the listed targets or groups.
 *
 * Audiences are export target ids (claude, cursor, hermes, ...) or groups:
 *   all       every target
 *   coding    claude, codex, gemini, windsurf, cursor, agents
 *   personal  openclaw, hermes, muse, instinct, dots, grok
 *   local     everything that reads a file on this machine (coding + openclaw + hermes)
 *   cloud     muse, instinct, dots, grok
 *
 * Subsections inherit their parent's directive unless they carry their own.
 * Directive lines are always stripped from rendered output, scoped or not.
 * The local MCP server reads the profile as the pseudo-target "mcp", which
 * belongs to the local and coding groups.
 */

// ---------------------------------------------------------------------------
// Audience vocabulary
// ---------------------------------------------------------------------------

/** Pseudo-target used by the local MCP server when the client is unknown. */
export const MCP_TARGET_ID = "mcp"

/**
 * Every id a directive may name. Kept in sync with EXPORT_TARGETS by a test
 * so the two lists cannot drift apart silently.
 */
export const KNOWN_TARGET_IDS: readonly string[] = [
  "claude",
  "codex",
  "gemini",
  "windsurf",
  "cursor",
  "agents",
  "openclaw",
  "hermes",
  "muse",
  "instinct",
  "dots",
  "grok",
  MCP_TARGET_ID,
]

export type AudienceGroup = "all" | "coding" | "personal" | "local" | "cloud"

export const AUDIENCE_GROUPS: Readonly<Record<AudienceGroup, readonly string[]>> = {
  all: KNOWN_TARGET_IDS,
  coding: ["claude", "codex", "gemini", "windsurf", "cursor", "agents", MCP_TARGET_ID],
  personal: ["openclaw", "hermes", "muse", "instinct", "dots", "grok"],
  local: ["claude", "codex", "gemini", "windsurf", "cursor", "agents", "openclaw", "hermes", MCP_TARGET_ID],
  cloud: ["muse", "instinct", "dots", "grok"],
}

const GROUP_NAMES = Object.keys(AUDIENCE_GROUPS) as AudienceGroup[]

/** Every name a directive may use: groups first, then target ids. */
export function audienceNames(): string[] {
  return [...GROUP_NAMES, ...KNOWN_TARGET_IDS.filter(id => id !== MCP_TARGET_ID)]
}

function isGroup(name: string): name is AudienceGroup {
  return (GROUP_NAMES as string[]).includes(name)
}

/** Expand a list of audience names into the set of target ids it covers. */
export function expandAudiences(audiences: readonly string[]): Set<string> {
  const ids = new Set<string>()
  for (const name of audiences) {
    if (isGroup(name)) {
      for (const id of AUDIENCE_GROUPS[name]) ids.add(id)
    } else if (KNOWN_TARGET_IDS.includes(name)) {
      ids.add(name)
    }
    // Unknown names expand to nothing. The validator reports them.
  }
  return ids
}

// ---------------------------------------------------------------------------
// Directive parsing
// ---------------------------------------------------------------------------

export interface AudienceRule {
  /** "for" keeps only the listed audiences; "not" removes them */
  readonly kind: "for" | "not"
  /** Audience names exactly as written (lowercased) */
  readonly audiences: readonly string[]
  /** The directive body as written, e.g. "private" or "for claude, cursor" */
  readonly raw: string
}

/**
 * Matches a whole line that is a you-md directive comment. The managed-block
 * markers (`<!-- you-md:begin -->`, `<!-- you-md:end -->`) share the prefix
 * and are excluded so a profile that quotes them is not misread.
 */
export const DIRECTIVE_LINE = /^\s*<!--\s*you-md:(?!\s*(?:begin|end)\s*-->)\s*(.*?)\s*-->\s*$/i

const RULE_PATTERN = /^(for|not)\s+(.+)$/i

/**
 * Parse the body of a directive ("private", "for claude, cursor", ...).
 * Returns null when the body is not a recognized audience rule.
 */
export function parseAudienceRule(body: string): AudienceRule | null {
  const raw = body.trim()
  if (raw.toLowerCase() === "private") {
    return { kind: "for", audiences: ["local"], raw }
  }
  const match = raw.match(RULE_PATTERN)
  if (!match) return null
  const audiences = match[2]
    .split(/[\s,]+/)
    .map(a => a.trim().toLowerCase())
    .filter(a => a.length > 0)
  if (audiences.length === 0) return null
  return { kind: match[1].toLowerCase() as "for" | "not", audiences, raw }
}

export interface DirectiveMatch {
  /** The parsed rule, or null when the directive body was not understood */
  readonly rule: AudienceRule | null
  /** The directive body as written */
  readonly raw: string
}

/**
 * Find the audience directive for a section: the first non-blank line of its
 * content, when that line is a you-md comment. Anything later in the section
 * is ordinary content and is left alone (apart from being stripped on render).
 */
export function findDirective(content: string): DirectiveMatch | null {
  for (const line of content.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const match = line.match(DIRECTIVE_LINE)
    if (!match) return null
    const raw = match[1].trim()
    return { rule: parseAudienceRule(raw), raw }
  }
  return null
}

/** Remove every you-md directive line from content. */
export function stripDirectives(content: string): string {
  if (!content.includes("you-md:")) return content
  return content
    .split(/\r?\n/)
    .filter(line => !DIRECTIVE_LINE.test(line))
    .join("\n")
    .trim()
}

/** Audience names in a rule that are neither a group nor a known target. */
export function unknownAudiences(rule: AudienceRule): string[] {
  return rule.audiences.filter(a => !isGroup(a) && !KNOWN_TARGET_IDS.includes(a))
}

/** Human-readable form of a rule, for CLI output: "private", "for coding", "not dots, grok". */
export function describeRule(rule: AudienceRule): string {
  if (rule.kind === "for" && rule.audiences.length === 1 && rule.audiences[0] === "local") {
    return "private"
  }
  return `${rule.kind} ${rule.audiences.join(", ")}`
}

/** True when a section governed by `rule` should reach `targetId`. No rule means everyone. */
export function audienceIncludes(rule: AudienceRule | null | undefined, targetId: string): boolean {
  if (!rule) return true
  const ids = expandAudiences(rule.audiences)
  return rule.kind === "for" ? ids.has(targetId) : !ids.has(targetId)
}

// ---------------------------------------------------------------------------
// Profile scoping
// ---------------------------------------------------------------------------

/**
 * The structural shape scoping needs. Matches the parser's YouMdSection and
 * the formatter's FormattableProfile without importing either, so tests can
 * pass hand-built objects.
 */
export interface ScopableSection {
  readonly title: string
  readonly content: string
  readonly subsections?: readonly ScopableSection[]
}

export interface ScopableProfile {
  readonly sections: Map<string, ScopableSection>
  readonly metadata: { readonly author?: string }
}

export interface ScopedSection {
  title: string
  content: string
  subsections: ScopedSection[]
}

export interface ScopedProfile {
  sections: Map<string, ScopedSection>
  metadata: { author?: string }
}

export interface WithheldSection {
  readonly title: string
  /** The rule that excluded it, described for humans */
  readonly rule: string
}

export interface ScopeResult {
  /** The profile with excluded sections removed and directive lines stripped */
  readonly profile: ScopedProfile
  /** Top-most excluded sections (children of an excluded section are implied) */
  readonly withheld: readonly WithheldSection[]
}

/**
 * Produce the view of a profile that a single target is allowed to see.
 *
 * The parser's section map is flat: every heading at every level has its own
 * entry, and parents also reference their children by identity through
 * `subsections`. Scoping walks the parent links so a subsection without a
 * directive inherits its parent's rule, then rebuilds both the map and the
 * nested lists without the excluded sections.
 */
export function scopeProfile(profile: ScopableProfile, targetId: string): ScopeResult {
  const parents = new Map<ScopableSection, ScopableSection>()
  for (const section of profile.sections.values()) {
    for (const child of section.subsections ?? []) parents.set(child, section)
  }

  const ruleCache = new Map<ScopableSection, AudienceRule | null>()
  const effectiveRule = (section: ScopableSection): AudienceRule | null => {
    const cached = ruleCache.get(section)
    if (cached !== undefined) return cached
    const own = findDirective(section.content)?.rule ?? null
    const parent = parents.get(section)
    const rule = own ?? (parent ? effectiveRule(parent) : null)
    ruleCache.set(section, rule)
    return rule
  }

  const excluded = new Set<ScopableSection>()
  for (const section of profile.sections.values()) {
    if (!audienceIncludes(effectiveRule(section), targetId)) excluded.add(section)
  }

  const withheld: WithheldSection[] = []
  const seen = new Set<string>()
  for (const section of profile.sections.values()) {
    if (!excluded.has(section)) continue
    const parent = parents.get(section)
    if (parent && excluded.has(parent)) continue
    if (seen.has(section.title)) continue
    seen.add(section.title)
    const rule = effectiveRule(section)
    withheld.push({ title: section.title, rule: rule ? describeRule(rule) : "" })
  }

  const rebuild = (section: ScopableSection): ScopedSection => ({
    title: section.title,
    content: stripDirectives(section.content),
    subsections: (section.subsections ?? []).filter(s => !excluded.has(s)).map(rebuild),
  })

  const sections = new Map<string, ScopedSection>()
  for (const [key, section] of profile.sections) {
    if (excluded.has(section)) continue
    sections.set(key, rebuild(section))
  }

  return {
    profile: { sections, metadata: { author: profile.metadata.author } },
    withheld,
  }
}
