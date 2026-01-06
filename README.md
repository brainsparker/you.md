# you-md

Parser library and CLI for you.md personal AI context files.

The you.md standard provides a portable way to define your preferences, coding style, and communication expectations for AI-assisted development tools.

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
npx you-md init ~/.you.md
```

The MCP server provides:
- **Resources:** Access your preferences via `youmd://preferences`
- **Tools:** `youmd_init`, `youmd_validate`, `youmd_get_preferences`

### CLI Usage

```bash
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

```markdown
---
schema_version: "1.0"
created: "2025-01-06"
last_updated: "2025-01-06"
privacy_level: "private"
author: "Your Name"
tags: ["coding", "typescript"]
---

# you.md

## About Me

Senior developer focused on backend systems.

## Technical Preferences

Primary Languages: TypeScript, Python
Frameworks: FastAPI, React

Style Preferences:
- Use prettier for formatting
- Prefer functional patterns
- Strict TypeScript

## Communication Style

Verbosity: concise
Explanations: when_asked
Assumptions: ask_first
Code Comments: sparse

## Code Generation Preferences

When generating code:
- Include type annotations
- Add error handling for I/O
- Use async/await for I/O operations
- Prefer dependency injection

## Don't

- Add verbose explanations unless asked
- Suggest obvious refactors
- Skip error handling
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
you-md init                    # Creates ./.you.md
you-md init ~/.you.md          # Creates global profile
you-md init --format minimal   # Creates minimal template
you-md init --force            # Overwrite existing
```

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
