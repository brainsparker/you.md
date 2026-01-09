/**
 * Coding-specific preferences extracted from you.md
 */
export interface CodingPreferences {
  /** Programming language preferences */
  readonly languages?: LanguagePreferences;

  /** Code style preferences */
  readonly style?: StylePreferences;

  /** Architecture and design preferences */
  readonly architecture?: ArchitecturePreferences;

  /** Testing preferences */
  readonly testing?: TestingPreferences;

  /** Documentation preferences */
  readonly documentation?: DocumentationPreferences;
}

/**
 * Language-related preferences
 */
export interface LanguagePreferences {
  /** Primary languages the user works with */
  readonly primary?: string[];

  /** Languages the user is familiar with but less preferred */
  readonly familiar?: string[];

  /** Languages to avoid */
  readonly avoid?: string[];

  /** Preferred frameworks by category */
  readonly frameworks?: Record<string, string>;
}

/**
 * Code style preferences
 */
export interface StylePreferences {
  /** Naming convention (e.g., "snake_case", "camelCase") */
  readonly naming?: string;

  /** Maximum line length */
  readonly maxLineLength?: number;

  /** Preferred formatter (e.g., "black", "prettier") */
  readonly formatter?: string;

  /** Indentation type */
  readonly indentation?: "tabs" | "spaces";

  /** Indentation size (if spaces) */
  readonly indentSize?: number;

  /** Quote style */
  readonly quotes?: "single" | "double";

  /** Use semicolons (for JS/TS) */
  readonly semicolons?: boolean;

  /** Trailing comma preference */
  readonly trailingComma?: "none" | "es5" | "all";
}

/**
 * Architecture and design preferences
 */
export interface ArchitecturePreferences {
  /** Preferred architectural patterns */
  readonly patterns?: string[];

  /** General preferences/guidelines */
  readonly preferences?: string;

  /** Dependency injection style */
  readonly dependencyInjection?: string;
}

/**
 * Testing preferences
 */
export interface TestingPreferences {
  /** Preferred test framework */
  readonly framework?: string;

  /** Testing style (BDD, TDD, etc.) */
  readonly style?: "bdd" | "tdd" | "unit";

  /** Coverage requirements */
  readonly coverage?: boolean | number;

  /** Test file naming pattern */
  readonly filePattern?: string;
}

/**
 * Documentation preferences
 */
export interface DocumentationPreferences {
  /** Documentation style (JSDoc, TSDoc, etc.) */
  readonly style?: "jsdoc" | "tsdoc" | "google" | "numpy" | "inline";

  /** Whether documentation is required */
  readonly required?: boolean;

  /** Comment level preference */
  readonly commentLevel?: "none" | "sparse" | "moderate" | "thorough";
}

/**
 * Communication style preferences for AI interactions
 */
export interface CommunicationPreferences {
  /** Response verbosity level */
  readonly verbosity?: "minimal" | "concise" | "detailed" | "verbose";

  /** When to provide explanations */
  readonly explanations?: "always" | "when_asked" | "never";

  /** Code comment level in generated code */
  readonly codeComments?: "none" | "sparse" | "moderate" | "thorough";

  /** How to handle ambiguous situations */
  readonly assumptions?: "assume" | "ask_first" | "never_assume";

  /** Preferred tone */
  readonly tone?: "formal" | "casual" | "technical";
}

/**
 * Code generation preferences
 */
export interface CodeGenerationPreferences {
  /** Include type hints/annotations */
  readonly typeAnnotations?: boolean;

  /** Include error handling */
  readonly errorHandling?: boolean;

  /** Prefer async/await for I/O */
  readonly preferAsync?: boolean;

  /** Use dependency injection */
  readonly dependencyInjection?: boolean;

  /** Include logging */
  readonly logging?: boolean;
}

/**
 * Code review preferences
 */
export interface CodeReviewPreferences {
  /** What to flag during review */
  readonly flag?: string[];

  /** What to ignore during review */
  readonly ignore?: string[];

  /** Strictness level */
  readonly strictness?: "relaxed" | "moderate" | "strict";
}

// ============================================================================
// Search/AI Personalization Signals
// ============================================================================

/**
 * Identity and authentication signals
 */
export interface IdentitySignals {
  /** Whether user is currently logged in */
  readonly logged_in?: boolean;

  /** Account age in days */
  readonly account_age_days?: number;

  /** Trust score (0-1) */
  readonly trust_score?: number;

  /** Verification level */
  readonly verified_level?: "none" | "email" | "phone" | "id" | "full";

  /** Age range bracket */
  readonly age_range?: string;

  /** Child safety mode enabled */
  readonly child_safe_mode?: boolean;

  /** Parental controls active */
  readonly parental_controls?: boolean;
}

/**
 * Location and regional context signals
 */
export interface LocationSignals {
  /** Current country (ISO 3166-1 alpha-2) */
  readonly current_country?: string;

  /** Current region/state */
  readonly current_region?: string;

  /** Home country */
  readonly home_country?: string;

  /** Home region/state */
  readonly home_region?: string;

  /** IANA timezone */
  readonly timezone?: string;

  /** Regulatory region for compliance */
  readonly regulatory_region?: "GDPR" | "CCPA" | "LGPD" | "PIPL" | string;
}

/**
 * Language and communication signals
 */
export interface LanguageSignals {
  /** Primary language (BCP 47 tag) */
  readonly primary_language?: string;

  /** Secondary languages */
  readonly secondary_languages?: string[];

  /** Spelling variant preference */
  readonly spelling_variant?: "US" | "UK" | "AU" | "CA" | string;

  /** Reading comprehension level */
  readonly reading_level?: "basic" | "intermediate" | "advanced" | "expert";

  /** Translation enabled */
  readonly translation_enabled?: boolean;
}

/**
 * Device and technical context signals
 */
export interface DeviceSignals {
  /** Device type */
  readonly device_type?: "mobile" | "tablet" | "desktop" | "tv" | "watch";

  /** Operating system */
  readonly os?: string;

  /** Browser name */
  readonly browser?: string;

  /** Screen size category */
  readonly screen_size?: "small" | "medium" | "large" | "xlarge";

  /** Primary input method */
  readonly input_method?: "touch" | "keyboard" | "voice" | "controller";

  /** Network connection type */
  readonly connection_type?: "cellular" | "wifi" | "ethernet" | "offline";

  /** Connection speed category */
  readonly connection_speed?: "slow" | "medium" | "fast";

  /** Accessibility features in use */
  readonly accessibility_features?: string[];
}

/**
 * Search behavior and intent signals
 */
export interface SearchBehaviorSignals {
  /** Recent search topics */
  readonly recent_topics?: string[];

  /** Long-term interest topics */
  readonly long_term_topics?: string[];

  /** Topic frequency map */
  readonly topic_frequency?: Record<string, number>;

  /** Preferred search depth */
  readonly search_depth?: "quick" | "moderate" | "deep" | "exhaustive";

  /** Query reformulation tendency */
  readonly reformulation_rate?: "low" | "medium" | "high";

  /** Average result click depth */
  readonly result_click_depth?: number;

  /** Time spent on results (seconds average) */
  readonly avg_time_on_result?: number;
}

/**
 * Content format and source preferences
 */
export interface ContentPreferences {
  /** Preferred content sources */
  readonly preferred_sources?: string[];

  /** Blocked/avoided sources */
  readonly blocked_sources?: string[];

  /** Authority vs explainer bias (0=explainer, 1=authority) */
  readonly authority_bias?: number;

  /** Visual content preference (0=text, 1=visual) */
  readonly visual_preference?: number;

  /** Long vs short form preference (0=short, 1=long) */
  readonly long_form_preference?: number;

  /** Content freshness weight (0=evergreen, 1=latest) */
  readonly freshness_weight?: number;

  /** Expertise level by topic */
  readonly expertise_level?: "beginner" | "intermediate" | "advanced" | "expert";

  /** Topic-specific expertise overrides */
  readonly expertise_by_topic?: Record<string, string>;
}

/**
 * AI response preferences
 */
export interface AIResponsePreferences {
  /** Response verbosity */
  readonly verbosity?: "minimal" | "concise" | "detailed" | "comprehensive";

  /** Explanation depth */
  readonly explanation_depth?: "surface" | "moderate" | "technical" | "deep";

  /** Include examples in responses */
  readonly include_examples?: boolean;

  /** Preferred example language */
  readonly example_language?: string;

  /** Code comment level */
  readonly code_comments?: "none" | "sparse" | "moderate" | "thorough";

  /** Preferred response format */
  readonly response_format?: "text" | "structured" | "visual" | "code";

  /** Math notation preference */
  readonly math_notation?: "plain" | "latex" | "ascii";

  /** Citation style preference */
  readonly citation_style?: "inline" | "footnote" | "none";
}

/**
 * Trust and safety preferences
 */
export interface TrustSafetySignals {
  /** Misinformation sensitivity level */
  readonly misinformation_sensitivity?: "low" | "standard" | "high" | "strict";

  /** Minimum source reliability threshold (0-1) */
  readonly source_reliability_threshold?: number;

  /** Content warning sensitivity */
  readonly content_warning_level?: "minimal" | "standard" | "sensitive";

  /** Medical/legal caution level */
  readonly medical_legal_caution?: "standard" | "high" | "maximum";

  /** Fact-check preference */
  readonly fact_check_preference?: "disabled" | "subtle" | "prominent";
}

/**
 * Profile metadata and system signals
 */
export interface PersonalizationMeta {
  /** Last profile update timestamp (ISO 8601) */
  readonly last_profile_update?: string;

  /** Per-category confidence scores */
  readonly signal_confidence?: Record<string, number>;

  /** Signal decay rate (0-1, per day) */
  readonly decay_rate?: number;

  /** Overall personalization weight (0-1) */
  readonly personalization_weight?: number;

  /** Active A/B experiments */
  readonly active_experiments?: string[];

  /** Profile version for migrations */
  readonly profile_version?: string;
}

/**
 * Complete personalization profile combining all signal categories
 */
export interface PersonalizationProfile {
  /** Identity and auth signals */
  readonly identity?: IdentitySignals;

  /** Location context */
  readonly location?: LocationSignals;

  /** Language preferences */
  readonly language?: LanguageSignals;

  /** Device context */
  readonly device?: DeviceSignals;

  /** Search behavior patterns */
  readonly search_behavior?: SearchBehaviorSignals;

  /** Content preferences */
  readonly content?: ContentPreferences;

  /** AI response preferences */
  readonly ai_preferences?: AIResponsePreferences;

  /** Trust and safety settings */
  readonly trust_safety?: TrustSafetySignals;

  /** Profile metadata */
  readonly meta?: PersonalizationMeta;
}
