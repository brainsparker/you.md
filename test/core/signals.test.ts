import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser";
import {
  extractIdentitySignals,
  extractLocationSignals,
  extractLanguageSignals,
  extractDeviceSignals,
  extractSearchBehaviorSignals,
  extractContentPreferences,
  extractAIPreferences,
  extractTrustSafetySignals,
  extractPersonalizationMeta,
  extractAllSignals,
  hasPersonalizationSignals,
  getSignalCategories,
} from "../../src/core/signals";

const parser = createParser();

const PERSONALIZATION_PROFILE = `---
schema_version: "1.0"
profile_type: "personalization"
---

# Personalization Profile

## Identity

logged_in: true
account_age_days: 730
trust_score: 0.92
verified_level: email
age_range: 25-34
child_safe_mode: false

## Location

current_country: US
current_region: CA
timezone: America/Los_Angeles
regulatory_region: CCPA

## Language

primary_language: en-US
secondary_languages: es, fr
spelling_variant: US
reading_level: advanced
translation_enabled: false

## Device

device_type: desktop
os: macOS
browser: Chrome
screen_size: large
input_method: keyboard
connection_type: wifi
connection_speed: fast

## Search Behavior

recent_topics: ["distributed systems", "rust"]
long_term_topics: ["software architecture"]
search_depth: deep
reformulation_rate: low
result_click_depth: 3

## Content Preferences

preferred_sources: ["github", "arxiv"]
authority_bias: 0.7
visual_preference: 0.3
freshness_weight: 0.4
expertise_level: expert

## AI Response Preferences

verbosity: concise
explanation_depth: technical
include_examples: true
example_language: python
code_comments: sparse
response_format: structured

## Trust and Safety

misinformation_sensitivity: high
source_reliability_threshold: 0.8
content_warning_level: standard
medical_legal_caution: high

## Meta

last_profile_update: "2025-01-09T12:00:00Z"
decay_rate: 0.1
personalization_weight: 0.8
`;

describe("Signal Extraction", () => {
  describe("extractIdentitySignals", () => {
    it("extracts identity signals from profile", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      const signals = extractIdentitySignals(result.profile);

      expect(signals).toBeDefined();
      expect(signals?.logged_in).toBe(true);
      expect(signals?.account_age_days).toBe(730);
      expect(signals?.trust_score).toBe(0.92);
      expect(signals?.verified_level).toBe("email");
      expect(signals?.age_range).toBe("25-34");
      expect(signals?.child_safe_mode).toBe(false);
    });

    it("returns undefined for missing section", () => {
      const result = parser.parse(`---
schema_version: "1.0"
---

# Profile

## About Me

Just a regular profile.
`);
      const signals = extractIdentitySignals(result.profile);
      expect(signals).toBeUndefined();
    });

    it("drops non-finite numeric values", () => {
      const result = parser.parse(`---
schema_version: "1.0"
---

# Profile

## Identity

trust_score: Infinity
`);
      const signals = extractIdentitySignals(result.profile);
      expect(signals).toBeUndefined();
    });
  });

  describe("extractLocationSignals", () => {
    it("extracts location signals from profile", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      const signals = extractLocationSignals(result.profile);

      expect(signals).toBeDefined();
      expect(signals?.current_country).toBe("US");
      expect(signals?.current_region).toBe("CA");
      expect(signals?.timezone).toBe("America/Los_Angeles");
      expect(signals?.regulatory_region).toBe("CCPA");
    });
  });

  describe("extractLanguageSignals", () => {
    it("extracts language signals from profile", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      const signals = extractLanguageSignals(result.profile);

      expect(signals).toBeDefined();
      expect(signals?.primary_language).toBe("en-US");
      expect(signals?.secondary_languages).toEqual(["es", "fr"]);
      expect(signals?.spelling_variant).toBe("US");
      expect(signals?.reading_level).toBe("advanced");
      expect(signals?.translation_enabled).toBe(false);
    });
  });

  describe("extractDeviceSignals", () => {
    it("extracts device signals from profile", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      const signals = extractDeviceSignals(result.profile);

      expect(signals).toBeDefined();
      expect(signals?.device_type).toBe("desktop");
      expect(signals?.os).toBe("macOS");
      expect(signals?.browser).toBe("Chrome");
      expect(signals?.screen_size).toBe("large");
      expect(signals?.input_method).toBe("keyboard");
      expect(signals?.connection_type).toBe("wifi");
      expect(signals?.connection_speed).toBe("fast");
    });
  });

  describe("extractSearchBehaviorSignals", () => {
    it("extracts search behavior signals from profile", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      const signals = extractSearchBehaviorSignals(result.profile);

      expect(signals).toBeDefined();
      expect(signals?.recent_topics).toEqual(["distributed systems", "rust"]);
      expect(signals?.long_term_topics).toEqual(["software architecture"]);
      expect(signals?.search_depth).toBe("deep");
      expect(signals?.reformulation_rate).toBe("low");
      expect(signals?.result_click_depth).toBe(3);
    });
  });

  describe("extractContentPreferences", () => {
    it("extracts content preferences from profile", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      const signals = extractContentPreferences(result.profile);

      expect(signals).toBeDefined();
      expect(signals?.preferred_sources).toEqual(["github", "arxiv"]);
      expect(signals?.authority_bias).toBe(0.7);
      expect(signals?.visual_preference).toBe(0.3);
      expect(signals?.freshness_weight).toBe(0.4);
      expect(signals?.expertise_level).toBe("expert");
    });
  });

  describe("extractAIPreferences", () => {
    it("extracts AI response preferences from profile", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      const signals = extractAIPreferences(result.profile);

      expect(signals).toBeDefined();
      expect(signals?.verbosity).toBe("concise");
      expect(signals?.explanation_depth).toBe("technical");
      expect(signals?.include_examples).toBe(true);
      expect(signals?.example_language).toBe("python");
      expect(signals?.code_comments).toBe("sparse");
      expect(signals?.response_format).toBe("structured");
    });
  });

  describe("extractTrustSafetySignals", () => {
    it("extracts trust and safety signals from profile", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      const signals = extractTrustSafetySignals(result.profile);

      expect(signals).toBeDefined();
      expect(signals?.misinformation_sensitivity).toBe("high");
      expect(signals?.source_reliability_threshold).toBe(0.8);
      expect(signals?.content_warning_level).toBe("standard");
      expect(signals?.medical_legal_caution).toBe("high");
    });
  });

  describe("extractPersonalizationMeta", () => {
    it("extracts personalization metadata from profile", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      const signals = extractPersonalizationMeta(result.profile);

      expect(signals).toBeDefined();
      expect(signals?.last_profile_update).toBe("2025-01-09T12:00:00Z");
      expect(signals?.decay_rate).toBe(0.1);
      expect(signals?.personalization_weight).toBe(0.8);
    });
  });

  describe("extractAllSignals", () => {
    it("extracts all signal categories from profile", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      const signals = extractAllSignals(result.profile);

      expect(signals.identity).toBeDefined();
      expect(signals.location).toBeDefined();
      expect(signals.language).toBeDefined();
      expect(signals.device).toBeDefined();
      expect(signals.search_behavior).toBeDefined();
      expect(signals.content).toBeDefined();
      expect(signals.ai_preferences).toBeDefined();
      expect(signals.trust_safety).toBeDefined();
      expect(signals.meta).toBeDefined();
    });

    it("returns empty object for non-personalization profile", () => {
      const result = parser.parse(`---
schema_version: "1.0"
---

# you.md

## About Me

Regular user profile.
`);
      const signals = extractAllSignals(result.profile);
      expect(Object.keys(signals).length).toBe(0);
    });
  });

  describe("hasPersonalizationSignals", () => {
    it("returns true for personalization profile", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      expect(hasPersonalizationSignals(result.profile)).toBe(true);
    });

    it("returns false for regular profile", () => {
      const result = parser.parse(`---
schema_version: "1.0"
---

# you.md

## About Me

Regular profile without personalization signals.
`);
      expect(hasPersonalizationSignals(result.profile)).toBe(false);
    });
  });

  describe("getSignalCategories", () => {
    it("returns list of present signal categories", () => {
      const result = parser.parse(PERSONALIZATION_PROFILE);
      const categories = getSignalCategories(result.profile);

      expect(categories).toContain("identity");
      expect(categories).toContain("location");
      expect(categories).toContain("language");
      expect(categories).toContain("device");
      expect(categories).toContain("search_behavior");
      expect(categories).toContain("content");
      expect(categories).toContain("ai_preferences");
      expect(categories).toContain("trust_safety");
      expect(categories).toContain("meta");
    });

    it("returns empty array for non-personalization profile", () => {
      const result = parser.parse(`---
schema_version: "1.0"
---

# you.md

## About Me

No signals here.
`);
      const categories = getSignalCategories(result.profile);
      expect(categories).toEqual([]);
    });
  });

  describe("Section aliases", () => {
    it("recognizes alternate section names", () => {
      const result = parser.parse(`---
schema_version: "1.0"
---

# Profile

## Identity Signals

logged_in: true
trust_score: 0.85

## Location Context

current_country: UK
timezone: Europe/London

## AI Preferences

verbosity: detailed
explanation_depth: deep

## Trust Signals

misinformation_sensitivity: strict
`);

      expect(extractIdentitySignals(result.profile)).toBeDefined();
      expect(extractIdentitySignals(result.profile)?.logged_in).toBe(true);

      expect(extractLocationSignals(result.profile)).toBeDefined();
      expect(extractLocationSignals(result.profile)?.current_country).toBe("UK");

      expect(extractAIPreferences(result.profile)).toBeDefined();
      expect(extractAIPreferences(result.profile)?.verbosity).toBe("detailed");

      expect(extractTrustSafetySignals(result.profile)).toBeDefined();
      expect(extractTrustSafetySignals(result.profile)?.misinformation_sensitivity).toBe("strict");
    });
  });

  describe("Type coercion", () => {
    it("coerces string booleans", () => {
      const result = parser.parse(`---
schema_version: "1.0"
---

# Profile

## Identity

logged_in: yes
child_safe_mode: no
`);
      const signals = extractIdentitySignals(result.profile);
      expect(signals?.logged_in).toBe(true);
      expect(signals?.child_safe_mode).toBe(false);
    });

    it("coerces string numbers", () => {
      const result = parser.parse(`---
schema_version: "1.0"
---

# Profile

## Content Preferences

authority_bias: 0.75
freshness_weight: 0.5
`);
      const signals = extractContentPreferences(result.profile);
      expect(signals?.authority_bias).toBe(0.75);
      expect(signals?.freshness_weight).toBe(0.5);
    });

    it("parses JSON array syntax", () => {
      const result = parser.parse(`---
schema_version: "1.0"
---

# Profile

## Search Behavior

recent_topics: ["topic1", "topic2", "topic3"]
`);
      const signals = extractSearchBehaviorSignals(result.profile);
      expect(signals?.recent_topics).toEqual(["topic1", "topic2", "topic3"]);
    });

    it("parses comma-separated arrays", () => {
      const result = parser.parse(`---
schema_version: "1.0"
---

# Profile

## Language

secondary_languages: es, fr, de
`);
      const signals = extractLanguageSignals(result.profile);
      expect(signals?.secondary_languages).toEqual(["es", "fr", "de"]);
    });
  });
});
