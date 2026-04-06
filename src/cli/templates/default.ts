import { CURRENT_SCHEMA_VERSION } from "../../utils/constants.js";

/**
 * Human-centric identity template (v1.1 default)
 * For general audience - focuses on AI identity, not coding
 */
export function getIdentityTemplate(): string {
  const today = new Date().toISOString().split("T")[0];

  return `---
schema_version: "${CURRENT_SCHEMA_VERSION}"
created: "${today}"
last_updated: "${today}"
privacy_level: "private"
---

# Me

## How I Think

<!-- Your expertise and cognitive style -->
Expertise: intermediate
Learning style: hands-on
Decision making: data-driven
Depth preference: thorough

## How I Communicate

<!-- How AI should talk to you -->
Verbosity: concise
Tone: direct
Explanations: only when asked
Examples: yes, when helpful

## What I Trust

<!-- Your standards for information quality -->
Trusted sources: official documentation, peer-reviewed
Fact-checking: strict
Content warnings: standard
Source quality: high

## What I'm Into

<!-- Topics and content you care about -->
Topics:
Content depth: long-form analysis
Visual content: minimal

## Context

<!-- Your environment and accessibility needs -->
Language: en-US
Timezone:
Accessibility:

## Boundaries

<!-- Things you want AI to avoid -->
- Over-explain things I already know
- Use excessive caveats or hedging
- Assume I need hand-holding
`;
}

/**
 * Default template - returns identity template (v1.1)
 */
export function getDefaultTemplate(): string {
  return getIdentityTemplate();
}

/**
 * Developer-focused template for coding preferences
 */
export function getDeveloperTemplate(): string {
  const today = new Date().toISOString().split("T")[0];

  return `---
schema_version: "${CURRENT_SCHEMA_VERSION}"
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

## Boundaries

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
schema_version: "${CURRENT_SCHEMA_VERSION}"
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

/**
 * Personalization profile template for search/AI signals
 */
export function getPersonalizationTemplate(): string {
  const today = new Date().toISOString().split("T")[0];
  const timestamp = new Date().toISOString();

  return `---
schema_version: "${CURRENT_SCHEMA_VERSION}"
profile_type: "personalization"
created: "${today}"
last_updated: "${today}"
privacy_level: "private"
---

# Personalization Profile

## Identity

<!-- Authentication and trust signals -->
logged_in: true
account_age_days: 0
trust_score: 0.5
verified_level: email
child_safe_mode: false

## Location

<!-- Regional context for compliance and localization -->
current_country: US
current_region:
timezone: America/Los_Angeles
regulatory_region: CCPA

## Language

<!-- Language and communication preferences -->
primary_language: en-US
secondary_languages:
spelling_variant: US
reading_level: advanced
translation_enabled: false

## Device

<!-- Device and technical context -->
device_type: desktop
os:
browser:
screen_size: large
input_method: keyboard
connection_type: wifi
connection_speed: fast
accessibility_features:

## Search Behavior

<!-- Search patterns and interests -->
recent_topics: []
long_term_topics: []
search_depth: moderate
reformulation_rate: low
result_click_depth: 3

## Content Preferences

<!-- Content format and source preferences -->
preferred_sources: []
blocked_sources: []
authority_bias: 0.5
visual_preference: 0.3
long_form_preference: 0.5
freshness_weight: 0.5
expertise_level: intermediate

## AI Response Preferences

<!-- How AI should respond to you -->
verbosity: concise
explanation_depth: moderate
include_examples: true
example_language:
code_comments: sparse
response_format: structured
math_notation: plain
citation_style: inline

## Trust and Safety

<!-- Content safety preferences -->
misinformation_sensitivity: standard
source_reliability_threshold: 0.7
content_warning_level: standard
medical_legal_caution: standard
fact_check_preference: subtle

## Meta

<!-- Profile metadata and system signals -->
last_profile_update: "${timestamp}"
decay_rate: 0.1
personalization_weight: 0.8
profile_version: "1.0"
`;
}
