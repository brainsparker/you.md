import type { YouMdProfile, YouMdSection, YouMdField } from "../types/profile";
import type { MergeOptions } from "../types/options";
import { CURRENT_SCHEMA_VERSION } from "../utils/constants";

/**
 * Merge multiple profiles into a single profile.
 * Later profiles in the array override earlier ones.
 *
 * Use this to combine user-level preferences with project-level overrides:
 * ```typescript
 * const merged = mergeProfiles([userProfile, projectProfile]);
 * // projectProfile values take precedence
 * ```
 *
 * @param profiles - Profiles to merge (in priority order, last wins)
 * @param options - Merge configuration
 * @returns Merged profile
 */
export function mergeProfiles(
  profiles: YouMdProfile[],
  options?: MergeOptions
): YouMdProfile {
  if (profiles.length === 0) {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      metadata: { schemaVersion: CURRENT_SCHEMA_VERSION },
      sections: new Map(),
      rawContent: "",
    };
  }

  if (profiles.length === 1) {
    return profiles[0];
  }

  const arrayMerge = options?.arrayMerge ?? "replace";
  const excludeSections = new Set(
    (options?.excludeSections ?? []).map((s) => s.toLowerCase())
  );

  // Start with empty profile
  let mergedMetadata: Record<string, unknown> = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
  let mergedSections = new Map<string, YouMdSection>();
  const rawContents: string[] = [];

  // Merge each profile
  for (const profile of profiles) {
    // Merge metadata (later values override)
    mergedMetadata = {
      ...mergedMetadata,
      ...profile.metadata,
    };

    // Merge sections
    for (const [key, section] of profile.sections) {
      if (excludeSections.has(key)) {
        continue;
      }

      const existingSection = mergedSections.get(key);
      if (existingSection) {
        // Merge sections
        mergedSections.set(
          key,
          mergeSections(existingSection, section, arrayMerge)
        );
      } else {
        // Add new section
        mergedSections.set(key, section);
      }
    }

    // Accumulate raw content
    if (profile.rawContent) {
      rawContents.push(profile.rawContent);
    }
  }

  // Use the highest schema version found
  const schemaVersion = profiles.reduce((max, profile) => {
    return compareVersions(profile.schemaVersion, max) > 0
      ? profile.schemaVersion
      : max;
  }, CURRENT_SCHEMA_VERSION);

  return {
    schemaVersion,
    metadata: {
      ...mergedMetadata,
      schemaVersion,
    },
    sections: mergedSections,
    rawContent: rawContents.join("\n\n---\n\n"),
  };
}

/**
 * Merge two sections, with the second section taking precedence
 */
function mergeSections(
  base: YouMdSection,
  override: YouMdSection,
  arrayMerge: "replace" | "concat" | "unique"
): YouMdSection {
  // Merge fields
  const mergedFields = new Map<string, YouMdField>(base.fields);

  for (const [key, field] of override.fields) {
    const existingField = mergedFields.get(key);

    if (existingField && Array.isArray(existingField.value) && Array.isArray(field.value)) {
      // Handle array merging based on strategy
      let mergedValue: string[];

      switch (arrayMerge) {
        case "concat":
          mergedValue = [
            ...(existingField.value as string[]),
            ...(field.value as string[]),
          ];
          break;
        case "unique":
          mergedValue = [
            ...new Set([
              ...(existingField.value as string[]),
              ...(field.value as string[]),
            ]),
          ];
          break;
        case "replace":
        default:
          mergedValue = field.value as string[];
      }

      mergedFields.set(key, {
        ...field,
        value: mergedValue,
      });
    } else {
      // Non-array or different types: override wins
      mergedFields.set(key, field);
    }
  }

  // Merge subsections recursively
  const mergedSubsections = mergeSubsections(
    base.subsections,
    override.subsections,
    arrayMerge
  );

  // Prefer override's content if it exists
  const content = override.content || base.content;

  return {
    title: override.title || base.title,
    normalizedTitle: override.normalizedTitle || base.normalizedTitle,
    level: override.level,
    content,
    fields: mergedFields,
    subsections: mergedSubsections,
    startLine: override.startLine ?? base.startLine,
    endLine: override.endLine ?? base.endLine,
  };
}

/**
 * Merge subsection arrays
 */
function mergeSubsections(
  base: YouMdSection[],
  override: YouMdSection[],
  arrayMerge: "replace" | "concat" | "unique"
): YouMdSection[] {
  // Create a map of base subsections by normalized title
  const baseMap = new Map<string, YouMdSection>();
  for (const section of base) {
    baseMap.set(section.normalizedTitle, section);
  }

  // Process override subsections
  const result: YouMdSection[] = [];
  const processed = new Set<string>();

  for (const section of override) {
    const baseSection = baseMap.get(section.normalizedTitle);

    if (baseSection) {
      // Merge with base section
      result.push(mergeSections(baseSection, section, arrayMerge));
    } else {
      // New section from override
      result.push(section);
    }

    processed.add(section.normalizedTitle);
  }

  // Add base sections that weren't in override
  for (const section of base) {
    if (!processed.has(section.normalizedTitle)) {
      result.push(section);
    }
  }

  return result;
}

/**
 * Compare two semver-like version strings
 * Returns: negative if a < b, 0 if equal, positive if a > b
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map((n) => parseInt(n, 10) || 0);
  const bParts = b.split(".").map((n) => parseInt(n, 10) || 0);

  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;

    if (aVal !== bVal) {
      return aVal - bVal;
    }
  }

  return 0;
}
