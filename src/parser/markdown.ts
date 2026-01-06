import { HEADER_PATTERN } from "../utils/constants";
import type { YouMdSection, YouMdField } from "../types/profile";

/**
 * Result of markdown section extraction
 */
export interface SectionExtractResult {
  /** Extracted sections */
  readonly sections: YouMdSection[];

  /** Warnings encountered during extraction */
  readonly warnings: SectionWarning[];
}

/**
 * A warning during section extraction
 */
export interface SectionWarning {
  readonly message: string;
  readonly line: number;
}

/**
 * Extract sections from markdown content.
 *
 * Sections are defined by headers (# to ######).
 * Content between headers is associated with the preceding header.
 * Nested headers create subsections.
 *
 * @param content - Markdown content (without frontmatter)
 * @param startLine - Starting line number (for error reporting)
 * @returns Extracted sections and warnings
 */
export function extractSections(
  content: string,
  startLine: number = 1
): SectionExtractResult {
  const warnings: SectionWarning[] = [];

  if (!content || content.trim().length === 0) {
    return { sections: [], warnings: [] };
  }

  const lines = content.split(/\r?\n/);
  const rootSections: YouMdSection[] = [];

  // Stack to track current section hierarchy
  const stack: { section: YouMdSection; level: number }[] = [];

  let currentContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = startLine + i;
    const headerMatch = line.match(HEADER_PATTERN);

    if (headerMatch) {
      // Save content to previous section
      if (stack.length > 0 && currentContent.length > 0) {
        const currentSection = stack[stack.length - 1].section;
        const contentStr = currentContent.join("\n").trim();
        if (contentStr) {
          // Update the section's content
          Object.assign(currentSection, {
            content:
              currentSection.content +
              (currentSection.content ? "\n" : "") +
              contentStr,
          });
        }
      }

      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();

      // Create new section
      const newSection: YouMdSection = {
        title,
        normalizedTitle: normalizeTitle(title),
        level,
        content: "",
        fields: new Map(),
        subsections: [],
        startLine: lineNumber,
      };

      // Pop sections from stack until we find a parent (lower level)
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        const popped = stack.pop()!;
        // Finalize the popped section
        finalizeSection(popped.section, startLine + i - 1);
      }

      // Add to parent or root
      if (stack.length > 0) {
        const parent = stack[stack.length - 1].section;
        (parent.subsections as YouMdSection[]).push(newSection);
      } else {
        rootSections.push(newSection);
      }

      // Push new section onto stack
      stack.push({ section: newSection, level });
      currentContent = [];
    } else {
      // Accumulate content
      currentContent.push(line);
    }
  }

  // Finalize remaining sections
  if (stack.length > 0 && currentContent.length > 0) {
    const currentSection = stack[stack.length - 1].section;
    const contentStr = currentContent.join("\n").trim();
    if (contentStr) {
      Object.assign(currentSection, {
        content:
          currentSection.content +
          (currentSection.content ? "\n" : "") +
          contentStr,
      });
    }
  }

  // Finalize and pop all remaining sections
  while (stack.length > 0) {
    const popped = stack.pop()!;
    finalizeSection(popped.section, startLine + lines.length);
  }

  // Parse fields from each section's content
  for (const section of rootSections) {
    parseSectionFields(section);
  }

  return { sections: rootSections, warnings };
}

/**
 * Normalize a section title for case-insensitive lookup
 */
function normalizeTitle(title: string): string {
  return title.toLowerCase().trim();
}

/**
 * Finalize a section by setting its end line
 */
function finalizeSection(section: YouMdSection, endLine: number): void {
  Object.assign(section, { endLine });
}

/**
 * Parse key-value fields from section content
 */
function parseSectionFields(section: YouMdSection): void {
  const fields = new Map<string, YouMdField>();
  const lines = section.content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) continue;

    // Check for "Key: Value" pattern
    const colonMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (colonMatch) {
      const key = colonMatch[1].trim();
      const rawValue = colonMatch[2].trim();

      // Skip if it looks like a URL or time
      if (rawValue.startsWith("//") || /^\d{1,2}:\d{2}/.test(rawValue)) {
        continue;
      }

      // Parse the value
      const value = parseFieldValue(rawValue);

      fields.set(key.toLowerCase(), {
        key,
        value,
        rawValue,
        line: (section.startLine ?? 0) + i + 1,
      });
      continue;
    }

    // Check for list items that might be key-value
    const listMatch = line.match(/^-\s+([^:]+):\s*(.+)$/);
    if (listMatch) {
      const key = listMatch[1].trim();
      const rawValue = listMatch[2].trim();
      const value = parseFieldValue(rawValue);

      fields.set(key.toLowerCase(), {
        key,
        value,
        rawValue,
        line: (section.startLine ?? 0) + i + 1,
      });
      continue;
    }

    // Check for simple list items (accumulate into array)
    const simpleListMatch = line.match(/^-\s+(.+)$/);
    if (simpleListMatch) {
      const itemValue = simpleListMatch[1].trim();
      const existingField = fields.get("_items");

      if (existingField && Array.isArray(existingField.value)) {
        (existingField.value as string[]).push(itemValue);
      } else {
        fields.set("_items", {
          key: "_items",
          value: [itemValue],
          rawValue: itemValue,
          line: (section.startLine ?? 0) + i + 1,
        });
      }
    }
  }

  // Update section with parsed fields
  Object.assign(section, { fields });

  // Recursively parse subsections
  for (const subsection of section.subsections) {
    parseSectionFields(subsection);
  }
}

/**
 * Parse a field value string into appropriate type
 */
function parseFieldValue(value: string): string | string[] | boolean | number {
  // Empty
  if (!value) return "";

  // Boolean
  const lowerValue = value.toLowerCase();
  if (lowerValue === "true" || lowerValue === "yes") return true;
  if (lowerValue === "false" || lowerValue === "no") return false;

  // Number
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

  // Comma-separated list (if contains comma and not quoted)
  if (
    value.includes(",") &&
    !value.startsWith('"') &&
    !value.startsWith("'")
  ) {
    return value.split(",").map((s) => s.trim());
  }

  // String (remove quotes if present)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

/**
 * Find a section by normalized title (case-insensitive)
 */
export function findSection(
  sections: YouMdSection[],
  title: string
): YouMdSection | undefined {
  const normalized = title.toLowerCase().trim();

  for (const section of sections) {
    if (section.normalizedTitle === normalized) {
      return section;
    }

    // Search subsections recursively
    const found = findSection(section.subsections, title);
    if (found) return found;
  }

  return undefined;
}

/**
 * Get all sections as a flat map keyed by normalized title
 */
export function flattenSections(
  sections: YouMdSection[]
): Map<string, YouMdSection> {
  const map = new Map<string, YouMdSection>();

  function addToMap(section: YouMdSection): void {
    map.set(section.normalizedTitle, section);
    for (const sub of section.subsections) {
      addToMap(sub);
    }
  }

  for (const section of sections) {
    addToMap(section);
  }

  return map;
}
