import { describe, it, expect } from "vitest";
import { generateFromAnswers } from "../../src/cli/wizard.js";

const sampleAnswers = {
  topics: ["distributed systems", "machine learning"],
  expertise: "expert",
  searchDepth: "deep",
  preferredSources: ["official_docs", "academic"],
  freshnessVsAuthority: "authoritative",
  visualPreference: "low",
  factChecking: "strict",
  verbosity: "concise",
};

describe("generateFromAnswers", () => {
  it("contains # Me heading", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain("# Me");
  });

  it("contains ## How I Think with Expertise: expert", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain("## How I Think");
    expect(output).toContain("Expertise: expert");
  });

  it("contains ## How I Communicate with Verbosity: concise", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain("## How I Communicate");
    expect(output).toContain("Verbosity: concise");
  });

  it("contains ## What I Trust with official documentation", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain("## What I Trust");
    expect(output).toContain("official documentation");
  });

  it("contains ## What I'm Into with topics", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain("## What I'm Into");
    expect(output).toContain("distributed systems");
    expect(output).toContain("machine learning");
  });

  it("does NOT contain snake_case fields", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).not.toContain("search_depth:");
    expect(output).not.toContain("expertise_level:");
    expect(output).not.toContain("freshness_weight:");
    expect(output).not.toContain("visual_preference:");
    expect(output).not.toContain("long_form_preference:");
    expect(output).not.toContain("preferred_sources:");
  });

  it("uses schema version 1.1", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain('schema_version: "1.1"');
  });

  it("maps searchDepth values correctly", () => {
    const quick = generateFromAnswers({ ...sampleAnswers, searchDepth: "quick" });
    expect(quick).toContain("quick answers");

    const moderate = generateFromAnswers({ ...sampleAnswers, searchDepth: "moderate" });
    expect(moderate).toContain("Depth preference: balanced");

    const deep = generateFromAnswers(sampleAnswers);
    expect(deep).toContain("long-form analysis");
  });

  it("maps visualPreference values correctly", () => {
    const low = generateFromAnswers(sampleAnswers);
    expect(low).toContain("Visual content: minimal");

    const moderate = generateFromAnswers({ ...sampleAnswers, visualPreference: "moderate" });
    expect(moderate).toContain("Visual content: some, when helpful");

    const high = generateFromAnswers({ ...sampleAnswers, visualPreference: "high" });
    expect(high).toContain("Visual content: yes, prefer visual content");
  });

  it("maps freshnessVsAuthority values correctly", () => {
    const auth = generateFromAnswers(sampleAnswers);
    expect(auth).toContain("prefer established, authoritative");

    const fresh = generateFromAnswers({ ...sampleAnswers, freshnessVsAuthority: "fresh" });
    expect(fresh).toContain("prefer recent over established");

    const balanced = generateFromAnswers({ ...sampleAnswers, freshnessVsAuthority: "balanced" });
    expect(balanced).toContain("mix of new and established");
  });

  it("sets explanations based on expertise", () => {
    const expert = generateFromAnswers(sampleAnswers);
    expect(expert).toContain("Explanations: only when asked");

    const beginner = generateFromAnswers({ ...sampleAnswers, expertise: "beginner" });
    expect(beginner).toContain("Explanations: when helpful");
  });

  it("includes Don't section for expert with concise verbosity", () => {
    const output = generateFromAnswers(sampleAnswers);
    expect(output).toContain("## Don't");
    expect(output).toContain("- Over-explain things I already know");
    expect(output).toContain("- Use excessive caveats or hedging");
  });
});
