/**
 * Interactive wizard for generating you.md profiles
 */

import prompts from "prompts";
import { CURRENT_SCHEMA_VERSION } from "../utils/constants.js";

export interface WizardAnswers {
  // Search behavior
  topics: string[];
  expertise: string;
  searchDepth: string;
  // Content preferences
  preferredSources: string[];
  freshnessVsAuthority: string;
  visualPreference: string;
  // Trust & safety
  factChecking: string;
  // AI response (bonus)
  verbosity: string;
}

/**
 * Run the interactive wizard to gather user preferences
 */
export async function runWizard(): Promise<WizardAnswers | null> {
  console.log("\n✨ Let's personalize your AI & search experience.\n");

  const answers = await prompts(
    [
      {
        type: "list",
        name: "topics",
        message: "What topics interest you? (comma-separated)",
        initial: "",
        separator: ",",
      },
      {
        type: "select",
        name: "expertise",
        message: "What level of content do you prefer?",
        choices: [
          { title: "Beginner-friendly", description: "Explain concepts, include context", value: "beginner" },
          { title: "Intermediate", description: "Assume I know the basics", value: "intermediate" },
          { title: "Advanced", description: "Technical depth, skip fundamentals", value: "advanced" },
          { title: "Expert", description: "Cutting-edge, research-level", value: "expert" },
        ],
        initial: 1,
      },
      {
        type: "select",
        name: "searchDepth",
        message: "Quick answers or deep dives?",
        choices: [
          { title: "Quick answers", description: "Get to the point fast", value: "quick" },
          { title: "Balanced", description: "Enough detail to understand", value: "moderate" },
          { title: "Deep dives", description: "Comprehensive, thorough", value: "deep" },
        ],
        initial: 1,
      },
      {
        type: "multiselect",
        name: "preferredSources",
        message: "What sources do you trust? (space to select)",
        choices: [
          { title: "Official documentation", value: "official_docs" },
          { title: "Academic/research papers", value: "academic" },
          { title: "Blog posts & tutorials", value: "blogs" },
          { title: "Stack Overflow / forums", value: "forums" },
          { title: "News articles", value: "news" },
          { title: "Video content", value: "video" },
        ],
        hint: "Space to select, Enter to continue",
      },
      {
        type: "select",
        name: "freshnessVsAuthority",
        message: "Recent content or established sources?",
        choices: [
          { title: "Latest", description: "Newest information, even if less proven", value: "fresh" },
          { title: "Balanced", description: "Mix of new and established", value: "balanced" },
          { title: "Established", description: "Authoritative, time-tested sources", value: "authoritative" },
        ],
        initial: 1,
      },
      {
        type: "select",
        name: "visualPreference",
        message: "How much do you like visual content?",
        choices: [
          { title: "Text preferred", description: "Articles, docs, written content", value: "low" },
          { title: "Some visuals", description: "Diagrams when helpful", value: "moderate" },
          { title: "Visual learner", description: "Images, videos, infographics", value: "high" },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "factChecking",
        message: "How strict on accuracy?",
        choices: [
          { title: "Relaxed", description: "Reasonable accuracy is fine", value: "relaxed" },
          { title: "Standard", description: "Flag uncertain claims", value: "standard" },
          { title: "Strict", description: "Cite sources, high accuracy bar", value: "strict" },
        ],
        initial: 1,
      },
      {
        type: "select",
        name: "verbosity",
        message: "How should AI respond to you?",
        choices: [
          { title: "Concise", description: "Brief, to the point", value: "concise" },
          { title: "Balanced", description: "Clear with enough context", value: "moderate" },
          { title: "Detailed", description: "Thorough explanations", value: "detailed" },
        ],
        initial: 0,
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

  // Build topics list
  const topics = answers.topics
    .map(t => t.trim())
    .filter(Boolean);

  // Map source values to readable names
  const sourceLabels: Record<string, string> = {
    official_docs: "official documentation",
    academic: "academic papers",
    blogs: "blog posts",
    forums: "Stack Overflow, forums",
    news: "news articles",
    video: "video content",
  };

  const sources = answers.preferredSources
    .map(s => sourceLabels[s] || s)
    .join(", ");

  // Map numeric preferences
  const depthMap: Record<string, number> = {
    quick: 0.3,
    moderate: 0.5,
    deep: 0.8,
  };

  const freshnessMap: Record<string, number> = {
    fresh: 0.8,
    balanced: 0.5,
    authoritative: 0.2,
  };

  const visualMap: Record<string, number> = {
    low: 0.2,
    moderate: 0.5,
    high: 0.8,
  };

  return `---
schema_version: "${CURRENT_SCHEMA_VERSION}"
created: "${today}"
privacy_level: "private"
---

# Me

## Search Behavior

topics: [${topics.map(t => `"${t}"`).join(", ")}]
search_depth: ${answers.searchDepth}
expertise_level: ${answers.expertise}

## Content Preferences

preferred_sources: [${answers.preferredSources.map(s => `"${s}"`).join(", ")}]
freshness_weight: ${freshnessMap[answers.freshnessVsAuthority] || 0.5}
visual_preference: ${visualMap[answers.visualPreference] || 0.2}
long_form_preference: ${depthMap[answers.searchDepth] || 0.5}

## Trust and Safety

misinformation_sensitivity: ${answers.factChecking === "strict" ? "high" : answers.factChecking}
fact_check_preference: ${answers.factChecking === "strict" ? "inline" : "subtle"}

## AI Response Preferences

verbosity: ${answers.verbosity === "moderate" ? "concise" : answers.verbosity}
explanation_depth: ${answers.expertise === "beginner" ? "detailed" : answers.expertise === "expert" ? "minimal" : "moderate"}
`;
}
