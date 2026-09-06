import { parseArgs } from "node:util";
import { getPackageVersion } from "../utils/version.js";

/**
 * CLI command types
 */
export type Command =
  | "init"
  | "validate"
  | "merge"
  | "convert"
  | "import"
  | "export"
  | "sync"
  | "skill"
  | "check"
  | "help"
  | "version";

/**
 * Parsed CLI arguments
 */
export interface CliArgs {
  /** The command to run */
  command: Command;

  /** Positional arguments for the command */
  args: string[];

  /** Flags/options */
  flags: CliFlags;
}

/**
 * CLI flags
 */
export interface CliFlags {
  /** Show help */
  help?: boolean;

  /** Show version */
  version?: boolean;

  /** Output file path */
  output?: string;

  /** Output format */
  format?: string;

  /** Suppress output */
  quiet?: boolean;

  /** Verbose output */
  verbose?: boolean;

  /** Force overwrite */
  force?: boolean;

  /** Use JSON output */
  json?: boolean;

  /** Interactive wizard mode */
  interactive?: boolean;

  /** Apply to all supported targets (export) */
  all?: boolean;

  /** Preview without writing (export) */
  dryRun?: boolean;

  /** Report drift without writing, exit 1 if any (sync) */
  check?: boolean;

  /** Add to an existing profile instead of replacing it (import) */
  merge?: boolean;
}

/**
 * Parse command line arguments
 */
export function parseCliArgs(argv: string[]): CliArgs {
  // Remove node and script path
  const args = argv.slice(2);

  // Define options
  const options = {
    help: { type: "boolean" as const, short: "h" },
    version: { type: "boolean" as const, short: "v" },
    output: { type: "string" as const, short: "o" },
    format: { type: "string" as const, short: "f" },
    quiet: { type: "boolean" as const, short: "q" },
    verbose: { type: "boolean" as const },
    force: { type: "boolean" as const },
    json: { type: "boolean" as const },
    interactive: { type: "boolean" as const, short: "i" },
    all: { type: "boolean" as const },
    "dry-run": { type: "boolean" as const },
    check: { type: "boolean" as const },
    merge: { type: "boolean" as const },
  };

  try {
    const { values, positionals } = parseArgs({
      args,
      options,
      allowPositionals: true,
    });

    // Extract command from first positional or flags
    let command: Command = "help";

    if (values.help) {
      command = "help";
    } else if (values.version) {
      command = "version";
    } else if (positionals.length > 0) {
      const cmd = positionals[0].toLowerCase();
      if (isValidCommand(cmd)) {
        command = cmd;
      }
    }

    return {
      command,
      args: positionals.slice(1),
      flags: {
        help: values.help,
        version: values.version,
        output: values.output,
        format: values.format,
        quiet: values.quiet,
        verbose: values.verbose,
        force: values.force,
        json: values.json,
        interactive: values.interactive,
        all: values.all,
        dryRun: values["dry-run"],
        check: values.check,
        merge: values.merge,
      },
    };
  } catch (error) {
    // On parse error, default to help
    return {
      command: "help",
      args: [],
      flags: {},
    };
  }
}

/**
 * Check if a string is a valid command
 */
function isValidCommand(cmd: string): cmd is Command {
  return [
    "init",
    "validate",
    "merge",
    "convert",
    "import",
    "export",
    "sync",
    "skill",
    "check",
    "help",
    "version",
  ].includes(cmd);
}

/**
 * Get help text
 */
export function getHelpText(): string {
  return `
you-md - Parser and CLI for you.md personal AI context files

Usage: you-md <command> [options] [arguments]

Commands:
  skill <subcommand>       Install/manage the you.md skill in your AI tools
  check                    Verify your profile and tool installations
  init [path]              Create a new you.md file (default: ./.you.md)
  validate <path>          Validate a you.md file
  merge <paths...>         Merge multiple you.md files
  import [files...]        Build a profile from the instruction files you already have
  convert <input>          Convert one file to you.md (alias of import <file>)
  export <target...>       Export preferences into tools' native instruction files
  sync                     Refresh previously exported files when your you.md changes
  help                     Show this help message
  version                  Show version number

Options:
  -h, --help               Show help
  -v, --version            Show version
  -o, --output <path>      Output file path
  -f, --format <format>    Template format: identity (default), developer, minimal, signals
  -i, --interactive        Interactive wizard mode
  -q, --quiet              Suppress output
  --verbose                Verbose output
  --force                  Force overwrite existing files
  --json                   Output as JSON
  --all                    Export to all supported targets / import project files too
  --dry-run                Preview export/sync/import without writing files
  --check                  Sync: report drift without writing, exit 1 if any
  --merge                  Import: add to an existing profile instead of replacing it

Examples:
  you-md skill install                     Install into all detected AI tools
  you-md skill status                      Check which tools have the skill
  you-md init -i                           Interactive wizard (easiest!)
  you-md init                              Create .you.md (identity template)
  you-md init ~/.you.md                    Create global you.md
  you-md init -f developer .you.md         Create developer-focused profile
  you-md init -f signals prefs.md          Create full personalization signals
  you-md validate ./you.md                 Validate a file
  you-md merge ~/.you.md ./.you.md         Merge user and project profiles
  you-md import --dry-run                  See which CLAUDE.md, GEMINI.md, Copilot files you have
  you-md import -o ~/.you.md               Build ~/.you.md from every user-level instruction file
  you-md import --all -o .you.md           Include this project's CLAUDE.md, .cursor/rules, and more
  you-md import -o ~/.you.md --merge       Add only what your profile is missing
  you-md convert .cursorrules              Convert one file to you.md
  you-md export claude gemini              Export to Claude Code and Gemini CLI
  you-md export --all --dry-run            Preview export to every tool
  you-md sync                              Refresh every exported file after editing you.md
  you-md sync --check                      CI drift gate: exit 1 if exports are stale

Documentation: https://github.com/briansparker/You
`.trim();
}

/**
 * Get version text
 */
export function getVersionText(): string {
  return `you-md version ${getPackageVersion()}`;
}
