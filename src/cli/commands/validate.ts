import { resolve } from "node:path";

import type { CliFlags } from "../args";
import { createParser } from "../../parser";
import { getSecurityWarnings } from "../../core/validator";
import { INJECTION_ALLOW_MARKER } from "../../core/injection";

/**
 * Validate a you.md file
 *
 * With `--strict`, security warnings (possible prompt injection, possible
 * sensitive data) fail validation. Use it in CI and before trusting a
 * profile you did not write yourself.
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
      console.error("Usage: you-md validate [--strict] <path>");
    }
    return 1;
  }

  const filePath = resolve(args[0]);
  const parser = createParser();

  // Load and parse the file
  const result = await parser.loadFromPath(filePath);

  // Parse errors
  if (!result.success) {
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            path: filePath,
            valid: false,
            strict: flags.strict === true,
            errors: result.errors,
            warnings: result.warnings,
            securityWarnings: [],
          },
          null,
          2
        )
      );
      return 1;
    }

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
  const securityWarnings = getSecurityWarnings(validation);
  const strictFailure = flags.strict === true && securityWarnings.length > 0;
  const valid = validation.valid && !strictFailure;

  // Output as JSON if requested
  if (flags.json) {
    const output = {
      path: filePath,
      valid,
      strict: flags.strict === true,
      errors: validation.errors,
      warnings: validation.warnings,
      securityWarnings,
      parseWarnings: result.warnings,
    };
    console.log(JSON.stringify(output, null, 2));
    return valid ? 0 : 1;
  }

  // Report validation results
  if (!flags.quiet) {
    const otherWarnings = validation.warnings.filter(
      (w) => !securityWarnings.includes(w)
    );

    if (valid && validation.warnings.length === 0) {
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
    } else if (valid) {
      console.log(`✓ Valid with warnings: ${filePath}`);
      console.log("");

      for (const warning of otherWarnings) {
        console.log(`  ⚠ ${warning.code}: ${warning.message}`);
        if (warning.suggestion && flags.verbose) {
          console.log(`    → ${warning.suggestion}`);
        }
      }
    } else if (strictFailure && validation.valid) {
      console.error(`✗ Failed (--strict): ${filePath}`);
      console.error("");

      for (const warning of otherWarnings) {
        console.log(`  ⚠ ${warning.code}: ${warning.message}`);
      }
    } else {
      console.error(`✗ Invalid: ${filePath}`);
      console.error("");

      for (const error of validation.errors) {
        console.error(`  ✗ ${error.code}: ${error.message}`);
      }

      if (otherWarnings.length > 0) {
        console.log("");
        for (const warning of otherWarnings) {
          console.log(`  ⚠ ${warning.code}: ${warning.message}`);
        }
      }
    }

    // Security warnings get their own block so they are never lost in the
    // noise of style warnings. They are the reason --strict exists.
    if (securityWarnings.length > 0) {
      console.log("");
      console.log(
        strictFailure
          ? `Security warnings (${securityWarnings.length}, failing under --strict):`
          : `Security warnings (${securityWarnings.length}):`
      );
      for (const warning of securityWarnings) {
        const marker = strictFailure ? "✗" : "⚠";
        const write = strictFailure ? console.error : console.log;
        write(`  ${marker} ${warning.code}: ${warning.message}`);
        if (warning.suggestion && flags.verbose) {
          write(`    → ${warning.suggestion}`);
        }
      }
      console.log("");
      console.log(
        "  This content is injected into every AI tool that reads the profile."
      );
      console.log(
        `  Intentional? Add <!-- ${INJECTION_ALLOW_MARKER} --> to the line, or alone on the line above. Details: --verbose`
      );
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

  return valid ? 0 : 1;
}
