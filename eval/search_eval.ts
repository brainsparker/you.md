/**
 * Search Relevance Evaluation
 *
 * Tests whether you.md personalization signals improve search results.
 *
 * Usage:
 *   YOU_API_KEY=xxx npx tsx eval/search_eval.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createParser } from "../src/index.js";

// Types
interface Query {
  id: string;
  query: string;
  expert_expected: ExpectedResults;
  beginner_expected: ExpectedResults;
}

interface ExpectedResults {
  good_sources: string[];
  good_terms: string[];
  bad_sources: string[];
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface YouSearchResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
    }>;
  };
}

interface ProfileSignals {
  expertise_level: string;
  search_depth: string;
  preferred_sources: string[];
  topics: string[];
}

interface EvalResult {
  query_id: string;
  profile: string;
  original_query: string;
  modified_query: string;
  original_score: number;
  reranked_score: number;
  improvement: number;
  top_results: string[];
}

// Load queries
const queries: Query[] = JSON.parse(
  readFileSync(new URL("./queries.json", import.meta.url), "utf-8")
).queries;

// Parse a you.md profile and extract signals
async function loadProfile(name: string): Promise<ProfileSignals | null> {
  if (name === "none") return null;

  const parser = createParser();
  const path = new URL(`./profiles/${name}.md`, import.meta.url).pathname;
  const result = await parser.loadFromPath(path);

  if (!result.success) return null;

  const searchBehavior = result.profile.sections.get("search behavior");
  const contentPrefs = result.profile.sections.get("content preferences");

  return {
    expertise_level: searchBehavior?.fields.get("expertise_level")?.value as string || "intermediate",
    search_depth: searchBehavior?.fields.get("search_depth")?.value as string || "moderate",
    preferred_sources: parseArray(searchBehavior?.fields.get("topics")?.rawValue || "[]"),
    topics: parseArray(searchBehavior?.fields.get("topics")?.rawValue || "[]"),
  };
}

function parseArray(value: string): string[] {
  try {
    return JSON.parse(value.replace(/'/g, '"'));
  } catch {
    return [];
  }
}

// Modify query based on profile signals
function modifyQuery(query: string, profile: ProfileSignals | null): string {
  if (!profile) return query;

  const modifiers: string[] = [];

  // Add expertise-based modifiers
  switch (profile.expertise_level) {
    case "beginner":
      modifiers.push("tutorial", "introduction", "basics");
      break;
    case "intermediate":
      modifiers.push("guide", "best practices");
      break;
    case "advanced":
    case "expert":
      modifiers.push("advanced", "deep dive", "internals");
      break;
  }

  // Add depth modifiers
  if (profile.search_depth === "deep") {
    modifiers.push("comprehensive", "in-depth");
  } else if (profile.search_depth === "quick") {
    modifiers.push("quick", "summary");
  }

  // Pick one random modifier to avoid over-stuffing
  const modifier = modifiers[Math.floor(Math.random() * modifiers.length)] || "";

  return modifier ? `${query} ${modifier}` : query;
}

// Call you.com search API
async function searchYou(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.YOU_API_KEY;
  if (!apiKey) {
    console.error("Error: YOU_API_KEY environment variable required");
    process.exit(1);
  }

  const url = new URL("https://api.ydc-index.io/search");
  url.searchParams.set("query", query);
  url.searchParams.set("count", "10");

  const response = await fetch(url.toString(), {
    headers: {
      "X-API-Key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data: YouSearchResponse = await response.json();

  return (data.web?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

// Re-rank results based on profile
function rerankResults(
  results: SearchResult[],
  profile: ProfileSignals | null
): SearchResult[] {
  if (!profile) return results;

  // Score each result
  const scored = results.map((result) => {
    let score = 0;
    const url = result.url.toLowerCase();
    const text = `${result.title} ${result.snippet}`.toLowerCase();

    // Source preference scoring
    const sourceScores: Record<string, number> = {
      official_docs: 0,
      academic: 0,
      blogs: 0,
      forums: 0,
      video: 0,
    };

    // Detect source type
    if (url.includes("github.com") || url.includes(".io/docs") || url.includes("docs.")) {
      sourceScores.official_docs = 10;
    }
    if (url.includes("arxiv.org") || url.includes("papers.") || url.includes(".edu")) {
      sourceScores.academic = 10;
    }
    if (url.includes("medium.com") || url.includes("dev.to") || url.includes("blog")) {
      sourceScores.blogs = 10;
    }
    if (url.includes("stackoverflow.com") || url.includes("reddit.com")) {
      sourceScores.forums = 10;
    }
    if (url.includes("youtube.com") || url.includes("vimeo.com")) {
      sourceScores.video = 10;
    }

    // Apply preference weights
    for (const pref of profile.preferred_sources) {
      score += sourceScores[pref] || 0;
    }

    // Expertise level scoring
    const beginnerTerms = ["tutorial", "introduction", "basics", "beginner", "getting started", "101"];
    const expertTerms = ["advanced", "deep dive", "internals", "architecture", "performance"];

    if (profile.expertise_level === "beginner" || profile.expertise_level === "intermediate") {
      for (const term of beginnerTerms) {
        if (text.includes(term)) score += 5;
      }
      for (const term of expertTerms) {
        if (text.includes(term)) score -= 2;
      }
    } else {
      for (const term of expertTerms) {
        if (text.includes(term)) score += 5;
      }
      for (const term of beginnerTerms) {
        if (text.includes(term)) score -= 2;
      }
    }

    return { result, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.map((s) => s.result);
}

// Score results against expected
function scoreResults(
  results: SearchResult[],
  expected: ExpectedResults
): number {
  let score = 0;
  const maxScore = 100;

  // Weight top results more heavily
  const weights = [10, 8, 6, 5, 4, 3, 2, 2, 1, 1];

  for (let i = 0; i < Math.min(results.length, 10); i++) {
    const result = results[i];
    const weight = weights[i];
    const url = result.url.toLowerCase();
    const text = `${result.title} ${result.snippet}`.toLowerCase();

    // Check good sources
    for (const source of expected.good_sources) {
      if (url.includes(source.toLowerCase())) {
        score += weight * 2;
        break;
      }
    }

    // Check bad sources (penalty)
    for (const source of expected.bad_sources) {
      if (url.includes(source.toLowerCase())) {
        score -= weight;
        break;
      }
    }

    // Check good terms
    let termMatches = 0;
    for (const term of expected.good_terms) {
      if (text.includes(term.toLowerCase())) {
        termMatches++;
      }
    }
    score += Math.min(termMatches, 3) * weight;
  }

  // Normalize to 0-100
  return Math.max(0, Math.min(100, (score / maxScore) * 100));
}

// Main evaluation loop
async function runEval() {
  console.log("🔍 Search Relevance Evaluation\n");
  console.log("=".repeat(60));

  const profiles = ["none", "expert", "beginner"];
  const results: EvalResult[] = [];

  for (const query of queries) {
    console.log(`\n📝 Query: "${query.query}" (${query.id})`);
    console.log("-".repeat(40));

    for (const profileName of profiles) {
      const profile = await loadProfile(profileName);
      const expected = profileName === "beginner"
        ? query.beginner_expected
        : query.expert_expected;

      // Modify query
      const modifiedQuery = modifyQuery(query.query, profile);

      // Search
      console.log(`  [${profileName}] Searching: "${modifiedQuery}"`);

      let searchResults: SearchResult[];
      try {
        searchResults = await searchYou(modifiedQuery);
      } catch (error) {
        console.log(`    ❌ Search failed: ${error}`);
        continue;
      }

      // Score original order
      const originalScore = scoreResults(searchResults, expected);

      // Re-rank and score
      const reranked = rerankResults(searchResults, profile);
      const rerankedScore = scoreResults(reranked, expected);

      const improvement = rerankedScore - originalScore;

      console.log(`    Original: ${originalScore.toFixed(1)} → Reranked: ${rerankedScore.toFixed(1)} (${improvement >= 0 ? "+" : ""}${improvement.toFixed(1)})`);

      results.push({
        query_id: query.id,
        profile: profileName,
        original_query: query.query,
        modified_query: modifiedQuery,
        original_score: originalScore,
        reranked_score: rerankedScore,
        improvement,
        top_results: reranked.slice(0, 3).map((r) => r.url),
      });

      // Rate limit
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Summary\n");

  const byProfile = profiles.map((p) => {
    const profileResults = results.filter((r) => r.profile === p);
    const avgOriginal = profileResults.reduce((sum, r) => sum + r.original_score, 0) / profileResults.length;
    const avgReranked = profileResults.reduce((sum, r) => sum + r.reranked_score, 0) / profileResults.length;
    const avgImprovement = profileResults.reduce((sum, r) => sum + r.improvement, 0) / profileResults.length;

    return { profile: p, avgOriginal, avgReranked, avgImprovement };
  });

  for (const p of byProfile) {
    console.log(`${p.profile.padEnd(10)} | Original: ${p.avgOriginal.toFixed(1)} | Reranked: ${p.avgReranked.toFixed(1)} | Δ ${p.avgImprovement >= 0 ? "+" : ""}${p.avgImprovement.toFixed(1)}`);
  }

  // Save results
  const outputPath = new URL("./results/eval_results.json", import.meta.url).pathname;
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to ${outputPath}`);
}

// Run
runEval().catch(console.error);
