# you.md

**Who you are. What you've lived. What you're becoming.**

Every AI tool you open starts from zero. It doesn't know how you think, what you've built, or where you're headed. You re-explain yourself every session, every tool, every project.

you.md fixes that. Define yourself once in a simple markdown file. Install the skill. Every AI tool you use — Cursor, Claude Code, Windsurf, and more — now knows exactly who you are and how you work.

```bash
# Install the CLI, then wire the skill into all your AI tools
npm install -g @brainsparker/you-md
you-md skill install
```

That's it. No manual JSON editing. No per-tool setup. The skill auto-detects every supported tool you have installed and wires itself in.

> **Package name:** install `@brainsparker/you-md` (the CLI commands are still `you-md` and `you-md-mcp`). The unscoped `youmd` package on npm is an unrelated project by a different author.

---

## Quick Start

Install once: `npm install -g @brainsparker/you-md` (or prefix any command below with `npx -y -p @brainsparker/you-md`).

### 1. Create your you.md profile

```bash
you-md init -i    # Interactive wizard (recommended)
```

### 2. Install the skill

```bash
you-md skill install
```

This auto-detects and configures: **Claude Code**, **Claude Desktop**, **Cursor**, and **Windsurf**.

Restart your AI tools. They now know you.

### 3. Check your status

```bash
you-md skill status
```

---

## What the skill does

Once installed, every supported AI tool gets access to:

- Your coding language and framework preferences
- Your naming conventions and code style
- Your communication preferences (concise vs. verbose, emoji use, etc.)
- Your role and professional context
- Project-level overrides (`.you.md` in your project root overrides `~/.you.md`)

The skill works via [MCP (Model Context Protocol)](https://modelcontextprotocol.io) and exposes three tools your AI can call:

| Tool | What it does |
|---|---|
| `youmd_get_preferences` | Returns your full preferences for context injection |
| `youmd_summarize` | One-paragraph summary of who you are — fast context for new sessions |
| `youmd_tool_config` | Generates tool-specific config (Cursor rules, Claude instructions) from your profile |

---

## Manual installation (advanced)

If you prefer to configure tools manually, add this to your tool's MCP config:

```json
{
  "mcpServers": {
    "you-md": {
      "command": "npx",
      "args": ["-y", "-p", "@brainsparker/you-md", "you-md-mcp"]
    }
  }
}
```

Config file locations:
- **Claude Code:** `~/.claude/claude_desktop_config.json`
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Cursor:** `~/.cursor/mcp.json`
- **Windsurf:** `~/.codeium/windsurf/mcp_config.json`

---

## CLI Reference

```bash
# Skill management
you-md skill install              Install into all detected AI tools
you-md skill install cursor       Install into a specific tool only
you-md skill status               Show which tools have the skill active
you-md skill uninstall            Remove from all tools

# Profile management
you-md init -i                    Interactive wizard (recommended)

# Create a new you.md file
you-md init

# Create in a specific location
you-md init ~/.you.md

# Validate a you.md file
you-md validate .you.md

# Merge user and project profiles
you-md merge ~/.you.md ./.you.md -o merged.md

# Convert from .cursorrules
you-md convert .cursorrules -o .you.md

# Export your preferences into each tool's native instruction file
you-md export --all               Export to every supported tool
you-md export claude gemini       Export to specific tools
you-md export --all --dry-run     Preview without writing

# Keep exported files in sync after you edit your you.md
you-md sync                       Refresh every previously exported file
you-md sync --check               CI drift gate: exit 1 if anything is stale
```

### Library Usage

```typescript
import { createParser } from "@brainsparker/you-md";

const parser = createParser();

// Parse content directly
const result = parser.parse(`---
schema_version: "1.0"
author: "Developer"
---

# Technical Preferences

Language: TypeScript
Framework: React
`);

console.log(result.profile.metadata.author); // "Developer"
console.log(result.profile.sections.get("technical preferences"));

// Load from file
const fileResult = await parser.loadFromPath("./.you.md");

// Auto-discover you.md (checks ./.you.md, ~/.you.md, etc.)
const discovered = await parser.discover();

// Merge profiles (project overrides user)
const userProfile = await parser.loadFromPath("~/.you.md");
const projectProfile = await parser.loadFromPath("./.you.md");
const merged = parser.merge([userProfile.profile, projectProfile.profile]);

// Validate
const validation = parser.validate(merged);
console.log(validation.valid, validation.errors, validation.warnings);
```

## you.md File Format

### Identity Format (Default, v1.1)

Human-centric format for everyone:

```markdown
---
schema_version: "1.1"
created: "2025-01-13"
privacy_level: "private"
---

# Me

## How I Think

Expertise: expert
Learning style: hands-on
Decision making: data-driven
Depth preference: thorough

## How I Communicate

Verbosity: concise
Tone: direct
Explanations: only when asked
Examples: yes, when helpful

## What I Trust

Trusted sources: official documentation, peer-reviewed
Fact-checking: strict
Content warnings: standard
Source quality: high

## What I'm Into

Topics: distributed systems, machine learning
Content depth: long-form analysis
Visual content: minimal

## Where I'm Headed

Currently exploring: Rust for systems programming
Building toward: distributed systems consultancy
Learning: category theory, formal verification

## Context

Language: en-US
Timezone: America/Los_Angeles

## Don't

- Over-explain things I already know
- Use excessive caveats or hedging
- Assume I need hand-holding
```

### Developer Format

For developers who want coding-specific preferences:

```bash
you-md init --format developer
```

```markdown
---
schema_version: "1.0"
privacy_level: "private"
---

# you.md

## Technical Preferences

Primary Languages: TypeScript, Python
Frameworks: FastAPI, React

## Communication Style

Verbosity: concise
Explanations: when_asked
Code Comments: sparse

## Code Generation Preferences

- Include type annotations
- Add error handling for I/O
- Prefer dependency injection

## Don't

- Add verbose explanations unless asked
- Suggest obvious refactors
```

## Discovery Order

The parser discovers you.md files in this order (first found wins):

1. **Explicit path** - `--you-md <path>` or `YOU_MD_PATH` env var
2. **Project-local** - `./.you.md` or `./you.md`
3. **User home** - `~/.you.md`
4. **XDG config** - `~/.config/you.md` or `~/.config/you/you.md`
5. **Remote URL** - If enabled via options

## CLI Commands

### `you-md init [path]`

Create a new you.md file with a template.

```bash
you-md init -i                     # Interactive wizard (easiest!)
you-md init                        # Creates ./.you.md (identity template)
you-md init ~/.you.md              # Creates global profile
you-md init --format identity      # Human-centric identity (default)
you-md init --format developer     # Developer-focused coding preferences
you-md init --format signals       # Full personalization signals
you-md init --format minimal       # Quick start minimal template
you-md init --force                # Overwrite existing
```

The interactive wizard (`-i`) asks a few questions and generates your profile - no manual editing needed.

### `you-md validate <path>`

Validate a you.md file against the schema.

```bash
you-md validate .you.md
you-md validate .you.md --json     # Output as JSON
you-md validate .you.md --verbose  # Show details
```

### `you-md merge <files...>`

Merge multiple you.md files. Later files override earlier ones.

```bash
you-md merge ~/.you.md ./.you.md             # Output to stdout
you-md merge ~/.you.md ./.you.md -o out.md   # Output to file
you-md merge a.md b.md c.md --json           # Output as JSON
```

### `you-md convert <input>`

Convert from other formats to you.md.

```bash
you-md convert .cursorrules              # Output to stdout
you-md convert .cursorrules -o .you.md   # Output to file
```

### `you-md export [targets...]`

Write your you.md preferences into each tool's native instruction file. This is the
outbound counterpart to `convert`: tools that don't speak MCP (or that you haven't
wired the skill into) still get your preferences, because they already read these
files at session start.

```bash
you-md export --all                # Export to every supported tool
you-md export claude gemini        # Export to specific tools
you-md export --all --dry-run      # Preview paths and actions, write nothing
you-md export claude -o ./out.md   # Override the output path (single target)
```

Supported targets:

| Target     | Tool               | File written                                   |
| ---------- | ------------------ | ---------------------------------------------- |
| `claude`   | Claude Code        | `~/.claude/CLAUDE.md`                          |
| `codex`    | Codex CLI          | `~/.codex/AGENTS.md`                           |
| `gemini`   | Gemini CLI         | `~/.gemini/GEMINI.md`                          |
| `windsurf` | Windsurf           | `~/.codeium/windsurf/memories/global_rules.md` |
| `cursor`   | Cursor             | `./.cursor/rules/you-md.mdc`                   |
| `agents`   | Any AGENTS.md tool | `./AGENTS.md`                                  |

Exports are idempotent. Managed content lives between `<!-- you-md:begin -->` and
`<!-- you-md:end -->` markers, so anything else you keep in those files is preserved,
and re-running `you-md export` updates the block in place. Existing files are backed
up to `<file>.backup` before each write. The `cursor` target is the exception: it
writes a dedicated `you-md.mdc` rule file that you-md owns entirely.

Exporting `agents` also bridges the project `CLAUDE.md`: Claude Code doesn't read
`AGENTS.md` natively, so you-md adds an `@AGENTS.md` import line (inside a managed
block) to `./CLAUDE.md`. One source file, and Claude Code reads the same instructions
as every AGENTS.md-native tool. If your `CLAUDE.md` already references `@AGENTS.md`,
you-md leaves it alone.

### `you-md sync`

Detect and repair drift between your you.md and every file you've exported it into.
This is the answer to the classic failure mode where `CLAUDE.md`, `AGENTS.md`, and
`.cursor/rules` slowly diverge until an agent violates a rule that only exists in
one of them.

```bash
you-md sync              # Refresh every previously exported file
you-md sync --check      # Report drift, write nothing, exit 1 if anything is stale
you-md sync --dry-run    # Preview what would change, always exit 0
```

`sync` only touches files that already carry you-md managed markers (or files
you-md owns outright, like Cursor's rule file). It never creates new export
targets on its own: run `you-md export <target>` first to add one. It also keeps
the `CLAUDE.md` -> `AGENTS.md` bridge healthy whenever the project `AGENTS.md`
is managed by you-md.

`--check` is built for CI: add it as a step and the build fails whenever someone
edits `you.md` without re-exporting (or hand-edits a managed block).

```yaml
# .github/workflows/ci.yml
- run: npx -y -p @brainsparker/you-md you-md sync --check
```

## API Reference

### `createParser(options?)`

Create a new parser instance.

```typescript
const parser = createParser({
  maxFileSize: 100 * 1024, // 100KB default
});
```

### `parser.parse(content, options?)`

Parse a you.md string.

```typescript
const result = parser.parse(content);
// result.success: boolean
// result.profile: YouMdProfile
// result.errors: ParseError[]
// result.warnings: ParseWarning[]
```

### `parser.loadFromPath(path, options?)`

Load and parse from filesystem.

```typescript
const result = await parser.loadFromPath("./.you.md");
```

### `parser.loadFromUrl(url, fetchOptions?, parseOptions?)`

Load and parse from HTTPS URL.

```typescript
const result = await parser.loadFromUrl("https://example.com/you.md");
```

### `parser.discover(options?)`

Auto-discover and load you.md.

```typescript
const result = await parser.discover({
  cwd: process.cwd(),
  envVar: "YOU_MD_PATH",
  enableRemote: false,
});
```

### `parser.merge(profiles, options?)`

Merge multiple profiles.

```typescript
const merged = parser.merge([userProfile, projectProfile], {
  arrayMerge: "replace", // or "concat", "unique"
});
```

### `parser.validate(profile)`

Validate a profile.

```typescript
const validation = parser.validate(profile);
// validation.valid: boolean
// validation.errors: ValidationError[]
// validation.warnings: ValidationWarning[]
```

## Types

```typescript
interface YouMdProfile {
  schemaVersion: string;
  metadata: ProfileMetadata;
  sections: Map<string, YouMdSection>;
  rawContent: string;
  sourcePath?: string;
}

interface ProfileMetadata {
  schemaVersion: string;
  created?: string;
  lastUpdated?: string;
  privacyLevel?: "public" | "private" | "authenticated";
  author?: string;
  tags?: string[];
  // ... additional fields
}

interface YouMdSection {
  title: string;
  normalizedTitle: string;
  level: number;
  content: string;
  fields: Map<string, YouMdField>;
  subsections: YouMdSection[];
}
```

## Personalization Signals

The library supports extended personalization profiles for search and AI systems. These provide a machine-readable, human-inspectable control surface for AI agents and ranking systems.

### Signal Categories

| Category | Description |
|----------|-------------|
| Identity | Authentication state, trust scores, account age |
| Location | Geographic context, timezone, regulatory region |
| Language | Primary/secondary languages, reading level |
| Device | Device type, OS, screen size, connection |
| Search Behavior | Topics, search depth, reformulation patterns |
| Content | Source preferences, expertise level, format bias |
| AI Preferences | Verbosity, explanation depth, response format |
| Trust & Safety | Misinformation sensitivity, content warnings |
| Meta | Confidence scores, decay rates, experiments |

### Creating a Personalization Profile

```bash
you-md init --format signals ~/.personalization.md
```

### Extracting Signals

```typescript
import { createParser, extractAllSignals, hasPersonalizationSignals } from "you-md";

const parser = createParser();
const result = await parser.loadFromPath("./personalization.md");

if (hasPersonalizationSignals(result.profile)) {
  const signals = extractAllSignals(result.profile);

  console.log(signals.identity?.trust_score);      // 0.92
  console.log(signals.ai_preferences?.verbosity);  // "concise"
  console.log(signals.content?.expertise_level);   // "expert"
}
```

### Individual Signal Extraction

```typescript
import {
  extractIdentitySignals,
  extractLocationSignals,
  extractSearchBehaviorSignals,
  extractAIPreferences,
  getSignalCategories,
} from "you-md";

// Extract specific signal categories
const identity = extractIdentitySignals(profile);
const location = extractLocationSignals(profile);
const search = extractSearchBehaviorSignals(profile);
const ai = extractAIPreferences(profile);

// Check which categories are present
const categories = getSignalCategories(profile);
// ["identity", "location", "language", "device", "search_behavior", ...]
```

### Personalization Profile Format

```markdown
---
schema_version: "1.0"
profile_type: "personalization"
created: "2025-01-09"
---

# Personalization Profile

## Identity

logged_in: true
trust_score: 0.92
verified_level: email
age_range: 25-34

## Location

current_country: US
timezone: America/Los_Angeles
regulatory_region: CCPA

## Search Behavior

recent_topics: ["distributed systems", "kubernetes"]
search_depth: deep
expertise_level: expert

## AI Response Preferences

verbosity: concise
explanation_depth: technical
include_examples: true
code_comments: sparse

## Trust and Safety

misinformation_sensitivity: high
source_reliability_threshold: 0.8
```

## MCP Server

The MCP server automatically loads your you.md preferences into Claude's context.

### Setup

1. Install: `npm install -g you-md`
2. Add to Claude Code config (see Quick Start above)
3. Create your profile: `you-md init ~/.you.md`
4. Restart Claude Code

### Available Tools

| Tool | Description |
|------|-------------|
| `youmd_get_preferences` | Get your merged preferences |
| `youmd_init` | Create a new you.md file |
| `youmd_validate` | Validate a you.md file |

### Available Resources

| URI | Description |
|-----|-------------|
| `youmd://preferences` | Your merged preferences (project + global) |
| `youmd://project` | Project-level .you.md |
| `youmd://global` | Global ~/.you.md |

## ChatGPT App

`apps/chatgpt/` packages a ChatGPT plugin that turns the context ChatGPT already
has about you into a you.md you own:

```
Create my you.md from what you know about me.
→ ChatGPT writes the profile and shows it to you
→ "Remove the location and add that I prefer direct answers."
→ Export my you.md
```

ChatGPT does the synthesis; the remote MCP server validates the markdown against
this package's parser, versions it, and hands it back. It never infers anything
about you on its own, and profiles are private by default.

```bash
npm run build
node bin/you-md-chatgpt.js       # remote MCP server on http://localhost:8787/mcp
```

See [`apps/chatgpt/README.md`](apps/chatgpt/README.md) for the tool surface,
deployment, and skill evals.

## Requirements

- Node.js >= 18.0.0

## License

MIT
