import { describe, it, expect } from "vitest";

import { InvalidProfileError } from "../../src/chatgpt/errors.js";
import {
  stampFrontmatter,
  validateProfileMarkdown,
} from "../../src/chatgpt/validation.js";
import { createParser } from "../../src/parser/index.js";

const VALID_PROFILE = `---
schema_version: "1.1"
---

# Me

## How I Communicate

Verbosity: concise
Tone: direct. Skip the preamble and lead with the answer.

## What I Do

Product manager at a developer tools company. Reads TypeScript fluently and
ships small prototypes personally.
`;

function expectRejection(markdown: unknown): InvalidProfileError {
  try {
    validateProfileMarkdown(markdown);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidProfileError);
    return error as InvalidProfileError;
  }
  throw new Error("Expected the profile to be rejected, but it was accepted");
}

describe("validateProfileMarkdown", () => {
  it("accepts a well-formed profile and reports section and word counts", () => {
    const result = validateProfileMarkdown(VALID_PROFILE);

    expect(result.stats.sectionCount).toBe(2);
    expect(result.stats.wordCount).toBeGreaterThan(15);
    expect(result.profile.schemaVersion).toBe("1.1");
  });

  it("produces markdown that parses as a valid you.md", () => {
    const result = validateProfileMarkdown(VALID_PROFILE);
    const parser = createParser();
    const parsed = parser.parse(result.markdown);

    expect(parsed.success).toBe(true);
    expect(parser.validate(parsed.profile).valid).toBe(true);
  });

  it("rejects markdown without frontmatter", () => {
    const error = expectRejection("# Me\n\n## What I Do\n\nSomething about me that is long enough to count as content.\n");

    expect(error.reasons.join(" ")).toContain("frontmatter");
  });

  it("rejects an unsupported schema version", () => {
    const error = expectRejection(
      VALID_PROFILE.replace('schema_version: "1.1"', 'schema_version: "9.0"')
    );

    expect(error.reasons.join(" ")).toContain("UNSUPPORTED_SCHEMA_VERSION");
  });

  it("rejects malformed frontmatter that never closes", () => {
    const error = expectRejection(`---
schema_version: "1.1"

# Me

## What I Do

Writes software for a living and prefers concise answers to long ones.
`);

    expect(error.reasons.join(" ")).toContain("frontmatter");
  });

  it("rejects an empty profile", () => {
    const error = expectRejection(`---
schema_version: "1.1"
---
`);

    expect(error.reasons.join(" ")).toContain("no sections");
  });

  it("rejects a template skeleton with headers and comments but no content", () => {
    const error = expectRejection(`---
schema_version: "1.1"
---

# Me

## How I Communicate

<!-- how AI should talk to you -->

## What I Do

<!-- your role -->
`);

    expect(error.reasons.join(" ")).toContain("no sections");
  });

  it("rejects a profile that is too thin to be worth keeping", () => {
    const error = expectRejection(`---
schema_version: "1.1"
---

# Me

## What I Do

Engineer.
`);

    expect(error.reasons.join(" ")).toContain("words of content");
  });

  it("rejects missing or non-string markdown", () => {
    expect(expectRejection(undefined).reasons.join(" ")).toContain("non-empty string");
    expect(expectRejection(42).reasons.join(" ")).toContain("non-empty string");
    expect(expectRejection("   ").reasons.join(" ")).toContain("non-empty string");
  });

  it("rejects a profile over the size limit", () => {
    const padding = "Prefers detailed written explanations. ".repeat(4000);
    const error = expectRejection(VALID_PROFILE + padding);

    expect(error.message).toContain("too large");
  });

  it("stamps server-owned dates and defaults on create", () => {
    const result = validateProfileMarkdown(VALID_PROFILE, {
      now: new Date("2026-03-04T05:06:07Z"),
      stampCreated: true,
    });

    expect(result.markdown).toContain('created: "2026-03-04"');
    expect(result.markdown).toContain('last_updated: "2026-03-04"');
    expect(result.markdown).toContain('source: "chatgpt"');
    expect(result.markdown).toContain('privacy_level: "private"');
  });

  it("does not add a created date on update", () => {
    const result = validateProfileMarkdown(VALID_PROFILE, {
      now: new Date("2026-03-04T05:06:07Z"),
      stampCreated: false,
    });

    expect(result.markdown).not.toContain("created:");
    expect(result.markdown).toContain('last_updated: "2026-03-04"');
  });

  it("surfaces unknown sections as warnings rather than failures", () => {
    const result = validateProfileMarkdown(`---
schema_version: "1.1"
---

# Me

## Fermentation Log

Keeps a sourdough starter going and asks about hydration ratios most weekends.
Bakes on Saturdays and wants measurements in grams rather than cups.
`);

    expect(result.warnings.join(" ")).toContain("UNKNOWN_SECTION");
  });
});

describe("stampFrontmatter", () => {
  const fields = {
    created: "2026-01-02",
    lastUpdated: "2026-01-02",
    source: "chatgpt",
    privacyLevel: "private",
  };

  it("overwrites last_updated but preserves user-set values", () => {
    const stamped = stampFrontmatter(
      `---
schema_version: "1.1"
created: "2020-05-05"
last_updated: "2020-05-05"
privacy_level: "public"
author: "Sam"
---

# Me
`,
      fields
    );

    expect(stamped).toContain('created: "2020-05-05"');
    expect(stamped).toContain('last_updated: "2026-01-02"');
    expect(stamped).toContain('privacy_level: "public"');
    expect(stamped).toContain('author: "Sam"');
  });

  it("leaves the body untouched", () => {
    const body = "\n# Me\n\n## What I Do\n\nBuilds things.\n";
    const stamped = stampFrontmatter(`---\nschema_version: "1.1"\n---${body}`, fields);

    expect(stamped.endsWith(body)).toBe(true);
  });

  it("returns the input unchanged when there is no frontmatter", () => {
    const input = "# Me\n\nNo frontmatter here.\n";
    expect(stampFrontmatter(input, fields)).toBe(input);
  });
});
