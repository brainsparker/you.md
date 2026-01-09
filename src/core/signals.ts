/**
 * Signal extraction utilities for personalization profiles
 */

import type { YouMdProfile, YouMdSection, YouMdField } from "../types/profile.js";
import type {
  IdentitySignals,
  LocationSignals,
  LanguageSignals,
  DeviceSignals,
  SearchBehaviorSignals,
  ContentPreferences,
  AIResponsePreferences,
  TrustSafetySignals,
  PersonalizationMeta,
  PersonalizationProfile,
} from "../types/preferences.js";

/**
 * Section name mappings for signal extraction
 */
const SECTION_ALIASES: Record<string, string[]> = {
  identity: ["identity", "identity signals"],
  location: ["location", "location context"],
  language: ["language", "language preferences"],
  device: ["device", "device context"],
  search_behavior: ["search behavior", "search signals"],
  content: ["content preferences", "content"],
  ai_preferences: ["ai preferences", "ai response preferences"],
  trust_safety: ["trust and safety", "trust safety", "trust signals"],
  meta: ["personalization meta", "meta"],
};

/**
 * Find a section by checking multiple possible names
 */
function findSection(
  profile: YouMdProfile,
  aliases: string[]
): YouMdSection | undefined {
  for (const alias of aliases) {
    const section = profile.sections.get(alias);
    if (section) return section;
  }
  return undefined;
}

/**
 * Extract a field value from a section, with type coercion
 */
function getField<T>(
  section: YouMdSection | undefined,
  key: string,
  transform?: (value: YouMdField["value"]) => T
): T | undefined {
  if (!section) return undefined;
  const field = section.fields.get(key);
  if (!field) return undefined;
  if (transform) return transform(field.value);
  return field.value as T;
}

/**
 * Convert a value to boolean
 */
function toBoolean(value: YouMdField["value"]): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "1") return true;
    if (lower === "false" || lower === "no" || lower === "0") return false;
  }
  return undefined;
}

/**
 * Convert a value to number
 */
function toNumber(value: YouMdField["value"]): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const num = parseFloat(value);
    if (!isNaN(num)) return num;
  }
  return undefined;
}

/**
 * Convert a value to string array
 */
function toStringArray(value: YouMdField["value"]): string[] | undefined {
  if (Array.isArray(value)) {
    // Check if the array contains a single JSON-like string that needs parsing
    if (value.length > 0 && typeof value[0] === "string") {
      const firstStr = value[0];
      // If the first item looks like a JSON array fragment, try to reconstruct and parse
      if (firstStr.startsWith("[")) {
        try {
          const reconstructed = value.join(",");
          const parsed = JSON.parse(reconstructed);
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch {
          // Fall through to normal mapping
        }
      }
    }
    return value.map(String);
  }
  if (typeof value === "string") {
    // Handle JSON array syntax
    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // Fall through to comma split
      }
    }
    // Handle comma-separated values
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

/**
 * Convert a value to Record<string, number>
 */
function toNumberRecord(
  value: YouMdField["value"]
): Record<string, number> | undefined {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null) {
        const result: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "number") result[k] = v;
        }
        return Object.keys(result).length > 0 ? result : undefined;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Extract all fields from a section as a typed object
 */
function extractSectionFields<T>(
  section: YouMdSection | undefined,
  fieldMappings: Record<
    string,
    { key: string; transform?: (v: YouMdField["value"]) => unknown }
  >
): Partial<T> {
  if (!section) return {};
  const result: Record<string, unknown> = {};
  for (const [resultKey, mapping] of Object.entries(fieldMappings)) {
    const value = getField(section, mapping.key, mapping.transform);
    if (value !== undefined) {
      result[resultKey] = value;
    }
  }
  return result as Partial<T>;
}

/**
 * Extract identity signals from a profile
 */
export function extractIdentitySignals(
  profile: YouMdProfile
): IdentitySignals | undefined {
  const section = findSection(profile, SECTION_ALIASES.identity);
  if (!section) return undefined;

  const signals = extractSectionFields<IdentitySignals>(section, {
    logged_in: { key: "logged_in", transform: toBoolean },
    account_age_days: { key: "account_age_days", transform: toNumber },
    trust_score: { key: "trust_score", transform: toNumber },
    verified_level: { key: "verified_level" },
    age_range: { key: "age_range" },
    child_safe_mode: { key: "child_safe_mode", transform: toBoolean },
    parental_controls: { key: "parental_controls", transform: toBoolean },
  });

  return Object.keys(signals).length > 0 ? signals : undefined;
}

/**
 * Extract location signals from a profile
 */
export function extractLocationSignals(
  profile: YouMdProfile
): LocationSignals | undefined {
  const section = findSection(profile, SECTION_ALIASES.location);
  if (!section) return undefined;

  const signals = extractSectionFields<LocationSignals>(section, {
    current_country: { key: "current_country" },
    current_region: { key: "current_region" },
    home_country: { key: "home_country" },
    home_region: { key: "home_region" },
    timezone: { key: "timezone" },
    regulatory_region: { key: "regulatory_region" },
  });

  return Object.keys(signals).length > 0 ? signals : undefined;
}

/**
 * Extract language signals from a profile
 */
export function extractLanguageSignals(
  profile: YouMdProfile
): LanguageSignals | undefined {
  const section = findSection(profile, SECTION_ALIASES.language);
  if (!section) return undefined;

  const signals = extractSectionFields<LanguageSignals>(section, {
    primary_language: { key: "primary_language" },
    secondary_languages: { key: "secondary_languages", transform: toStringArray },
    spelling_variant: { key: "spelling_variant" },
    reading_level: { key: "reading_level" },
    translation_enabled: { key: "translation_enabled", transform: toBoolean },
  });

  return Object.keys(signals).length > 0 ? signals : undefined;
}

/**
 * Extract device signals from a profile
 */
export function extractDeviceSignals(
  profile: YouMdProfile
): DeviceSignals | undefined {
  const section = findSection(profile, SECTION_ALIASES.device);
  if (!section) return undefined;

  const signals = extractSectionFields<DeviceSignals>(section, {
    device_type: { key: "device_type" },
    os: { key: "os" },
    browser: { key: "browser" },
    screen_size: { key: "screen_size" },
    input_method: { key: "input_method" },
    connection_type: { key: "connection_type" },
    connection_speed: { key: "connection_speed" },
    accessibility_features: { key: "accessibility_features", transform: toStringArray },
  });

  return Object.keys(signals).length > 0 ? signals : undefined;
}

/**
 * Extract search behavior signals from a profile
 */
export function extractSearchBehaviorSignals(
  profile: YouMdProfile
): SearchBehaviorSignals | undefined {
  const section = findSection(profile, SECTION_ALIASES.search_behavior);
  if (!section) return undefined;

  const signals = extractSectionFields<SearchBehaviorSignals>(section, {
    recent_topics: { key: "recent_topics", transform: toStringArray },
    long_term_topics: { key: "long_term_topics", transform: toStringArray },
    topic_frequency: { key: "topic_frequency", transform: toNumberRecord },
    search_depth: { key: "search_depth" },
    reformulation_rate: { key: "reformulation_rate" },
    result_click_depth: { key: "result_click_depth", transform: toNumber },
    avg_time_on_result: { key: "avg_time_on_result", transform: toNumber },
  });

  return Object.keys(signals).length > 0 ? signals : undefined;
}

/**
 * Extract content preferences from a profile
 */
export function extractContentPreferences(
  profile: YouMdProfile
): ContentPreferences | undefined {
  const section = findSection(profile, SECTION_ALIASES.content);
  if (!section) return undefined;

  const signals = extractSectionFields<ContentPreferences>(section, {
    preferred_sources: { key: "preferred_sources", transform: toStringArray },
    blocked_sources: { key: "blocked_sources", transform: toStringArray },
    authority_bias: { key: "authority_bias", transform: toNumber },
    visual_preference: { key: "visual_preference", transform: toNumber },
    long_form_preference: { key: "long_form_preference", transform: toNumber },
    freshness_weight: { key: "freshness_weight", transform: toNumber },
    expertise_level: { key: "expertise_level" },
    expertise_by_topic: { key: "expertise_by_topic" },
  });

  return Object.keys(signals).length > 0 ? signals : undefined;
}

/**
 * Extract AI response preferences from a profile
 */
export function extractAIPreferences(
  profile: YouMdProfile
): AIResponsePreferences | undefined {
  const section = findSection(profile, SECTION_ALIASES.ai_preferences);
  if (!section) return undefined;

  const signals = extractSectionFields<AIResponsePreferences>(section, {
    verbosity: { key: "verbosity" },
    explanation_depth: { key: "explanation_depth" },
    include_examples: { key: "include_examples", transform: toBoolean },
    example_language: { key: "example_language" },
    code_comments: { key: "code_comments" },
    response_format: { key: "response_format" },
    math_notation: { key: "math_notation" },
    citation_style: { key: "citation_style" },
  });

  return Object.keys(signals).length > 0 ? signals : undefined;
}

/**
 * Extract trust and safety signals from a profile
 */
export function extractTrustSafetySignals(
  profile: YouMdProfile
): TrustSafetySignals | undefined {
  const section = findSection(profile, SECTION_ALIASES.trust_safety);
  if (!section) return undefined;

  const signals = extractSectionFields<TrustSafetySignals>(section, {
    misinformation_sensitivity: { key: "misinformation_sensitivity" },
    source_reliability_threshold: {
      key: "source_reliability_threshold",
      transform: toNumber,
    },
    content_warning_level: { key: "content_warning_level" },
    medical_legal_caution: { key: "medical_legal_caution" },
    fact_check_preference: { key: "fact_check_preference" },
  });

  return Object.keys(signals).length > 0 ? signals : undefined;
}

/**
 * Extract personalization metadata from a profile
 */
export function extractPersonalizationMeta(
  profile: YouMdProfile
): PersonalizationMeta | undefined {
  const section = findSection(profile, SECTION_ALIASES.meta);
  if (!section) return undefined;

  const signals = extractSectionFields<PersonalizationMeta>(section, {
    last_profile_update: { key: "last_profile_update" },
    signal_confidence: { key: "signal_confidence", transform: toNumberRecord },
    decay_rate: { key: "decay_rate", transform: toNumber },
    personalization_weight: { key: "personalization_weight", transform: toNumber },
    active_experiments: { key: "active_experiments", transform: toStringArray },
    profile_version: { key: "profile_version" },
  });

  return Object.keys(signals).length > 0 ? signals : undefined;
}

/**
 * Extract all personalization signals from a profile
 */
export function extractAllSignals(
  profile: YouMdProfile
): PersonalizationProfile {
  const result: PersonalizationProfile = {};

  const identity = extractIdentitySignals(profile);
  if (identity) (result as { identity?: IdentitySignals }).identity = identity;

  const location = extractLocationSignals(profile);
  if (location) (result as { location?: LocationSignals }).location = location;

  const language = extractLanguageSignals(profile);
  if (language) (result as { language?: LanguageSignals }).language = language;

  const device = extractDeviceSignals(profile);
  if (device) (result as { device?: DeviceSignals }).device = device;

  const search_behavior = extractSearchBehaviorSignals(profile);
  if (search_behavior)
    (result as { search_behavior?: SearchBehaviorSignals }).search_behavior =
      search_behavior;

  const content = extractContentPreferences(profile);
  if (content) (result as { content?: ContentPreferences }).content = content;

  const ai_preferences = extractAIPreferences(profile);
  if (ai_preferences)
    (result as { ai_preferences?: AIResponsePreferences }).ai_preferences =
      ai_preferences;

  const trust_safety = extractTrustSafetySignals(profile);
  if (trust_safety)
    (result as { trust_safety?: TrustSafetySignals }).trust_safety =
      trust_safety;

  const meta = extractPersonalizationMeta(profile);
  if (meta) (result as { meta?: PersonalizationMeta }).meta = meta;

  return result;
}

/**
 * Check if a profile contains personalization signals
 */
export function hasPersonalizationSignals(profile: YouMdProfile): boolean {
  for (const aliases of Object.values(SECTION_ALIASES)) {
    if (findSection(profile, aliases)) return true;
  }
  return false;
}

/**
 * Get a list of which signal categories are present in a profile
 */
export function getSignalCategories(profile: YouMdProfile): string[] {
  const categories: string[] = [];
  for (const [category, aliases] of Object.entries(SECTION_ALIASES)) {
    if (findSection(profile, aliases)) {
      categories.push(category);
    }
  }
  return categories;
}
