# `--from-me`: Auto-inferred profile generation

## Summary

Add `npx you-md init --from-me` that scans the user's local environment, builds a you.md profile from what it finds, shows the result, and asks if they want to save it. Pure heuristics, no AI, no network calls, no new dependencies.

## Problem

The interactive wizard asks 8 abstract questions. Most people bounce. But every developer has already implicitly defined themselves through their git history, dotfiles, and project configs. `--from-me` flips the interaction from "define yourself" to "correct this portrait of you."

## Signal gathering

A new module `src/cli/infer.ts` exports a `gatherSignals()` function. Each collector is isolated and allowed to fail silently.

### Collectors

| Collector | Reads | Produces |
|---|---|---|
| `gitIdentity()` | `git config user.name`, `git config user.email` | Name, email for frontmatter |
| `gitHistory()` | `git log --oneline -200`, file extensions in tracked files | Top languages by %, commit message style (conventional/terse/verbose), avg frequency |
| `projectStack()` | `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile` | Frameworks, runtime, package manager |
| `codeStyle()` | `.editorconfig`, `.prettierrc`, `.eslintrc`, `rustfmt.toml`, `pyproject.toml [tool.black]` | Indent style, line length, formatter name |
| `existingAIPrefs()` | `.cursorrules`, `CLAUDE.md`, `.github/copilot-instructions.md` | Any explicit AI preferences already articulated |
| `systemContext()` | `Intl.DateTimeFormat`, `process.env.LANG`, `os.platform()` | Timezone, locale, OS |

### Return type

```typescript
interface InferredSignals {
  git: {
    name: string | null;
    email: string | null;
    topLanguages: Array<{ language: string; percentage: number }>;
    commitStyle: "conventional" | "terse" | "verbose" | null;
    commitFrequency: string | null; // e.g. "daily", "weekly"
  } | null;
  stack: {
    frameworks: string[];
    runtime: string | null;
    packageManager: string | null;
  } | null;
  codeStyle: {
    formatter: string | null;
    indentStyle: string | null;
    indentSize: number | null;
    lineLength: number | null;
  } | null;
  aiPrefs: {
    source: string; // which file it came from
    raw: string;    // raw content for parsing
    preferences: Array<{ key: string; value: string }>;
  } | null;
  system: {
    timezone: string;
    locale: string;
    os: string;
  };
}
```

Each top-level field is nullable except `system` (always available).

## Profile assembly

A function `buildProfileFromSignals(signals: InferredSignals): string` maps collected data to you.md markdown.

### Section mapping

**Always populated from inference:**
- `## How I Work` — languages, frameworks, style, commit style (NEW section)
- `## Context` — timezone, locale, OS
- `## What I'm Into` — topics inferred from stack/git

**Populated if existing AI prefs found:**
- `## Don't` — extracted from .cursorrules / CLAUDE.md
- `## How I Communicate` — if verbosity/tone preferences found

**Left as one-liner prompts when not inferred:**
- `## How I Think` — expertise, learning style, decision making
- `## How I Communicate` — verbosity, tone, explanations (unless found in AI prefs)
- `## What I Trust` — sources, fact-checking
- `## Where I'm Headed` — goals, current learning

### Prompt format for unknowns

One-liner HTML comments with options:

```markdown
Verbosity: <!-- concise | moderate | detailed -->
```

Easy to fill in (delete the comment, type a word) or delete the whole line. No multi-line comment blocks.

### Existing AI preferences handling

`.cursorrules`, `CLAUDE.md`, and `.github/copilot-instructions.md` are the highest-confidence signals. The user explicitly wrote them.

Strategy:
1. Read the file content
2. Look for key phrases that map to you.md concepts (e.g. "be concise" -> verbosity: concise, "no emojis" -> Don't: use emojis)
3. Simple keyword/pattern matching, not full NLP
4. Preferences that don't map to a known section go under `## Don't` or `## How I Work` as-is
5. Note the source file in an HTML comment so the user knows where it came from

### Language inference

From git tracked files (not git log diffs, which would be slow):

```bash
git ls-files
```

Count file extensions, map to languages, compute percentages. Top 5 languages included. Filter out non-code files (`.md`, `.json`, `.yml`, `.lock`, etc.).

### Commit style detection

From recent 50 commit messages:
- If >60% match `type: description` or `type(scope): description` -> "conventional"
- If average message length < 30 chars -> "terse"
- Otherwise -> "verbose"

## UX flow

```
$ npx you-md init --from-me

Scanning your environment...

  ✓ Git identity: Brian Sparker <brian@example.com>
  ✓ Git history: 847 commits, top: TypeScript (62%), Python (24%)
  ✓ Frameworks: React, FastAPI, Express
  ✓ Code style: prettier, 2-space indent
  ✓ Found .cursorrules with 8 preferences
  ✓ Timezone: America/Los_Angeles
  ✗ No .editorconfig found (skipped)

Here's your inferred profile:
─────────────────────────────
[prints the generated you.md]
─────────────────────────────

Save to ~/.you.md? (Y/n/edit)
```

### Save prompt options

- **Y** (default) — writes the file to `~/.you.md`
- **n** — exits without saving
- **edit** — opens in `$EDITOR` if set, otherwise prints path and tells user to edit manually

### Output path

Defaults to `~/.you.md` (global profile) since `--from-me` infers from the whole environment, not one project. User can override with positional arg: `npx you-md init --from-me ./project.you.md`.

## File changes

### New file: `src/cli/infer.ts`

Contains:
- `gatherSignals(): Promise<InferredSignals>` — orchestrates all collectors
- `gitIdentity(): Promise<GitIdentity | null>`
- `gitHistory(): Promise<GitHistory | null>`
- `projectStack(): Promise<StackInfo | null>`
- `codeStyle(): Promise<CodeStyleInfo | null>`
- `existingAIPrefs(): Promise<AIPrefsInfo | null>`
- `systemContext(): SystemContext`
- `buildProfileFromSignals(signals: InferredSignals): string`
- `formatScanResults(signals: InferredSignals): string` — the "Scanning..." output

### Modified: `src/cli/args.ts`

- Add `fromMe?: boolean` to `CliFlags`
- Add `"from-me": { type: "boolean" }` to parseArgs options
- Map to `fromMe` in returned flags

### Modified: `src/cli/commands/init.ts`

- If `flags.fromMe` is set, call `gatherSignals()` then `buildProfileFromSignals()`
- Print scan results and generated profile
- Prompt to save (Y/n/edit)
- Skip interactive wizard and template selection

## Edge cases

| Scenario | Behavior |
|---|---|
| No git repo | Skip git collectors, still get system context + dotfiles in `~` |
| Empty git history | Skip language/commit inference, note in output |
| No project files | Skip stack detection |
| Multiple conflicting signals | Explicit user preferences (.cursorrules) win over inferred |
| Existing you.md at target path | Same as current init — blocked unless `--force` |
| No signals at all | Fall back to identity template with system context filled in |
| `--from-me` combined with `--interactive` | Error: flags are mutually exclusive |
| `--from-me` combined with `--format` | Ignore `--format`, `--from-me` has its own assembly |

## What it doesn't do

- No network calls (no GitHub API, no npm registry, no AI)
- No scanning outside cwd and `~` for dotfiles
- No guessing at personality or soft preferences
- No new npm dependencies — uses Node builtins + `child_process.execSync` + `fs`

## Known sections update

Add `"How I Work"` to the known sections list in `src/utils/constants.ts` so the parser/validator recognizes it.
