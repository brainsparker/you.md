import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { CliFlags } from "../args";
import { createParser } from "../../parser";
import type { YouMdProfile } from "../../types/profile";

/**
 * Merge multiple you.md files
 *
 * @param args - Positional arguments (file paths)
 * @param flags - CLI flags
 * @returns Exit code (0 = success, 1 = error)
 */
export async function mergeCommand(
  args: string[],
  flags: CliFlags
): Promise<number> {
  if (args.length < 2) {
    if (!flags.quiet) {
      console.error("Error: At least 2 files required for merge");
      console.error("Usage: you-md merge <file1> <file2> [file3...]");
    }
    return 1;
  }

  const parser = createParser();
  const profiles: YouMdProfile[] = [];
  const errors: string[] = [];

  // Load all files
  for (const arg of args) {
    const filePath = resolve(arg);
    const result = await parser.loadFromPath(filePath);

    if (!result.success) {
      errors.push(`Failed to parse ${filePath}: ${result.errors[0]?.message}`);
    } else {
      profiles.push(result.profile);
      if (flags.verbose && !flags.quiet) {
        console.log(`Loaded: ${filePath}`);
      }
    }
  }

  // Check for load errors
  if (errors.length > 0) {
    if (!flags.quiet) {
      console.error("Errors loading files:");
      for (const error of errors) {
        console.error(`  ✗ ${error}`);
      }
    }
    return 1;
  }

  // Merge profiles
  const merged = parser.merge(profiles);

  // Generate output
  const output = generateMergedOutput(merged);

  // Output or write to file
  if (flags.output) {
    const outputPath = resolve(flags.output);
    try {
      await writeFile(outputPath, output, "utf-8");
      if (!flags.quiet) {
        console.log(`Merged ${profiles.length} files → ${outputPath}`);
      }
    } catch (error) {
      if (!flags.quiet) {
        console.error(`Error writing file: ${outputPath}`);
      }
      return 1;
    }
  } else if (flags.json) {
    // Output as JSON
    console.log(
      JSON.stringify(
        {
          schemaVersion: merged.schemaVersion,
          metadata: merged.metadata,
          sections: Object.fromEntries(merged.sections),
        },
        null,
        2
      )
    );
  } else {
    // Output merged markdown
    console.log(output);
  }

  return 0;
}

/**
 * Generate markdown output from a merged profile
 */
function generateMergedOutput(profile: YouMdProfile): string {
  const lines: string[] = [];

  // Generate frontmatter
  lines.push("---");
  lines.push(`schema_version: "${profile.schemaVersion}"`);

  const today = new Date().toISOString().split("T")[0];
  lines.push(`last_updated: "${today}"`);

  if (profile.metadata.privacyLevel) {
    lines.push(`privacy_level: "${profile.metadata.privacyLevel}"`);
  }

  if (profile.metadata.author) {
    lines.push(`author: "${profile.metadata.author}"`);
  }

  if (profile.metadata.tags && Array.isArray(profile.metadata.tags)) {
    lines.push(`tags: [${profile.metadata.tags.map((t) => `"${t}"`).join(", ")}]`);
  }

  lines.push("---");
  lines.push("");

  // Generate sections
  for (const [, section] of profile.sections) {
    // Section header
    const headerPrefix = "#".repeat(section.level);
    lines.push(`${headerPrefix} ${section.title}`);
    lines.push("");

    // Section content
    if (section.content) {
      lines.push(section.content);
      lines.push("");
    }

    // Generate subsections recursively
    for (const subsection of section.subsections) {
      generateSectionOutput(subsection, lines);
    }
  }

  return lines.join("\n");
}

/**
 * Generate output for a section and its subsections
 */
function generateSectionOutput(
  section: { title: string; level: number; content: string; subsections: any[] },
  lines: string[]
): void {
  const headerPrefix = "#".repeat(section.level);
  lines.push(`${headerPrefix} ${section.title}`);
  lines.push("");

  if (section.content) {
    lines.push(section.content);
    lines.push("");
  }

  for (const subsection of section.subsections) {
    generateSectionOutput(subsection, lines);
  }
}
