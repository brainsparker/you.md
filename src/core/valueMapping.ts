/**
 * Value mapping for human-friendly field values to internal representations
 *
 * Maps readable strings like "long-form" to numeric values (0.8) for
 * use in ranking algorithms and signal processing.
 */

/**
 * Mapping of field names to their human-friendly value translations
 */
export const VALUE_MAPPINGS: Record<string, Record<string, number>> = {
  // Depth/length preferences
  depth_preference: {
    quick: 0.2,
    brief: 0.3,
    moderate: 0.5,
    thorough: 0.7,
    "long-form": 0.8,
    deep: 0.9,
    exhaustive: 1.0,
  },

  long_form_preference: {
    minimal: 0.1,
    brief: 0.3,
    moderate: 0.5,
    detailed: 0.7,
    "long-form": 0.8,
    comprehensive: 0.9,
  },

  // Expertise levels
  expertise: {
    beginner: 0.2,
    novice: 0.3,
    intermediate: 0.5,
    advanced: 0.7,
    expert: 0.9,
    specialist: 1.0,
  },

  expertise_level: {
    beginner: 0.2,
    novice: 0.3,
    intermediate: 0.5,
    advanced: 0.7,
    expert: 0.9,
    specialist: 1.0,
  },

  // Trust and safety
  fact_checking: {
    relaxed: 0.3,
    standard: 0.5,
    strict: 0.8,
    maximum: 1.0,
  },

  misinformation_sensitivity: {
    low: 0.3,
    standard: 0.5,
    high: 0.8,
    maximum: 1.0,
  },

  source_reliability_threshold: {
    low: 0.3,
    standard: 0.5,
    moderate: 0.6,
    high: 0.8,
    strict: 0.9,
  },

  source_quality: {
    any: 0.2,
    standard: 0.5,
    high: 0.8,
    authoritative: 0.9,
  },

  // Content preferences
  authority_bias: {
    low: 0.2,
    balanced: 0.5,
    moderate: 0.6,
    high: 0.8,
    authoritative: 0.9,
  },

  visual_preference: {
    none: 0.0,
    minimal: 0.2,
    low: 0.3,
    moderate: 0.5,
    high: 0.7,
    visual: 0.9,
  },

  freshness_weight: {
    archived: 0.1,
    low: 0.3,
    moderate: 0.5,
    fresh: 0.7,
    latest: 0.9,
  },

  // Personalization weight
  personalization_weight: {
    minimal: 0.2,
    low: 0.4,
    moderate: 0.6,
    high: 0.8,
    maximum: 1.0,
  },
};

/**
 * Field name aliases - maps human-friendly names to internal field names
 */
export const FIELD_ALIASES: Record<string, string> = {
  // Human-friendly -> internal
  expertise: "expertise_level",
  "content depth": "long_form_preference",
  "depth preference": "long_form_preference",
  "fact-checking": "misinformation_sensitivity",
  "source quality": "source_reliability_threshold",
  "trusted sources": "preferred_sources",
  "blocked sources": "blocked_sources",
  "visual content": "visual_preference",
  topics: "recent_topics",
  language: "primary_language",
  timezone: "timezone",
  accessibility: "accessibility_features",
};

/**
 * Normalize a field name to its internal representation
 */
export function normalizeFieldName(field: string): string {
  const normalized = field.toLowerCase().trim();
  return FIELD_ALIASES[normalized] ?? normalized.replace(/\s+/g, "_");
}

/**
 * Normalize a human-friendly value to its internal representation
 *
 * @param field - The field name (human-friendly or internal)
 * @param value - The value to normalize
 * @returns The normalized numeric value, or the original value if no mapping exists
 */
export function normalizeValue(
  field: string,
  value: string | number | boolean
): number | string | boolean {
  // If already a number or boolean, return as-is
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  const normalizedField = normalizeFieldName(field);
  const normalizedValue = value.toLowerCase().trim();

  // Check if we have a mapping for this field
  const fieldMappings = VALUE_MAPPINGS[normalizedField];
  if (fieldMappings && normalizedValue in fieldMappings) {
    return fieldMappings[normalizedValue];
  }

  // Return original value if no mapping found
  return value;
}

/**
 * Convert a numeric value back to a human-friendly string
 *
 * @param field - The field name
 * @param value - The numeric value
 * @returns The closest human-friendly string representation
 */
export function humanizeValue(field: string, value: number): string {
  const normalizedField = normalizeFieldName(field);
  const fieldMappings = VALUE_MAPPINGS[normalizedField];

  if (!fieldMappings) {
    return String(value);
  }

  // Find the closest matching value
  let closestKey = "";
  let closestDiff = Infinity;

  for (const [key, numValue] of Object.entries(fieldMappings)) {
    const diff = Math.abs(numValue - value);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestKey = key;
    }
  }

  return closestKey || String(value);
}

/**
 * Check if a field has value mappings available
 */
export function hasValueMapping(field: string): boolean {
  const normalizedField = normalizeFieldName(field);
  return normalizedField in VALUE_MAPPINGS;
}
