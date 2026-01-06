import type { YouMdProfile } from "../types/profile";
import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from "../types/options";
import {
  SUPPORTED_SCHEMA_VERSIONS,
  KNOWN_SECTIONS,
  SENSITIVE_PATTERNS,
} from "../utils/constants";

/**
 * Validate a you.md profile against schema requirements.
 *
 * @param profile - Profile to validate
 * @returns Validation result with errors and warnings
 */
export function validateProfile(profile: YouMdProfile): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check schema version
  validateSchemaVersion(profile, errors);

  // Check for unknown sections
  validateSections(profile, warnings);

  // Check for sensitive data
  checkSensitiveData(profile, warnings);

  // Check metadata fields
  validateMetadata(profile, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate schema version
 */
function validateSchemaVersion(
  profile: YouMdProfile,
  errors: ValidationError[]
): void {
  const version = profile.schemaVersion;

  if (!version) {
    errors.push({
      code: "MISSING_SCHEMA_VERSION",
      message: "Missing required schema_version field in frontmatter",
      path: "metadata.schema_version",
    });
    return;
  }

  // Check version format
  if (!/^\d+\.\d+$/.test(version)) {
    errors.push({
      code: "INVALID_SCHEMA_VERSION",
      message: `Invalid schema_version format: "${version}". Expected format: "MAJOR.MINOR"`,
      path: "metadata.schema_version",
    });
    return;
  }

  // Check if version is supported
  const majorVersion = version.split(".")[0];
  const isSupported = SUPPORTED_SCHEMA_VERSIONS.some(
    (v) => v.split(".")[0] === majorVersion
  );

  if (!isSupported) {
    errors.push({
      code: "UNSUPPORTED_SCHEMA_VERSION",
      message: `Unsupported schema version: "${version}". Supported major versions: ${SUPPORTED_SCHEMA_VERSIONS.map((v) => v.split(".")[0]).join(", ")}`,
      path: "metadata.schema_version",
    });
  }
}

/**
 * Validate sections and warn about unknown ones
 */
function validateSections(
  profile: YouMdProfile,
  warnings: ValidationWarning[]
): void {
  const knownSectionsSet = new Set(KNOWN_SECTIONS);

  for (const [key, section] of profile.sections) {
    // Check for empty sections
    if (!section.content && section.fields.size === 0 && section.subsections.length === 0) {
      warnings.push({
        code: "EMPTY_SECTION",
        message: `Section "${section.title}" is empty`,
        path: `sections.${key}`,
        suggestion: "Consider adding content or removing the section",
      });
    }

    // Check for unknown top-level sections
    if (!knownSectionsSet.has(key) && section.level <= 2) {
      warnings.push({
        code: "UNKNOWN_SECTION",
        message: `Unknown section: "${section.title}"`,
        path: `sections.${key}`,
        suggestion:
          "This section will be preserved but may not be recognized by all tools",
      });
    }
  }

  // Check for duplicate sections (by title, different case)
  const sectionTitles = new Map<string, string>();
  for (const [key, section] of profile.sections) {
    const existing = sectionTitles.get(key);
    if (existing && existing !== section.title) {
      warnings.push({
        code: "DUPLICATE_SECTION",
        message: `Duplicate section with different casing: "${existing}" and "${section.title}"`,
        path: `sections.${key}`,
      });
    }
    sectionTitles.set(key, section.title);
  }
}

/**
 * Check for potentially sensitive data
 */
function checkSensitiveData(
  profile: YouMdProfile,
  warnings: ValidationWarning[]
): void {
  const content = profile.rawContent;

  for (const pattern of SENSITIVE_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      warnings.push({
        code: "POSSIBLE_SENSITIVE_DATA",
        message: `Possible sensitive data detected: "${match[0].slice(0, 30)}..."`,
        suggestion:
          "Review the content and ensure no secrets, API keys, or credentials are included",
      });
    }
  }
}

/**
 * Validate metadata fields
 */
function validateMetadata(
  profile: YouMdProfile,
  _errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const metadata = profile.metadata;

  // Validate date formats
  if (metadata.created && !isValidDateFormat(metadata.created)) {
    warnings.push({
      code: "INVALID_DATE_FORMAT",
      message: `Invalid date format for "created": "${metadata.created}"`,
      path: "metadata.created",
      suggestion: "Use ISO 8601 format: YYYY-MM-DD",
    });
  }

  if (metadata.lastUpdated && !isValidDateFormat(metadata.lastUpdated)) {
    warnings.push({
      code: "INVALID_DATE_FORMAT",
      message: `Invalid date format for "last_updated": "${metadata.lastUpdated}"`,
      path: "metadata.last_updated",
      suggestion: "Use ISO 8601 format: YYYY-MM-DD",
    });
  }

  // Validate privacy level
  if (
    metadata.privacyLevel &&
    !["public", "private", "authenticated"].includes(metadata.privacyLevel)
  ) {
    warnings.push({
      code: "DEPRECATED_FIELD",
      message: `Invalid privacy_level: "${metadata.privacyLevel}"`,
      path: "metadata.privacy_level",
      suggestion: 'Valid values: "public", "private", "authenticated"',
    });
  }

  // Validate TTL
  if (metadata.ttl !== undefined) {
    if (typeof metadata.ttl !== "number" || metadata.ttl < 0) {
      warnings.push({
        code: "DEPRECATED_FIELD",
        message: `Invalid ttl value: "${metadata.ttl}"`,
        path: "metadata.ttl",
        suggestion: "TTL must be a positive number (seconds)",
      });
    }
  }

  // Validate tags
  if (metadata.tags !== undefined) {
    if (!Array.isArray(metadata.tags)) {
      warnings.push({
        code: "DEPRECATED_FIELD",
        message: "Tags must be an array",
        path: "metadata.tags",
        suggestion: 'Use array format: tags: ["coding", "python"]',
      });
    }
  }
}

/**
 * Check if a string is a valid ISO 8601 date format
 */
function isValidDateFormat(dateStr: string): boolean {
  // Accept YYYY-MM-DD or full ISO 8601
  const datePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
  return datePattern.test(dateStr);
}

/**
 * Quick validation check - returns true if profile is minimally valid
 */
export function isValidProfile(profile: YouMdProfile): boolean {
  const result = validateProfile(profile);
  return result.valid;
}
