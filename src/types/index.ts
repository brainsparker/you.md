// Profile types
export type {
  YouMdProfile,
  ProfileMetadata,
  YouMdSection,
  YouMdField,
} from "./profile";
export { createEmptyProfile } from "./profile";

// Preference types
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
} from "./preferences";

// Option types
export type {
  DiscoveryOptions,
  FetchOptions,
  ParseOptions,
  MergeOptions,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ValidationErrorCode,
  ValidationWarningCode,
} from "./options";

// Parser types
export type {
  YouMdParser,
  ParseResult,
  ParseError,
  ParseWarning,
  ParseErrorCode,
  ParseWarningCode,
} from "./parser";
