/**
 * Interactive wizard for generating you.md profiles
 */

import prompts from "prompts";
import { CURRENT_SCHEMA_VERSION } from "../utils/constants.js";

export interface WizardAnswers {
  expertise: string;
  verbosity: string;
  tone: string;
  explanations: string;
  topics: string[];
  sourceQuality: string;
  donts: string[];
}

/**
 * Run the interactive wizard to gather user preferences
 */
export async function runWizard(): Promise<WizardAnswers | null> {
  console.log("\n✨ Let's set up your AI identity.\n");

  const answers = await prompts(
    [
      {
        type: "select",
        name: "expertise",
        message: "How much should AI assume you know?",
        choices: [
          { title: "Explain everything", description: "I'm learning, walk me through it", value: "beginner" },
          { title: "Skip the basics", description: "I know fundamentals", value: "intermediate" },
          { title: "Be technical", description: "No hand-holding needed", value: "advanced" },
          { title: "Assume expertise", description: "Just the facts, I'll figure it out", value: "expert" },
        ],
        initial: 1,
      },
      {
        type: "select",
        name: "verbosity",
        message: "How long should responses be?",
        choices: [
          { title: "Short", description: "Just the answer", value: "minimal" },
          { title: "Brief", description: "Concise but complete", value: "concise" },
          { title: "Thorough", description: "Full explanations", value: "detailed" },
        ],
        initial: 1,
      },
      {
        type: "select",
        name: "tone",
        message: "What tone works best for you?",
        choices: [
          { title: "Direct", description: "Straight to the point", value: "direct" },
          { title: "Friendly", description: "Warm and conversational", value: "friendly" },
          { title: "Professional", description: "Polished and formal", value: "professional" },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "explanations",
        message: "Should AI explain its reasoning?",
        choices: [
          { title: "Yes, always", description: "Show the thinking", value: "always" },
          { title: "Only if I ask", description: "Keep it clean unless I want more", value: "only when asked" },
          { title: "No", description: "Just give me answers", value: "never" },
        ],
        initial: 1,
      },
      {
        type: "list",
        name: "topics",
        message: "Topics you care about? (comma-separated, or skip)",
        initial: "",
        separator: ",",
      },
      {
        type: "select",
        name: "sourceQuality",
        message: "How picky are you about sources?",
        choices: [
          { title: "Not very", description: "Reasonable sources are fine", value: "any" },
          { title: "Somewhat", description: "Prefer reputable sources", value: "standard" },
          { title: "Very", description: "Official docs and peer-reviewed only", value: "high" },
        ],
        initial: 1,
      },
      {
        type: "multiselect",
        name: "donts",
        message: "Pet peeves? (space to select)",
        choices: [
          { title: "Over-explaining", value: "Over-explain things I already know" },
          { title: "Too many caveats", value: "Use excessive caveats or hedging" },
          { title: "Unnecessary disclaimers", value: "Add unnecessary disclaimers" },
          { title: "Repeating what I said", value: "Repeat information I just provided" },
          { title: "Being too formal", value: "Be overly formal or stiff" },
          { title: "Being too casual", value: "Be too casual or use slang" },
        ],
        hint: "Space to select, Enter to continue",
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
    : "";

  // Map expertise to human-friendly assumption text
  const expertiseMap: Record<string, string> = {
    beginner: "explain everything",
    intermediate: "skip the basics",
    advanced: "be technical",
    expert: "assume expertise",
  };

  // Map source quality
  const sourceMap: Record<string, string> = {
    any: "any reasonable source",
    standard: "reputable sources",
    high: "official docs, peer-reviewed",
  };

  // Map verbosity
  const verbosityMap: Record<string, string> = {
    minimal: "short",
    concise: "brief",
    detailed: "thorough",
  };

  let content = `---
schema_version: "${CURRENT_SCHEMA_VERSION}"
created: "${today}"
privacy_level: "private"
---

# Me

## How I Communicate

Assume I know: ${expertiseMap[answers.expertise] || answers.expertise}
Response length: ${verbosityMap[answers.verbosity] || answers.verbosity}
Tone: ${answers.tone}
Explanations: ${answers.explanations}

## What I Trust

Sources: ${sourceMap[answers.sourceQuality] || answers.sourceQuality}
`;

  if (topicsStr) {
    content += `
## What I'm Into

Topics: ${topicsStr}
`;
  }

  if (dontsStr) {
    content += `
## Don't

${dontsStr}
`;
  }

  return content;
}
