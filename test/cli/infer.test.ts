import { describe, it, expect } from "vitest";
import {
  buildProfileFromSignals,
  formatScanResults,
  type InferredSignals,
} from "../../src/cli/infer.js";
import { CURRENT_SCHEMA_VERSION } from "../../src/utils/constants.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseSignals: InferredSignals = {
  git: {
    name: "Test User",
    email: "test@example.com",
    topLanguages: [
      { language: "TypeScript", percentage: 62 },
      { language: "Python", percentage: 24 },
      { language: "Go", percentage: 10 },
      { language: "Rust", percentage: 4 },
    ],
    commitStyle: "conventional",
    commitCount: 847,
  },
  stack: {
    frameworks: ["React", "FastAPI"],
    runtime: "Node.js",
    packageManager: "npm",
  },
  codeStyle: {
    formatter: "Prettier",
    indentStyle: "space",
    indentSize: 2,
    lineLength: 100,
  },
  aiPrefs: {
    source: ".cursorrules",
    raw: "be concise\nno hedging\n",
    preferences: [
      { key: "verbosity", value: "concise" },
      { key: "no_hedging", value: "true" },
    ],
  },
  system: {
    timezone: "America/Los_Angeles",
    locale: "en-US",
    os: "darwin",
  },
};

const minimalSignals: InferredSignals = {
  git: null,
  stack: null,
  codeStyle: null,
  aiPrefs: null,
  system: {
    timezone: "UTC",
    locale: "en-US",
    os: "linux",
  },
};

// ---------------------------------------------------------------------------
// buildProfileFromSignals
// ---------------------------------------------------------------------------

describe("buildProfileFromSignals", () => {
  it("includes author and email from git identity in frontmatter", () => {
    const profile = buildProfileFromSignals(baseSignals);
    expect(profile).toContain('author: "Test User"');
    expect(profile).toContain('email: "test@example.com"');
    expect(profile).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  });

  it("includes How I Work section with runtime, languages, frameworks", () => {
    const profile = buildProfileFromSignals(baseSignals);
    expect(profile).toContain("## How I Work");
    expect(profile).toContain("Primary runtime: Node.js");
    expect(profile).toContain("Languages: TypeScript");
    expect(profile).toContain("Frameworks: React, FastAPI");
    expect(profile).toContain("Package manager: npm");
    expect(profile).toContain("Commit style: Conventional Commits");
    expect(profile).toContain("Formatter: Prettier");
    expect(profile).toContain("Indentation: space (2)");
    expect(profile).toContain("Line length: 100");
  });

  it("includes Context section with timezone, locale, OS", () => {
    const profile = buildProfileFromSignals(baseSignals);
    expect(profile).toContain("## Context");
    expect(profile).toContain("Timezone: America/Los_Angeles");
    expect(profile).toContain("Locale: en-US");
    expect(profile).toContain("OS: darwin");
  });

  it("includes What I'm Into section with topics from languages", () => {
    const profile = buildProfileFromSignals(baseSignals);
    expect(profile).toContain("## What I'm Into");
    expect(profile).toContain("Topics: TypeScript, Python, Go, Rust, React, FastAPI");
  });

  it("includes How I Think with placeholder comments", () => {
    const profile = buildProfileFromSignals(baseSignals);
    expect(profile).toContain("## How I Think");
    expect(profile).toContain("Expertise: <!-- beginner | intermediate | advanced | expert -->");
    expect(profile).toContain("Learning style:");
  });

  it("includes How I Communicate with placeholder comments when no AI prefs override", () => {
    const profile = buildProfileFromSignals(minimalSignals);
    expect(profile).toContain("## How I Communicate");
    expect(profile).toContain("Verbosity: <!-- concise | moderate | detailed -->");
  });

  it("includes Boundaries section with AI prefs when found", () => {
    const profile = buildProfileFromSignals(baseSignals);
    expect(profile).toContain("## Boundaries");
    expect(profile).toContain("Inferred from .cursorrules");
    expect(profile).toContain("verbosity: concise");
  });

  it("includes What I Trust with placeholder fields", () => {
    const profile = buildProfileFromSignals(baseSignals);
    expect(profile).toContain("## What I Trust");
    expect(profile).toContain("Trusted sources:");
    expect(profile).toContain("Fact-checking:");
  });

  it("includes Where I'm Headed with placeholder fields", () => {
    const profile = buildProfileFromSignals(baseSignals);
    expect(profile).toContain("## Where I'm Headed");
    expect(profile).toContain("Current focus:");
    expect(profile).toContain("Learning goals:");
  });

  it("handles minimal signals gracefully", () => {
    const profile = buildProfileFromSignals(minimalSignals);
    expect(profile).toContain("## Context");
    expect(profile).toContain("Timezone: UTC");
    expect(profile).not.toContain("Primary runtime:");
    expect(profile).toContain("## How I Think");
    // Boundaries with defaults when no AI prefs
    expect(profile).toContain("## Boundaries");
    expect(profile).toContain("- Over-explain things I already know");
  });

  it("does not include What I'm Into when there are no languages or frameworks", () => {
    const profile = buildProfileFromSignals(minimalSignals);
    expect(profile).not.toContain("## What I'm Into");
  });
});

// ---------------------------------------------------------------------------
// formatScanResults
// ---------------------------------------------------------------------------

describe("formatScanResults", () => {
  it("formats git identity with name and email", () => {
    const output = formatScanResults(baseSignals);
    expect(output).toContain("Test User");
    expect(output).toContain("test@example.com");
  });

  it("shows commit count and top languages", () => {
    const output = formatScanResults(baseSignals);
    expect(output).toContain("847 commits");
    expect(output).toContain("TypeScript (62%)");
    expect(output).toContain("Python (24%)");
  });

  it("shows project stack info", () => {
    const output = formatScanResults(baseSignals);
    expect(output).toContain("Node.js");
    expect(output).toContain("React");
    expect(output).toContain("npm");
  });

  it("shows AI prefs source and count", () => {
    const output = formatScanResults(baseSignals);
    expect(output).toContain(".cursorrules");
    expect(output).toContain("2 preferences");
  });

  it("shows system info", () => {
    const output = formatScanResults(baseSignals);
    expect(output).toContain("America/Los_Angeles");
    expect(output).toContain("darwin");
  });

  it("handles null signals gracefully", () => {
    const output = formatScanResults(minimalSignals);
    expect(output).toContain("not available");
    expect(output).toContain("no project config");
    expect(output).toContain("no existing .cursorrules");
  });
});