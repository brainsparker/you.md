/**
 * Synthetic user histories for the you.md ChatGPT skill evals.
 *
 * Each fixture stands in for "what the assistant already knows about this user".
 * The expectations encode the extraction rules the skill is supposed to follow:
 * stable and repeated signals land in the profile, incidental and ephemeral ones
 * do not, and nothing that isn't in the history may appear at all.
 */

export interface Expectation {
  /** What this expectation is checking, shown in eval output. */
  readonly label: string;
  /** Any one of these matching counts as a hit. */
  readonly patterns: RegExp[];
}

export interface SkillFixture {
  readonly id: string;
  /** Prose summary of the assistant's accumulated context for this user. */
  readonly history: string;
  /** Signals a good profile must carry. */
  readonly mustInclude: Expectation[];
  /** Incidental or ephemeral details a good profile must leave out. */
  readonly mustExclude: Expectation[];
  /** Facts absent from the history — appearing at all means the model invented it. */
  readonly mustNotInvent: Expectation[];
}

export const SKILL_FIXTURES: SkillFixture[] = [
  {
    id: "pm-with-technical-depth",
    history: `Across roughly four months of conversations:

- Introduces themselves as a product manager at a developer tools company. Has
  mentioned their team, their roadmap, and their engineers many times.
- Asks for "just the answer first" in almost every conversation, and has twice
  said explicitly that they dislike long preambles.
- Reads and writes TypeScript comfortably; has pasted TypeScript snippets for
  review at least a dozen times and once said "I write TypeScript daily, I'm just
  not the one shipping the service."
- Is currently writing a PRD for a ChatGPT integration and has come back to it in
  five separate conversations this month.
- Regularly asks for competitive analysis of developer tools and AI coding
  assistants.
- Last Tuesday, asked for a recipe for cacio e pepe.
- Two weeks ago, asked what to wear to a wedding in Palm Springs.
- Yesterday, said "I'm at the airport, quick question" before asking about
  pricing models.
- Once mentioned they might move to Europe at some point, "maybe, someday, if the
  timing works".`,
    mustInclude: [
      {
        label: "professional context (product manager)",
        patterns: [/product manager/i, /\bPM\b/],
      },
      {
        label: "repeated communication preference (answer first / concise)",
        patterns: [/answer first/i, /concise/i, /direct/i, /no preamble/i, /skip .{0,20}preamble/i],
      },
      {
        label: "stable technical background (TypeScript)",
        patterns: [/typescript/i],
      },
      {
        label: "current project (the integration PRD)",
        patterns: [/PRD/i, /chatgpt integration/i],
      },
    ],
    mustExclude: [
      { label: "incidental recipe question", patterns: [/cacio/i, /pasta/i, /recipe/i] },
      { label: "incidental wedding question", patterns: [/wedding/i, /palm springs/i] },
      { label: "ephemeral location", patterns: [/airport/i] },
      { label: "highly uncertain future move", patterns: [/move to europe/i, /relocat/i] },
    ],
    mustNotInvent: [
      { label: "a seniority level never stated", patterns: [/\b(senior|staff|principal|VP|head of)\b/i] },
      { label: "an employer name never stated", patterns: [/\b(google|microsoft|stripe|meta|amazon)\b/i] },
      { label: "languages never mentioned", patterns: [/\b(rust|haskell|kotlin|ruby)\b/i] },
    ],
  },
  {
    id: "career-switcher-learning-backend",
    history: `Across about six weeks of conversations:

- Says repeatedly that they are switching careers into software from teaching
  high school biology, and asks for explanations "like I'm new to this, because I
  am".
- Consistently asks for step-by-step explanations with a worked example before
  the general rule. Has said "examples first, theory second" more than once.
- Is learning Python and working through a backend course; has asked about
  Flask, SQL joins, and HTTP status codes across many separate sessions.
- Is actively interviewing for junior backend roles and has asked for interview
  prep four times in the last two weeks.
- Has said they find heavy jargon discouraging and asked to have terms defined
  when first used.
- Mentioned once that their cat is named Biscuit.
- Asked for the weather in Chicago on a Monday morning.
- Mentioned last week that they had a headache and would keep it short.`,
    mustInclude: [
      {
        label: "learning stage / career switch",
        patterns: [/career (change|switch)/i, /switching careers/i, /new to (software|programming|this)/i, /beginner/i, /learning to code/i],
      },
      {
        label: "repeated explanation preference (examples first)",
        patterns: [/examples? first/i, /worked example/i, /step[- ]by[- ]step/i],
      },
      { label: "current technology (Python)", patterns: [/python/i] },
      {
        label: "current goal (interviewing for backend roles)",
        patterns: [/interview/i, /job search/i, /junior backend/i],
      },
      {
        label: "standing instruction about jargon",
        patterns: [/jargon/i, /define .{0,20}terms?/i, /explain .{0,20}terms?/i],
      },
    ],
    mustExclude: [
      { label: "incidental pet detail", patterns: [/biscuit/i, /\bcat\b/i] },
      { label: "ephemeral weather question", patterns: [/weather/i] },
      { label: "sensitive, ephemeral health detail", patterns: [/headache/i, /\bsick\b/i] },
    ],
    mustNotInvent: [
      { label: "a location never established as context", patterns: [/lives in/i, /based in/i] },
      { label: "a degree or credential never stated", patterns: [/bootcamp/i, /computer science degree/i, /\bCS degree\b/i] },
      { label: "frameworks never mentioned", patterns: [/\b(django|rails|spring|react)\b/i] },
    ],
  },
  {
    id: "thin-history",
    history: `Total known context, from two short conversations:

- Asked how to center a div in CSS.
- Asked for a summary of a news article about interest rates.

Nothing else. No stated profession, no stated preferences, no repeated patterns.`,
    mustInclude: [],
    mustExclude: [],
    mustNotInvent: [
      { label: "a profession that was never stated", patterns: [/\b(engineer|developer|designer|manager|analyst|student)\b/i] },
      { label: "communication preferences never expressed", patterns: [/prefers? (concise|detailed|direct)/i, /verbosity/i] },
      { label: "interests inferred from two questions", patterns: [/interested in (finance|economics|web development)/i, /passionate about/i] },
    ],
  },
];

export function findFixture(id: string): SkillFixture | undefined {
  return SKILL_FIXTURES.find((fixture) => fixture.id === id);
}
