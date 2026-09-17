/**
 * Options for discovering you.md files
 */
export interface DiscoveryOptions {
  /** Explicit file path (highest priority) */
  readonly path?: string;

  /** Environment variable name to check (default: YOU_MD_PATH) */
  readonly envVar?: string;

  /** Working directory for relative path resolution */
  readonly cwd?: string;

  /** Custom search paths in priority order */
  readonly searchPaths?: string[];

  /** Skip automatic discovery, only use explicit path */
  readonly skipDiscovery?: boolean;

  /** Include remote URLs in discovery */
  readonly enableRemote?: boolean;

  /** Remote URL to fetch if local not found */
  readonly remoteUrl?: string;
}

/**
 * Options for fetching remote you.md files
 */
export interface FetchOptions {
  /** Request timeout in milliseconds (default: 5000) */
  readonly timeout?: number;

  /** Additional HTTP headers */
  readonly headers?: Record<string, string>;

  /** Authentication token for protected profiles */
  readonly authToken?: string;
}

/**
 * Options for parsing you.md content
 */
export interface ParseOptions {
  /** Maximum file size in bytes (default: 102400 = 100KB) */
  readonly maxFileSize?: number;

  /** Maximum parse time in milliseconds (default: 50) */
  readonly maxParseTime?: number;

  /** Whether to validate against schema (default: true) */
  readonly validate?: boolean;

  /** Whether to preserve raw section content (default: true) */
  readonly preserveRawContent?: boolean;

  /**
   * Whether to resolve the `extends` frontmatter field when loading a
   * profile from a path or URL (default: true). When resolved, the base
   * profile chain is loaded and merged underneath the profile, with the
   * loaded profile winning on conflicts.
   */
  readonly resolveExtends?: boolean;

  /**
   * Allow `extends` to point at an HTTPS URL (default: false, or true when
   * the YOU_MD_ALLOW_REMOTE_EXTENDS environment variable is set to 1 or true).
   * Remote bases are opt-in because a project-local profile in a cloned
   * repository could otherwise pull instructions from anywhere.
   */
  readonly allowRemoteExtends?: boolean;

  /** Maximum length of the `extends` chain (default: 5) */
  readonly maxExtendsDepth?: number;
}

/**
 * Options for merging profiles
 */
export interface MergeOptions {
  /** How to handle array fields */
  readonly arrayMerge?: "replace" | "concat" | "unique";

  /** How to handle conflicting fields */
  readonly conflictResolution?: "later_wins" | "first_wins" | "error";

  /** Sections to exclude from merge */
  readonly excludeSections?: string[];
}

/**
 * Result of profile validation
 */
export interface ValidationResult {
  /** Whether the profile is valid */
  readonly valid: boolean;

  /** Validation errors (prevent usage) */
  readonly errors: ValidationError[];

  /** Validation warnings (allow usage but indicate issues) */
  readonly warnings: ValidationWarning[];
}

/**
 * A validation error
 */
export interface ValidationError {
  /** Error code for programmatic handling */
  readonly code: ValidationErrorCode;

  /** Human-readable error message */
  readonly message: string;

  /** JSON path to the problematic field */
  readonly path?: string;

  /** Line number in source file */
  readonly line?: number;

  /** Column number in source file */
  readonly column?: number;
}

/**
 * A validation warning
 */
export interface ValidationWarning {
  /** Warning code for programmatic handling */
  readonly code: ValidationWarningCode;

  /** Human-readable warning message */
  readonly message: string;

  /** JSON path to the problematic field */
  readonly path?: string;

  /** Suggested fix */
  readonly suggestion?: string;
}

/**
 * Validation error codes
 */
export type ValidationErrorCode =
  | "MISSING_SCHEMA_VERSION"
  | "INVALID_SCHEMA_VERSION"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_FRONTMATTER"
  | "INVALID_YAML"
  | "FILE_TOO_LARGE"
  | "PARSE_TIMEOUT"
  | "INVALID_FIELD_TYPE"
  | "REQUIRED_FIELD_MISSING";

/**
 * Validation warning codes
 */
export type ValidationWarningCode =
  | "UNKNOWN_SECTION"
  | "DEPRECATED_FIELD"
  | "POSSIBLE_SENSITIVE_DATA"
  | "EMPTY_SECTION"
  | "DUPLICATE_SECTION"
  | "INVALID_DATE_FORMAT"
  | "LARGE_FILE_SIZE";
