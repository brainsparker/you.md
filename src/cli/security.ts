/**
 * Shared security reporting for CLI commands that push a profile into an
 * agent's context (export, sync) or vet one before use (validate).
 *
 * The scanner itself lives in core/injection.ts and runs as part of
 * validateProfile. This module decides how the CLI presents the results:
 * a warning block by default, a hard stop with `--strict`.
 */

import type { YouMdProfile } from "../types/profile";
import type { ValidationWarning } from "../types/options";
import { validateProfile, getSecurityWarnings } from "../core/validator";
import { INJECTION_ALLOW_MARKER } from "../core/injection";

export interface SecurityGateResult {
  /** Security warnings found in the profile (possible injection or sensitive data) */
  readonly warnings: ValidationWarning[];

  /** True when `--strict` was set and at least one warning was found */
  readonly blocked: boolean;
}

/**
 * Run the security checks for a profile and print the outcome.
 *
 * @param profile - The profile about to be exported, synced, or validated
 * @param options.strict - Fail (blocked: true) when any warning is present
 * @param options.quiet - Suppress output
 * @param options.action - Verb used in the summary line, e.g. "export"
 * @param options.log - Logger for the warning block (default: console.error)
 */
export function runSecurityGate(
  profile: YouMdProfile,
  options: {
    strict?: boolean;
    quiet?: boolean;
    action: string;
    log?: (msg: string) => void;
  }
): SecurityGateResult {
  const log = options.log ?? ((msg: string) => console.error(msg));
  const warnings = getSecurityWarnings(validateProfile(profile));
  const blocked = options.strict === true && warnings.length > 0;

  if (warnings.length === 0 || options.quiet) {
    return { warnings, blocked };
  }

  const source = profile.sourcePath ?? profile.sourceUrl ?? "profile";
  log(`Security warnings in ${source}:`);
  for (const line of formatSecurityWarnings(warnings)) {
    log(`  ${line}`);
  }
  log("");

  if (blocked) {
    log(
      `Refusing to ${options.action}: ${warnings.length} security warning${
        warnings.length === 1 ? "" : "s"
      } and --strict is set.`
    );
    log(
      `Review the lines above. If a line is intentional, add <!-- ${INJECTION_ALLOW_MARKER} --> to it, or alone on the line above.`
    );
  } else {
    log(
      `These lines will reach every AI tool you ${options.action} to. ` +
        `Review them before trusting the profile, or run with --strict to block.`
    );
  }
  log("");

  return { warnings, blocked };
}

/**
 * Format security warnings as display lines.
 */
export function formatSecurityWarnings(warnings: readonly ValidationWarning[]): string[] {
  return warnings.map((w) => `⚠ ${w.code}: ${w.message}`);
}
