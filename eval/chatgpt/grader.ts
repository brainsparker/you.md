/**
 * Deterministic grader for the you.md skill evals.
 *
 * A generated profile passes only if it is a valid you.md, carries every signal
 * the history repeats, leaves out the incidental and ephemeral details, and
 * invents nothing. The score is a partial-credit view of the same four checks,
 * so a regression shows up as a number moving rather than a pass flipping.
 */

import { InvalidProfileError } from "../../src/chatgpt/errors.js";
import { validateProfileMarkdown } from "../../src/chatgpt/validation.js";
import type { Expectation, SkillFixture } from "./fixtures.js";

export interface ExpectationResult {
  readonly label: string;
  readonly matched: boolean;
}

export interface GradeResult {
  readonly fixtureId: string;
  /** Whether the model produced a profile at all. */
  readonly createdProfile: boolean;
  readonly valid: boolean;
  readonly validationReasons: string[];
  /** Signals that should be present. */
  readonly includes: ExpectationResult[];
  /** Incidental details that leaked in. */
  readonly excludeViolations: string[];
  /** Content with no support in the history. */
  readonly inventionViolations: string[];
  /** 0–1, weighted across validity, coverage, exclusions, and inventions. */
  readonly score: number;
  readonly passed: boolean;
}

const WEIGHTS = {
  valid: 0.4,
  coverage: 0.3,
  exclusions: 0.15,
  inventions: 0.15,
} as const;

function matches(expectation: Expectation, text: string): boolean {
  return expectation.patterns.some((pattern) => pattern.test(text));
}

/**
 * Grade one generated profile.
 *
 * Pass `null` when the model declined to create a profile — correct behavior
 * for a history with nothing worth recording, and a failure otherwise.
 */
export function gradeProfile(
  fixture: SkillFixture,
  markdown: string | null
): GradeResult {
  const declined = markdown === null || markdown.trim().length === 0;

  if (declined) {
    const rightToDecline = fixture.mustInclude.length === 0;
    return {
      fixtureId: fixture.id,
      createdProfile: false,
      valid: false,
      validationReasons: rightToDecline
        ? []
        : ["No profile was produced, but the history contains signals worth recording."],
      includes: fixture.mustInclude.map((expectation) => ({
        label: expectation.label,
        matched: false,
      })),
      excludeViolations: [],
      inventionViolations: [],
      score: rightToDecline ? 1 : 0,
      passed: rightToDecline,
    };
  }

  const text = markdown as string;

  let valid = true;
  const validationReasons: string[] = [];
  try {
    validateProfileMarkdown(text);
  } catch (error) {
    valid = false;
    validationReasons.push(
      ...(error instanceof InvalidProfileError
        ? error.reasons
        : [error instanceof Error ? error.message : String(error)])
    );
  }

  const includes = fixture.mustInclude.map((expectation) => ({
    label: expectation.label,
    matched: matches(expectation, text),
  }));

  const excludeViolations = fixture.mustExclude
    .filter((expectation) => matches(expectation, text))
    .map((expectation) => expectation.label);

  const inventionViolations = fixture.mustNotInvent
    .filter((expectation) => matches(expectation, text))
    .map((expectation) => expectation.label);

  const coverage =
    includes.length === 0
      ? 1
      : includes.filter((entry) => entry.matched).length / includes.length;

  const exclusionScore =
    fixture.mustExclude.length === 0
      ? 1
      : 1 - excludeViolations.length / fixture.mustExclude.length;

  const inventionScore =
    fixture.mustNotInvent.length === 0
      ? 1
      : 1 - inventionViolations.length / fixture.mustNotInvent.length;

  const score =
    (valid ? WEIGHTS.valid : 0) +
    WEIGHTS.coverage * coverage +
    WEIGHTS.exclusions * exclusionScore +
    WEIGHTS.inventions * inventionScore;

  return {
    fixtureId: fixture.id,
    createdProfile: true,
    valid,
    validationReasons,
    includes,
    excludeViolations,
    inventionViolations,
    score: Number(score.toFixed(4)),
    passed:
      valid &&
      coverage === 1 &&
      excludeViolations.length === 0 &&
      inventionViolations.length === 0,
  };
}

/** One line per fixture, for terminal output. */
export function formatGrade(result: GradeResult): string {
  const status = result.passed ? "PASS" : "FAIL";
  const misses = result.includes.filter((entry) => !entry.matched);

  const notes: string[] = [];
  if (!result.createdProfile) notes.push("no profile produced");
  if (result.createdProfile && !result.valid) {
    notes.push(`invalid: ${result.validationReasons[0] ?? "unknown"}`);
  }
  if (misses.length > 0) {
    notes.push(`missing: ${misses.map((entry) => entry.label).join(", ")}`);
  }
  if (result.excludeViolations.length > 0) {
    notes.push(`leaked: ${result.excludeViolations.join(", ")}`);
  }
  if (result.inventionViolations.length > 0) {
    notes.push(`invented: ${result.inventionViolations.join(", ")}`);
  }

  return `${status}  ${result.fixtureId.padEnd(32)} score=${result.score.toFixed(2)}${
    notes.length > 0 ? `  (${notes.join("; ")})` : ""
  }`;
}

export function summarize(results: GradeResult[]): {
  passRate: number;
  meanScore: number;
} {
  if (results.length === 0) {
    return { passRate: 0, meanScore: 0 };
  }

  const passed = results.filter((result) => result.passed).length;
  const total = results.reduce((sum, result) => sum + result.score, 0);

  return {
    passRate: passed / results.length,
    meanScore: Number((total / results.length).toFixed(4)),
  };
}
