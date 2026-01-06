import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname, basename } from "node:path";

import type { CliFlags } from "../args";

/**
 * Convert from other formats to you.md
 *
 * @param args - Positional arguments (input file path)
 * @param flags - CLI flags
 * @returns Exit code (0 = success, 1 = error)
 */
export async function convertCommand(
  args: string[],
  flags: CliFlags
): Promise<number> {
  if (args.length === 0) {
    if (!flags.quiet) {
      console.error("Error: No input file provided");
      console.error("Usage: you-md convert <input>");
      console.error("");
      console.error("Supported formats:");
      console.error("  .cursorrules    Cursor AI rules");
    }
    return 1;
  }

  const inputPath = resolve(args[0]);

  // Check if file exists
  if (!existsSync(inputPath)) {
    if (!flags.quiet) {
      console.error(`Error: File not found: ${inputPath}`);
    }
    return 1;
  }

  // Detect format from extension or filename
  const ext = extname(inputPath).toLowerCase();
  const filename = basename(inputPath).toLowerCase();

  let content: string;
  try {
    content = await readFile(inputPath, "utf-8");
  } catch (error) {
    if (!flags.quiet) {
      console.error(`Error reading file: ${inputPath}`);
    }
    return 1;
  }

  let output: string;

  try {
    if (filename === ".cursorrules" || ext === ".cursorrules") {
      output = convertCursorRules(content);
    } else if (filename === "agents.md" || filename === "agent.md") {
      output = convertAgentsMd(content);
    } else {
      // Try to auto-detect
      if (content.includes("cursor") || content.includes("Cursor")) {
        output = convertCursorRules(content);
      } else {
        output = convertGenericRules(content);
      }

      if (!flags.quiet) {
        console.error(
          `Warning: Unknown format, using generic conversion for: ${inputPath}`
        );
      }
    }
  } catch (error) {
    if (!flags.quiet) {
      console.error(`Error converting file: ${inputPath}`);
      if (flags.verbose && error instanceof Error) {
        console.error(error.message);
      }
    }
    return 1;
  }

  // Output or write to file
  if (flags.output) {
    const outputPath = resolve(flags.output);
    try {
      await writeFile(outputPath, output, "utf-8");
      if (!flags.quiet) {
        console.log(`Converted: ${inputPath} → ${outputPath}`);
      }
    } catch (error) {
      if (!flags.quiet) {
        console.error(`Error writing file: ${outputPath}`);
      }
      return 1;
    }
  } else {
    console.log(output);
  }

  return 0;
}

/**
 * Convert .cursorrules format to you.md
 */
function convertCursorRules(content: string): string {
  const today = new Date().toISOString().split("T")[0];
  const lines: string[] = [];

  // Generate frontmatter
  lines.push("---");
  lines.push('schema_version: "1.0"');
  lines.push(`created: "${today}"`);
  lines.push('privacy_level: "private"');
  lines.push("# Converted from .cursorrules");
  lines.push("---");
  lines.push("");
  lines.push("# you.md");
  lines.push("");

  // Parse the cursorrules content
  // Cursorrules are typically free-form instructions
  const sections = parseCursorRulesSections(content);

  if (sections.about) {
    lines.push("## About Me");
    lines.push("");
    lines.push(sections.about);
    lines.push("");
  }

  if (sections.preferences || sections.rules) {
    lines.push("## Technical Preferences");
    lines.push("");
    lines.push(sections.preferences || sections.rules || "");
    lines.push("");
  }

  if (sections.style) {
    lines.push("## Communication Style");
    lines.push("");
    lines.push(sections.style);
    lines.push("");
  }

  if (sections.generation) {
    lines.push("## Code Generation Preferences");
    lines.push("");
    lines.push("When generating code:");
    lines.push(sections.generation);
    lines.push("");
  }

  if (sections.dont) {
    lines.push("## Don't");
    lines.push("");
    lines.push(sections.dont);
    lines.push("");
  }

  // If no sections were detected, put everything in preferences
  if (Object.keys(sections).length === 0) {
    lines.push("## Technical Preferences");
    lines.push("");
    lines.push(content.trim());
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Parse .cursorrules into rough sections
 */
function parseCursorRulesSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split("\n");

  let currentSection = "rules";
  let currentContent: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Detect section headers (common patterns in cursorrules)
    if (
      lower.includes("about") ||
      lower.includes("who i am") ||
      lower.includes("background")
    ) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = "about";
      currentContent = [];
    } else if (
      lower.includes("preference") ||
      lower.includes("style guide") ||
      lower.includes("coding style")
    ) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = "preferences";
      currentContent = [];
    } else if (
      lower.includes("don't") ||
      lower.includes("do not") ||
      lower.includes("never") ||
      lower.includes("avoid")
    ) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = "dont";
      currentContent = [];
    } else if (
      lower.includes("generat") ||
      lower.includes("when writing") ||
      lower.includes("code style")
    ) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = "generation";
      currentContent = [];
    } else if (
      lower.includes("communicat") ||
      lower.includes("response") ||
      lower.includes("tone")
    ) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = "style";
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentContent.length > 0) {
    sections[currentSection] = currentContent.join("\n").trim();
  }

  return sections;
}

/**
 * Convert AGENTS.md format to you.md
 */
function convertAgentsMd(content: string): string {
  const today = new Date().toISOString().split("T")[0];

  // AGENTS.md is already markdown, just add frontmatter
  return `---
schema_version: "1.0"
created: "${today}"
privacy_level: "private"
# Converted from AGENTS.md
---

${content}
`;
}

/**
 * Convert generic rules/instructions to you.md
 */
function convertGenericRules(content: string): string {
  const today = new Date().toISOString().split("T")[0];

  return `---
schema_version: "1.0"
created: "${today}"
privacy_level: "private"
---

# you.md

## Technical Preferences

${content.trim()}
`;
}
