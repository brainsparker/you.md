import { FRONTMATTER_START, FRONTMATTER_END_MARKERS } from "../utils/constants";

/**
 * Result of frontmatter extraction
 */
export interface FrontmatterResult {
  /** YAML frontmatter content (without delimiters) */
  readonly frontmatter: string | null;

  /** Markdown content after frontmatter */
  readonly content: string;

  /** Whether frontmatter was found */
  readonly hasFrontmatter: boolean;

  /** Line number where frontmatter ends (1-indexed) */
  readonly contentStartLine: number;
}

/**
 * Extract YAML frontmatter from markdown content.
 *
 * Frontmatter must:
 * - Start at the beginning of the file (ignoring BOM and whitespace)
 * - Be delimited by --- at start and --- or ... at end
 * - Each delimiter must be on its own line
 *
 * @param input - Raw markdown content
 * @returns Extracted frontmatter and remaining content
 */
export function extractFrontmatter(input: string): FrontmatterResult {
  // Handle empty input
  if (!input || input.trim().length === 0) {
    return {
      frontmatter: null,
      content: input,
      hasFrontmatter: false,
      contentStartLine: 1,
    };
  }

  // Remove BOM if present
  let content = input;
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  // Split into lines for processing
  const lines = content.split(/\r?\n/);

  // Find the start delimiter (must be first non-empty line)
  let startLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed === FRONTMATTER_START) {
      startLineIndex = i;
      break;
    }
    // First non-empty line is not ---, no frontmatter
    return {
      frontmatter: null,
      content: input,
      hasFrontmatter: false,
      contentStartLine: 1,
    };
  }

  // No start delimiter found
  if (startLineIndex === -1) {
    return {
      frontmatter: null,
      content: input,
      hasFrontmatter: false,
      contentStartLine: 1,
    };
  }

  // Find the end delimiter
  let endLineIndex = -1;
  for (let i = startLineIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (FRONTMATTER_END_MARKERS.includes(trimmed)) {
      endLineIndex = i;
      break;
    }
  }

  // No end delimiter found - treat as no frontmatter
  if (endLineIndex === -1) {
    return {
      frontmatter: null,
      content: input,
      hasFrontmatter: false,
      contentStartLine: 1,
    };
  }

  // Extract frontmatter content (between delimiters)
  const frontmatterLines = lines.slice(startLineIndex + 1, endLineIndex);
  const frontmatter = frontmatterLines.join("\n");

  // Extract remaining content (after end delimiter)
  const contentLines = lines.slice(endLineIndex + 1);
  const remainingContent = contentLines.join("\n");

  return {
    frontmatter: frontmatter.length > 0 ? frontmatter : null,
    content: remainingContent,
    hasFrontmatter: true,
    contentStartLine: endLineIndex + 2, // 1-indexed, after end delimiter
  };
}
