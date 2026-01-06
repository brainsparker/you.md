import { MAX_YAML_DEPTH } from "../utils/constants";

/**
 * Result of YAML parsing
 */
export interface YamlParseResult {
  /** Parsed data as a JavaScript object */
  readonly data: Record<string, unknown>;

  /** Errors encountered during parsing */
  readonly errors: YamlError[];
}

/**
 * A YAML parsing error
 */
export interface YamlError {
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

/**
 * Parse a YAML string into a JavaScript object.
 * This is a minimal YAML parser supporting the subset needed for you.md frontmatter.
 *
 * Supported features:
 * - Key-value pairs
 * - Nested objects (via indentation)
 * - Arrays (both block and inline style)
 * - Inline objects { key: value }
 * - Strings (quoted and unquoted)
 * - Numbers (integer and float)
 * - Booleans (true/false, yes/no)
 * - Null (null, ~)
 * - Comments (#)
 * - Multi-line strings (| and >)
 *
 * @param input - YAML string to parse
 * @returns Parsed data and any errors
 */
export function parseYaml(input: string): YamlParseResult {
  const errors: YamlError[] = [];

  if (!input || input.trim().length === 0) {
    return { data: {}, errors: [] };
  }

  const lines = input.split(/\r?\n/);
  const result: Record<string, unknown> = {};

  try {
    parseBlock(lines, 0, result, 0, errors);
  } catch (e) {
    errors.push({
      message: e instanceof Error ? e.message : "Unknown parsing error",
      line: 1,
      column: 1,
    });
  }

  return { data: result, errors };
}

/**
 * Parse a block of YAML lines into an object
 */
function parseBlock(
  lines: string[],
  startLine: number,
  target: Record<string, unknown>,
  baseIndent: number,
  errors: YamlError[],
  depth: number = 0
): number {
  if (depth > MAX_YAML_DEPTH) {
    errors.push({
      message: "Maximum nesting depth exceeded",
      line: startLine + 1,
      column: 1,
    });
    return lines.length;
  }

  let i = startLine;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Skip empty lines and comments
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const currentIndent = line.length - trimmed.length;

    // If indentation is less than base, we've exited this block
    if (currentIndent < baseIndent) {
      return i;
    }

    // If this is a list item at current level
    if (trimmed.startsWith("- ")) {
      // This shouldn't happen at the top level of an object
      // Skip and continue
      i++;
      continue;
    }

    // Parse key-value pair
    const colonIndex = findColonIndex(trimmed);
    if (colonIndex === -1) {
      // Not a key-value pair, skip
      i++;
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const valueStr = trimmed.slice(colonIndex + 1).trim();

    // Handle multi-line strings
    if (valueStr === "|" || valueStr === ">" || valueStr === "|+" || valueStr === ">+") {
      const { value, nextLine } = parseMultiLineString(
        lines,
        i + 1,
        currentIndent,
        valueStr.startsWith(">")
      );
      target[key] = value;
      i = nextLine;
      continue;
    }

    // Handle inline value
    if (valueStr.length > 0) {
      target[key] = parseValue(valueStr, errors, i + 1);
      i++;
      continue;
    }

    // Check if next line has increased indent (nested block or array)
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const nextTrimmed = nextLine.trimStart();
      const nextIndent = nextLine.length - nextTrimmed.length;

      if (nextIndent > currentIndent) {
        if (nextTrimmed.startsWith("- ")) {
          // It's an array
          const { array, nextLine: newLine } = parseArray(
            lines,
            i + 1,
            nextIndent,
            errors,
            depth + 1
          );
          target[key] = array;
          i = newLine;
        } else {
          // It's a nested object
          const nestedObj: Record<string, unknown> = {};
          i = parseBlock(lines, i + 1, nestedObj, nextIndent, errors, depth + 1);
          target[key] = nestedObj;
        }
        continue;
      }
    }

    // Empty value
    target[key] = null;
    i++;
  }

  return i;
}

/**
 * Parse an array from YAML lines
 */
function parseArray(
  lines: string[],
  startLine: number,
  baseIndent: number,
  errors: YamlError[],
  depth: number
): { array: unknown[]; nextLine: number } {
  if (depth > MAX_YAML_DEPTH) {
    errors.push({
      message: "Maximum nesting depth exceeded",
      line: startLine + 1,
      column: 1,
    });
    return { array: [], nextLine: lines.length };
  }

  const array: unknown[] = [];
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Skip empty lines and comments
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const currentIndent = line.length - trimmed.length;

    // If indentation is less than base, we've exited this array
    if (currentIndent < baseIndent) {
      return { array, nextLine: i };
    }

    // Must be a list item
    if (!trimmed.startsWith("- ")) {
      return { array, nextLine: i };
    }

    const itemValue = trimmed.slice(2).trim();

    if (itemValue.length === 0) {
      // Check for nested structure
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextTrimmed = nextLine.trimStart();
        const nextIndent = nextLine.length - nextTrimmed.length;

        if (nextIndent > currentIndent) {
          // Nested object in array
          const nestedObj: Record<string, unknown> = {};
          i = parseBlock(lines, i + 1, nestedObj, nextIndent, errors, depth + 1);
          array.push(nestedObj);
          continue;
        }
      }
      array.push(null);
    } else {
      array.push(parseValue(itemValue, errors, i + 1));
    }

    i++;
  }

  return { array, nextLine: i };
}

/**
 * Parse a multi-line string (| or > style)
 */
function parseMultiLineString(
  lines: string[],
  startLine: number,
  baseIndent: number,
  folded: boolean
): { value: string; nextLine: number } {
  const contentLines: string[] = [];
  let i = startLine;
  let contentIndent = -1;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line - include it
    if (line.trim().length === 0) {
      contentLines.push("");
      i++;
      continue;
    }

    const currentIndent = line.length - line.trimStart().length;

    // Determine content indent from first non-empty line
    if (contentIndent === -1) {
      if (currentIndent <= baseIndent) {
        break;
      }
      contentIndent = currentIndent;
    }

    // If less indented than content, we're done
    if (currentIndent < contentIndent) {
      break;
    }

    // Add the content (removing the indent)
    contentLines.push(line.slice(contentIndent));
    i++;
  }

  // Join lines based on style
  let value: string;
  if (folded) {
    // Folded style: single newlines become spaces
    value = contentLines
      .join("\n")
      .replace(/([^\n])\n([^\n])/g, "$1 $2")
      .trim();
  } else {
    // Literal style: preserve newlines
    value = contentLines.join("\n").trimEnd();
  }

  return { value, nextLine: i };
}

/**
 * Parse a YAML value into a JavaScript value
 */
function parseValue(
  value: string,
  errors: YamlError[],
  line: number
): unknown {
  // Null
  if (value === "null" || value === "~" || value === "") {
    return null;
  }

  // Boolean
  const lowerValue = value.toLowerCase();
  if (lowerValue === "true" || lowerValue === "yes" || lowerValue === "on") {
    return true;
  }
  if (lowerValue === "false" || lowerValue === "no" || lowerValue === "off") {
    return false;
  }

  // Quoted string
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return parseQuotedString(value);
  }

  // Inline array [a, b, c]
  if (value.startsWith("[") && value.endsWith("]")) {
    return parseInlineArray(value.slice(1, -1), errors, line);
  }

  // Inline object {key: value}
  if (value.startsWith("{") && value.endsWith("}")) {
    return parseInlineObject(value.slice(1, -1), errors, line);
  }

  // Number
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value);
  }

  // ISO date check (keep as string but validate format)
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?/.test(value)) {
    return value;
  }

  // Unquoted string - strip inline comments
  const commentIndex = value.indexOf(" #");
  if (commentIndex !== -1) {
    return value.slice(0, commentIndex).trim();
  }

  return value;
}

/**
 * Parse a quoted string, handling escape sequences
 */
function parseQuotedString(value: string): string {
  const quote = value[0];
  const inner = value.slice(1, -1);

  if (quote === '"') {
    // Double quotes: process escape sequences
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"');
  }

  // Single quotes: only escape '' -> '
  return inner.replace(/''/g, "'");
}

/**
 * Parse an inline array [a, b, c]
 */
function parseInlineArray(
  content: string,
  errors: YamlError[],
  line: number
): unknown[] {
  if (content.trim().length === 0) {
    return [];
  }

  const items: unknown[] = [];
  let current = "";
  let depth = 0;
  let inQuote: string | null = null;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    // Handle quotes
    if ((char === '"' || char === "'") && content[i - 1] !== "\\") {
      if (inQuote === null) {
        inQuote = char;
      } else if (inQuote === char) {
        inQuote = null;
      }
      current += char;
      continue;
    }

    // Track nesting
    if (inQuote === null) {
      if (char === "[" || char === "{") {
        depth++;
      } else if (char === "]" || char === "}") {
        depth--;
      }
    }

    // Comma at top level separates items
    if (char === "," && depth === 0 && inQuote === null) {
      items.push(parseValue(current.trim(), errors, line));
      current = "";
      continue;
    }

    current += char;
  }

  // Add last item
  if (current.trim().length > 0) {
    items.push(parseValue(current.trim(), errors, line));
  }

  return items;
}

/**
 * Parse an inline object {key: value}
 */
function parseInlineObject(
  content: string,
  errors: YamlError[],
  line: number
): Record<string, unknown> {
  if (content.trim().length === 0) {
    return {};
  }

  const result: Record<string, unknown> = {};
  let current = "";
  let depth = 0;
  let inQuote: string | null = null;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    // Handle quotes
    if ((char === '"' || char === "'") && content[i - 1] !== "\\") {
      if (inQuote === null) {
        inQuote = char;
      } else if (inQuote === char) {
        inQuote = null;
      }
      current += char;
      continue;
    }

    // Track nesting
    if (inQuote === null) {
      if (char === "[" || char === "{") {
        depth++;
      } else if (char === "]" || char === "}") {
        depth--;
      }
    }

    // Comma at top level separates pairs
    if (char === "," && depth === 0 && inQuote === null) {
      const pair = current.trim();
      const colonIdx = findColonIndex(pair);
      if (colonIdx !== -1) {
        const key = pair.slice(0, colonIdx).trim();
        const val = pair.slice(colonIdx + 1).trim();
        result[key] = parseValue(val, errors, line);
      }
      current = "";
      continue;
    }

    current += char;
  }

  // Add last pair
  if (current.trim().length > 0) {
    const pair = current.trim();
    const colonIdx = findColonIndex(pair);
    if (colonIdx !== -1) {
      const key = pair.slice(0, colonIdx).trim();
      const val = pair.slice(colonIdx + 1).trim();
      result[key] = parseValue(val, errors, line);
    }
  }

  return result;
}

/**
 * Find the colon that separates key from value, ignoring colons in quoted strings
 */
function findColonIndex(str: string): number {
  let inQuote: string | null = null;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if ((char === '"' || char === "'") && str[i - 1] !== "\\") {
      if (inQuote === null) {
        inQuote = char;
      } else if (inQuote === char) {
        inQuote = null;
      }
      continue;
    }

    if (char === ":" && inQuote === null) {
      return i;
    }
  }

  return -1;
}
