/**
 * Maximum file size in bytes (100KB as per FR-04)
 */
export const MAX_FILE_SIZE = 100 * 1024;

/**
 * Maximum parse time in milliseconds (50ms as per NF-01)
 */
export const MAX_PARSE_TIME = 50;

/**
 * Default fetch timeout in milliseconds
 */
export const DEFAULT_FETCH_TIMEOUT = 5000;

/**
 * Default environment variable name for you.md path
 */
export const DEFAULT_ENV_VAR = "YOU_MD_PATH";

/**
 * Default file names to search for
 */
export const DEFAULT_FILE_NAMES = [".you.md", "you.md"];

/**
 * Supported schema versions
 */
export const SUPPORTED_SCHEMA_VERSIONS = ["1.0", "1.1"];

/**
 * Current schema version
 */
export const CURRENT_SCHEMA_VERSION = "1.1";

/**
 * Frontmatter delimiters
 */
export const FRONTMATTER_START = "---";
export const FRONTMATTER_END_MARKERS = ["---", "..."];

/**
 * Maximum recursion depth for YAML parsing
 */
export const MAX_YAML_DEPTH = 50;

/**
 * Regex patterns for sensitive data detection (SEC-05)
 */
export const SENSITIVE_PATTERNS = [
  /(?:api[_-]?key|secret|password|token)\s*[:=]/i,
  /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----/i,
  /(?:aws|azure|gcp)[_-]?(?:access|secret)[_-]?key/i,
];

/**
 * Known section names for validation
 */
export const KNOWN_SECTIONS = [
  // Human-centric identity sections (v1.1)
  "me",
  "how i think",
  "how i communicate",
  "what i trust",
  "what i'm into",
  "what im into",
  "context",
  // Original you.md sections
  "about me",
  "about",
  "technical preferences",
  "coding preferences",
  "coding",
  "communication style",
  "code generation preferences",
  "code review preferences",
  "project conventions",
  "development environment",
  "don't",
  "do not",
  "preferences",
  "you.md",
  "user profile",
  "project profile",
  "testing",
  "documentation",
  // Personalization signal sections
  "personalization profile",
  "identity",
  "identity signals",
  "location",
  "location context",
  "language",
  "language preferences",
  "device",
  "device context",
  "search behavior",
  "search signals",
  "content preferences",
  "content",
  "ai preferences",
  "ai response preferences",
  "trust and safety",
  "trust safety",
  "trust signals",
  "personalization meta",
  "meta",
];

/**
 * Header level regex pattern
 */
export const HEADER_PATTERN = /^(#{1,6})\s+(.+)$/;
