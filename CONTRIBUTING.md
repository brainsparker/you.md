# Contributing to you.md

Thanks for your interest in contributing. you.md is an open protocol and toolchain for portable user preferences across AI tools, and contributions are welcome: bug reports, docs fixes, new tool integrations, and protocol feedback.

## Development setup

Requires Node.js 18 or newer.

```bash
git clone https://github.com/brainsparker/you.md.git
cd you.md
npm install
npm run build
```

## Running tests and checks

```bash
npm test          # vitest suite
npm run lint      # tsc --noEmit
```

Tests run fully offline. Please keep it that way: no test should require network access or credentials.

## Project layout

- `src/` parser, CLI, and MCP server source (TypeScript)
- `bin/` executable entry points (you-md, you-md-mcp)
- `test/` vitest suites, organized by module
- `docs/` protocol and integration documentation
- `fixtures/` sample you.md profiles used by tests

## Adding support for a new AI tool

Tool integrations live in the skill installer. The existing Claude Code, Cursor, and Windsurf integrations are the best reference. A new integration should:

1. Detect the tool's config location on each platform.
2. Merge the you-md MCP server entry without clobbering existing config.
3. Be covered by a test using a temp directory, not the real home directory.

## Pull requests

1. Fork and create a feature branch.
2. Keep the change focused and reviewable in one sitting.
3. Add or update tests for behavior changes.
4. Make sure `npm test` and `npm run lint` pass.
5. Describe what changed and why in the PR body.

## Protocol changes

Changes to the you.md file format itself (new sections, frontmatter fields, override semantics) should start as an issue before a PR, so the format stays stable for downstream tools.
