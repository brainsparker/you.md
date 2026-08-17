import { describe, it, expect } from "vitest";

import { SKILL_FIXTURES, findFixture } from "../../eval/chatgpt/fixtures.js";
import { gradeProfile, summarize } from "../../eval/chatgpt/grader.js";

/**
 * These tests exercise the eval harness, not a model: each case is a
 * hand-written profile that fails exactly one of the skill's rules, proving the
 * grader would catch that failure when a real model makes it.
 */

const PM = findFixture("pm-with-technical-depth")!;
const THIN = findFixture("thin-history")!;

const GOOD_PM_PROFILE = `---
schema_version: "1.1"
privacy_level: "private"
source: "chatgpt"
---

# Me

## How I Communicate

Wants the answer first, then the reasoning. Concise, no preamble.

## What I Do

Product manager at a developer tools company. Writes and reads TypeScript daily,
though engineers on the team ship the services.

## What I'm Working On

Writing a PRD for a ChatGPT integration, returned to across several sessions.

## What I'm Into

Competitive analysis of developer tools and AI coding assistants.
`;

describe("skill eval fixtures", () => {
  it("cover the extraction rules the skill has to follow", () => {
    expect(SKILL_FIXTURES.length).toBeGreaterThanOrEqual(3);

    for (const fixture of SKILL_FIXTURES) {
      expect(fixture.history.length).toBeGreaterThan(100);
      expect(fixture.mustNotInvent.length).toBeGreaterThan(0);
    }

    // At least one fixture must have nothing worth recording, so "declined to
    // create a profile" stays a tested outcome.
    expect(SKILL_FIXTURES.some((fixture) => fixture.mustInclude.length === 0)).toBe(true);
  });
});

describe("gradeProfile", () => {
  it("passes a profile that follows every rule", () => {
    const result = gradeProfile(PM, GOOD_PM_PROFILE);

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.includes.every((entry) => entry.matched)).toBe(true);
  });

  it("fails a profile that misses a repeated preference", () => {
    const withoutCommunication = GOOD_PM_PROFILE.replace(
      "Wants the answer first, then the reasoning. Concise, no preamble.",
      "Enjoys talking through roadmap tradeoffs with the team at length."
    );

    const result = gradeProfile(PM, withoutCommunication);

    expect(result.passed).toBe(false);
    expect(result.includes.find((entry) => entry.label.includes("communication"))?.matched).toBe(false);
    expect(result.score).toBeLessThan(1);
  });

  it("fails a profile that misses professional context", () => {
    const result = gradeProfile(
      PM,
      GOOD_PM_PROFILE.replace(
        "Product manager at a developer tools company.",
        "Works on software products."
      )
    );

    expect(result.passed).toBe(false);
    expect(result.includes.find((entry) => entry.label.includes("professional"))?.matched).toBe(false);
  });

  it("fails a profile that keeps incidental details", () => {
    const result = gradeProfile(
      PM,
      GOOD_PM_PROFILE.replace(
        "## What I'm Into",
        "## What I'm Into\n\nCooking — asked for a cacio e pepe recipe recently.\n\n## More"
      )
    );

    expect(result.passed).toBe(false);
    expect(result.excludeViolations.length).toBeGreaterThan(0);
  });

  it("fails a profile that invents facts", () => {
    const result = gradeProfile(
      PM,
      GOOD_PM_PROFILE.replace(
        "Product manager at a developer tools company.",
        "Senior product manager at Stripe."
      )
    );

    expect(result.passed).toBe(false);
    expect(result.inventionViolations.length).toBeGreaterThan(0);
  });

  it("fails markdown that is not a valid you.md", () => {
    const result = gradeProfile(PM, GOOD_PM_PROFILE.replace(/^---\n[\s\S]*?\n---\n/, ""));

    expect(result.valid).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.validationReasons.join(" ")).toContain("frontmatter");
  });

  it("treats declining to write a profile as correct only when there is nothing to say", () => {
    expect(gradeProfile(THIN, null).passed).toBe(true);
    expect(gradeProfile(THIN, "   ").passed).toBe(true);

    const missed = gradeProfile(PM, null);
    expect(missed.passed).toBe(false);
    expect(missed.createdProfile).toBe(false);
    expect(missed.validationReasons.join(" ")).toContain("signals worth recording");
  });

  it("fails a padded profile built from a thin history", () => {
    const result = gradeProfile(
      THIN,
      `---
schema_version: "1.1"
---

# Me

## What I Do

Software engineer with an interest in web development and front-end layout.

## How I Communicate

Prefers concise summaries of long articles and technical explanations.
`
    );

    expect(result.passed).toBe(false);
    expect(result.inventionViolations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("summarize", () => {
  it("reports pass rate and mean score across fixtures", () => {
    const results = [
      gradeProfile(PM, GOOD_PM_PROFILE),
      gradeProfile(PM, null),
    ];

    expect(summarize(results)).toEqual({ passRate: 0.5, meanScore: 0.5 });
  });

  it("handles an empty run", () => {
    expect(summarize([])).toEqual({ passRate: 0, meanScore: 0 });
  });
});
