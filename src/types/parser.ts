import type { YouMdProfile } from "./profile";
import type {
  DiscoveryOptions,
  FetchOptions,
  ParseOptions,
  MergeOptions,
  ValidationResult,
} from "./options";

/**
 * Main parser interface for you.md files
 */
export interface YouMdParser {
  /**
   * Parse a you.md string into a structured profile.
   * Never throws - returns partial results with errors on failure.
   *
   * @param content - Raw you.md file content
   * @param options - Optional parsing options
   * @returns Parsed profile (may be partial if errors occurred)
   */
  parse(content: string, options?: ParseOptions): ParseResult;

  /**
   * Load and parse a you.md file from the filesystem.
   *
   * @param path - Absolute or relative file path
   * @param options - Optional parsing options
   * @returns Parsed profile or null if file not found
   */
  loadFromPath(path: string, options?: ParseOptions): Promise<ParseResult>;

  /**
   * Load and parse a you.md file from a URL.
   *
   * @param url - HTTPS URL to fetch
   * @param fetchOptions - Optional fetch configuration
   * @param parseOptions - Optional parsing options
   * @returns Parsed profile
   */
  loadFromUrl(
    url: string,
    fetchOptions?: FetchOptions,
    parseOptions?: ParseOptions
  ): Promise<ParseResult>;

  /**
   * Discover and load you.md files based on precedence rules.
   *
   * Discovery order (first found wins):
   * 1. Explicit path in options
   * 2. Environment variable (YOU_MD_PATH)
   * 3. Project-local (./.you.md)
   * 4. User-global (~/.you.md)
   * 5. XDG config (~/.config/you.md)
   * 6. Remote URL (if enabled)
   *
   * @param options - Discovery configuration
   * @returns Parsed profile or null if not found
   */
  discover(options?: DiscoveryOptions): Promise<ParseResult | null>;

  /**
   * Merge multiple profiles. Later profiles override earlier ones.
   * Useful for combining user-level and project-level preferences.
   *
   * @param profiles - Profiles to merge (in priority order)
   * @param options - Optional merge configuration
   * @returns Merged profile
   */
  merge(profiles: YouMdProfile[], options?: MergeOptions): YouMdProfile;

  /**
   * Validate a profile against schema version constraints.
   *
   * @param profile - Profile to validate
   * @returns Validation result with errors and warnings
   */
  validate(profile: YouMdProfile): ValidationResult;
}

/**
 * Result of parsing a you.md file
 */
export interface ParseResult {
  /** Parsed profile (may be partial if errors occurred) */
  readonly profile: YouMdProfile;

  /** Whether parsing was fully successful */
  readonly success: boolean;

  /** Parse errors encountered */
  readonly errors: ParseError[];

  /** Parse warnings */
  readonly warnings: ParseWarning[];
}

/**
 * An error encountered during parsing
 */
export interface ParseError {
  /** Error code for programmatic handling */
  readonly code: ParseErrorCode;

  /** Human-readable error message */
  readonly message: string;

  /** Line number in source (1-indexed) */
  readonly line?: number;

  /** Column number in source (1-indexed) */
  readonly column?: number;
}

/**
 * A warning encountered during parsing
 */
export interface ParseWarning {
  /** Warning code */
  readonly code: ParseWarningCode;

  /** Human-readable warning message */
  readonly message: string;

  /** Line number in source (1-indexed) */
  readonly line?: number;
}

/**
 * Parse error codes
 */
export type ParseErrorCode =
  | "FILE_NOT_FOUND"
  | "FILE_TOO_LARGE"
  | "INVALID_ENCODING"
  | "INVALID_FRONTMATTER"
  | "INVALID_YAML"
  | "MISSING_SCHEMA_VERSION"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "PERMISSION_DENIED";

/**
 * Parse warning codes
 */
export type ParseWarningCode =
  | "EMPTY_FILE"
  | "NO_FRONTMATTER"
  | "EMPTY_SECTION"
  | "MALFORMED_FIELD"
  | "UNKNOWN_FIELD_TYPE";
