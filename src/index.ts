// Main library exports for you-md

// Parser
export { createParser, YouMdParserImpl } from "./parser";
export type { YouMdParser } from "./types/parser";

// Types
export type {
  YouMdProfile,
  ProfileMetadata,
  YouMdSection,
  YouMdField,
} from "./types/profile";
export { createEmptyProfile } from "./types/profile";

// Preferences
export type {
  CodingPreferences,
  LanguagePreferences,
  StylePreferences,
  ArchitecturePreferences,
  TestingPreferences,
  DocumentationPreferences,
  CommunicationPreferences,
  CodeGenerationPreferences,
  CodeReviewPreferences,
} from "./types/preferences";

// Options
export type {
  DiscoveryOptions,
  FetchOptions,
  ParseOptions,
  MergeOptions,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from "./types/options";

// Parse results
export type { ParseResult, ParseError, ParseWarning } from "./types/parser";

// Core functions
export { discoverProfilePath, getDefaultSearchPaths } from "./core/discovery";
export { mergeProfiles } from "./core/merger";
export { validateProfile, isValidProfile } from "./core/validator";

// Low-level parsers (for advanced use)
export { extractFrontmatter } from "./parser/frontmatter";
export { parseYaml } from "./parser/yaml";
export { extractSections, findSection, flattenSections } from "./parser/markdown";

// Errors
export {
  YouMdError,
  YouMdFileError,
  YouMdSizeError,
  YouMdParseError,
  YouMdYamlError,
  YouMdNetworkError,
  YouMdTimeoutError,
  YouMdValidationError,
} from "./utils/errors";

// Constants
export {
  MAX_FILE_SIZE,
  MAX_PARSE_TIME,
  SUPPORTED_SCHEMA_VERSIONS,
  CURRENT_SCHEMA_VERSION,
} from "./utils/constants";
