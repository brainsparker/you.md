/**
 * Agent Performance Evaluation
 *
 * Tests whether you.md context improves AI agent task completion.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=xxx npx tsx eval/agent_eval.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createParser } from "../src/index.js";

// Types
interface Task {
  id: string;
  description: string;
  expert_expected: string[];
  beginner_expected: string[];
  max_turns: number;
}

interface ProfileContext {
  name: string;
  context: string;
}

interface TaskResult {
  task_id: string;
  profile: string;
  turns_used: number;
  response_length: number;
  contains_expected: number;
  total_expected: number;
  score: number;
  response_snippet: string;
}

// Test tasks
const tasks: Task[] = [
  {
    id: "explain-k8s-networking",
    description: "Explain how Kubernetes networking works",
    expert_expected: [
      "CNI",
      "pod network",
      "service",
      "kube-proxy",
      "iptables",
      "ingress",
    ],
    beginner_expected: [
      "container",
      "communicate",
      "service",
      "load balancer",
      "DNS",
    ],
    max_turns: 1,
  },
  {
    id: "debug-slow-query",
    description: "How would you debug a slow database query?",
    expert_expected: [
      "EXPLAIN",
      "execution plan",
      "index",
      "query optimizer",
      "profiling",
      "statistics",
    ],
    beginner_expected: [
      "index",
      "slow",
      "optimize",
      "check",
      "performance",
    ],
    max_turns: 1,
  },
  {
    id: "react-state-management",
    description: "What are the options for state management in React?",
    expert_expected: [
      "Context",
      "Redux",
      "Zustand",
      "Recoil",
      "server state",
      "React Query",
      "trade-offs",
    ],
    beginner_expected: [
      "useState",
      "props",
      "Context",
      "simple",
      "example",
    ],
    max_turns: 1,
  },
  {
    id: "api-security",
    description: "What security measures should I implement for a REST API?",
    expert_expected: [
      "authentication",
      "authorization",
      "rate limiting",
      "input validation",
      "HTTPS",
      "CORS",
      "JWT",
      "OAuth",
    ],
    beginner_expected: [
      "authentication",
      "HTTPS",
      "password",
      "secure",
      "protect",
    ],
    max_turns: 1,
  },
];

// Load profile and format as context
async function loadProfileContext(name: string): Promise<ProfileContext> {
  if (name === "none") {
    return { name: "none", context: "" };
  }

  const parser = createParser();
  const path = new URL(`./profiles/${name}.md`, import.meta.url).pathname;
  const result = await parser.loadFromPath(path);

  if (!result.success) {
    return { name, context: "" };
  }

  // Format profile as context for the agent
  const context = `
<user_profile>
The user has the following preferences:

Expertise Level: ${getField(result.profile, "search behavior", "expertise_level") || "intermediate"}
Preferred Depth: ${getField(result.profile, "search behavior", "search_depth") || "moderate"}
Preferred Sources: ${getField(result.profile, "content preferences", "preferred_sources") || "various"}
Visual Preference: ${getField(result.profile, "content preferences", "visual_preference") || "0.5"}

Please tailor your response to match this user's expertise level and preferences.
</user_profile>
`;

  return { name, context };
}

function getField(profile: any, section: string, field: string): string | undefined {
  return profile.sections.get(section)?.fields.get(field)?.rawValue;
}

// Run a task with the AI agent
async function runTask(
  client: Anthropic,
  task: Task,
  profile: ProfileContext
): Promise<TaskResult> {
  const systemPrompt = profile.context
    ? `You are a helpful assistant.${profile.context}`
    : "You are a helpful assistant.";

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: task.description,
      },
    ],
  });

  const responseText = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");

  // Score based on expected terms
  const expected = profile.name === "beginner"
    ? task.beginner_expected
    : task.expert_expected;

  const lowerResponse = responseText.toLowerCase();
  let matches = 0;
  for (const term of expected) {
    if (lowerResponse.includes(term.toLowerCase())) {
      matches++;
    }
  }

  const score = (matches / expected.length) * 100;

  return {
    task_id: task.id,
    profile: profile.name,
    turns_used: 1,
    response_length: responseText.length,
    contains_expected: matches,
    total_expected: expected.length,
    score,
    response_snippet: responseText.slice(0, 200) + "...",
  };
}

// Main evaluation
async function runEval() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable required");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  console.log("🤖 Agent Performance Evaluation\n");
  console.log("=".repeat(60));

  const profiles = ["none", "expert", "beginner"];
  const results: TaskResult[] = [];

  for (const task of tasks) {
    console.log(`\n📝 Task: "${task.description}" (${task.id})`);
    console.log("-".repeat(40));

    for (const profileName of profiles) {
      const profile = await loadProfileContext(profileName);

      console.log(`  [${profileName}] Running...`);

      try {
        const result = await runTask(client, task, profile);
        results.push(result);

        console.log(`    Score: ${result.score.toFixed(1)}% (${result.contains_expected}/${result.total_expected} terms)`);
        console.log(`    Length: ${result.response_length} chars`);
      } catch (error) {
        console.log(`    ❌ Failed: ${error}`);
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Summary\n");

  const byProfile = profiles.map((p) => {
    const profileResults = results.filter((r) => r.profile === p);
    const avgScore = profileResults.reduce((sum, r) => sum + r.score, 0) / profileResults.length;
    const avgLength = profileResults.reduce((sum, r) => sum + r.response_length, 0) / profileResults.length;

    return { profile: p, avgScore, avgLength };
  });

  for (const p of byProfile) {
    console.log(`${p.profile.padEnd(10)} | Avg Score: ${p.avgScore.toFixed(1)}% | Avg Length: ${p.avgLength.toFixed(0)} chars`);
  }

  // Compare none vs personalized
  const noneScore = byProfile.find((p) => p.profile === "none")?.avgScore || 0;
  const expertScore = byProfile.find((p) => p.profile === "expert")?.avgScore || 0;
  const beginnerScore = byProfile.find((p) => p.profile === "beginner")?.avgScore || 0;

  console.log("\n📈 Improvement over baseline (none):");
  console.log(`  expert:   ${expertScore >= noneScore ? "+" : ""}${(expertScore - noneScore).toFixed(1)}%`);
  console.log(`  beginner: ${beginnerScore >= noneScore ? "+" : ""}${(beginnerScore - noneScore).toFixed(1)}%`);

  // Save results
  const outputPath = new URL("./results/agent_results.json", import.meta.url).pathname;
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to ${outputPath}`);
}

// Run
runEval().catch(console.error);
