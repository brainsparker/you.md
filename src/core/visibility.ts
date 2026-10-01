/**
 * Section visibility: decide which parts of a you.md reach which audience.
 *
 * One profile feeds very different places. A project AGENTS.md gets committed
 * and read by teammates. A global CLAUDE.md stays on your own machine. A
 * portable copy gets pasted into a cloud personal agent. Not every section
 * belongs in every one of them: a "Boundaries" section about your health or
 * family has no place in a repo, and "Code Review Preferences" is noise for
 * the agent that plans your week.
 *
 * Declare it once in frontmatter, keyed by section title:
 *
 *   visibility:
 *     Boundaries: private               # never leaves this machine
 *     Context: personal                 # personal agents only
 *     Code Review Preferences: coding   # coding tools only
 *
 * Values:
 *   everywhere  (default) every export target
 *   coding      coding tools only (Claude Code, Codex, Gemini, Cursor, ...)
 *   personal    personal agents only (OpenClaw, Hermes, Muse, Instinct, ...)
 *   private     only files that stay on this machine: user-level instruction
 *               files and the MCP server. Never a committed project file,
 *               never a portable copy handed to a cloud agent.
 *
 * Titles match case-insensitively and can name a top-level section or a
 * nested one. An unrecognised value fails closed: the section is treated as
 * private so a typo never leaks it.
 */

import type { FormattableProfile } from "./formatter.js";

export type Visibility = "everywhere" | "coding" | "personal" | "private";

export const VISIBILITY_VALUES: readonly Visibility[] = [
  "everywhere",
  "coding",
  "personal",
  "private",
];

export const DEFAULT_VISIBILITY: Visibility = "everywhere";

/** Frontmatter key that carries the visibility map. */
export const VISIBILITY_KEY = "visibility";

/**
 * Who reads an export target.
 */
export interface Audience {
  /** The kind of consumer: a coding tool or a personal agent. */
  kind: "coding" | "personal";
  /**
   * True when the exported file leaves this machine: a project-scoped file
   * that gets committed (AGENTS.md, .cursor/rules) or a portable copy that is
   * pasted, uploaded, or texted to a cloud agent.
   */
  shared: boolean;
}

export interface VisibilityProblem {
  /** Section title as written in frontmatter */
  title: string;
  /** The value that was not understood */
  value: string;
}

export interface VisibilityMap {
  /** Normalised (lowercase, trimmed) section title to visibility */
  rules: Map<string, Visibility>;
  /** Entries whose value is not a known visibility (treated as private) */
  invalid: VisibilityProblem[];
  /** True when frontmatter has a visibility key that is not a map at all */
  malformed: boolean;
}

function normalizeTitle(title: string): string {
  let t = title.trim();
  // The frontmatter YAML parser keeps quotes on quoted keys.
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t.toLowerCase();
}

function isVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && (VISIBILITY_VALUES as readonly string[]).includes(value);
}

/**
 * Read the visibility map out of parsed frontmatter metadata.
 * Never throws; problems are reported in the result.
 */
export function parseVisibility(metadata: Record<string, unknown> | undefined): VisibilityMap {
  const rules = new Map<string, Visibility>();
  const invalid: VisibilityProblem[] = [];
  const raw = metadata?.[VISIBILITY_KEY];

  if (raw === undefined || raw === null) {
    return { rules, invalid, malformed: false };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { rules, invalid, malformed: true };
  }

  for (const [title, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeTitle(title);
    if (!key) continue;
    const normalizedValue = typeof value === "string" ? value.trim().toLowerCase() : value;
    if (isVisibility(normalizedValue)) {
      rules.set(key, normalizedValue);
    } else {
      invalid.push({ title: title.trim(), value: String(value) });
      // Fail closed: an unknown value must never widen where a section goes.
      rules.set(key, "private");
    }
  }

  return { rules, invalid, malformed: false };
}

/**
 * Does a section with this visibility reach this audience?
 */
export function isVisible(visibility: Visibility, audience: Audience): boolean {
  switch (visibility) {
    case "everywhere":
      return true;
    case "coding":
      return audience.kind === "coding";
    case "personal":
      return audience.kind === "personal";
    case "private":
      return !audience.shared;
  }
}

/**
 * Look up the visibility declared for a section title.
 */
export function visibilityFor(map: VisibilityMap, title: string): Visibility {
  return map.rules.get(normalizeTitle(title)) ?? DEFAULT_VISIBILITY;
}

/**
 * The structural shape filterProfileForAudience works on: a formattable
 * profile whose metadata may carry a visibility map.
 */
export interface VisibilityAwareProfile extends FormattableProfile {
  metadata: FormattableProfile["metadata"] & { [key: string]: unknown };
}

export interface FilteredProfile {
  /** A profile containing only the sections this audience may see */
  profile: FormattableProfile;
  /** Titles held back, nested ones as "Parent > Child" */
  hidden: string[];
}

/**
 * Produce the view of a profile that a given audience is allowed to see.
 * The original profile is not modified.
 */
export function filterProfileForAudience(
  profile: VisibilityAwareProfile,
  audience: Audience
): FilteredProfile {
  const map = parseVisibility(profile.metadata);
  const hidden: string[] = [];

  if (map.rules.size === 0) {
    return { profile, hidden };
  }

  const sections: FormattableProfile["sections"] = new Map();
  // The parser lists H2s under an H1 both as subsections and as top-level
  // sections. Report a hidden heading once, under its top-level name.
  const topLevel = new Set(profile.sections.keys());

  for (const [key, section] of profile.sections) {
    if (!isVisible(visibilityFor(map, section.title), audience)) {
      hidden.push(section.title);
      continue;
    }

    const subsections = section.subsections.filter(sub => {
      const visible = isVisible(visibilityFor(map, sub.title), audience);
      if (!visible && !topLevel.has(normalizeTitle(sub.title))) {
        hidden.push(`${section.title} > ${sub.title}`);
      }
      return visible;
    });

    sections.set(key, subsections === section.subsections ? section : { ...section, subsections });
  }

  return {
    profile: { ...profile, sections },
    hidden,
  };
}

/**
 * Human-readable description of a visibility value, for help text and reports.
 */
export function describeVisibility(visibility: Visibility): string {
  switch (visibility) {
    case "everywhere":
      return "every target";
    case "coding":
      return "coding tools only";
    case "personal":
      return "personal agents only";
    case "private":
      return "stays on this machine";
  }
}
