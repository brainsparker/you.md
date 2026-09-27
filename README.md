# you.md

> **Stop reintroducing yourself to AI.**

`you.md` is a portable, human-readable profile that tells AI assistants how you think, work, communicate, and want to be helped. Write it once, keep it under your control, and use it across Claude, Cursor, Windsurf, Codex, Gemini, and any agent that reads `AGENTS.md`.

[![npm version](https://img.shields.io/npm/v/@brainsparker/you-md?logo=npm&color=cb3837)](https://www.npmjs.com/package/@brainsparker/you-md)
[![CI](https://github.com/brainsparker/you.md/actions/workflows/ci.yml/badge.svg)](https://github.com/brainsparker/you.md/actions/workflows/ci.yml)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Your preferences should not be trapped in one app's memory. `you.md` makes them a file you can read, edit, version, and take anywhere.

```text
                         ┌─ MCP ───────→ Claude · Cursor · Windsurf
~/.you.md or ./.you.md ──┤
                         └─ export ────→ CLAUDE.md · AGENTS.md · GEMINI.md · rules
```

## Quick start

Requires Node.js 18 or newer.

```bash
npm install -g @brainsparker/you-md

# Create a personal profile with the interactive wizard
you-md init -i ~/.you.md

# Connect it to every supported AI tool detected on this machine
you-md skill install

# Verify the profile and integrations
you-md check
```

Restart the connected apps. They can now retrieve your profile through MCP.

> The npm package is `@brainsparker/you-md`. The unscoped `youmd` package is an unrelated project.

Prefer not to install globally? Prefix commands with `npx -y -p @brainsparker/you-md`, for example:

```bash
npx -y -p @brainsparker/you-md you-md init -i ~/.you.md
```

## What goes in a you.md?

Anything stable that would help an AI work better with you: your expertise, communication style, trusted sources, tools, conventions, active goals, and boundaries.

```markdown
---
schema_version: "1.1"
privacy_level: "private"
---

# Me

## What I Do

Senior backend engineer working on distributed systems.

## How I Communicate

Verbosity: concise
Tone: direct
Explanations: only when asked

## How I Work

- Prefer TypeScript in strict mode
- Explain tradeoffs before introducing dependencies
- Test behavior, not implementation details

## Boundaries

- Do not add abstractions for hypothetical future needs
- Do not put secrets or credentials in generated examples
```

It is ordinary Markdown with small YAML frontmatter—easy for people to inspect and easy for machines to parse. Start with five useful lines or build a detailed profile; the format does not force you to fill every section.

## Why you.md

- **One identity, many assistants.** Carry the same preferences between tools instead of rebuilding context in every app.
- **Local-first and user-owned.** The core workflow needs no account or hosted service. Your profile lives wherever you put the file.
- **Human-readable.** Review changes in a diff, keep the file in Git, or edit it in any text editor.
- **Works with and without MCP.** Connect supported apps directly or export to the native instruction files they already read.
- **Project-aware.** Keep personal defaults in `~/.you.md` and use a project-local `.you.md` when a repository needs different context.
- **Designed against drift.** Managed export blocks preserve your other instructions, `you-md sync --check` catches stale copies in CI, and `you-md check` shows which instruction file each tool will actually load.
- **Useful as infrastructure.** The typed TypeScript API parses, validates, merges, and extracts personalization signals for your own products.

## Integrations

There are two ways to connect a profile:

1. **MCP** gives an assistant tools for finding, reading, summarizing, and validating the active profile.
2. **Native export** writes a managed block into the instruction file the tool already reads at startup.

| Tool | MCP auto-install | Native export |
| --- | :---: | :---: |
| Claude Code | `claude-code` | `claude` → `~/.claude/CLAUDE.md` |
| Claude Desktop | `claude-desktop` | — |
| Cursor | `cursor` | `cursor` → `./.cursor/rules/you-md.mdc` |
| Windsurf | `windsurf` | `windsurf` → global rules |
| Codex CLI | — | `codex` → `~/.codex/AGENTS.md` |
| Gemini CLI | — | `gemini` → `~/.gemini/GEMINI.md` |
| AGENTS.md-compatible tools | — | `agents` → `./AGENTS.md` |

Install MCP into all detected tools or choose one explicitly:

```bash
you-md skill install
you-md skill install cursor
you-md skill status
```

Export to native instruction files when MCP is unavailable or when you want the context loaded at session start:

```bash
you-md export --all
you-md export claude codex gemini
you-md export --all --dry-run
```

Exports are idempotent. In shared files, `you.md` owns only the content between `<!-- you-md:begin -->` and `<!-- you-md:end -->`; everything outside those markers is preserved. Existing files are backed up before writes. The Cursor target is a dedicated file owned by `you.md`.

Exporting the `agents` target also adds an `@AGENTS.md` bridge to the project's `CLAUDE.md`. Claude Code 2.1.277 and later reads `AGENTS.md` on its own, but only when no `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` sits in the working directory or above it. The import keeps `AGENTS.md` visible when a `CLAUDE.md` exists, and in sessions that cannot load `AGENTS.md` directly, without ever loading it twice.

## Keep every tool in sync

After editing your profile, refresh only the targets you have already exported:

```bash
you-md sync              # Update stale managed files
you-md sync --dry-run    # Preview without writing
you-md sync --check      # Exit 1 when an export is stale
```

Use the check mode as a CI drift gate:

```yaml
- name: Check AI instructions
  run: npx -y -p @brainsparker/you-md you-md sync --check
```

`sync` does not create new targets. Run `you-md export <target>` once to opt a file into management.

## Know which file each tool actually reads

Every coding agent loads instruction files by its own rules, and the rules changed in September 2026: Claude Code now reads a project's `AGENTS.md`, but a `CLAUDE.md` anywhere on the path makes it read that instead. Codex concatenates `AGENTS.md` files up to a 32 KiB cap. Gemini CLI only reads the names in its `context.fileName` setting. Copilot CLI reads all of them at once.

`you-md check` audits the current project against those rules and reports where files shadow, duplicate, or truncate each other:

```text
Instruction files (project root: /work/api):
    ./CLAUDE.md         3 lines   mentions AGENTS.md, no import
    ./AGENTS.md        22 lines   you-md block
    ~/.codex/AGENTS.md 40 lines
    Claude Code project instructions: claude-md-or-agents-md (default)

Precedence:
    ⚠ Claude Code    ./CLAUDE.md talks about AGENTS.md in prose, but only an `@AGENTS.md` import line makes Claude load it. ...
                     fix: Replace the sentence with an `@AGENTS.md` line, or run `you-md export agents` to add a managed import.
    ℹ Gemini CLI     Gemini CLI loads only `GEMINI.md` (its context.fileName setting), so it does not see ./AGENTS.md ...
                     fix: Run `you-md export gemini`, or add "AGENTS.md" to `context.fileName` in ~/.gemini/settings.json.
```

Findings and what they mean:

| Code | Level | Meaning |
| --- | --- | --- |
| `claude-shadows-agents` | warn | A `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` on the path hides `AGENTS.md` from Claude Code |
| `claude-mentions-agents-without-import` | warn | `CLAUDE.md` says "read AGENTS.md" in prose; only an `@AGENTS.md` import line works |
| `claude-mode-skips-agents` | warn | Claude Code's Project instructions setting is `claude-md` or `managed-only` |
| `session-start-hook-duplicates-agents` | warn | A `SessionStart` hook still prints `AGENTS.md`, so it now loads twice |
| `duplicate-managed-blocks` | warn | Your you.md block is in more than one project file that some tools load together |
| `managed-block-drift` | warn | Managed blocks differ between files; run `you-md sync` |
| `codex-size-cap` | warn | The Codex `AGENTS.md` chain exceeds `project_doc_max_bytes` (32 KiB by default) |
| `agents-read-directly` | info | No `CLAUDE.md` on the path; Claude Code 2.1.277+ reads `AGENTS.md` directly |
| `user-and-project-managed-blocks` | info | `~/.claude/CLAUDE.md` and a project file both carry your block |
| `long-instruction-file` | info | A file Claude reads is over 200 lines, Anthropic's adherence guidance |
| `claude-mode-ignored-in-project-settings` | info | The Claude Code mode is set in project settings, which Claude Code ignores |
| `gemini-skips-agents` | info | Gemini CLI does not read `AGENTS.md` and the project has no `GEMINI.md` |

The audit is read-only. `you-md check --json` prints the same report as JSON, with each finding's `code`, `level`, `paths`, and `fix`, for scripts and CI.

## Profiles and precedence

Profile discovery uses the first match in this order:

1. An explicit path or `YOU_MD_PATH`
2. Project-local `./.you.md` or `./you.md`
3. User-level `~/.you.md`
4. XDG paths such as `~/.config/you.md` and `~/.config/you/you.md`
5. An explicitly enabled remote HTTPS URL

A project-local file therefore takes precedence over the user-level profile. If you want to combine profiles instead, merge them explicitly; later files win on conflicts:

```bash
you-md merge ~/.you.md ./.you.md -o merged.md
```

## CLI at a glance

| Command | Purpose |
| --- | --- |
| `you-md init -i [path]` | Build a profile with the interactive wizard |
| `you-md init --format developer [path]` | Start from the developer-focused template |
| `you-md check [--json]` | Check profile validity, MCP installations, and instruction-file precedence |
| `you-md validate <path>` | Validate a profile against the schema |
| `you-md skill install [tool]` | Add the local MCP server to supported apps |
| `you-md skill status` | Show detected tools and installation state |
| `you-md export <targets...>` | Write the profile to native instruction files |
| `you-md sync [--check]` | Detect or repair drift in managed exports |
| `you-md merge <files...>` | Merge profiles, with later files taking precedence |
| `you-md convert <input>` | Convert `.cursorrules`, `AGENTS.md`, or generic rules |

Run `you-md --help` for every option.

## Manual MCP setup

If you prefer to manage MCP configuration yourself, add this server entry to your client:

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

The local server exposes:

| MCP tool | Purpose |
| --- | --- |
| `youmd_get_preferences` | Return the active profile as assistant-ready context |
| `youmd_summarize` | Return a short summary for quick context injection |
| `youmd_tool_config` | Render profile context for Cursor, Claude, Windsurf, or a generic client |
| `youmd_init` | Create a profile template in an approved local path |
| `youmd_validate` | Validate a local profile |

It also exposes the discovered profiles as `youmd://preferences`, `youmd://project`, and `youmd://global` resources when available.

## TypeScript API

Use the package as a library to parse and validate profiles:

```typescript
import { createParser } from "@brainsparker/you-md";

const parser = createParser();
const result = await parser.discover();

if (!result?.success) {
  throw new Error("No valid you.md profile found");
}

const validation = parser.validate(result.profile);
console.log(validation.valid);
console.log([...result.profile.sections.keys()]);
```

The public API also includes profile merging, remote HTTPS loading, low-level Markdown/frontmatter parsers, typed profile structures, and extraction helpers for identity, language, content, search, AI-response, and trust-and-safety signals.

## Optional ChatGPT app

This repository includes a separate remote MCP app for a conversational flow: ChatGPT synthesizes a profile from context it already has, while the server validates, versions, stores, updates, and exports the Markdown. The server itself never infers personal facts.

This integration requires you to deploy a reachable MCP endpoint and configure authentication and storage. See [the ChatGPT app guide](apps/chatgpt/README.md) for its architecture, privacy model, and deployment instructions.

## Privacy and security

- New templates set `privacy_level: "private"` by default.
- The core CLI and local MCP workflow require no `you.md` account or hosted backend.
- Remote profile loading is opt-in, HTTPS-only, size-limited, and blocks private-network hosts and redirects.
- MCP write operations are restricted to the current project and the user's home directory.
- A profile is context, not a secrets vault. Anything in it may be sent to the AI tools you connect, so never store passwords, tokens, or private keys in `you.md`.

## Development

```bash
git clone https://github.com/brainsparker/you.md.git
cd you.md
npm ci
npm run build
npm test
npm run lint
```

Contributions are welcome—especially new tool integrations, format feedback, tests, and documentation improvements. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE) © sparker
