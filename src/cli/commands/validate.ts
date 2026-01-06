import { resolve } from "node:path";

import type { CliFlags } from "../args";
import { createParser } from "../../parser";

/**
 * Validate a you.md file
 *
 * @param args - Positional arguments (file path)
 * @param flags - CLI flags
 * @returns Exit code (0 = valid, 1 = invalid/error)
 */
export async function validateCommand(
  args: string[],
  flags: CliFlags
): Promise<number> {
  if (args.length === 0) {
    if (!flags.quiet) {
      console.error("Error: No file path provided");
      console.error("Usage: you-md validate <path>");
    }
    return 1;
  }

  const filePath = resolve(args[0]);
  const parser = createParser();

  // Load and parse the file
  const result = await parser.loadFromPath(filePath);

  // Output as JSON if requested
  if (flags.json) {
    const output = {
      path: filePath,
      valid: result.success,
      errors: result.errors,
      warnings: result.warnings,
    };
    console.log(JSON.stringify(output, null, 2));
    return result.success ? 0 : 1;
  }

  // Parse errors
  if (!result.success) {
    if (!flags.quiet) {
      console.error(`Validation failed: ${filePath}`);
      console.error("");

      for (const error of result.errors) {
        const location = error.line ? `:${error.line}` : "";
        console.error(`  ✗ ${error.code}${location}: ${error.message}`);
      }
    }
    return 1;
  }

  // Run additional validation
  const validation = parser.validate(result.profile);

  // Report validation results
  if (!flags.quiet) {
    if (validation.valid && validation.warnings.length === 0) {
      console.log(`✓ Valid: ${filePath}`);

      if (flags.verbose) {
        console.log("");
        console.log("Profile details:");
        console.log(`  Schema version: ${result.profile.schemaVersion}`);
        console.log(`  Sections: ${result.profile.sections.size}`);

        if (result.profile.metadata.author) {
          console.log(`  Author: ${result.profile.metadata.author}`);
        }
      }
    } else if (validation.valid) {
      console.log(`✓ Valid with warnings: ${filePath}`);
      console.log("");

      for (const warning of validation.warnings) {
        console.log(`  ⚠ ${warning.code}: ${warning.message}`);
        if (warning.suggestion && flags.verbose) {
          console.log(`    → ${warning.suggestion}`);
        }
      }
    } else {
      console.error(`✗ Invalid: ${filePath}`);
      console.error("");

      for (const error of validation.errors) {
        console.error(`  ✗ ${error.code}: ${error.message}`);
      }

      if (validation.warnings.length > 0) {
        console.log("");
        for (const warning of validation.warnings) {
          console.log(`  ⚠ ${warning.code}: ${warning.message}`);
        }
      }
    }
  }

  // Also output parse warnings
  if (result.warnings.length > 0 && !flags.quiet && flags.verbose) {
    console.log("");
    console.log("Parse warnings:");
    for (const warning of result.warnings) {
      const location = warning.line ? `:${warning.line}` : "";
      console.log(`  ⚠ ${warning.code}${location}: ${warning.message}`);
    }
  }

  return validation.valid ? 0 : 1;
}
