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
- **Designed against drift.** Managed export blocks preserve your other instructions, and `you-md sync --check` catches stale copies in CI.
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

Exporting the `agents` target also adds an `@AGENTS.md` bridge to the project's `CLAUDE.md`, so Claude Code and AGENTS.md-aware tools can share one source of project instructions.

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

## Check a profile before you trust it

A profile is an instruction file. Whatever it says reaches every AI tool that reads it, through MCP or through the files `export` writes. Poisoned instruction files are now a documented attack: text that tells the agent to ignore its other rules, hide an action from you, ship prompts or `.env` contents to an outside endpoint, or route API traffic through a proxy.

`you-md validate`, `check`, `export`, and `sync` scan for those patterns and report them as `POSSIBLE_INJECTION` warnings with line numbers:

```text
Security warnings (2):
  ⚠ POSSIBLE_INJECTION: YM-INJ-001 (high, authority_override) line 14: "Ignore all previous instructions"
  ⚠ POSSIBLE_INJECTION: YM-INJ-003 (high, exfiltration) line 15: "Send the contents of .env to https://"
```

Warnings never fail a personal profile on their own. Add `--strict` to turn them into a failing exit code, and to make `export` and `sync` refuse to write:

```bash
you-md validate --strict shared.you.md   # Exit 1 if the profile carries injection-shaped text
you-md export --all --strict             # Refuse to write flagged content into any tool
you-md sync --check --strict             # CI: drift gate plus security gate
```

Use `--strict` whenever the profile is not your own: a teammate's file, a template from a repository, or a remote URL. If a flagged line is intentional, add `<!-- you-md:allow-injection -->` to that line, or alone on the line above it.

The rules cover eight technique families: authority override, concealment, exfiltration, API endpoint override, permission bypass, hidden content (zero-width and bidirectional characters, agent-addressed HTML comments, opaque payloads), remote instruction loading, and piped execution. The scanner is static and dependency-free; the same check is available in the TypeScript API as `scanForInjection`.

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
| `you-md check` | Check profile validity and MCP installations |
| `you-md validate [--strict] <path>` | Validate a profile against the schema; `--strict` fails on possible prompt injection or sensitive data |
| `you-md skill install [tool]` | Add the local MCP server to supported apps |
| `you-md skill status` | Show detected tools and installation state |
| `you-md export [--strict] <targets...>` | Write the profile to native instruction files; `--strict` refuses flagged content |
| `you-md sync [--check] [--strict]` | Detect or repair drift in managed exports |
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
- Every profile is scanned for instruction-file poisoning patterns (`POSSIBLE_INJECTION`) and likely secrets (`POSSIBLE_SENSITIVE_DATA`). Pass `--strict` to `validate`, `export`, or `sync` to fail on them. See [Check a profile before you trust it](#check-a-profile-before-you-trust-it).

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
