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
  // Personalization signal types
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
export {
  validateProfile,
  isValidProfile,
  getSecurityWarnings,
  SECURITY_WARNING_CODES,
} from "./core/validator";

// Instruction-file injection scanner
export {
  scanForInjection,
  formatInjectionFindings,
  hasHighSeverityFindings,
  INJECTION_RULES,
  INJECTION_ALLOW_MARKER,
} from "./core/injection";
export type {
  InjectionFinding,
  InjectionCategory,
  InjectionSeverity,
  InjectionScanOptions,
} from "./core/injection";

// Personalization signal extraction
export {
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
} from "./core/signals";

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
