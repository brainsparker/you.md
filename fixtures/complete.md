---
schema_version: "1.0"
created: "2025-01-06"
last_updated: "2025-01-06"
privacy_level: "public"
profile_id: "12345678-1234-1234-1234-123456789abc"
author: "Jane Developer"
tags: ["coding", "python", "typescript", "backend"]
ttl: 3600
---

# you.md

## About Me

Senior backend engineer focused on distributed systems.
10+ years Python, transitioning to Rust for performance-critical paths.

## Technical Preferences

Primary Languages: Python 3.11+, Rust, TypeScript
Frameworks: FastAPI, Axum, React

Style Preferences:
- Python: black formatter, 88 char lines, Google docstrings
- Rust: rustfmt defaults, prefer Result over panic
- TypeScript: prettier, strict mode, functional patterns

Architecture:
- Hexagonal/ports-and-adapters for services
- Event sourcing for complex domains
- Prefer composition over inheritance

### Testing

Framework: pytest
Style: BDD
Coverage: 80%

### Documentation

Style: Google docstrings
Required: yes

## Communication Style

Verbosity: Concise
Explanations: Only when I ask or something is non-obvious
Assumptions: Ask if ambiguous, otherwise make reasonable choices
Code Comments: Sparse - explain why, not what

## Code Generation Preferences

When generating code:
- Include type hints (Python) or full types (TS/Rust)
- Add error handling for I/O operations
- Prefer async/await for I/O bound operations
- Use dependency injection over global state
- Include basic logging at function boundaries

## Code Review Preferences

When reviewing code:
- Flag security issues (SQL injection, XSS, etc.)
- Note performance concerns for hot paths
- Suggest more idiomatic patterns
- Ignore minor style issues (formatter handles it)

## Project Conventions

Test files: `test_*.py` or `*.test.ts`
Documentation: README.md in each package
API specs: OpenAPI 3.1 in `/specs`
Migrations: Sequential numbered files

## Development Environment

OS: macOS
Editor: VS Code, Neovim
Shell: zsh
Terminal: iTerm2

## Don't

- Add verbose explanations unless I ask
- Suggest obvious refactors
- Use `print()` for debugging (use logging)
- Create god objects or deep inheritance
- Ignore error cases
