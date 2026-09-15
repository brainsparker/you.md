/**
 * Auto-inference engine for `you-md init --from-me`.
 *
 * Scans the local environment (git config, git history, project config,
 * code style, existing AI preferences, system context) and builds a
 * draft you.md profile. Pure heuristics, no AI, no network calls,
 * no new dependencies (only Node builtins).
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { CURRENT_SCHEMA_VERSION } from "../utils/constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InferredSignals {
  git: GitIdentity | null;
  stack: StackInfo | null;
  codeStyle: CodeStyleInfo | null;
  aiPrefs: AIPrefsInfo | null;
  system: SystemContext;
}

export interface GitIdentity {
  name: string | null;
  email: string | null;
  topLanguages: Array<{ language: string; percentage: number }>;
  commitStyle: "conventional" | "terse" | "verbose" | null;
  commitCount: number | null;
}

export interface StackInfo {
  frameworks: string[];
  runtime: string | null;
  packageManager: string | null;
}

export interface CodeStyleInfo {
  formatter: string | null;
  indentStyle: string | null;
  indentSize: number | null;
  lineLength: number | null;
}

export interface AIPrefsInfo {
  source: string;
  raw: string;
  preferences: Array<{ key: string; value: string }>;
}

export interface SystemContext {
  timezone: string;
  locale: string;
  os: string;
}

// ---------------------------------------------------------------------------
// Extension → language map (code-relevant only)
// ---------------------------------------------------------------------------

const EXT_LANGUAGE: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  scala: "Scala",
  rb: "Ruby",
  php: "PHP",
  c: "C",
  h: "C",
  cpp: "C++",
  hpp: "C++",
  cs: "C#",
  swift: "Swift",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  fish: "Shell",
  sql: "SQL",
  r: "R",
  dart: "Dart",
  lua: "Lua",
  elm: "Elm",
  clj: "Clojure",
  cljs: "Clojure",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  ml: "OCaml",
  svelte: "Svelte",
  vue: "Vue",
  sass: "SCSS",
  scss: "SCSS",
  less: "Less",
  css: "CSS",
  graphql: "GraphQL",
  prisma: "Prisma",
  cmake: "CMake",
  make: "Makefile",
  dockerfile: "Dockerfile",
};

const CODE_EXTENSIONS = new Set(Object.keys(EXT_LANGUAGE));

// Non-code extensions to exclude
const NON_CODE = new Set(["md", "json", "yaml", "yml", "toml", "lock", "txt", "log", "svg", "png", "jpg", "jpeg", "gif", "ico", "woff", "woff2", "ttf", "eot", "otf", "pdf", "zip", "gz", "tar", "mp4", "mp3", "wav", "ogg"]);

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

function exec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function isGitRepo(): boolean {
  return exec("git rev-parse --is-inside-work-tree 2>/dev/null") === "true";
}

export function gitIdentity(): GitIdentity | null {
  if (!isGitRepo()) return null;

  const name = exec('git config user.name');
  const email = exec('git config user.email');

  // Languages from tracked files
  const ls = exec('git ls-files');
  const extensions = new Map<string, number>();
  let totalCodeFiles = 0;

  if (ls) {
    for (const file of ls.split("\n")) {
      const dot = file.lastIndexOf(".");
      if (dot === -1 || dot === file.length - 1) continue;
      const ext = file.slice(dot + 1).toLowerCase();
      if (NON_CODE.has(ext)) continue;
      if (!CODE_EXTENSIONS.has(ext)) continue;
      extensions.set(ext, (extensions.get(ext) || 0) + 1);
      totalCodeFiles++;
    }
  }

  const topLanguages: Array<{ language: string; percentage: number }> = [];
  if (totalCodeFiles > 0) {
    const sorted = [...extensions.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [ext, count] of sorted) {
      topLanguages.push({
        language: EXT_LANGUAGE[ext],
        percentage: Math.round((count / totalCodeFiles) * 100),
      });
    }
  }

  // Commit style from recent commits
  const log = exec('git log --oneline -50 2>/dev/null');
  let commitStyle: GitIdentity["commitStyle"] = null;
  let commitCount: number | null = null;

  if (log) {
    const msgs = log.split("\n").filter(Boolean);
    commitCount = exec('git rev-list --count HEAD 2>/dev/null')
      ? Number(exec('git rev-list --count HEAD 2>/dev/null'))
      : msgs.length;

    const conventional = msgs.filter(m => /^\w+(\([\w-]+\))?:\s/.test(m.trim()));
    const avgLen = msgs.reduce((sum, m) => sum + m.trim().length, 0) / msgs.length;

    if (conventional.length / msgs.length > 0.6) {
      commitStyle = "conventional";
    } else if (avgLen < 30) {
      commitStyle = "terse";
    } else {
      commitStyle = "verbose";
    }
  }

  return {
    name: name || null,
    email: email || null,
    topLanguages,
    commitStyle,
    commitCount,
  };
}

export function projectStack(): StackInfo | null {
  const frameworks: string[] = [];
  let runtime: string | null = null;
  let packageManager: string | null = null;

  // package.json
  if (existsSync("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
      runtime = "Node.js";
      packageManager = pkg.packageManager?.split("@")[0] || null;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps) {
        for (const dep of Object.keys(deps)) {
          if (dep.startsWith("@angular/")) { frameworks.push("Angular"); break; }
        }
        if (deps.react || deps["react-dom"]) frameworks.push("React");
        if (deps.vue || deps["@vue/reactivity"]) frameworks.push("Vue");
        if (deps.next) frameworks.push("Next.js");
        if (deps.express) frameworks.push("Express");
        if (deps.fastify) frameworks.push("Fastify");
        if (deps["@nestjs/core"]) frameworks.push("NestJS");
        if (deps.svelte || deps["@sveltejs/kit"]) frameworks.push("Svelte");
        if (deps["@remix-run/react"]) frameworks.push("Remix");
        if (deps.electron) frameworks.push("Electron");
      }
    } catch {
      // skip unparseable package.json
    }
  }

  // Python
  if (existsSync("pyproject.toml")) {
    try {
      const content = readFileSync("pyproject.toml", "utf-8");
      if (!runtime) runtime = "Python";
      if (content.includes("django")) frameworks.push("Django");
      if (content.includes("fastapi") || content.includes("fastapi")) frameworks.push("FastAPI");
      if (content.includes("flask")) frameworks.push("Flask");
      if (content.includes("pytorch") || content.includes("torch")) frameworks.push("PyTorch");
      if (content.includes("tensorflow")) frameworks.push("TensorFlow");
      if (content.includes("poetry")) packageManager = "poetry";
      if (content.includes("[tool.pdm]")) packageManager = "pdm";
      if (content.includes("[tool.uv]")) packageManager = "uv";
      if (content.includes("[tool.black]")) {
        if (!packageManager) packageManager = "pip";
      }
    } catch {
      // skip
    }
  }

  if (existsSync("requirements.txt")) {
    if (!runtime) runtime = "Python";
  }

  // Rust
  if (existsSync("Cargo.toml")) {
    try {
      const content = readFileSync("Cargo.toml", "utf-8");
      if (!runtime) runtime = "Rust";
      if (content.includes('tokio =') || content.includes('tokio"')) frameworks.push("Tokio");
      if (content.includes('actix')) frameworks.push("Actix");
      if (content.includes('axum')) frameworks.push("Axum");
      if (content.includes('rocket')) frameworks.push("Rocket");
      if (content.includes('clap')) frameworks.push("Clap");
    } catch {
      // skip
    }
    if (existsSync("rust-toolchain") || existsSync("rust-toolchain.toml")) {
      // no extra info needed
    }
  }

  // Go
  if (existsSync("go.mod")) {
    try {
      const content = readFileSync("go.mod", "utf-8");
      if (!runtime) runtime = "Go";
      if (content.includes("gin-gonic/gin")) frameworks.push("Gin");
      if (content.includes("gorilla/mux")) frameworks.push("Gorilla Mux");
      if (content.includes("echo")) frameworks.push("Echo");
      if (content.includes("fiber")) frameworks.push("Fiber");
    } catch {
      // skip
    }
  }

  // Ruby
  if (existsSync("Gemfile")) {
    try {
      const content = readFileSync("Gemfile", "utf-8");
      if (!runtime) runtime = "Ruby";
      if (content.includes("rails")) frameworks.push("Rails");
      if (content.includes("sinatra")) frameworks.push("Sinatra");
    } catch {
      // skip
    }
  }

  if (frameworks.length === 0 && !runtime && !packageManager) return null;

  // Remove duplicates
  const unique = [...new Set(frameworks)];
  return { frameworks: unique, runtime, packageManager };
}

const PRETTIER_CONFIG_FILES = [".prettierrc", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.yml", ".prettierrc.toml", ".prettierrc.js", "prettier.config.js"];

function readFirstExisting(...paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, "utf-8");
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function codeStyle(): CodeStyleInfo | null {
  let formatter: string | null = null;
  let indentStyle: string | null = null;
  let indentSize: number | null = null;
  let lineLength: number | null = null;

  // .editorconfig
  if (existsSync(".editorconfig")) {
    try {
      const content = readFileSync(".editorconfig", "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("indent_style")) indentStyle = trimmed.split("=")[1]?.trim() || null;
        if (trimmed.startsWith("indent_size")) indentSize = Number(trimmed.split("=")[1]?.trim()) || null;
        if (trimmed.startsWith("max_line_length")) {
          const val = trimmed.split("=")[1]?.trim();
          if (val && val !== "off") lineLength = Number(val) || null;
        }
      }
      if (!formatter) formatter = "EditorConfig";
    } catch {
      // skip
    }
  }

  // Prettier
  const prettierContent = readFirstExisting(...PRETTIER_CONFIG_FILES);
  if (prettierContent) {
    formatter = "Prettier";
    try {
      const cfg = JSON.parse(prettierContent);
      indentSize = cfg.tabWidth ?? indentSize;
      indentStyle = cfg.useTabs ? "tab" : indentStyle || "space";
      lineLength = cfg.printWidth ?? lineLength;
    } catch {
      // YAML-formatted prettier config — skip JSON parse
      if (prettierContent.includes("tabWidth")) {
        const m = prettierContent.match(/tabWidth:\s*(\d+)/);
        if (m) indentSize = Number(m[1]);
      }
      if (prettierContent.includes("printWidth")) {
        const m = prettierContent.match(/printWidth:\s*(\d+)/);
        if (m) lineLength = Number(m[1]);
      }
      if (prettierContent.includes("useTabs: true")) indentStyle = "tab";
    }
  }

  // ESLint
  if (existsSync(".eslintrc") || existsSync(".eslintrc.json") || existsSync(".eslintrc.js") || existsSync("eslint.config.js")) {
    if (!formatter) formatter = "ESLint";
  }

  // rustfmt
  if (existsSync("rustfmt.toml") || existsSync(".rustfmt.toml")) {
    if (!formatter) formatter = "rustfmt";
    try {
      const content = readFileSync(existsSync("rustfmt.toml") ? "rustfmt.toml" : ".rustfmt.toml", "utf-8");
      const m = content.match(/max_width\s*=\s*(\d+)/);
      if (m) lineLength = Number(m[1]);
    } catch {
      // skip
    }
  }

  if (!formatter && !indentStyle && !indentSize && !lineLength) return null;

  return { formatter, indentStyle, indentSize, lineLength };
}

export function existingAIPrefs(): AIPrefsInfo | null {
  const candidates = [
    { path: ".cursorrules", source: ".cursorrules" },
    { path: "CLAUDE.md", source: "CLAUDE.md" },
    { path: ".github/copilot-instructions.md", source: ".github/copilot-instructions.md" },
    { path: resolve(homedir(), ".cursorrules"), source: "~/.cursorrules" },
  ];

  for (const { path, source } of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf-8");
      const preferences: Array<{ key: string; value: string }> = [];

      // Extract key-value patterns
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("<!--")) continue;

        // "be concise" → verbosity: concise
        if (/be\s+concise/i.test(trimmed)) preferences.push({ key: "verbosity", value: "concise" });
        if (/be\s+detailed/i.test(trimmed)) preferences.push({ key: "verbosity", value: "detailed" });
        if (/no\s+emojis?/i.test(trimmed)) preferences.push({ key: "no_emoji", value: "true" });
        if (/no\s+hedging/i.test(trimmed)) preferences.push({ key: "no_hedging", value: "true" });

        // "always explain" / "explain your reasoning"
        if (/always\s+explain/i.test(trimmed)) preferences.push({ key: "explanations", value: "always" });
        if (/explain\s+(your\s+)?reasoning/i.test(trimmed)) preferences.push({ key: "explanations", value: "always" });
        if (/skip\s+explanations/i.test(trimmed)) preferences.push({ key: "explanations", value: "never" });

        // "prefer functional" / "use TypeScript"
        if (/prefer\s+functional/i.test(trimmed)) preferences.push({ key: "style", value: "functional" });
        if (/prefer\s+OOP/i.test(trimmed) || /prefer\s+object.ori/i.test(trimmed)) preferences.push({ key: "style", value: "OOP" });
        if (/typescript\s+strict/i.test(trimmed)) preferences.push({ key: "typescript_strict", value: "true" });
      }

      if (preferences.length === 0) continue;

      return { source, raw, preferences };
    } catch {
      continue;
    }
  }

  return null;
}

export function systemContext(): SystemContext {
  let timezone = "UTC";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // fallback
  }

  const locale = process.env.LANG || "en-US";
  const os = process.platform;

  return { timezone, locale, os };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function gatherSignals(cwd?: string): Promise<InferredSignals> {
  const prevCwd = process.cwd();
  if (cwd) process.chdir(cwd);

  try {
    const git = gitIdentity();
    const stack = projectStack();
    const cs = codeStyle();
    const ai = existingAIPrefs();
    const system = systemContext();

    return { git, stack, codeStyle: cs, aiPrefs: ai, system };
  } finally {
    if (cwd) process.chdir(prevCwd);
  }
}

// ---------------------------------------------------------------------------
// Profile assembly
// ---------------------------------------------------------------------------

export function buildProfileFromSignals(signals: InferredSignals): string {
  const today = new Date().toISOString().split("T")[0];
  const lines: string[] = [];

  // Frontmatter
  lines.push("---");
  lines.push(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  if (signals.git?.name) lines.push(`author: "${signals.git.name}"`);
  if (signals.git?.email) lines.push(`email: "${signals.git.email}"`);
  lines.push(`created: "${today}"`);
  lines.push(`privacy_level: "private"`);
  lines.push("---");
  lines.push("");

  // # Me
  lines.push("# Me");
  lines.push("");

  // ## How I Work
  lines.push("## How I Work");
  lines.push("");

  if (signals.stack?.runtime) {
    lines.push(`Primary runtime: ${signals.stack.runtime}`);
  }
  if (signals.git?.topLanguages && signals.git.topLanguages.length > 0) {
    const langs = signals.git.topLanguages.map(l => `${l.language} (${l.percentage}%)`).join(", ");
    lines.push(`Languages: ${langs}`);
  }
  if (signals.stack?.frameworks && signals.stack.frameworks.length > 0) {
    lines.push(`Frameworks: ${signals.stack.frameworks.join(", ")}`);
  }
  if (signals.stack?.packageManager) {
    lines.push(`Package manager: ${signals.stack.packageManager}`);
  }
  if (signals.git?.commitStyle) {
    const styleLabel: Record<string, string> = { conventional: "Conventional Commits", terse: "short, direct messages", verbose: "detailed descriptions" };
    lines.push(`Commit style: ${styleLabel[signals.git.commitStyle]}`);
  }
  if (signals.codeStyle) {
    if (signals.codeStyle.formatter) lines.push(`Formatter: ${signals.codeStyle.formatter}`);
    if (signals.codeStyle.indentStyle) {
      const size = signals.codeStyle.indentSize ? ` (${signals.codeStyle.indentSize})` : "";
      lines.push(`Indentation: ${signals.codeStyle.indentStyle}${size}`);
    }
    if (signals.codeStyle.lineLength) lines.push(`Line length: ${signals.codeStyle.lineLength}`);
  }
  lines.push("");

  // ## Context
  lines.push("## Context");
  lines.push("");
  lines.push(`Timezone: ${signals.system.timezone}`);
  lines.push(`Locale: ${signals.system.locale}`);
  lines.push(`OS: ${signals.system.os}`);
  lines.push("");

  // ## What I'm Into
  if (signals.git?.topLanguages && signals.git.topLanguages.length > 0) {
    lines.push("## What I'm Into");
    lines.push("");
    const topics = signals.git.topLanguages.map(l => l.language);
    if (signals.stack?.frameworks) topics.push(...signals.stack.frameworks);
    lines.push(`Topics: ${[...new Set(topics)].join(", ")}`);
    lines.push("");
  }

  // ## Boundaries — from AI prefs if found
  if (signals.aiPrefs) {
    lines.push("## Boundaries");
    lines.push("");
    lines.push(`<!-- Inferred from ${signals.aiPrefs.source} -->`);
    for (const pref of signals.aiPrefs.preferences) {
      lines.push(`- ${pref.key}: ${pref.value}`);
    }
    lines.push("");
  }

  // ## How I Think (prompt for user to fill)
  lines.push("## How I Think");
  lines.push("");
  lines.push("<!-- Fill in your expertise level and cognitive preferences -->");
  lines.push("Expertise: <!-- beginner | intermediate | advanced | expert -->");
  lines.push("Learning style: <!-- hands-on | theoretical | visual | reading -->");
  lines.push("Decision making: <!-- data-driven | intuitive | consensus -->");
  lines.push("Depth preference: <!-- quick answers | balanced | thorough -->");
  lines.push("");

  // ## How I Communicate (prompt — unless inferred)
  if (!signals.aiPrefs || !signals.aiPrefs.preferences.some(p => p.key === "verbosity")) {
    lines.push("## How I Communicate");
    lines.push("");
    lines.push("<!-- Fill in your communication preferences -->");
    lines.push("Verbosity: <!-- concise | moderate | detailed -->");
    lines.push("Tone: <!-- direct | friendly | formal -->");
    lines.push("Explanations: <!-- only when asked | when helpful | always -->");
    lines.push("");
  }

  // ## What I Trust
  lines.push("## What I Trust");
  lines.push("");
  lines.push("<!-- Fill in your trusted sources and fact-checking preferences -->");
  lines.push("Trusted sources: <!-- e.g., official documentation, academic papers -->");
  lines.push("Fact-checking: <!-- relaxed | standard | strict -->");
  lines.push("");

  // ## Where I'm Headed
  lines.push("## Where I'm Headed");
  lines.push("");
  lines.push("<!-- What are you working on or learning? -->");
  lines.push("Current focus:");
  lines.push("Learning goals:");
  lines.push("");

  // ## Boundaries (fallback if no AI prefs)
  if (!signals.aiPrefs) {
    lines.push("## Boundaries");
    lines.push("");
    lines.push("<!-- Things you want AI to avoid -->");
    lines.push("- Over-explain things I already know");
    lines.push("- Use excessive caveats or hedging");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Scan results formatter
// ---------------------------------------------------------------------------

export function formatScanResults(signals: InferredSignals): string {
  const lines: string[] = [];

  // Git identity
  if (signals.git?.name) {
    const email = signals.git.email ? ` <${signals.git.email}>` : "";
    lines.push(`  ✓ Git identity: ${signals.git.name}${email}`);
  } else {
    lines.push("  ○ Git identity: not available (not a git repo?)");
  }

  // Git history
  if (signals.git) {
    if (signals.git.commitCount !== null) {
      const langs = signals.git.topLanguages.length > 0
        ? `, top: ${signals.git.topLanguages.map(l => `${l.language} (${l.percentage}%)`).join(", ")}`
        : "";
      lines.push(`  ✓ Git history: ${signals.git.commitCount} commits${langs}`);
    } else {
      lines.push("  ○ Git history: no commits found");
    }
  }

  // Stack
  if (signals.stack) {
    const parts: string[] = [];
    if (signals.stack.runtime) parts.push(signals.stack.runtime);
    if (signals.stack.frameworks.length > 0) parts.push(signals.stack.frameworks.join(", "));
    if (signals.stack.packageManager) parts.push(signals.stack.packageManager);
    lines.push(`  ✓ Project stack: ${parts.join(" · ")}`);
  } else {
    lines.push("  ○ Project stack: no project config detected");
  }

  // Code style
  if (signals.codeStyle) {
    const parts: string[] = [];
    if (signals.codeStyle.formatter) parts.push(signals.codeStyle.formatter);
    if (signals.codeStyle.indentStyle) {
      const size = signals.codeStyle.indentSize ? ` ${signals.codeStyle.indentSize}` : "";
      parts.push(`${signals.codeStyle.indentStyle}${size}-space indent`);
    }
    if (signals.codeStyle.lineLength) parts.push(`${signals.codeStyle.lineLength} char lines`);
    lines.push(`  ✓ Code style: ${parts.join(", ")}`);
  } else {
    lines.push("  ○ Code style: no style config detected");
  }

  // AI prefs
  if (signals.aiPrefs) {
    lines.push(`  ✓ Found ${signals.aiPrefs.source} with ${signals.aiPrefs.preferences.length} preferences`);
  } else {
    lines.push("  ○ AI preferences: no existing .cursorrules or CLAUDE.md found");
  }

  // System
  lines.push(`  ✓ System: ${signals.system.timezone} · ${signals.system.locale} · ${signals.system.os}`);

  return lines.join("\n");
}