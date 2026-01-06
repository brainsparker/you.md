/**
 * Default you.md template for the init command
 */
export function getDefaultTemplate(): string {
  const today = new Date().toISOString().split("T")[0];

  return `---
schema_version: "1.0"
created: "${today}"
last_updated: "${today}"
privacy_level: "private"
---

# you.md

## About Me

<!-- Describe yourself and your role -->
<!-- Example: Senior backend engineer focused on distributed systems -->

## Technical Preferences

<!-- List your primary languages, frameworks, and tools -->

Primary Languages:
Frameworks:

Style Preferences:
- <!-- e.g., Prefer functional patterns -->
- <!-- e.g., Use TypeScript strict mode -->

Architecture:
- <!-- e.g., Hexagonal/ports-and-adapters for services -->
- <!-- e.g., Prefer composition over inheritance -->

## Communication Style

<!-- How should AI assistants communicate with you? -->

Verbosity: concise
Explanations: when_asked
Assumptions: ask_first
Code Comments: sparse

## Code Generation Preferences

<!-- Preferences for AI-generated code -->

When generating code:
- Include type hints/annotations
- Add error handling for I/O operations
- Prefer async/await for I/O bound operations
- Use dependency injection over global state

## Code Review Preferences

<!-- What should AI assistants focus on when reviewing? -->

When reviewing code:
- Flag security issues
- Note performance concerns for hot paths
- Suggest more idiomatic patterns
- Ignore minor style issues (formatter handles it)

## Project Conventions

<!-- Project-specific conventions (for project-level .you.md) -->

Test files:
Documentation:
API specs:

## Don't

<!-- Things you don't want AI assistants to do -->

- Add verbose explanations unless asked
- Suggest obvious refactors
- Create god objects or deep inheritance
- Ignore error cases
`;
}

/**
 * Minimal template for quick start
 */
export function getMinimalTemplate(): string {
  const today = new Date().toISOString().split("T")[0];

  return `---
schema_version: "1.0"
created: "${today}"
privacy_level: "private"
---

# you.md

## Technical Preferences

Primary Languages:
Frameworks:

## Communication Style

Verbosity: concise
Assumptions: ask_first
`;
}
