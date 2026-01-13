import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

import type { CliFlags } from "../args";
import {
  getDefaultTemplate,
  getMinimalTemplate,
  getPersonalizationTemplate,
  getIdentityTemplate,
  getDeveloperTemplate,
} from "../templates/default";

/**
 * Initialize a new you.md file
 *
 * @param args - Positional arguments (optional path)
 * @param flags - CLI flags
 * @returns Exit code (0 = success, 1 = error)
 */
export async function initCommand(
  args: string[],
  flags: CliFlags
): Promise<number> {
  // Determine output path
  const outputPath = resolve(args[0] || ".you.md");

  // Check if file exists
  if (existsSync(outputPath) && !flags.force) {
    if (!flags.quiet) {
      console.error(`Error: File already exists: ${outputPath}`);
      console.error("Use --force to overwrite");
    }
    return 1;
  }

  // Get template content based on format
  let template: string;
  switch (flags.format) {
    case "identity":
      template = getIdentityTemplate();
      break;
    case "developer":
      template = getDeveloperTemplate();
      break;
    case "minimal":
      template = getMinimalTemplate();
      break;
    case "personalization":
    case "signals":
      template = getPersonalizationTemplate();
      break;
    default:
      // Default is identity template (v1.1)
      template = getDefaultTemplate();
  }

  try {
    // Ensure directory exists
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Write file
    await writeFile(outputPath, template, "utf-8");

    if (!flags.quiet) {
      console.log(`Created: ${outputPath}`);
      console.log("");
      console.log("Next steps:");
      console.log("  1. Edit the file to add your preferences");
      console.log("  2. Run 'you-md validate " + outputPath + "' to check");
    }

    return 0;
  } catch (error) {
    if (!flags.quiet) {
      console.error(`Error writing file: ${outputPath}`);
      if (flags.verbose && error instanceof Error) {
        console.error(error.message);
      }
    }
    return 1;
  }
}
