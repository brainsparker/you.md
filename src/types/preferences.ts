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
