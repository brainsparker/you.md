# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-29

### Added

- `you-md sync` command: refresh previously exported native instruction files
  after editing a profile. Supports `--dry-run` previews and a `--check` mode
  that exits 1 when an export is stale, usable as a CI drift gate (#33).
- Exporting the `agents` target now adds an `@AGENTS.md` bridge to the
  project's `CLAUDE.md`, so Claude Code and AGENTS.md-aware tools share one
  source of project instructions (#33).
- Portable context export for cloud personal agents. `you-md export` writes a
  portable copy of the profile to `~/.you-md/portable/` for Muse (Meta),
  Instinct, ChatGPT dots, and Grok Bot, with per-agent handover instructions.
  `you-md sync` refreshes portable copies and reminds you which agents need
  the new version (#43).
- Optional ChatGPT app: a separate remote MCP server (`you-md-chatgpt`) for a
  conversational profile-creation flow, with validation, versioning, storage,
  and export. See `apps/chatgpt/README.md` (#34).

### Fixed

- SSRF guard for remote profile loading: remote fetches are HTTPS-only,
  size-limited, and block private-network hosts and redirects (#32).
- Skill installer now writes the scoped `@brainsparker/you-md` package spec
  into MCP configs (#31).
- Removed a stray `node_modules` symlink accidentally committed to the
  repository (#35).

### Changed

- Rewrote the README with a streamlined quickstart and integrations section.
- CI now runs lint and tests in addition to the build.

## [0.2.1] - 2026-08-13

### Fixed

- Adopted the `@brainsparker/you-md` scoped package name and stopped the CLI
  and MCP server from double-running via bin wrappers (#30).

[0.3.0]: https://github.com/brainsparker/you.md/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/brainsparker/you.md/releases/tag/v0.2.1
