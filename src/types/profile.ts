/**
 * Represents a parsed you.md profile
 */
export interface YouMdProfile {
  /** The schema version from frontmatter */
  readonly schemaVersion: string;

  /** Profile metadata from YAML frontmatter */
  readonly metadata: ProfileMetadata;

  /** Parsed sections keyed by normalized name (lowercase) */
  readonly sections: Map<string, YouMdSection>;

  /** Original raw content */
  readonly rawContent: string;

  /** Source file path if loaded from filesystem */
  readonly sourcePath?: string;

  /** Source URL if loaded from remote */
  readonly sourceUrl?: string;
}

/**
 * Profile metadata from YAML frontmatter
 */
export interface ProfileMetadata {
  /** Required: Schema version (e.g., "1.0") */
  readonly schemaVersion: string;

  /** Optional: ISO 8601 date when profile was created */
  readonly created?: string;

  /** Optional: ISO 8601 date when profile was last updated */
  readonly lastUpdated?: string;

  /** Optional: Privacy level for sharing */
  readonly privacyLevel?: "public" | "private" | "authenticated";

  /** Optional: Unique profile identifier */
  readonly profileId?: string;

  /** Optional: Parent profile URL/path for inheritance */
  readonly extends?: string;

  /** Optional: Cache duration in seconds */
  readonly ttl?: number;

  /** Optional: Profile author name */
  readonly author?: string;

  /** Optional: Categorization tags */
  readonly tags?: string[];

  /** Allow additional custom fields */
  readonly [key: string]: unknown;
}

/**
 * Represents a markdown section (h1-h6)
 */
export interface YouMdSection {
  /** Section title (header text) */
  readonly title: string;

  /** Normalized title (lowercase, trimmed) for lookup */
  readonly normalizedTitle: string;

  /** Header level (1-6) */
  readonly level: number;

  /** Raw content of the section (excluding header) */
  readonly content: string;

  /** Parsed key-value fields from the section */
  readonly fields: Map<string, YouMdField>;

  /** Nested subsections */
  readonly subsections: YouMdSection[];

  /** Starting line number in source (1-indexed) */
  readonly startLine?: number;

  /** Ending line number in source (1-indexed) */
  readonly endLine?: number;
}

/**
 * Represents a key-value field within a section
 */
export interface YouMdField {
  /** Field key/name */
  readonly key: string;

  /** Parsed value (string, array, boolean, or number) */
  readonly value: string | string[] | boolean | number;

  /** Original raw value as string */
  readonly rawValue: string;

  /** Line number where field was found */
  readonly line?: number;
}

/**
 * Empty/default profile for when no you.md is found
 */
export function createEmptyProfile(): YouMdProfile {
  return {
    schemaVersion: "1.0",
    metadata: { schemaVersion: "1.0" },
    sections: new Map(),
    rawContent: "",
  };
}
