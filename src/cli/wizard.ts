/**
 * Interactive wizard for generating you.md profiles
 */

import prompts from "prompts";
import { CURRENT_SCHEMA_VERSION } from "../utils/constants.js";

export interface WizardAnswers {
  name?: string;
  expertise: string;
  learningStyle: string;
  verbosity: string;
  tone: string;
  explanations: string;
  topics: string[];
  sourceQuality: string;
  factChecking: string;
  contentDepth: string;
  language: string;
  timezone?: string;
  donts: string[];
}

/**
 * Run the interactive wizard to gather user preferences
 */
export async function runWizard(): Promise<WizardAnswers | null> {
  console.log("\n🎯 Let's create your AI identity.\n");

  const answers = await prompts(
    [
      {
        type: "text",
        name: "name",
        message: "What should AI call you? (optional)",
        initial: "",
      },
      {
        type: "select",
        name: "expertise",
        message: "What's your general expertise level?",
        choices: [
          { title: "Beginner", description: "New to most topics", value: "beginner" },
          { title: "Intermediate", description: "Comfortable with fundamentals", value: "intermediate" },
          { title: "Advanced", description: "Deep knowledge in your areas", value: "advanced" },
          { title: "Expert", description: "Professional-level expertise", value: "expert" },
        ],
        initial: 1,
      },
      {
        type: "select",
        name: "learningStyle",
        message: "How do you prefer to learn?",
        choices: [
          { title: "Hands-on", description: "Show me examples, let me try", value: "hands-on" },
          { title: "Conceptual", description: "Explain the theory first", value: "conceptual" },
          { title: "Visual", description: "Diagrams and illustrations", value: "visual" },
          { title: "Reference", description: "Give me docs, I'll figure it out", value: "reference" },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "verbosity",
        message: "How verbose should AI responses be?",
        choices: [
          { title: "Minimal", description: "Just the answer, nothing extra", value: "minimal" },
          { title: "Concise", description: "Brief but complete", value: "concise" },
          { title: "Detailed", description: "Full explanations", value: "detailed" },
          { title: "Verbose", description: "Comprehensive with context", value: "verbose" },
        ],
        initial: 1,
      },
      {
        type: "select",
        name: "tone",
        message: "What tone do you prefer?",
        choices: [
          { title: "Direct", description: "Straight to the point", value: "direct" },
          { title: "Friendly", description: "Warm and approachable", value: "friendly" },
          { title: "Professional", description: "Formal and polished", value: "professional" },
          { title: "Casual", description: "Relaxed and conversational", value: "casual" },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "explanations",
        message: "When should AI explain its reasoning?",
        choices: [
          { title: "Always", description: "Show your work", value: "always" },
          { title: "Only when asked", description: "Keep it brief unless I ask", value: "only when asked" },
          { title: "Never", description: "Just give me the answer", value: "never" },
        ],
        initial: 1,
      },
      {
        type: "list",
        name: "topics",
        message: "What topics interest you? (comma-separated)",
        initial: "",
        separator: ",",
      },
      {
        type: "select",
        name: "sourceQuality",
        message: "How strict about information sources?",
        choices: [
          { title: "Relaxed", description: "Any reasonable source", value: "any" },
          { title: "Standard", description: "Prefer reputable sources", value: "standard" },
          { title: "High", description: "Official docs and peer-reviewed", value: "high" },
          { title: "Strict", description: "Only authoritative sources", value: "authoritative" },
        ],
        initial: 2,
      },
      {
        type: "select",
        name: "factChecking",
        message: "How important is fact-checking to you?",
        choices: [
          { title: "Relaxed", description: "Trust AI judgment", value: "relaxed" },
          { title: "Standard", description: "Flag uncertain claims", value: "standard" },
          { title: "Strict", description: "Cite sources, verify claims", value: "strict" },
        ],
        initial: 1,
      },
      {
        type: "select",
        name: "contentDepth",
        message: "How deep should content go?",
        choices: [
          { title: "Quick answers", description: "Surface level, fast", value: "quick" },
          { title: "Moderate", description: "Balanced depth", value: "moderate" },
          { title: "Thorough", description: "Complete coverage", value: "thorough" },
          { title: "Deep dive", description: "Comprehensive analysis", value: "deep" },
        ],
        initial: 2,
      },
      {
        type: "text",
        name: "language",
        message: "What's your primary language?",
        initial: "en-US",
      },
      {
        type: "text",
        name: "timezone",
        message: "What's your timezone? (optional)",
        initial: "",
      },
      {
        type: "multiselect",
        name: "donts",
        message: "What should AI avoid? (space to select, enter to confirm)",
        choices: [
          { title: "Over-explaining", value: "Over-explain things I already know" },
          { title: "Excessive caveats", value: "Use excessive caveats or hedging" },
          { title: "Hand-holding", value: "Assume I need hand-holding" },
          { title: "Repeating info", value: "Repeat information I just provided" },
          { title: "Unnecessary disclaimers", value: "Add unnecessary disclaimers" },
          { title: "Being too formal", value: "Be overly formal or stiff" },
          { title: "Being too casual", value: "Be too casual or use slang" },
        ],
        hint: "- Space to select. Enter to submit",
      },
    ],
    {
      onCancel: () => {
        console.log("\n✖ Cancelled\n");
        return false;
      },
    }
  );

  // Check if user cancelled
  if (!answers.expertise) {
    return null;
  }

  return answers as WizardAnswers;
}

/**
 * Generate you.md content from wizard answers
 */
export function generateFromAnswers(answers: WizardAnswers): string {
  const today = new Date().toISOString().split("T")[0];

  // Build topics string
  const topicsStr = answers.topics.length > 0
    ? answers.topics.map(t => t.trim()).filter(Boolean).join(", ")
    : "";

  // Build don'ts list
  const dontsStr = answers.donts.length > 0
    ? answers.donts.map(d => `- ${d}`).join("\n")
    : "- Over-explain things I already know";

  // Map source quality to human-friendly text
  const sourceMap: Record<string, string> = {
    any: "any reasonable source",
    standard: "reputable sources",
    high: "official documentation, peer-reviewed",
    authoritative: "authoritative sources only",
  };

  return `---
schema_version: "${CURRENT_SCHEMA_VERSION}"
created: "${today}"
last_updated: "${today}"
privacy_level: "private"
---

# Me${answers.name ? `\n\n${answers.name}` : ""}

## How I Think

Expertise: ${answers.expertise}
Learning style: ${answers.learningStyle}
Depth preference: ${answers.contentDepth}

## How I Communicate

Verbosity: ${answers.verbosity}
Tone: ${answers.tone}
Explanations: ${answers.explanations}

## What I Trust

Trusted sources: ${sourceMap[answers.sourceQuality] || answers.sourceQuality}
Fact-checking: ${answers.factChecking}

## What I'm Into

Topics: ${topicsStr}
Content depth: ${answers.contentDepth}

## Context

Language: ${answers.language}${answers.timezone ? `\nTimezone: ${answers.timezone}` : ""}

## Don't

${dontsStr}
`;
}
