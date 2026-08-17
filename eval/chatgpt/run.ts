/**
 * you.md skill eval — does the skill turn accumulated context into a profile
 * worth keeping?
 *
 * Runs each synthetic user history through the packaged SKILL.md and grades the
 * profile the model writes: valid you.md, repeated preferences and professional
 * context present, incidental details absent, nothing invented.
 *
 * The eval runs against Claude rather than ChatGPT — what it measures is whether
 * the skill's instructions are unambiguous enough to produce a good profile, and
 * that transfers. It is the closest signal we can get without a ChatGPT account
 * that has real history.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=xxx npx tsx eval/chatgpt/run.ts
 *   ANTHROPIC_API_KEY=xxx npx tsx eval/chatgpt/run.ts --model claude-opus-4-1
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";

import { SKILL_FIXTURES, type SkillFixture } from "./fixtures.js";
import { formatGrade, gradeProfile, summarize, type GradeResult } from "./grader.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = resolve(HERE, "../../apps/chatgpt/skills/you-md/SKILL.md");
const RESULTS_PATH = resolve(HERE, "results/skill_eval.json");

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/**
 * The model returns either the profile markdown or NO_PROFILE. We ask for a
 * fenced block so "here is your profile:" preamble doesn't end up in the file.
 */
const TASK_INSTRUCTIONS = `The user says: "Create my you.md from what you know about me."

Everything you know about this user is in the context above. Follow the you.md
skill. Reply with the complete profile markdown inside a single \`\`\`markdown
fenced block and nothing else.

If the context genuinely does not contain enough to build a profile worth
keeping, reply with exactly NO_PROFILE instead.`;

function extractProfile(text: string): string | null {
  if (/^\s*NO_PROFILE\s*$/m.test(text) && !text.includes("---")) {
    return null;
  }

  const fenced = text.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();

  return candidate.length > 0 ? candidate + "\n" : null;
}

async function generateProfile(
  client: Anthropic,
  model: string,
  skill: string,
  fixture: SkillFixture
): Promise<string | null> {
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: skill,
    messages: [
      {
        role: "user",
        content: `<known_context>\n${fixture.history}\n</known_context>\n\n${TASK_INSTRUCTIONS}`,
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return extractProfile(text);
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is required to run the skill eval.");
    process.exitCode = 1;
    return;
  }

  const modelFlag = process.argv.indexOf("--model");
  const model = modelFlag > -1 ? process.argv[modelFlag + 1] : DEFAULT_MODEL;

  const skill = readFileSync(SKILL_PATH, "utf-8");
  const client = new Anthropic({ apiKey });

  console.log(`you.md skill eval — ${SKILL_FIXTURES.length} fixtures, model ${model}\n`);

  const results: GradeResult[] = [];
  const profiles: Record<string, string | null> = {};

  for (const fixture of SKILL_FIXTURES) {
    const markdown = await generateProfile(client, model, skill, fixture);
    const result = gradeProfile(fixture, markdown);

    profiles[fixture.id] = markdown;
    results.push(result);
    console.log(formatGrade(result));
  }

  const summary = summarize(results);
  console.log(
    `\npass rate: ${(summary.passRate * 100).toFixed(0)}%   mean score: ${summary.meanScore.toFixed(2)}`
  );

  mkdirSync(dirname(RESULTS_PATH), { recursive: true });
  writeFileSync(
    RESULTS_PATH,
    JSON.stringify({ model, summary, results, profiles }, null, 2)
  );
  console.log(`\nwrote ${RESULTS_PATH}`);

  if (summary.passRate < 1) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
