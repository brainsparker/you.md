# you-md

Parser library and CLI for you.md - your portable AI identity.

**Own your AI identity. Stop being a stranger.**

The you.md standard provides a portable way to define who you are to AI systems. Create your profile once, use it everywhere - across search engines, AI assistants, and any tool that supports the format.

## Installation

```bash
npm install you-md
```

## Quick Start

### MCP Server (Recommended for Claude Code)

Add to your Claude Code MCP settings (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "you-md": {
      "command": "npx",
      "args": ["-y", "-p", "you-md", "you-md-mcp"]
    }
  }
}
```

Or install globally first (`npm install -g you-md`), then:

```json
{
  "mcpServers": {
    "you-md": {
      "command": "you-md-mcp"
    }
  }
}
```

Then create your preferences file:

```bash
npx you-md init -i ~/.you.md   # Interactive wizard (recommended)
# or
npx you-md init ~/.you.md      # Template-based
```

The MCP server provides:
- **Resources:** Access your preferences via `youmd://preferences`
- **Tools:** `youmd_init`, `youmd_validate`, `youmd_get_preferences`

### CLI Usage

```bash
# Easiest: Interactive wizard
you-md init -i

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
```

### Library Usage

```typescript
import { createParser } from "you-md";

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

## Requirements

- Node.js >= 18.0.0

## License

MIT
