import { createParser } from "../parser/index.js";
import type { YouMdProfile } from "../types/profile.js";
import { CURRENT_SCHEMA_VERSION, MAX_FILE_SIZE } from "../utils/constants.js";
import { InvalidProfileError } from "./errors.js";

const parser = createParser();

/** A profile with fewer real words than this is a skeleton, not a profile. */
const MIN_BODY_WORDS = 15;

/** Counting stats we report to telemetry; never the text itself. */
export interface ProfileStats {
  /** Sections (h2+) that carry actual content. */
  readonly sectionCount: number;
  /** Words in the body, excluding headings and HTML comments. */
  readonly wordCount: number;
}

export interface ValidatedProfile {
  /** Markdown after frontmatter stamping — this is what gets stored. */
  readonly markdown: string;
  readonly profile: YouMdProfile;
  readonly stats: ProfileStats;
  /** Non-fatal notes worth surfacing to the user (unknown sections, etc.). */
  readonly warnings: string[];
}

export interface ValidateOptions {
  /** Value for `source:` in frontmatter when absent. Defaults to "chatgpt". */
  readonly source?: string;
  /** Timestamp used for `created`/`last_updated`. Defaults to now. */
  readonly now?: Date;
  /** Set `created` when missing. True on create, false on update. */
  readonly stampCreated?: boolean;
}

/**
 * Validate model-generated markdown and return the exact bytes to store.
 *
 * The service does not infer, rewrite, or enrich the profile — it only checks
 * that the markdown is a real you.md and stamps server-owned frontmatter dates.
 *
 * @throws InvalidProfileError when the markdown cannot be stored as a profile
 */
export function validateProfileMarkdown(
  markdown: unknown,
  options: ValidateOptions = {}
): ValidatedProfile {
  const reasons: string[] = [];

  if (typeof markdown !== "string" || markdown.trim().length === 0) {
    throw new InvalidProfileError("Profile markdown is required.", [
      "`markdown` must be a non-empty string containing the full you.md file.",
    ]);
  }

  const byteLength = new TextEncoder().encode(markdown).length;
  if (byteLength > MAX_FILE_SIZE) {
    throw new InvalidProfileError("Profile is too large.", [
      `Profile is ${byteLength} bytes; the limit is ${MAX_FILE_SIZE} bytes. Keep the profile to what another AI actually needs.`,
    ]);
  }

  const parsed = parser.parse(markdown);

  if (!hasFrontmatter(markdown)) {
    reasons.push(
      'Missing YAML frontmatter. The file must start with `---`, include `schema_version: "' +
        CURRENT_SCHEMA_VERSION +
        '"`, and close with `---`.'
    );
  }

  for (const error of parsed.errors) {
    reasons.push(`${error.code}: ${error.message}`);
  }

  const validation = parser.validate(parsed.profile);
  for (const error of validation.errors) {
    // Parse already reported a missing schema_version; don't say it twice.
    if (error.code === "MISSING_SCHEMA_VERSION" && reasons.length > 0) continue;
    reasons.push(`${error.code}: ${error.message}`);
  }

  const stats = computeStats(parsed.profile, markdown);

  if (reasons.length === 0 && stats.sectionCount === 0) {
    reasons.push(
      "Profile has no sections with content. Add sections such as `## How I Communicate` or `## What I Do` with real detail, or don't create a profile yet."
    );
  }

  if (reasons.length === 0 && stats.wordCount < MIN_BODY_WORDS) {
    reasons.push(
      `Profile has only ${stats.wordCount} words of content. An empty or near-empty profile is worse than none — include what you actually know about the user.`
    );
  }

  if (reasons.length > 0) {
    throw new InvalidProfileError(
      "The markdown is not a valid you.md profile.",
      reasons
    );
  }

  const now = options.now ?? new Date();
  const stamped = stampFrontmatter(markdown, {
    created: options.stampCreated ? isoDate(now) : undefined,
    lastUpdated: isoDate(now),
    source: options.source ?? "chatgpt",
    privacyLevel: "private",
  });

  return {
    markdown: stamped,
    profile: parsed.profile,
    stats,
    warnings: validation.warnings.map((w) => `${w.code}: ${w.message}`),
  };
}

function isoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function hasFrontmatter(markdown: string): boolean {
  return /^﻿?\s*---\s*\r?\n/.test(markdown);
}

/**
 * Count sections that carry content and words in the body.
 *
 * Headings and HTML comments are excluded so a template skeleton — all headers
 * and placeholder comments — scores zero.
 */
function computeStats(profile: YouMdProfile, markdown: string): ProfileStats {
  let sectionCount = 0;
  for (const section of profile.sections.values()) {
    if (section.level < 2) continue;
    if (stripNoise(section.content).trim().length > 0) {
      sectionCount++;
    }
  }

  const body = markdown.replace(/^﻿?\s*---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(\r?\n|$)/, "");
  const words = stripNoise(body)
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));

  return { sectionCount, wordCount: words.length };
}

/** Drop HTML comments and heading lines — neither is user content. */
function stripNoise(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^#{1,6}\s.*$/gm, " ");
}

interface StampFields {
  readonly created?: string;
  readonly lastUpdated: string;
  readonly source: string;
  readonly privacyLevel: string;
}

/**
 * Set server-owned frontmatter keys, leaving every other line untouched.
 *
 * `last_updated` is always the server's clock. `created`, `source`, and
 * `privacy_level` are only filled in when the model left them out — a user who
 * set `privacy_level: public` keeps it, but the default is private.
 */
export function stampFrontmatter(markdown: string, fields: StampFields): string {
  const match = markdown.match(/^(﻿?\s*---\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*)(\r?\n|$)/);
  if (!match) {
    return markdown;
  }

  const [, open, body, close, trailing] = match;
  const eol = body.includes("\r\n") || open.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);

  const setLine = (key: string, value: string, onlyIfMissing: boolean): void => {
    const index = lines.findIndex((line) =>
      new RegExp(`^${key}\\s*:`).test(line)
    );
    if (index === -1) {
      lines.push(`${key}: "${value}"`);
    } else if (!onlyIfMissing) {
      lines[index] = `${key}: "${value}"`;
    }
  };

  if (fields.created) {
    setLine("created", fields.created, true);
  }
  setLine("last_updated", fields.lastUpdated, false);
  setLine("source", fields.source, true);
  setLine("privacy_level", fields.privacyLevel, true);

  // Drop blank lines that would otherwise pile up at the end of the block.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  return open + lines.join(eol) + close + trailing + markdown.slice(match[0].length);
}
